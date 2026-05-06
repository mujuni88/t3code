# Spike: pi-mono as a t3code provider — vertical slice

**Goal:** prove pi-mono can drive the t3code GUI end-to-end. One prompt sent, one streamed response, rendered identically to the Codex path.

This is a side project. There are no peer reviewers. Stacked PRs are not the right shape. **One branch, one commit acceptable, ship the smallest thing that works.**

## Acceptance criteria

The spike is done when **all** of these are true:

1. `bun dev` (or the equivalent dev server invocation in this repo) starts without errors.
2. From the GUI, the user can create a new thread with the pi driver selected.
3. The user can type a prompt and submit it.
4. The assistant's response streams into the chat view in real time.
5. The streamed response renders correctly — assistant text shows as assistant text, no raw event payloads visible, no rendering errors in the console.
6. The thread can be closed and the dev server stopped without orphaned processes.

That's it. No more, no less.

## Constraints

These are hard constraints. Generator: do not relax them.

- **Embed pi as a library**, not RPC. Use `createAgentSessionRuntime` from `@mariozechner/pi-coding-agent`, the same way `pi-gui/packages/pi-sdk-driver/src/session-supervisor.ts` does.
- **Read-only tools only.** Use `createReadOnlyTools` from pi. Do not enable `bash`, `edit`, `write`. This means we don't need an approval bridge.
- **Auth via env var.** Read `ANTHROPIC_API_KEY` from process env. Do not build a settings UI. Do not write to `~/.pi/agent/auth.json`. Do not implement OAuth.
- **Anthropic only.** Hardcode `model = "claude-3-5-sonnet"` (or the latest stable equivalent — verify in pi's `ModelRegistry`). No model picker.
- **Coexist with Codex.** Do not modify, refactor, or remove any Codex code. The pi driver is a **5th driver alongside** Codex/Claude/Cursor/OpenCode.
- **No persistence changes.** Use whatever pi gives you for session state. Do not add new event types, contracts, or migrations.

## Reference reading (read in this order)

1. `docs/pi-migration/00-phase1-investigation.md` — full investigation. Section 3 (the seam) and section 1 (Codex integration shape) are load-bearing. Section 2 explains pi's API.
2. `docs/pi-migration/pr0-raw-audit.md` — confirms `event.raw` is not consumed by the renderer, so adapter can emit a generic raw shape.
3. `apps/server/src/provider/ProviderDriver.ts` — the SPI you implement.
4. `apps/server/src/provider/builtInDrivers.ts` — register the new driver here.
5. `apps/server/src/provider/Layers/CodexAdapter.ts` — reference for what `ProviderAdapterShape` implementations look like. **Do not copy Codex-specific concepts.** Use it to understand the shape, not to mimic it.

The pi-mono and pi-gui repos are at `/tmp/pi-investigation/pi-mono` and `/tmp/pi-investigation/pi-gui` if you need to read pi's API or the reference adapter.

## What's intentionally out of scope

These all live in `docs/pi-migration/backlog.md`. Do not implement any of them in this spike:

- Approval bridge / `beforeToolCall` Deferred map
- Mutating tools (bash/edit/write)
- Settings UI / model picker / driver metadata icons
- API key entry UI / OAuth flow
- Plan-mode handling (hide it later, don't implement it)
- Text generation replacement (commit messages, PR titles)
- Thread history / rollback / fork
- Codex retirement
- `codexThreadId` rename
- Tests beyond what's needed to verify the acceptance criteria

If you find yourself implementing any of these, stop and ask.

## Suggested implementation shape

Think of this as one feature, not a stack. Likely files touched (rough estimate):

- `packages/contracts/src/settings.ts` — add minimal `PiSettings` (probably just `{ enabled: boolean }`)
- `apps/server/src/provider/builtInDrivers.ts` — register `PiDriver`
- `apps/server/src/provider/Drivers/PiDriver.ts` — new file
- `apps/server/src/provider/Layers/PiSessionRuntime.ts` — new file, embeds `createAgentSessionRuntime`
- `apps/server/src/provider/Layers/PiAdapter.ts` — new file, AgentEvent → ProviderRuntimeEvent translation
- `apps/server/src/provider/Layers/PiProvider.ts` — wire-up

Renderer changes are *probably* zero — pi sessions leave `codexThreadId: null`, the canonical `ProviderRuntimeEvent` shape doesn't change.

## Pass/fail signal for the evaluator

The evaluator should:

1. Verify the dev server starts (no errors in stdout/stderr during boot).
2. Drive the GUI: open the app, create a thread with the pi driver, send a prompt, wait for streamed response.
3. Confirm the response renders as assistant text and not as raw JSON or error.
4. Check the browser console for errors during the interaction.
5. Stop the dev server and verify no orphaned processes.

If any step fails, return the failure mode (which step, what error) so the generator can fix it.

## Branch

`mujuni88/pi-spike` (already created, sitting on top of the docs commit).
