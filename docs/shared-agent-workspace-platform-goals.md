# Shared Agent Workspace Platform Goal Slice

These platform goals source the next Stephanos/OpenClaw build sequence while preserving the Shared Workspace as external runtime truth, not repository state.

| Goal | Title | Status | Scope |
| --- | --- | --- | --- |
| G1 | Shared Agent Workspace runtime configuration | Implemented in this slice | Resolve one safe external workspace path for Battle Bridge publisher, backend feed, and startup integration. |
| G2 | End-to-end live feed proof | Implemented in this slice | Trace Battle Bridge Publisher → Shared Workspace → Backend API → Goal Dashboard without fake live proof. |
| G3 | Live cockpit landing page | Queued | Promote the live dashboard to the operator cockpit entry once G1/G2 evidence is stable. |
| G4 | Ignition premium polish | Queued | Improve startup clarity without loosening validation or adding restart/process-kill behavior. |
| G5 | Real runtime telemetry enrichment | Queued | Add richer live runtime facts from canonical sources only. |
| G6 | Goal dashboard realtime progress model | Queued | Model realtime progress while keeping static fallback as fallback only. |
| G7 | Operator inbox | Queued | Add a read-only/operator-approved inbox flow for workspace attention items. |

## G1/G2 proof commands

```bash
node --test shared/agents/*shared*workspace*.test.mjs
node --test shared/agents/*dashboard*feed*.test.mjs
node --test shared/agents/*battle*publisher*.test.mjs
node --test tests/shared-workspace-dashboard-api.test.mjs
node --test tests/goal-dashboard-live-telemetry.test.mjs
node --test apps/goal-dashboard/*.test.mjs
node --test shared/agents/*.test.mjs
git diff --check
```

## Runtime safety boundary

The runtime resolver accepts the default `$HOME/Documents/Stephanos-openclaw-workspace` path or an explicit `STEPHANOS_SHARED_AGENT_WORKSPACE` override only when the resolved path is outside the repository, does not traverse upward, and does not target secret/session/config locations. Bootstrap creates only the approved Shared Workspace directory layout and never writes source repo files, secrets, env dumps, token dumps, or dashboard mutations.
