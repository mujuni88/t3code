import { MicIcon, MicOffIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import type { VoiceChatState } from "./useVoiceChat";

type VoiceIndicatorState = "connecting" | "idle" | "user" | "assistant" | "muted" | "error";

const compactBars = [
  { id: "one", height: 5, delay: 0, duration: 620 },
  { id: "two", height: 8, delay: -137, duration: 703 },
  { id: "three", height: 4, delay: -274, duration: 786 },
  { id: "four", height: 7, delay: -411, duration: 869 },
];
const activeBars = [
  { ...compactBars[0]!, height: 10 },
  { ...compactBars[1]!, height: 15 },
  { ...compactBars[2]!, height: 8 },
  { ...compactBars[3]!, height: 13 },
];

function VoiceStatusIndicator({ state }: { state: VoiceChatState }) {
  const activity: VoiceIndicatorState = state.muted
    ? "muted"
    : state.status === "connected"
      ? state.activity
      : state.status === "error"
        ? "error"
        : "connecting";
  const compact = activity !== "user" && activity !== "assistant";
  const animated = activity === "idle" || activity === "user" || activity === "assistant";
  const label =
    activity === "muted"
      ? "Muted"
      : activity === "user"
        ? "Hearing you"
        : activity === "assistant"
          ? "Responding"
          : activity === "error"
            ? "Voice chat error"
            : activity === "connecting"
              ? "Connecting"
              : "Listening";
  const color =
    activity === "muted" || activity === "error"
      ? "text-red-400"
      : activity === "user"
        ? "text-[var(--voice-user-pastel)]"
        : activity === "assistant"
          ? "text-[var(--voice-assistant-pastel)]"
          : activity === "connecting"
            ? "text-muted-foreground/55"
            : "text-[var(--voice-listening-pastel)]";

  return (
    <span
      className={cn("flex size-7 shrink-0 items-center justify-center", color)}
      role="status"
      aria-label={label}
      data-voice-status={activity}
    >
      <span className="flex h-4 items-center gap-[2px]" aria-hidden="true">
        {(compact ? compactBars : activeBars).map(({ id, height, delay, duration }) => (
          <span
            key={id}
            className={cn(
              "w-0.5 rounded-full bg-current",
              animated &&
                "motion-safe:animate-[voice-equalizer_680ms_ease-in-out_infinite] motion-reduce:animate-none",
            )}
            style={{
              height,
              animationDelay: `${delay}ms`,
              animationDuration: `${duration}ms`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

export function VoiceChatControls({
  state,
  onClose,
  onMutedChange,
}: {
  state: VoiceChatState;
  onClose: () => void;
  onMutedChange: (muted: boolean) => void;
}) {
  const inactive = state.status === "idle" || state.status === "error";
  return (
    <div
      className="flex h-7 items-center overflow-hidden rounded-full"
      role="group"
      aria-label="Voice chat controls"
      data-voice-controls
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn("rounded-full", state.muted && "text-red-400")}
              disabled={inactive}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => onMutedChange(!state.muted)}
              aria-label={state.muted ? "Unmute voice chat" : "Mute voice chat"}
              aria-pressed={state.muted}
            />
          }
        >
          {state.muted ? <MicOffIcon /> : <MicIcon />}
        </TooltipTrigger>
        <TooltipPopup>{state.muted ? "Unmute" : "Mute"}</TooltipPopup>
      </Tooltip>
      <VoiceStatusIndicator state={state} />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onClose}
              aria-label="End voice chat"
            />
          }
        >
          <XIcon />
        </TooltipTrigger>
        <TooltipPopup>End voice chat</TooltipPopup>
      </Tooltip>
    </div>
  );
}
