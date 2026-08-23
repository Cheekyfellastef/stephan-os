# Landing Goal Dashboard Live Wiring Runbook

The landing Goal Dashboard is a read-only projection over existing Shared Agent Workspace, Codex queue/dispatcher, Battle Bridge supervisor, and OpenClaw capability ladder contracts.

## Safety boundaries

- The dashboard must not execute shell commands.
- The dashboard must not mutate the repository or Shared Workspace.
- Missing or stale workspace records must render as `UNKNOWN` or `STALE` with an exact next action.
- Browser/UI proof is never inferred from source tests; capture separate browser evidence before claiming UI health.

## Operator flow

1. Publish current Shared Agent Workspace status/proof/capability records for #1290, #1287, #1291, #1292, #1293, #1284, and #1286.
2. Refresh the approved read-only dashboard feed.
3. Confirm queue/dispatcher status, Battle Bridge service health, and OpenClaw capability ladder state.
4. Resolve the Operator Attention panel in order: approvals, local proof needed, blockers, exact next action.
5. Only after current proof records exist, attach browser screenshots/UI reality proof to the PR.

## Focused checks

```bash
node --test shared/agents/landingGoalDashboardProjection.test.mjs
node --test shared/agents/*.test.mjs
```
