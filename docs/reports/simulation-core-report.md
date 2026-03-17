# Simulation Core Report

## 1. Executive summary
Stephanos now includes a first working Simulation Core with a registry-driven architecture, deterministic execution engine, command routing under `/simulate`, simulation tooling (`simList`, `simRun`, `simGetStatus`), lightweight preset persistence, and frontend rendering for simulation outputs. The initial simulations are `system-health-snapshot` and `trajectory-demo`.

## 2. Files created
- `stephanos-server/services/simulationTypes.js`
- `stephanos-server/services/simulationRegistry.js`
- `stephanos-server/services/simulationEngine.js`
- `stephanos-server/services/simulationPresets.js`
- `stephanos-server/services/simulations/systemHealthSnapshot.js`
- `stephanos-server/services/simulations/trajectoryDemo.js`
- `stephanos-server/data/simulations/presets.json`
- `stephanos-ui/src/components/SimulationPanel.jsx`
- `stephanos-ui/src/components/SimulationListPanel.jsx`
- `stephanos-ui/src/components/SimulationResultCard.jsx`
- `stephanos-ui/src/components/SimulationChartView.jsx`
- `docs/reports/simulation-core-report.md`

## 3. Files modified
- `stephanos-server/services/toolRegistry.js`
- `stephanos-server/services/commandRouter.js`
- `stephanos-server/routes/ai.js`
- `stephanos-ui/src/App.jsx`
- `stephanos-ui/src/components/AIConsole.jsx`
- `stephanos-ui/src/components/CommandResultCard.jsx`
- `stephanos-ui/src/components/DebugConsole.jsx`
- `stephanos-ui/src/hooks/useAIConsole.js`
- `stephanos-ui/src/ai/aiTypes.js`
- `stephanos-ui/src/ai/commandFormatter.js`
- `stephanos-ui/src/ai/commandParser.js`
- `stephanos-ui/src/state/aiStore.js`
- `stephanos-ui/src/styles.css`

## 4. Architecture decisions
- Implemented a **registry + engine split** so simulation definitions remain independent from orchestration.
- Kept numerical execution deterministic in backend simulation modules (no AI in numeric path).
- Added a typed error model (`SimulationInputError`, `SimulationExecutionError`) for consistent routing.
- Kept command parsing deterministic with explicit parsing rules for `/simulate` and flags.
- Surfaced simulation core into existing status/tool introspection pathways.

## 5. Data models introduced
- Simulation definition model with:
  - `id`, `name`, `description`, `category`, `state`
  - `input_schema`, `output_schema`
  - `validateInput(input)`
  - `execute(input, context)`
- Simulation execution envelope:
  - simulation metadata
  - validated input
  - result payload
  - execution timing
- Preset model in `presets.json`:
  - `name`, `simulationId`, `input`, `created_at`, `updated_at`

## 6. Commands/features now working
- `/simulate`
- `/simulate help`
- `/simulate list`
- `/simulate status`
- `/simulate run system-health-snapshot`
- `/simulate run trajectory-demo --start 1000 --monthly 100 --rate 0.05 --years 10`
- Tool registry integration:
  - `simList`
  - `simRun`
  - `simGetStatus`
- Frontend simulation panel + result rendering + lightweight time-series bar visualization.
- Debug console now surfaces simulation action and validated input.

## 7. Mocked or incomplete parts
- Presets are persisted and listed in status but no dedicated slash command workflow for save/load yet.
- No simulation editing UI yet (current UI is inspect/run result consumption through command responses).
- No advanced charting library yet; visualization is intentionally lightweight.

## 8. Known issues / technical debt
- `isUserInputError` currently relies on message-fragment matching; this should later become typed/status-code driven.
- Command router currently has explicit trajectory flag mapping; future simulations should move to schema-driven argument adapters.
- Preset management should be promoted to first-class tools and commands (`/simulate preset ...`).

## 9. Manual test checklist
- [ ] Start backend and frontend.
- [ ] Run `/simulate` and verify help payload.
- [ ] Run `/simulate list` and verify two simulations appear.
- [ ] Run `/simulate run system-health-snapshot` and verify structured system payload.
- [ ] Run `/simulate run trajectory-demo --start 1000 --monthly 100 --rate 0.05 --years 10` and verify deterministic output and yearly snapshots.
- [ ] Run malformed command `/simulate run trajectory-demo --start abc --monthly 100 --rate 0.05 --years 10` and verify contract-compliant error.
- [ ] Open debug console (F1) and verify parsed command, selected simulation tool, input, timing, and output summary.
- [ ] Run `/status` and confirm simulation engine status exists.
- [ ] Run `/tools` and confirm simulation tools are listed.

## 10. Recommended next milestone
Implement **Simulation Scenario Workbench v2**:
1. Slash + tool support for preset lifecycle (`/simulate preset list|save|load|delete`).
2. Schema-driven argument parsing so new simulations can self-describe CLI flags.
3. Add scenario comparison and Monte-Carlo-ready deterministic random seed handling.
4. Add financial-retirement simulation plugin as first domain module.
5. Add simulation-run history persistence and replay in UI for inspectability.
