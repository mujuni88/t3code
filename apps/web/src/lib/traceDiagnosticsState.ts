import type { ServerTraceDiagnosticsResult } from "@t3tools/contracts";

import { ensureLocalApi } from "../localApi";
import { type DiagnosticsState, makeDiagnosticsAtom } from "./makeDiagnosticsAtom";

const { refresh: refreshTraceDiagnostics, useHook: useTraceDiagnostics } =
  makeDiagnosticsAtom<ServerTraceDiagnosticsResult>({
    fetch: () => ensureLocalApi().server.getTraceDiagnostics(),
    staleTimeMs: 5_000,
    idleTtlMs: 5 * 60_000,
    label: "trace-diagnostics",
    errorFallback: "Failed to load trace diagnostics.",
  });

export type TraceDiagnosticsState = DiagnosticsState<ServerTraceDiagnosticsResult>;

export { refreshTraceDiagnostics, useTraceDiagnostics };
