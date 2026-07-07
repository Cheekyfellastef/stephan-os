# Battle Bridge Publisher Local Proof Runbook

This slice publishes real current Battle Bridge status into the Shared Agent Workspace; it does not write to the dashboard, run arbitrary shell, kill processes, restart services, dump secrets, or mutate the repository from runtime.

## Windows proof commands

Run from the repository root in PowerShell after setting `STEPHANOS_SHARED_AGENT_WORKSPACE` to the existing external workspace directory:

```powershell
$env:STEPHANOS_SHARED_AGENT_WORKSPACE="$env:USERPROFILE\Documents\Stephanos-openclaw-workspace"
node --test shared/agents/*battle*publisher*.test.mjs
node --test shared/agents/*dashboard*feed*.test.mjs
node --test shared/agents/*.test.mjs
```

## Interpreting the publisher records

- `status/battle-bridge-current.json` is the live dashboard status input.
- `proof/battle-bridge-current.json` carries the proof references used by the feed.
- `capabilities/openclaw.json` keeps OpenClaw in the existing Shared Workspace capability format.
- `events/battle-bridge-current.json` is a dashboard-compatible current event record.

If any publisher cannot check a service, it must publish `UNKNOWN` or `STALE` plus the exact next action instead of claiming live health.
