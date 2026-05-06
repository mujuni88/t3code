[second-opinion] Querying gpt-5.3-codex (reasoning=xhigh, max_completion=128000) with 22 tools...
[second-opinion] Model gpt-5.3-codex does not support: temperature, reasoning_effort. Retrying without.
[iteration 1] Calling: read_file, read_file, read_file, read_file, read_file, read_file, read_file, read_file
[second-opinion] Complete after 2 iteration(s)
**SHIP WITH CHANGES**

1. **The seam is mostly real, but not clean enough to call “Codex confined”: `raw` is a direct Codex escape hatch and the adapter intentionally forwards Codex payloads wholesale.**  
   `ProviderRuntimeEventBase` explicitly includes `raw?: { source, method, payload }` (`t3code/packages/contracts/src/providerRuntime.ts:246-260` as cited in REPORT), and `CodexAdapter.runtimeEventBase` always sets `raw` + many events copy `event.payload` into canonical payload fields (`t3code/apps/server/src/provider/Layers/CodexAdapter.ts`, e.g. `runtimeEventBase`, `request.opened.payload.args`, multiple `...detail: event.payload`). If web code reads `raw.payload`, your “renderer-neutral” claim is weaker than stated.

2. **PR5 is mis-scoped and high-risk: approval bridge + tool-event mapping are two separate reviewer questions and should be split.**  
   PHASE2 bundles both in PR5 (`PHASE2-PLAN.md`, PR5 description), but tool lifecycle mapping (`tool_execution_start/update/end`→`item.*`) is straightforward translation, while synthetic approval via Deferred from `beforeToolCall` is concurrency/cancellation semantics design. Split into **PR5a tool item mapping** and **PR5b approval bridge**.

3. **Approval bridge ordering is wrong: put approval bridge before “full mutation support” is declared done, or you’ll ship unsafe writes in between.**  
   PR4 introduces sendTurn + attachments, PR5 later adds gating (`PHASE2-PLAN.md` PR4/PR5). In pi, write/edit/bash are normal tools; without gating they execute immediately. If v1 posture is “approval-required runtime mode” parity with Codex approvals, PR4 as written creates a temporary policy regression.

4. **PR2/PR3 coupling is real; either merge or narrow PR2 to avoid fake progress.**  
   PR2 says lifecycle bridge with `streamEvents = Stream.empty` (`PHASE2-PLAN.md` PR2). That’s not independently behavior-valid beyond teardown; all user-facing correctness begins in PR3 mapping. I’d either merge PR2+PR3 or keep PR2 but shrink it to pure resource lifecycle with explicit non-functional label.

5. **Your default “hide plan mode for pi” is correct, but it is load-bearing and should move earlier than PR10.**  
   Codex has explicit plan/proposal event family (`turn.proposed.delta/completed`, `turn/plan/updated`) mapped in `CodexAdapter.ts`; pi `AgentEvent` has no analog (`pi-mono/packages/agent/src/types.ts`, `AgentEvent` union). Waiting until PR10 means interim UI can expose controls the backend can’t honor. Move hide/guard into first UI PR (PR9), not polish tail.

6. **“Coexist for v1” is right technically, but your text-generation split risks semantic drift because Codex text-gen is currently separate infra path.**  
   REPORT notes `CodexTextGeneration.ts` is an independent `codex exec` path; PHASE2 PR7 swaps to `streamSimple`. Fine, but this is not just plumbing — prompt behavior/provider auth/error surfaces differ. Keep PR7 isolated (good), but require fixture parity checks before merge.

7. **Unverified Appendix claims are load-bearing for risk, especially `event.raw` usage and rpc/protocol assumptions.**  
   If web consumes `event.raw.payload`, your seam is leaky and PR3/PR5 mapping must preserve more Codex-native structure. If `pi --rpc` works poorly, fallback architecture options collapse. If `openai-codex-responses` is unrelated (likely), any “protocol compatibility” hope is dead and reinforces adapter-first plan. These materially affect PR1 scope confidence.

### Smallest plan changes I’d make

- Split PR5 into **PR5a tool lifecycle mapping** and **PR5b approval bridge (Deferred + respondToRequest)**.  
- Move **plan-toggle hiding + unsupported affordance guards** from PR10 into PR9.  
- Add a **pre-PR1 verification gate**: grep web for `raw` consumption and codex-shaped payload assumptions.  
- Keep PR2 but explicitly non-user-facing; otherwise merge PR2+PR3.  
- Add explicit tests in PR5b for: parallel tool calls, abort while waiting approval, stale request resolution after abort/stop, and pending-request cleanup on session reload/resume.
