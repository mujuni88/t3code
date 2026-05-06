import type { ServerProcessDiagnosticsResult } from "@t3tools/contracts";

import { ensureLocalApi } from "../localApi";
import { type DiagnosticsState, makeDiagnosticsAtom } from "./makeDiagnosticsAtom";

const { refresh: refreshProcessDiagnostics, useHook: useProcessDiagnostics } =
  makeDiagnosticsAtom<ServerProcessDiagnosticsResult>({
    fetch: () => ensureLocalApi().server.getProcessDiagnostics(),
    staleTimeMs: 2_000,
    idleTtlMs: 5 * 60_000,
    label: "process-diagnostics",
    errorFallback: "Failed to load process diagnostics.",
  });

export type ProcessDiagnosticsState = DiagnosticsState<ServerProcessDiagnosticsResult>;

export { refreshProcessDiagnostics, useProcessDiagnostics };
