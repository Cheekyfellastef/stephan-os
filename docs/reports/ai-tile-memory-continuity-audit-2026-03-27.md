# AI ↔ Tile ↔ Memory Audit (2026-03-27)

## Scope
Audit-first inventory for existing communication paths before continuity unification.

## A) Existing AI runtime/service/module pieces
- `system/agents/assistant_agent/assistant_agent.js`: local interpreter listens to `console:command`; emits `console:list` and `simulation:start`.
- `system/agents/agent_runtime.js`: agent subscription model over shared event bus.
- `shared/ai/assembleStephanosContext.mjs`: already composes active + relevant tile context snapshots.
- `shared/ai/stephanosClient.mjs`: forwards runtime context and tile context to AI backend calls.
- `shared/runtime/tileContextRegistry.mjs` + `shared/runtime/tileContextBridge.js`: existing AI-visible tile snapshot plumbing via localStorage.

## B) Existing tile communication/state mechanisms
- Tile/app source: `apps/*/app.json`, discovery in `system/apps/app_discovery.js`.
- Launch semantics preserved in:
  - `modules/command-deck/command-deck.js`
  - `system/workspace.js`
  - with order `launchEntry -> runtimeEntry -> entry` for Stephanos targets.
- Event system: `system/core/event_bus.js` (including wildcard `*` envelopes).
- Tile state hints already exist via `setActiveTileContextHint` / `getActiveTileContextHint`.
- Structured tile events were partial; most flows only emitted `workspace:*` and app diagnostics.

## C) Existing memory systems
- Durable: `shared/runtime/stephanosMemory.mjs` (v1 before this pass, namespace/id CRUD, weak typing).
- Session/UI: `shared/runtime/stephanosSessionMemory.mjs` (provider prefs, layout toggles, working/project/session state).
- Panel layout persistence runs through `stephanosSessionMemory` and UI renderer layout keys.
- Ad hoc writes existed through tile context bridge localStorage key and uncategorized durable payloads.

## D) Existing truth/continuity/routing structures
- Truth engine/panel/reality sync:
  - `shared/runtime/truthEngine.mjs`
  - `shared/runtime/renderTruthPanel.mjs`
  - `shared/runtime/realitySync.mjs`
- Runtime/route truth contracts and adjudication:
  - `shared/runtime/truthContract.mjs`
  - `shared/runtime/runtimeAdjudicator.mjs`
  - launcher diagnostics in `main.js`.
- Runtime service registry exists (`system/core/service_registry.js`) but no canonical continuity service yet.

## E) Gaps and risks found
- Duplicate concepts:
  - tile context snapshots in both registry module and bridge script.
- Bypass paths:
  - AI and launcher flows could act without emitting governed tile/AI event families.
- Contract inconsistency:
  - durable memory accepted mostly free-form records (`type` not strongly governed).
- Persistence blind spots:
  - meaningful runtime events were often transient only (event bus) with no selective persistence path.
- State boundary blur:
  - some “current context” lived only in UI/session state, without a shared continuity snapshot.
- Surface-only state to keep out of continuity:
  - panel rendering details and visual-only presentation flags beyond high-level visibility toggles.

## Reuse-first implementation direction taken
- Reused existing event bus (no replacement).
- Reused existing service registry and window runtime exposure pattern.
- Extended (did not replace) `stephanosMemory`.
- Kept launcher/runtime separation and existing Stephanos launch resolution semantics intact.
