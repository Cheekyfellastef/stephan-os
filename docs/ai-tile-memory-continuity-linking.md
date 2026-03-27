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
