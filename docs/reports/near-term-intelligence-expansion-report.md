# Near-Term Intelligence Expansion Report

## 1. Executive summary
This sprint adds a deterministic, confirmation-first intelligence expansion across Stephanos OS with explicit proposal staging, provenance-aware graph mutation, simulation run history/comparison, shared activity logging, roadmap notes stubs, and subsystem-aware assistant context packaging. No memory-to-graph mutation is automatic: graph changes from memory are queued and require explicit acceptance.

## 2. Files created
- `stephanos-server/services/storageUtils.js`
- `stephanos-server/services/activityLogStore.js`
- `stephanos-server/services/activityLogService.js`
- `stephanos-server/services/roadmapStore.js`
- `stephanos-server/services/roadmapService.js`
- `stephanos-server/services/simulationHistoryStore.js`
- `stephanos-server/services/simulationHistoryService.js`
- `stephanos-server/services/proposalStore.js`
- `stephanos-server/services/proposalService.js`
- `stephanos-server/services/memoryProposalService.js`
- `stephanos-server/services/assistantContextService.js`
- `stephanos-server/tests/near-term-intelligence.test.js`
- `stephanos-ui/src/components/ProposalPanel.jsx`
- `stephanos-ui/src/components/ActivityPanel.jsx`
- `stephanos-ui/src/components/RoadmapPanel.jsx`
- `stephanos-ui/src/components/SimulationHistoryPanel.jsx`

## 3. Files modified
- `stephanos-server/services/memoryService.js`
- `stephanos-server/services/knowledgeGraphService.js`
- `stephanos-server/services/simulationPresets.js`
- `stephanos-server/services/errors.js`
- `stephanos-server/services/commandRouter.js`
- `stephanos-server/services/toolRegistry.js`
- `stephanos-server/services/subsystemRegistry.js`
- `stephanos-server/routes/ai.js`
- `stephanos-ui/src/App.jsx`
- `stephanos-ui/src/components/CommandResultCard.jsx`
- `stephanos-ui/src/components/StatusPanel.jsx`
- `stephanos-ui/src/styles.css`

## 4. New subsystems added
- Proposal Queue (`proposal_queue`)
- Activity Log (`activity_log`)
- Roadmap Service (`roadmap_service`)
- Simulation History (`simulation_history`)
- Assistant Context Packager (`assistantContextService`)

## 5. New commands/features now working
- Proposals: `/proposals`, `/proposals list`, `/proposals stats`, `/proposals show <id>`, `/proposals accept <id>`, `/proposals reject <id>`
- Memory proposals: `/memory propose <id>`, `/memory propose recent`
- Activity: `/activity`, `/activity list`, `/activity recent`, `/activity show <id>`
- Roadmap: `/roadmap`, `/roadmap list`, `/roadmap add <text>`, `/roadmap done <id>`, `/roadmap show <id>`
- Simulation history: `/simulate history`, `/simulate history list`, `/simulate history show <runId>`, `/simulate history clear`
- Simulation comparison: `/simulate compare <runIdA> <runIdB>`
- Assistant now receives compact subsystem context bundle server-side.

## 6. New error codes introduced
- `PROPOSAL_NOT_FOUND`
- `PROPOSAL_INVALID_STATE`
- `MEMORY_NOT_FOUND`
- `ACTIVITY_NOT_FOUND`
- `ROADMAP_NOT_FOUND`
- `SIM_HISTORY_NOT_FOUND`
- `SIM_COMPARE_INVALID`

## 7. Test coverage added
- Deterministic parsing for `/proposals`, `/activity`, `/roadmap`, and simulation history/compare commands.
- Proposal lifecycle: create/list/accept/reject.
- Accepted proposal graph mutation includes provenance.
- Simulation run history persistence and compare.
- Activity log generation + roadmap add/done flow.
- Error response contract with new error codes.

## 8. Remaining technical debt
- Proposal generation heuristics are intentionally simple and should evolve with stronger memory semantics.
- Context bundle size policies are basic and should be token-budget aware per model profile.
- Activity log growth controls (rotation/pruning) are not implemented yet.
- Frontend panels currently consume command result payloads, not dedicated polling endpoints.

## 9. Manual verification checklist
- [ ] Save memory and stage proposal: `/memory save ...` then `/memory propose recent`
- [ ] Inspect and accept proposal, then verify graph node/edge plus provenance metadata.
- [ ] Reject proposal and verify rejection audit trail remains persisted.
- [ ] Run simulations and inspect history list/show/clear commands.
- [ ] Compare two simulation runs and inspect structured delta output.
- [ ] Inspect activity timeline after graph/proposal/memory/simulation/roadmap operations.
- [ ] Add and complete roadmap items.
- [ ] Verify dashboard panels render proposal/activity/roadmap/simulation history summaries.
- [ ] Verify assistant responses include structured suggested actions.

## 10. Recommended next milestone
Implement “Cross-Subsystem Snapshot + Replay”:
- point-in-time snapshots of proposal queue, graph, memory, simulation runs, roadmap, and activity
- deterministic diff/replay tooling for trusted evolution
- first-class “state pack” export/import for cross-device continuity.
