import type {
  LiveVoiceActivity,
  LiveVoiceTransportCallbacks,
} from "@t3tools/client-runtime/live-voice";

const ACTIVITY_SAMPLE_MS = 80;
const ACTIVITY_RELEASE_MS = 240;
const ACTIVITY_THRESHOLD = 0.04;

interface ActivityMeter {
  analyser: AnalyserNode;
  samples: Uint8Array<ArrayBuffer>;
  source: MediaStreamAudioSourceNode;
}

function createAudioActivityMonitor(onActivity: (activity: LiveVoiceActivity) => void) {
  if (typeof AudioContext === "undefined") return null;
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return null;
  }
  let input: ActivityMeter | null = null;
  let output: ActivityMeter | null = null;
  let inputMuted = false;
  let current: LiveVoiceActivity = "idle";
  let lastUserAt = Number.NEGATIVE_INFINITY;
  let lastAssistantAt = Number.NEGATIVE_INFINITY;

  const createMeter = (stream: MediaStream) => {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    return { source, analyser, samples: new Uint8Array(analyser.frequencyBinCount) };
  };
  const level = (meter: ActivityMeter | null) => {
    if (!meter) return 0;
    meter.analyser.getByteTimeDomainData(meter.samples);
    let sum = 0;
    for (const sample of meter.samples) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    return Math.sqrt(sum / meter.samples.length);
  };
  const sample = () => {
    const now = Date.now();
    if (!inputMuted && level(input) >= ACTIVITY_THRESHOLD) lastUserAt = now;
    if (level(output) >= ACTIVITY_THRESHOLD) lastAssistantAt = now;
    const next: LiveVoiceActivity =
      !inputMuted && now - lastUserAt <= ACTIVITY_RELEASE_MS
        ? "user"
        : now - lastAssistantAt <= ACTIVITY_RELEASE_MS
          ? "assistant"
          : "idle";
    if (next !== current) {
      current = next;
      onActivity(next);
    }
  };
  const interval = setInterval(sample, ACTIVITY_SAMPLE_MS);
  void context.resume().catch(() => undefined);

  return {
    setInput(stream: MediaStream) {
      input?.source.disconnect();
      input = createMeter(stream);
    },
    setOutput(stream: MediaStream) {
      output?.source.disconnect();
      output = createMeter(stream);
    },
    setInputMuted(muted: boolean) {
      inputMuted = muted;
      if (muted) lastUserAt = Number.NEGATIVE_INFINITY;
      sample();
    },
    close() {
      clearInterval(interval);
      input?.source.disconnect();
      output?.source.disconnect();
      input = null;
      output = null;
      void context.close().catch(() => undefined);
    },
  };
}

export async function createBrowserVoiceTransport(options: LiveVoiceTransportCallbacks) {
  if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
    throw new Error("Voice chat needs microphone access in the desktop app or an HTTPS browser.");
  }

  let microphone: MediaStream;
  try {
    microphone = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "NotAllowedError") {
      throw new Error(
        "Microphone access was denied. Allow it in your browser or system settings, then try again.",
        { cause: error },
      );
    }
    throw error;
  }

  let peer: RTCPeerConnection;
  try {
    peer = new RTCPeerConnection();
  } catch (error) {
    for (const track of microphone.getTracks()) track.stop();
    throw error;
  }
  let audio: HTMLAudioElement;
  let channel: RTCDataChannel;
  try {
    audio = new Audio();
    audio.autoplay = true;
    channel = peer.createDataChannel("oai-events");
  } catch (error) {
    for (const track of microphone.getTracks()) track.stop();
    peer.close();
    throw error;
  }
  let closed = false;
  const lifetime = new AbortController();
  let activityMonitor = createAudioActivityMonitor(options.onAudioActivity);
  try {
    activityMonitor?.setInput(microphone);
  } catch {
    activityMonitor?.close();
    activityMonitor = null;
  }

  const close = () => {
    if (closed) return;
    closed = true;
    lifetime.abort();
    channel.onmessage = null;
    channel.onclose = null;
    channel.onerror = null;
    peer.ontrack = null;
    peer.onconnectionstatechange = null;
    for (const track of microphone.getTracks()) {
      track.onended = null;
      track.stop();
    }
    activityMonitor?.close();
    audio.pause();
    audio.srcObject = null;
    channel.close();
    peer.close();
  };

  try {
    for (const track of microphone.getAudioTracks()) {
      peer.addTrack(track, microphone);
      track.onended = () => {
        if (!closed) options.onConnectionState("failed");
      };
    }
    channel.onmessage = (event) => {
      if (closed || typeof event.data !== "string") return;
      try {
        options.onEvent(JSON.parse(event.data));
      } catch {
        // Non-JSON messages do not change call state.
      }
    };
    channel.onclose = () => {
      if (!closed) options.onConnectionState("closed");
    };
    channel.onerror = () => {
      if (!closed) options.onConnectionState("failed");
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (
        !closed &&
        (state === "connected" ||
          state === "disconnected" ||
          state === "failed" ||
          state === "closed")
      ) {
        options.onConnectionState(state);
      }
    };
    peer.ontrack = (event) => {
      if (closed) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      try {
        activityMonitor?.setOutput(stream);
      } catch {
        activityMonitor?.close();
        activityMonitor = null;
      }
      void audio.play().catch(() => {
        if (closed) return;
        options.onEvent({
          type: "error",
          error: {
            message:
              "Audio playback was blocked. Allow sound for this app, then start voice chat again.",
          },
        });
      });
    };
  } catch (error) {
    close();
    throw error;
  }

  return {
    async createOffer() {
      const offer = await peer.createOffer();
      if (closed) throw new Error("Voice chat was cancelled.");
      await peer.setLocalDescription(offer);
      if (closed) throw new Error("Voice chat was cancelled.");
      // This exchange sends one SDP offer, so include gathered candidates before sending it.
      if (peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const finish = (error?: Error) => {
            clearTimeout(timeout);
            peer.removeEventListener("icegatheringstatechange", onGatheringChange);
            lifetime.signal.removeEventListener("abort", onAbort);
            if (error) reject(error);
            else resolve();
          };
          const onGatheringChange = () => {
            if (peer.iceGatheringState === "complete") finish();
          };
          const onAbort = () => finish(new Error("Voice chat was cancelled."));
          const timeout = setTimeout(
            () => finish(new Error("The voice connection could not reach the network. Try again.")),
            10_000,
          );
          peer.addEventListener("icegatheringstatechange", onGatheringChange);
          lifetime.signal.addEventListener("abort", onAbort, { once: true });
          onGatheringChange();
          if (lifetime.signal.aborted) onAbort();
        });
      }
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Could not prepare the voice connection.");
      return sdp;
    },
    async acceptAnswer(sdp: string) {
      if (closed) throw new Error("Voice chat was cancelled.");
      await peer.setRemoteDescription({ type: "answer", sdp });
    },
    setMuted(muted: boolean) {
      for (const track of microphone.getAudioTracks()) track.enabled = !muted;
      activityMonitor?.setInputMuted(muted);
    },
    close,
  };
}
