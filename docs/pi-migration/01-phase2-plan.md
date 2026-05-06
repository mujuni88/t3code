# Phase 2: Stacked-PR Plan — pi-mono as a t3code provider

Status: revised after second-opinion review (gpt-5.3-codex, verdict: SHIP WITH CHANGES). Six pushbacks integrated below.

## Defaults assumed (override before kicking off PR1)

| # | Question | Default chosen | Why this default |
|---|---|---|---|
| 1 | Embed vs. RPC | **Embed** via `createAgentSessionRuntime` | Matches `pi-gui`; no extra process; preserves types. |
| 2 | Coexist vs. replace | **Coexist for v1**, retirement is a separate decision after pi proves out | Reversible; reviewable; lets you A/B in real use. |
| 3 | Providers / auth modes for v1 | **Anthropic (OAuth + API key) + OpenAI API key** | Covers ~all your daily use; defers Bedrock/Google/Mistral. |
| 4 | Plan mode under pi | **Hide the toggle when driver=pi for v1** (moved to PR9, not PR10) | System-prompt emulation is a rabbit hole; re-add later if missed. |

Other defaults (lower-stakes):

- `tool_user_input`: skip for v1 (no pi-native analog).
- `rollbackThread(N)`: implement as fork-by-entry-id; renderer translates N → entry id.
- `PiSettings`: mirror `CodexSettings` (multi-instance, per-instance `agentDir`).
- Text generation: `streamSimple` from `pi-ai`, not `pi --rpc exec`.
- Telemetry: keep `Identify.ts` Codex-only for now; pi-only id deferred.

## Stack shape

`gate → schema/skeleton → lifecycle → read-only events → mutations(read-only tools) → tool items → approvals → history → text-gen → auth → settings UI + plan-mode hide → polish`

11 PRs in v1 (was 10, split PR5 into 5a/5b) plus a pre-PR1 verification gate (PR0) and an optional retirement PR (PR11).

## The stack

0. **`(gate) audit: web consumption of event.raw / Codex-shaped payloads`** — grep `apps/web/` for `event.raw`, `raw.payload`, and any reads of Codex-native shapes. Output a written finding: clean (proceed) or list of files where renderer assumes Codex shape. If anything material shows up, PR3's mapping scope grows to preserve `raw` shape. Not a code PR — a written verification report committed at `docs/pi-migration/pr0-raw-audit.md`. · reviewer validates *the seam is as clean as REPORT.md §3 claims, or here's where it isn't*.

1. **`feat(pi): settings schema + unavailable PiDriver skeleton`** — adds `PiSettings` to `packages/contracts/src/settings.ts`, registers `PiDriver` in `apps/server/src/provider/builtInDrivers.ts`, `create()` returns a `ProviderInstance` whose adapter reports `capabilities: { available: false }`. No pi import yet. · reviewer validates *the new driver is registered without perturbing the existing four* · excludes any pi runtime · enables every later layer.

2. **`infra(pi): Effect lifecycle bridge for AgentSessionRuntime`** *(non-user-facing; explicitly infra-only)* — `apps/server/src/provider/Layers/PiSessionRuntime.ts`: `Effect.acquireRelease` around `createAgentSessionRuntime`, abort-signal wiring, scope teardown. `streamEvents` is `Stream.empty`. **Labeled as infra commit; reviewer is told upfront there is no behavioral change to validate beyond start/stop.** · reviewer validates *pi processes start, attach, and shut down cleanly under Effect's scope semantics* · excludes any user-visible behavior · enables PR3.

3. **`feat(pi): AgentEvent → ProviderRuntimeEvent read-only mapping`** — `PiAdapter.ts` translation: `agent_start/turn_start/turn_end/message_start/message_update/message_end` → `session.started`, `turn.started`, `turn.completed`, `item.started`, `item.completed`, `content.delta` (5-value `streamKind` derived from `assistantMessageEvent`). No tool events, no approvals. Largest single PR. · reviewer validates *a streamed assistant response renders identically to the Codex path* · excludes mutations, tool events, approvals, history · enables PR4.

4. **`feat(pi): sendTurn + interruptTurn + image attachments (read-only tools only)`** — `prompt(message, images)` and `abort()` wired through `ProviderAdapterShape`; `attachments: { type: "image", url: "data:..." }` → pi `ImageContent[]`. **Pi tool registry restricted to read-only tools (`createReadOnlyTools`) until PR5b lands.** This avoids a window where bash/edit/write execute without approval gating. · reviewer validates *send → stream → cancel works end-to-end with read-only tools, no unsafe writes possible* · excludes approvals, mutating tools, history, plan mode · enables PR5a.

5. **`feat(pi): tool-event lifecycle mapping`** *(was PR5 part 1)* — `tool_execution_start/update/end` → `item.started/item.completed` for tool items; result/error rendering. Read-only tool surface only — still no mutating tools enabled. · reviewer validates *tool calls render correctly in the timeline* · excludes approval gating · enables PR5b.

6. **`feat(pi): approval bridge — Deferred + respondToRequest, enable mutating tools`** *(was PR5 part 2; the architectural-novelty PR)* — `beforeToolCall` parks a `Deferred` and emits a synthetic `request.opened` (`requestType` derived from tool name: `bash`→`command_execution_approval`, `edit`/`write`→`file_change_approval`); `respondToRequest` resolves the Deferred. Pending-approval map lives in `PiSessionRuntime`. **Mutating tools (`createCodingTools`) enabled in PR4's tool registry as part of this PR.** Required tests: parallel tool calls, abort during pending approval, stale request resolution after abort/stop, pending-request cleanup on session resume. · reviewer validates *mutations are gated and resolve correctly under approve, deny, abort, parallel, and resume* · excludes `tool_user_input` (deferred) · enables PR7.

7. **`feat(pi): readThread + rollback (fork by entry id)`** *(was PR6)* — `readThread` maps to `SessionManager.getMessages`; `rollbackThread(N)` resolves N→entry id then calls `fork(entryId)`. Resume cursor schema: `PiResumeCursorSchema = Schema.Struct({ sessionId: Schema.String })`. · reviewer validates *history reads, resumes, and rollbacks behave like the Codex equivalent at the renderer boundary* · excludes UI changes · enables PR10.

8. **`feat(pi): text-generation via streamSimple (with parity fixtures)`** *(was PR7)* — `apps/server/src/textGeneration/PiTextGeneration.ts` calls `streamSimple` from `pi-ai` directly with the existing `TextGenerationPrompts`; selected when active provider is pi. Replaces `codex exec` for commit messages, PR titles, branch names. **Includes side-by-side fixture tests: same prompt → Codex output vs pi output, recorded as golden files. Differences must be reviewed, not silently merged.** · reviewer validates *commit messages and PR titles still generate, and prompt/output behavior is documented vs Codex baseline* · excludes UI · independent leaf.

9. **`feat(pi): auth endpoints — API key + Anthropic OAuth`** *(was PR8)* — `apps/server/src/provider/Layers/PiAuthService.ts`: writes/reads `~/.pi/agent/auth.json` via pi's `AuthStorage`; tRPC endpoints for "set API key", "start OAuth", "complete OAuth". OAuth flow uses `pi-ai/oauth` helpers. No UI. · reviewer validates *credentials land in pi's auth store and are readable on next session* · excludes UI · enables PR10.

10. **`feat(pi): settings panel + driver metadata + plan-mode/affordance guards`** *(was PR9, with PR10's UX guards pulled forward)* — `providerDriverMeta.ts` entry, icon in `providerIconUtils.ts`, settings form in `SettingsPanels.tsx` for API key + OAuth, model picker reads `ModelRegistry`. **When `driver=pi`: hide plan-mode toggle, hide MCP-OAuth/rate-limit/sandbox panels, hide `tool_user_input` affordances. Pulled forward from old PR10 because the first user-clickable PR cannot expose controls the backend can't honor.** · reviewer validates *a fresh user can configure pi from the UI, select it for a thread, and not see any control pi can't satisfy* · enables PR11.

11. **`test(pi): integration smoke + remaining polish`** *(was PR10, now slimmer)* — integration smoke test in `apps/server/integration/`: one prompt → one response → one tool approval → render. Any remaining UX nits not folded into PR10. · reviewer validates *end-to-end loop works under realistic conditions* · v1 ships here.

12. **(deferred / separate decision) `chore(codex): retire Codex driver`** — delete `CodexDriver`, `CodexAdapter`, `CodexSessionRuntime`, `effect-codex-app-server`, `CodexTextGeneration`, related tests, `Identify.ts` Codex hook, settings migrations to drop `CodexSettings`. Only if you opt to replace rather than coexist.

## What changed vs the v1 draft

- **Added PR0** — pre-PR1 verification gate (grep web for `event.raw` consumption). Peer flagged the seam-cleanliness claim was unverified.
- **Split PR5 → PR5a (tool lifecycle) + PR5b (approval bridge)** — different reviewer questions (mechanical mapping vs. concurrency design).
- **PR4 restricted to read-only tools** — closes the unsafe-writes window between PR4 and PR5b.
- **PR2 explicitly labeled non-user-facing infra** — was pretending to have independent behavioral value.
- **Plan-mode hide moved from PR10 → PR10 (was old PR9 / new PR10)** — must land with the first UI PR, not the polish tail.
- **PR8 (text-gen) requires parity fixtures** — different auth surfaces and error shapes vs `codex exec`.
- **PR5b test bar made explicit** — parallel tool calls, abort during pending approval, stale request resolution, session-resume cleanup.

## Sizing notes

- PR3 is the only PR likely to push past the 200-line ideal. Translation tables are inherently long; splitting them under-validates each half.
- PR5b is the only PR with real architectural novelty. Worth a synchronous walkthrough before merge.
- PR9 (auth endpoints) and PR10 (UI + guards) deliberately split. OAuth scrutiny shouldn't be diluted by settings-form nits.

## What this stack does not include

- Plan-mode emulation under pi.
- `tool_user_input` parity.
- Telemetry parity (`Identify.ts` pi equivalent).
- Multi-account "shadow home" for pi.
- Bedrock / Google / Mistral providers.
- Codex deletion (gated separately as PR12).

## Branch naming

Per personal-repo convention: `mujuni88/pi-NN-<slug>`. Stack lives on the `mujuni88/t3code` fork, not upstream `pingdotgg/t3code`.

## Before PR1

PR0 (the verification gate) runs first. If grep returns clean: proceed with PR1 as written. If grep returns Codex-shape consumption in the renderer: PR3 expands to preserve more of the `raw` payload, and we revisit before unblocking PR1.
