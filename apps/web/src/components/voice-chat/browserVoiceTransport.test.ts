import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createBrowserVoiceTransport } from "./browserVoiceTransport";

const microphoneTrack = { enabled: true, stop: vi.fn(), onended: null as (() => void) | null };
const microphone = {
  getTracks: () => [microphoneTrack],
  getAudioTracks: () => [microphoneTrack],
};

class FakePeer extends EventTarget {
  static instances: FakePeer[] = [];
  connectionState = "new";
  iceGatheringState = "complete";
  localDescription = { type: "offer", sdp: "gathered-offer-sdp" };
  onconnectionstatechange: (() => void) | null = null;
  ontrack: ((event: { streams: unknown[] }) => void) | null = null;
  channel = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
    close: vi.fn(),
  };
  createDataChannel = vi.fn(() => this.channel);
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({ type: "offer", sdp: "offer-sdp" }));
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => undefined);
  close = vi.fn();
  constructor() {
    super();
    FakePeer.instances.push(this);
  }
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  autoplay = false;
  srcObject: unknown = null;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  constructor() {
    FakeAudio.instances.push(this);
  }
}

const callbacks = () => ({
  onEvent: vi.fn(),
  onConnectionState: vi.fn(),
  onAudioActivity: vi.fn(),
});

class FakeAnalyser {
  fftSize = 0;
  amplitude = 0;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  getByteTimeDomainData(data: Uint8Array) {
    data.forEach((_, index) => {
      data[index] = 128 + (index % 2 === 0 ? this.amplitude : -this.amplitude);
    });
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static failSource = false;
  analysers: FakeAnalyser[] = [];
  createMediaStreamSource = vi.fn(() => {
    if (FakeAudioContext.failSource) throw new Error("meter unavailable");
    return { connect: vi.fn(), disconnect: vi.fn() };
  });
  createAnalyser = vi.fn(() => {
    const analyser = new FakeAnalyser();
    this.analysers.push(analyser);
    return analyser;
  });
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

beforeEach(() => {
  FakePeer.instances = [];
  FakeAudio.instances = [];
  FakeAudioContext.instances = [];
  FakeAudioContext.failSource = false;
  microphoneTrack.enabled = true;
  microphoneTrack.stop.mockReset();
  microphoneTrack.onended = null;
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => microphone) } });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("browser voice transport", () => {
  it("negotiates microphone-only audio and releases resources exactly once", async () => {
    const transport = await createBrowserVoiceTransport(callbacks());
    const peer = FakePeer.instances[0]!;
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    expect(peer.addTrack).toHaveBeenCalledWith(microphoneTrack, microphone);
    expect(await transport.createOffer()).toBe("gathered-offer-sdp");
    await transport.acceptAnswer("answer-sdp");
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "answer-sdp" });
    transport.setMuted(true);
    expect(microphoneTrack.enabled).toBe(false);
    transport.setMuted(false);
    expect(microphoneTrack.enabled).toBe(true);
    transport.close();
    transport.close();
    expect(microphoneTrack.stop).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(peer.channel.close).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances[0]!.srcObject).toBe(null);
    expect(peer.ontrack).toBe(null);
    await expect(transport.acceptAnswer("late-answer")).rejects.toThrow("cancelled");
  });

  it("reports connection and transcript events and ignores malformed messages", async () => {
    const handlers = callbacks();
    const transport = await createBrowserVoiceTransport(handlers);
    const peer = FakePeer.instances[0]!;
    peer.channel.onmessage?.({ data: "not-json" });
    const event = { type: "session.output_transcript.delta", delta: "Hello" };
    peer.channel.onmessage?.({ data: JSON.stringify(event) });
    expect(handlers.onEvent).toHaveBeenCalledExactlyOnceWith(event);
    peer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    expect(handlers.onConnectionState).toHaveBeenCalledWith("connected");
    microphoneTrack.onended?.();
    expect(handlers.onConnectionState).toHaveBeenLastCalledWith("failed");
    transport.close();
  });

  it("reports microphone and assistant audio immediately, then returns to idle", async () => {
    vi.useFakeTimers();
    const handlers = callbacks();
    const transport = await createBrowserVoiceTransport(handlers);
    const input = FakeAudioContext.instances[0]!.analysers[0]!;

    input.amplitude = 24;
    await vi.advanceTimersByTimeAsync(80);
    expect(handlers.onAudioActivity).toHaveBeenLastCalledWith("user");

    input.amplitude = 0;
    FakePeer.instances[0]!.ontrack?.({ streams: [{}] });
    const output = FakeAudioContext.instances[0]!.analysers[1]!;
    output.amplitude = 24;
    await vi.advanceTimersByTimeAsync(320);
    expect(handlers.onAudioActivity).toHaveBeenLastCalledWith("assistant");

    output.amplitude = 0;
    await vi.advanceTimersByTimeAsync(320);
    expect(handlers.onAudioActivity).toHaveBeenLastCalledWith("idle");
    transport.close();
  });

  it("keeps voice available when optional audio metering cannot start", async () => {
    FakeAudioContext.failSource = true;
    const handlers = callbacks();

    const transport = await createBrowserVoiceTransport(handlers);

    expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalledOnce();
    expect(handlers.onAudioActivity).not.toHaveBeenCalled();
    expect(FakePeer.instances[0]!.addTrack).toHaveBeenCalledWith(microphoneTrack, microphone);
    transport.close();
  });

  it("reports data-channel failure even when the audio peer remains connected", async () => {
    const handlers = callbacks();
    const transport = await createBrowserVoiceTransport(handlers);
    const peer = FakePeer.instances[0]!;
    peer.connectionState = "connected";
    peer.channel.onerror?.();
    expect(handlers.onConnectionState).toHaveBeenLastCalledWith("failed");
    peer.channel.onclose?.();
    expect(handlers.onConnectionState).toHaveBeenLastCalledWith("closed");
    transport.close();
    expect(peer.channel.onerror).toBeNull();
    expect(peer.channel.onclose).toBeNull();
  });

  it("waits for ICE candidates and returns the final local description", async () => {
    const transport = await createBrowserVoiceTransport(callbacks());
    const peer = FakePeer.instances[0]!;
    peer.iceGatheringState = "gathering";
    const offer = transport.createOffer();
    const resolved = vi.fn();
    void offer.then(resolved);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    peer.localDescription.sdp = "offer-with-candidates";
    peer.iceGatheringState = "complete";
    peer.dispatchEvent(new Event("icegatheringstatechange"));
    expect(await offer).toBe("offer-with-candidates");
    transport.close();
  });

  it("cancels pending ICE gathering immediately on close", async () => {
    const transport = await createBrowserVoiceTransport(callbacks());
    FakePeer.instances[0]!.iceGatheringState = "gathering";
    const offer = transport.createOffer();
    const rejected = expect(offer).rejects.toThrow("cancelled");
    await Promise.resolve();
    await Promise.resolve();
    transport.close();
    await rejected;
  });

  it("bounds ICE gathering instead of hanging forever", async () => {
    vi.useFakeTimers();
    const transport = await createBrowserVoiceTransport(callbacks());
    FakePeer.instances[0]!.iceGatheringState = "gathering";
    const rejected = expect(transport.createOffer()).rejects.toThrow("could not reach the network");
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    transport.close();
  });

  it("surfaces autoplay denial instead of leaving a silent call connected", async () => {
    const handlers = callbacks();
    const transport = await createBrowserVoiceTransport(handlers);
    const audio = FakeAudio.instances[0]!;
    audio.play.mockRejectedValueOnce(new Error("autoplay denied"));
    const remoteStream = {};
    FakePeer.instances[0]!.ontrack?.({ streams: [remoteStream] });
    await Promise.resolve();
    expect(audio.srcObject).toBe(remoteStream);
    expect(handlers.onEvent).toHaveBeenCalledWith({
      type: "error",
      error: { message: expect.stringContaining("Audio playback was blocked") },
    });
    transport.close();
  });

  it("does not report an autoplay error after the call ended", async () => {
    const handlers = callbacks();
    const transport = await createBrowserVoiceTransport(handlers);
    FakeAudio.instances[0]!.play.mockRejectedValueOnce(new Error("autoplay denied"));
    FakePeer.instances[0]!.ontrack?.({ streams: [{}] });
    transport.close();
    await Promise.resolve();
    expect(handlers.onEvent).not.toHaveBeenCalled();
  });

  it("explains microphone denial without creating a peer", async () => {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await expect(createBrowserVoiceTransport(callbacks())).rejects.toThrow(
      "Microphone access was denied",
    );
    expect(FakePeer.instances).toHaveLength(0);
  });

  it("stops the microphone when peer construction fails", async () => {
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        constructor() {
          throw new Error("RTC unavailable");
        }
      },
    );
    await expect(createBrowserVoiceTransport(callbacks())).rejects.toThrow("RTC unavailable");
    expect(microphoneTrack.stop).toHaveBeenCalledExactlyOnceWith();
  });

  it("closes the peer and microphone when data-channel setup fails", async () => {
    vi.stubGlobal(
      "RTCPeerConnection",
      class extends FakePeer {
        override createDataChannel = vi.fn(() => {
          throw new Error("channel unavailable");
        });
      },
    );
    await expect(createBrowserVoiceTransport(callbacks())).rejects.toThrow("channel unavailable");
    expect(microphoneTrack.stop).toHaveBeenCalledExactlyOnceWith();
    expect(FakePeer.instances[0]!.close).toHaveBeenCalledExactlyOnceWith();
  });
});
