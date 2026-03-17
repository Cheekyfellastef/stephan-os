# Knowledge Graph Core Report

## 1. Executive summary
The Knowledge Graph Core milestone is now implemented as a local, JSON-backed subsystem integrated across the Stephanos backend command/tools pipeline and frontend inspector UI. It supports deterministic `/kg` commands, persistent nodes/edges storage, graph tool registration, graph stats/search/related-node operations, and deep debug visibility in the F1 console.

## 2. Files created
- `stephanos-server/services/graphTypes.js`
- `stephanos-server/services/graphStore.js`
- `stephanos-server/services/knowledgeGraphService.js`
- `stephanos-server/data/knowledge-graph/nodes.json`
- `stephanos-server/data/knowledge-graph/edges.json`
- `stephanos-ui/src/components/KnowledgeGraphPanel.jsx`
- `stephanos-ui/src/components/GraphNodeCard.jsx`
- `stephanos-ui/src/components/GraphEdgeCard.jsx`
- `stephanos-ui/src/components/GraphStatsCard.jsx`
- `docs/reports/knowledge-graph-core-report.md`

## 3. Files modified
- `stephanos-server/services/commandRouter.js`
- `stephanos-server/services/toolRegistry.js`
- `stephanos-server/routes/ai.js`
- `stephanos-ui/src/App.jsx`
- `stephanos-ui/src/components/CommandResultCard.jsx`
- `stephanos-ui/src/components/DebugConsole.jsx`
- `stephanos-ui/src/hooks/useAIConsole.js`
- `stephanos-ui/src/ai/commandParser.js`
- `stephanos-ui/src/ai/aiTypes.js`
- `stephanos-ui/src/styles.css`

## 4. Architecture decisions
- JSON files were selected for graph persistence (`nodes.json`, `edges.json`) to keep local-first simplicity and inspectability.
- Persistence logic was isolated into `graphStore.js`; graph business logic resides in `knowledgeGraphService.js`.
- Deterministic parsing for `/kg` commands was added into `commandRouter.js`, avoiding AI for core graph operations.
- Graph capabilities were exposed through explicit tools in `toolRegistry.js` with stable contracts.
- Graph debug details were added to response debug payloads and rendered in the frontend debug console.
- UI rendering uses lightweight inspector cards/panels instead of heavyweight node-canvas visualization.

## 5. Data models introduced
### Node model
- `id`, `label`, `type`, `description`, `tags`, `created_at`, `updated_at`, `source`, `metadata`
- future-ready fields included: `confidence`, `provenance`, `embedding_ref`

### Edge model
- `id`, `from`, `to`, `type`, `label`, `weight`, `created_at`, `updated_at`, `metadata`
- future-ready fields included: `confidence`, `provenance`

## 6. Commands/features now working
- `/kg`
- `/kg help`
- `/kg status`
- `/kg stats`
- `/kg list nodes`
- `/kg list edges`
- `/kg add node <label> --type <type> --description <text> --tags <comma-separated>`
- `/kg add edge <from> <to> --type <type> --label <label>`
- `/kg search <query>`
- `/kg related <nodeId>`

Also integrated:
- `/status` now includes `knowledge_graph_service` status.
- `/tools` now includes `kg*` tool entries.
- F1 debug console now surfaces graph operation action/payload/summary/timing/storage info.

## 7. Mocked or incomplete parts
- Optional AI-assisted natural language graph extraction is not implemented; deferred intentionally as future-ready scope.
- No graph-delete slash commands were added (service supports delete methods, command surface currently focuses on requested milestone commands).
- No graphical node-link canvas yet; milestone uses card/list inspector UI.

## 8. Known issues / technical debt
- Frontend dependency installation/build was blocked by package registry policy in this environment (`403` for npm packages), preventing local UI build validation and screenshot capture.
- Graph persistence uses synchronous file I/O for simplicity; could be migrated to async batched writes in future.
- No dedicated automated test suite yet for graph service and command parser; manual/inline validation used for milestone completion.

## 9. Manual test checklist
- [ ] Start backend (`npm run dev` in `stephanos-server`).
- [ ] In UI command console, run `/kg help` and verify command guidance.
- [ ] Run `/kg status` and verify live service + storage path.
- [ ] Run `/kg add node Cockpit Mode --type preference --description "User prefers seated VR" --tags vr,controller`.
- [ ] Run `/kg add node VR Domain --type domain --description "VR preference space" --tags vr,domain`.
- [ ] Run `/kg list nodes` and verify both nodes.
- [ ] Run `/kg add edge <node1_id> <node2_id> --type relates_to --label supports`.
- [ ] Run `/kg list edges` and verify edge creation.
- [ ] Run `/kg search vr` and verify matching nodes/edges.
- [ ] Run `/kg related <node1_id>` and verify linked node appears.
- [ ] Press `F1` and confirm debug pane shows parsed command, selected tool, graph action, payload, result summary, timing, and storage outcome.
- [ ] Run `/status` and confirm graph status appears under system data.
- [ ] Run `/tools` and confirm `kg*` tools appear.

## 10. Recommended next milestone
- Add `/kg update node`, `/kg delete node`, `/kg delete edge` command support.
- Introduce schema versioning + state migration guardrails for graph JSON files.
- Add provenance-first memory-to-graph linking and optional AI suggestion flow with explicit confirmation.
- Add graph snapshots and timeline/history events for inspectability.
- Add semantic relation typing strategy and confidence scoring policy.
- Add thin integration layer for future embeddings and project intelligence traversal.
