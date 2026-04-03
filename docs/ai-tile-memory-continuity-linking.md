# AI, Tiles, Memory, and Continuity: Operational Linking

## End-to-end governed path
1. Operator/AI action emits event (`ai.intent.received`, `tile.action`, etc.).
2. Tile/workspace emits structured lifecycle/result events (`tile.opened`, `tile.result`, `tile.closed`).
3. Continuity core ingests event stream, updates active context and recent event references.
4. Memory gateway selectively persists meaningful events to typed durable memory.
5. AI context assembly can read active tile + continuity summary for follow-up reasoning.

## Current proof flow implemented
- `command-deck` emits `tile.action` on launch request.
- `workspace` emits `tile.focused`, `tile.opened`, `tile.result`, `tile.closed`.
- `assistant_agent` emits AI intent/decision events.
- `main.js` wires continuity + selective memory persistence through service registry and window exposure.

## 2026-04-03 integration audit summary
### What already existed
- Shared durable memory contracts existed in both frontend (`shared/runtime/stephanosMemory.mjs`) and backend (`stephanos-server/services/durableMemoryService.js`).
- Tile durable persistence existed via `/api/tile-state/:appId` and `shared/runtime/tileDataContract.mjs`.
- Continuity core existed with event-bus ingestion and optional memory gateway persistence.
- Ideas tile already migrated to shared tile-state backend and supported edit/update of idea records.

### What was incomplete/fragmented
- Durable memory writes were whole-store PUTs without stale-write conflict protection.
- AI route used local memory context, but continuity artifacts were not persisted into shared durable memory.
- Tile execution events from iframe tiles were not normalized into a common AI/continuity/memory loop contract.
- Tile link/degraded status was implied through logs, not explicitly surfaced by the ideas tile.

### What this pass regularizes
- Added conflict-aware durable-memory writes (`ifUnmodifiedSince`) and frontend rehydrate-on-conflict behavior.
- AI route now persists bounded intent/outcome continuity artifacts to backend durable memory and activity log.
- Added lightweight tile execution bridge (`publishTileExecutionEvent`) for tiles to publish normalized loop events.
- Launcher runtime exposes `[EXECUTION LOOP]` bridge/status and persists tile outcomes through existing memory gateway.
- Ideas tile now publishes execution-loop events and surfaces explicit link/degraded status text.
