# Mission Dashboard + Stephanos Surface Wiring Audit

Date: 2026-04-28 (UTC)
Repo: `stephan-os`

## Scope
Audit pass across Mission Dashboard, Mission Console/Stephanos panes, landing Command Deck tiles, and specialist tiles for truth wiring alignment.

Guardrails applied:
- Mission Dashboard consumes shared summaries/projections and does not own subsystem logic.
- UI surfaces are projection/interaction layers; canonical truth remains in shared adjudicators/models.
- OpenClaw remains safety-gated (policy/kill-switch/adapter/approval truth separated).

## Systems wiring table

| # | System | Canonical truth owner(s) | Adjudicator / projection | Dashboard summary input | Mission Dashboard consumer | Stephanos pane consumer(s) | Landing tile / specialist consumers | Tests covering wiring | Audit result |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Runtime / route truth | `shared/runtime/runtimeAdjudicator.mjs`, `shared/runtime/runtimeStatusModel.mjs` | `modules/command-deck/stephanosTileTruthProjection.mjs` | `runtimeStatus`, `finalRouteTruth` | `MissionDashboardPanel.jsx` live projection | `StatusPanel`, `RuntimeFingerprintPanel`, Mission Console | Command Deck Stephanos tile summary | `tests/stephanos-tile-truth-projection.test.mjs`, `tests/command-deck-guardrails.test.mjs` | Wired; no duplicate route canonical logic added. |
| 2 | Backend / bridge truth | `shared/runtime/hostedIdeaStaging.mjs`, orchestration selectors | `stephanos-ui/src/state/runtimeOrchestrationTruth.js`, `missionBridge.js` | `orchestrationSelectors`, mission bridge state | Mission Dashboard live projection | `MissionConsoleTile`, `HostedIdeaStagingPanel` | N/A | `shared/runtime/hostedIdeaStaging.test.mjs` | Wired; lane remains mixed seeded+live where no single summary exists. |
| 3 | Agent Task Layer | `shared/agents/agentTaskModel.mjs` | `shared/agents/agentTaskAdjudicator.mjs`, `shared/agents/agentTaskProjection.mjs` | `agentTaskProjection.readinessSummary` | Agent Task lane overlays + summary section | `AgentsTile`, Mission Console compact summary | Command Deck Stephanos tile compact agent summary | `shared/agents/agentTaskProjection.test.mjs`, `stephanos-ui/src/components/AgentsTile.truthProjection.test.mjs` | Wired; canonical source is shared projection. |
| 4 | Codex manual handoff packet | `shared/agents/codexHandoffPacket.mjs` | via `agentTaskProjection` handoff fields | `codexReadiness`, `codexManualHandoff*` | Codex lane + next actions | `AgentsTile`, `MissionPacketQueuePanel`, Mission Console compact | StatusPanel handoff metadata | `shared/agents/codexHandoffPacket.test.mjs` | Wired; no UI-owned packet canonicalization found. |
| 5 | Verification Return State | `shared/agents/agentVerificationReturn.mjs` | via `agentTaskAdjudicator` -> `agentTaskProjection` | `verificationReturn*`, `verificationDecision`, checks | Verification lane + agent summary | `AgentsTile`, Mission Console compact summary | N/A | `shared/agents/agentVerificationReturn.test.mjs`, `MissionConsoleTile.verificationSummary.test.mjs` | Wired; projection fields consistent. |
| 6 | OpenClaw Policy Harness | `shared/agents/openClawPolicyHarness.mjs` | via `agentTaskAdjudicator` | `openClawIntegrationMode`, `openClawSafeToUse`, `openClawNextAction` | OpenClaw lane + next-action ordering | `AgentsTile`, Mission Console compact, OpenClaw tile | Command Deck compact summary | `shared/agents/openClawPolicyHarness.test.mjs`, `projectProgressAdjudicator.test.mjs` | Wired; safety gating preserved. |
| 7 | OpenClaw Kill Switch | `shared/agents/openClawKillSwitch.mjs` | via harness/adjudicator/projection | `openClawKillSwitchState`, `openClawExecutionAllowed` | Next action gate ordering | `AgentsTile`, Mission Console compact | Command Deck summary chip text | `shared/agents/openClawKillSwitch.test.mjs` | Wired; execution remains gated. |
| 8 | OpenClaw Local Adapter | `shared/agents/openClawLocalAdapter.mjs` | via harness/adjudicator/projection | adapter mode/readiness/connection/canExecute | Next action sequencing (design/stub/connect/approvals) | `AgentsTile`, Mission Console compact, OpenClaw tile | Command Deck summary fields | `shared/agents/openClawLocalAdapter.test.mjs`, `projectProgressAdjudicator.test.mjs` | Wired; dependency sequencing intact. |
| 9 | Memory / retrieval | `shared/runtime/stephanosMemory.mjs`, `shared/runtime/stephanosSessionMemory.mjs` | memory service contracts + panel projections | mission dashboard persisted state + memory lane seeds | Mission Dashboard hydration and lane display | `MemoryPanel`, Agent memory capability section | N/A | memory server tests + UI memory tests | Wired; durable/session separation preserved. |
| 10 | Telemetry | `stephanos-ui/src/components/system/telemetryEvents.js` and runtime telemetry state | `TelemetryFeed` + support snapshot selectors | telemetry lanes seeded; live telemetry in separate pane | Mission Dashboard only via seeded lane + risks | `TelemetryFeed`, Cockpit panel | N/A | `telemetryEvents.test.mjs`, telemetry feed tests | Partially wired; no dedicated dashboard live telemetry summary exporter yet. |
| 11 | Prompt Builder | `stephanos-ui/src/components/system/promptBuilder.js` + orchestration truth | prompt builder model selectors | seeded lane + orchestration hints | dashboard lane only (seed/fallback) | `PromptBuilder` pane, Mission Console prompt actions | N/A | `promptBuilder.test.mjs`, import regression tests | Gap documented: dashboard lacks first-class prompt summary feed. |
| 12 | Intent / Proposal Engine | `stephanos-ui/src/state/intentToBuildModel.js`, `missionBridge.js`, server intent proposal services | mission bridge + intent projections | seeded lane + mission bridge live projection | lane + live projection fields | `IntentEnginePanel`, `MissionConsoleTile`, proposal panels | N/A | intent model/tests, operator command intent tests | Wired with mixed seeded/live evidence. |
| 13 | Project Progress / Mission Dashboard | `shared/project/projectProgressModel.mjs` | `shared/project/projectProgressAdjudicator.mjs` | seed model + agent readiness overlay | `MissionDashboardPanel` | N/A | N/A | `projectProgressAdjudicator.test.mjs` | Corrected stale fallback seed assumptions in this pass. |
| 14 | Deployment / dist metadata | build/verify scripts and runtime markers | runtime verify scripts | verification lane + build markers | Mission Dashboard verification status + command deck detail | status/runtime panels | command deck runtime detail | `npm run stephanos:build`, `npm run stephanos:verify` | Build/verify clean in this pass. |
| 15 | Stephanos Tile pane order persistence | `stephanos-ui/src/utils/paneOrderPersistence.js` | `App.jsx` reconciliation/load/save | N/A | N/A | all Mission Console panes order | N/A | `paneOrderPersistence.test.mjs` | Wired; test pass confirms persistence. |
| 16 | Other existing panes/tiles | App pane definitions + command deck registry | N/A | N/A | dashboard references where summaries exist | `StatusPanel`, `MissionPacketQueuePanel`, etc. | command deck tiles | render/import regression tests | No duplicate new surfaces added. |

## Surface wiring table

| Surface | Primary truth input(s) | Observed wiring | Mismatch / stale logic | Action in this pass |
|---|---|---|---|---|
| Mission Dashboard (`MissionDashboardPanel`) | `agentTaskProjection.readinessSummary`, `runtimeStatus`, `finalRouteTruth`, selectors | Uses shared project adjudicator + agent readiness overlay | Fallback seed text in project model still reflected pre-upgrade assumptions when live summary absent | Updated fallback lane seed text/evidence to explicitly indicate fallback-only and modern system presence. |
| Mission Console Tile compact verification summary | `agentTaskProjection.readinessSummary` (+ fallback `operatorSurface`) | Compact OpenClaw/verification list | Boolean merge used `summary || operatorSurface`, which could claim `true` from fallback even if canonical summary reported `false` | Replaced boolean OR merge with precedence-aware boolean resolver (summary authoritative when provided). |
| Agents Tile | `agentTaskProjection.operatorSurface` | Uses shared projection fields for OpenClaw/verification/handoff | No stale hardcoded execution claims detected | No code change needed. |
| Landing Command Deck Stephanos tile | `buildStephanosTileTruthProjection` from runtime model + agent summary | Compact tile summary projects route + agent/openclaw states | No UI-owned canon discovered; defaults are compatibility/fallback only | No code change needed. |
| Prompt Builder pane | promptBuilder model + orchestration truth | Pane-level surface exists | No dedicated mission dashboard summary exporter | Follow-up task (no new architecture in this pass). |
| Telemetry pane/feed | telemetry entries + telemetryEvents | Pane-level surface exists | Mission Dashboard telemetry lane still mostly seed-derived | Follow-up task (add shared telemetry summary projection). |

## Disconnected surfaces found
- None fully disconnected.
- Partial disconnects (documented follow-up): dashboard telemetry and prompt-builder lanes rely largely on seeded lane metadata, not dedicated shared summary exporters.

## Stale seeded assumptions found
1. Project progress seed lane text for Agent Task/Codex/OpenClaw/Verification still described these systems as “not yet first-class/missing canonical model” even though shared adjudicators/projections now exist.
2. Mission Console compact boolean merge allowed fallback operator surface to override explicit false in readiness summary.

## Duplicated UI-owned truth found
- Minor duplication pattern (not canonical ownership): Mission Console compact summary had local boolean reconciliation logic that could diverge from readiness summary semantics.
- Corrected to preserve readiness summary precedence.

## Systems missing dashboard summary exports (follow-up)
- Telemetry: no dedicated shared telemetry summary contract into project progress adjudication.
- Prompt Builder: no dedicated shared prompt-builder readiness summary exported into dashboard lanes.

## Systems with dashboard summary but no dedicated pane
- None critical in audited scope; major systems have panes/tiles or compact sections.

## Systems with landing tile but missing summary
- No critical missing summary found for Stephanos landing tile (route + agent/openclaw compact summary present).

## Recommendation alignment checks (Mission Dashboard)
- Verified next-best-action progression order remains dependency-correct:
  - kill-switch before adapter progression,
  - adapter design/stub/connect/approvals sequence,
  - verification return action priority before OpenClaw steps when return not ready.
- No direct hardcoded fixes in `MissionDashboardPanel.jsx` were required; adjudication remains in shared `projectProgressAdjudicator.mjs`.

## Fixes applied in this pass
1. **Mission Console compact summary boolean precedence fix**
   - Ensures readiness summary booleans (`openClawSafeToUse`, `openClawExecutionAllowed`, `openClawAdapterCanExecute`) stay authoritative when explicitly false.
2. **Project progress fallback seed modernization**
   - Updated fallback lane text/evidence for Agent Task, Codex handoff, OpenClaw control, and Verification loop to reflect current shared truth architecture and fallback-only semantics.
3. **Adjusted adjudicator test expectation**
   - Updated baseline readiness expectation to match revised seed fallback status.

## Remaining follow-up tasks
1. Add shared telemetry summary projection contract for Mission Dashboard lane input.
2. Add shared prompt-builder readiness summary projection contract for Mission Dashboard lane input.
3. Consider exposing “truth source id” per lane in dashboard UI (e.g., `agentTaskReadinessSummary`, `seed-model`) for operator transparency.

## Validation commands run
- `node --test shared/agents/*.test.mjs shared/project/*.test.mjs`
- `node --test shared/runtime/*.test.mjs`
- `node --test stephanos-ui/src/utils/paneOrderPersistence.test.mjs`
- `node --test stephanos-ui/src/components/MissionConsoleTile.verificationSummary.test.mjs stephanos-ui/src/components/AgentsTile.openclawPresence.test.mjs`
- `node --test modules/command-deck/*.test.mjs tests/*.test.mjs`
- `npm run stephanos:build`
- `npm run stephanos:verify`
