# Runtime Sanity Audit — OpenClaw Kill-Switch Wiring v1

Date: 2026-04-28 (UTC)
Branch: `work`

## Scope
Post-merge sanity audit for OpenClaw Kill-Switch Wiring v1 with focus on:
- Mission Dashboard next-best-action progression
- Cross-surface agreement (Agent Tile, Stephanos Tile pane, landing tile)
- Policy-only execution truth
- `openClawExecutionAllowed` safety posture
- Build/verify truth gates

## Result Summary
All requested sanity checks passed.

## Evidence

### 1) Mission Dashboard next-best-action advanced correctly
- `agentTaskProjection` now advances beyond policy harness and recommends kill-switch wiring when policy-only harness exists.
- `projectProgressAdjudicator` prioritizes `wire-openclaw-kill-switch` and explicitly suppresses policy-harness as top recommendation once harness exists.

Validated by:
- `shared/agents/agentTaskProjection.test.mjs`
- `shared/project/projectProgressAdjudicator.test.mjs`

### 2) Agent Tile, Stephanos Tile pane, and landing tile agree
- Agent task readiness summary is exposed in projection payload for Mission Dashboard consumption.
- Stephanos tile truth projection carries compact agent-task summary and projects canonical route/provider truth used by landing tile.

Validated by:
- `shared/agents/agentTaskProjection.test.mjs`
- `tests/stephanos-tile-truth-projection.test.mjs`

### 3) Policy-only mode does not claim execution
- Policy-only harness remains safe-to-use false and execution stays blocked.
- Kill switch adjudicator reports `killSwitchMode: policy_only` and keeps execution disabled.

Validated by:
- `shared/agents/openClawPolicyHarness.test.mjs`
- `shared/agents/openClawKillSwitch.test.mjs`

### 4) `openClawExecutionAllowed` remains false
- In policy-only and missing/required kill-switch states, projection and policy harness preserve `openClawExecutionAllowed: false`.

Validated by:
- `shared/agents/agentTaskProjection.test.mjs`
- `shared/agents/openClawPolicyHarness.test.mjs`
- `shared/agents/openClawKillSwitch.test.mjs`

### 5) Build/verify pass after merge
- Dist rebuild succeeded.
- Dist verification succeeded with current source fingerprint and marker.

Validated by:
- `npm run stephanos:build`
- `npm run stephanos:verify`

## Next real dependency
Given kill-switch wiring is now represented and policy-only execution remains correctly blocked, the next real dependency is:

- **Design OpenClaw local adapter** (to establish executable adapter contract while preserving guardrails), then
- complete approval gates before any execution enablement.

This matches the existing adjudication progression from kill-switch → adapter → approvals.
