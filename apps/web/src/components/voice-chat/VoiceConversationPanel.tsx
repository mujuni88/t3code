import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* oxlint-disable react/no-array-index-key -- Transcript events have no stable ids and these rows hold no local state. */

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import { cn } from "~/lib/utils";
import type { VoiceChatState } from "./useVoiceChat";

export function VoiceConversationPanel({ state }: { state: VoiceChatState }) {
  const [expanded, setExpanded] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.error) return;
    // Errors need to reveal their recovery guidance, but users can collapse it afterward.
    // oxlint-disable-next-line react/set-state-in-effect
    setExpanded(true);
  }, [state.error]);

  useEffect(() => {
    if (!expanded || state.transcript.length === 0 || !transcriptRef.current) return;
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [expanded, state.transcript]);

  return (
    <div className="relative z-10 mb-2">
      <Collapsible
        open={expanded}
        onOpenChange={setExpanded}
        className="overflow-hidden rounded-2xl border border-border/70 bg-card/96 text-card-foreground shadow-[0_12px_36px_-28px_rgb(0_0_0/70%)]"
      >
        <CollapsibleTrigger className="flex min-h-12 w-full items-center gap-3 px-4 text-left">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Voice conversation</span>
          <ChevronDownIcon
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div
            ref={transcriptRef}
            aria-label="Voice transcript"
            className="max-h-64 space-y-2 overflow-y-auto border-t border-border/60 px-4 py-3 text-sm"
          >
            {state.error ? (
              <p role="alert" className="leading-5 text-destructive">
                {state.error}
              </p>
            ) : state.status === "connecting" ? (
              <p className="text-muted-foreground">Connecting to GPT Live…</p>
            ) : state.transcript.length > 0 ? (
              state.transcript.map((entry, index) => (
                <p key={index} className="leading-5 text-foreground/85">
                  <span className="font-medium">
                    {entry.role === "user" ? "You" : "GPT Live"}:{" "}
                  </span>
                  {entry.text}
                </p>
              ))
            ) : (
              <p className="text-muted-foreground">Start speaking to GPT Live.</p>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
