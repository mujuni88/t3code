# PR0: Web-side audit of Codex-shape consumption

**Date**: 2026-05-05
**Scope**: `t3code/apps/web/src/**` — find any renderer-side code that consumes Codex-native event shapes via `event.raw` or assumes Codex-specific data structures.
**Verdict**: **MOSTLY CLEAN — one structural leak, low impact.**

## Method

Two greps over `apps/web/src/`:
1. Escape-hatch consumption: `\.raw\b|event\.raw|raw\.payload|raw\.method|raw\.source`
2. Codex string mentions: `codex|Codex|CODEX`

## Findings

### Finding 1 — `event.raw` is NOT consumed in the renderer

The grep for `event.raw`, `raw.payload`, `raw.method`, `raw.source` returned **zero matches** across `apps/web/src/`. The canonical contract permits a `raw` escape hatch (`packages/contracts/src/providerRuntime.ts:259`), but the web app does not reach into it.

**Implication for PR3 (event mapping):** scope unchanged. The pi adapter does not need to preserve Codex-shape `raw` payloads to keep the renderer working. Setting `raw` to a generic `{ source: "pi", method: <agent_event_type>, payload: <agent_event> }` shape is sufficient.

### Finding 2 — `codexThreadId` is a structural field on the renderer's Thread type

A `Thread.codexThreadId: string | null` field exists on the renderer's domain model:

- Declaration: `apps/web/src/types.ts:99` and `:123` (two Thread shapes)
- Reads/writes: `store.ts:236, :270, :318, :414`, `session-logic.ts:36`
- Test fixtures: 13 test files default this to `null`

This is a **real but minor seam leak** — the renderer's data model carries a Codex-named field. For non-Codex threads (Claude, Cursor, OpenCode today; pi tomorrow) it's set to `null` and ignored.

**Implication for the migration:**
- v1 (PR1–11): pi sessions leave `codexThreadId: null`. Pi's session id lives in `resumeCursor`. Renderer continues to work.
- Follow-up (post-v1): rename `codexThreadId` → `providerSessionId` (or similar) as a small refactor PR. Not blocking. Cosmetic-with-test-churn.

### Finding 3 — Other `codex` mentions are cosmetic

Sampled the other 48 `codex|Codex` matches (driver name strings, plugin path checks, settings labels, icons, model picker lookups). All are either:
- string identifiers (`ProviderDriverKind.make("codex")`)
- file path checks for codex-shaped plugin directories (`/.codex/plugins/`)
- UI metadata keyed by driver name

None reach into Codex event payloads structurally.

## Decision

**Proceed with PR1 as planned.** The seam is as clean as REPORT.md §3 claimed for the purposes of v1 — the renderer does not consume Codex-shape event payloads.

The `codexThreadId` field name is the only real leak and is non-blocking. Track as a post-v1 cleanup.

## Plan deltas

- PR3 scope unchanged.
- New tracking item: **post-v1 rename `codexThreadId` → `providerSessionId`**. File when v1 is shipping.
- Pi adapter sets `raw = { source: "pi", method: agentEvent.type, payload: agentEvent }` for forward compatibility, even though renderer doesn't read it today.
