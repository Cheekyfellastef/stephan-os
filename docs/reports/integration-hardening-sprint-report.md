# Integration Hardening Sprint Report

## 1. Executive summary
This sprint hardened cross-core integration by introducing a shared subsystem registry, explicit backend error codes, command-family parser refactors, expanded deterministic KG and simulation-preset command sets, normalized debug payloads, and baseline automated tests for deterministic graph/simulation command flows.

## 2. Files created
- `stephanos-server/services/errors.js`
- `stephanos-server/services/subsystemRegistry.js`
- `stephanos-server/tests/integration-hardening.test.js`
- `docs/reports/integration-hardening-sprint-report.md`

## 3. Files modified
- `stephanos-server/services/commandRouter.js`
- `stephanos-server/services/knowledgeGraphService.js`
- `stephanos-server/services/graphStore.js`
- `stephanos-server/services/simulationPresets.js`
- `stephanos-server/services/simulationTypes.js`
- `stephanos-server/services/simulationRegistry.js`
- `stephanos-server/services/simulationEngine.js`
- `stephanos-server/services/toolRegistry.js`
- `stephanos-server/services/responseBuilder.js`
- `stephanos-server/routes/ai.js`
- `stephanos-server/package.json`
- `stephanos-ui/src/hooks/useAIConsole.js`
- `stephanos-ui/src/components/DebugConsole.jsx`
- `stephanos-ui/src/components/CommandResultCard.jsx`
- `stephanos-ui/src/components/ToolsPanel.jsx`

## 4. Architecture issues addressed
- Removed fragmented status composition in favor of shared subsystem registry.
- Replaced message-fragment input error classification with typed error normalization.
- Reduced command parsing drift via family-level parser helpers.
- Unified debug payload across simulation/graph with subsystem/tool/execution metadata.
- Added preset lifecycle commands as first-class simulation tools.

## 5. New error codes introduced
- `SIM_INPUT_INVALID`
- `SIM_NOT_FOUND`
- `SIM_EXECUTION_FAILED`
- `SIM_PRESET_NOT_FOUND`
- `KG_INPUT_INVALID`
- `KG_NODE_NOT_FOUND`
- `KG_EDGE_INVALID`
- `KG_DUPLICATE_NODE`
- `KG_STORAGE_FAILURE`
- `CMD_INVALID`
- `TOOL_EXECUTION_FAILED`

## 6. New commands/features now working
- `/subsystems`
- `/kg update node <id> --label <label> --type <type> --description <text> --tags <csv>`
- `/kg delete node <id>`
- `/kg delete edge <id>`
- `/simulate preset`
- `/simulate preset list`
- `/simulate preset save <name> --simulation <id> [--start ... --monthly ... --rate ... --years ...]`
- `/simulate preset load <name>`
- `/simulate preset delete <name>`
- `/tools` grouped by subsystem/category
- `/status` reflects shared subsystem registry

## 7. Test coverage added
Automated node:test coverage for:
- `/kg` and `/simulate` parser routing
- simulation happy path + invalid input
- graph node/edge create
- graph search
- graph related traversal
- duplicate node prevention
- preset save/load/delete
- deterministic error response contract includes `error_code`

## 8. Remaining technical debt
- Frontend parser can eventually share parser schema from backend for tighter parity.
- Preset load currently returns payload but does not auto-run simulation by design.
- Memory↔graph link remains placeholder hook pending confirmation UX and policy design.

## 9. Manual verification checklist
- [ ] Run `/status` and verify subsystem registry output includes all core entries.
- [ ] Run `/tools` and verify grouping by subsystem/category.
- [ ] Run `/subsystems` and inspect registry details.
- [ ] Run KG create/update/delete commands and verify deterministic output + error codes.
- [ ] Run simulation run and preset save/load/delete commands and inspect debug payload.
- [ ] Trigger bad commands and verify `error_code` appears in response/result cards/debug console.
- [ ] Press `F1` and verify unified debug panel fields for both KG and simulation operations.

## 10. Recommended next milestone
Implement confirmation-based memory→graph suggestion workflow: capture memory candidates, stage graph proposals, require explicit user confirmation, and record provenance linking memory item IDs to created/updated graph entities.
