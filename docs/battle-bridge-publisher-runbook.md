# Battle Bridge Publisher Local Proof Runbook

This slice publishes real current Battle Bridge status into the Shared Agent Workspace; it does not write to the dashboard, run arbitrary shell, kill processes, restart services, dump secrets, or mutate the repository from runtime.

The runtime loop is wired as a Battle Bridge supervisor startup integration through `createBattleBridgeSupervisorStartupPublisher`. It calls the existing Battle Bridge publisher on a guarded interval, writes hidden structured Shared Workspace events instead of visible PowerShell walls, and exposes a `stop()` cleanup contract for shutdown.

## Windows proof commands

Run from the repository root in PowerShell after setting `STEPHANOS_SHARED_AGENT_WORKSPACE` to an existing external workspace directory. The runtime loop reports unavailable rather than creating a missing workspace root.

```powershell
$env:STEPHANOS_SHARED_AGENT_WORKSPACE="$env:USERPROFILE\Documents\Stephanos-openclaw-workspace"
Test-Path $env:STEPHANOS_SHARED_AGENT_WORKSPACE
node --test shared/agents/*battle*publisher*.test.mjs
node --test shared/agents/*publisher*loop*.test.mjs
node --test shared/agents/*dashboard*feed*.test.mjs
node --test shared/agents/*.test.mjs
```

## Local Battle Bridge loop smoke proof

Use this from the Battle Bridge machine only after the workspace directory exists. It starts the supervisor-integrated publisher loop, performs the immediate first tick, then stops the interval without killing any process or restarting anything.

```powershell
$env:STEPHANOS_SHARED_AGENT_WORKSPACE="$env:USERPROFILE\Documents\Stephanos-openclaw-workspace"
node --input-type=module -e "import { createBattleBridgeSupervisorStartupPublisher } from './shared/agents/battleBridgePublisherLoop.mjs'; const loop = createBattleBridgeSupervisorStartupPublisher({ root: process.env.STEPHANOS_SHARED_AGENT_WORKSPACE, repoRoot: process.cwd(), intervalMs: 60000 }); setTimeout(() => { console.log(loop.stop()); }, 1500);"
Get-Content "$env:STEPHANOS_SHARED_AGENT_WORKSPACE\status\battle-bridge-current.json" -Raw
Get-Content "$env:STEPHANOS_SHARED_AGENT_WORKSPACE\events\battle-bridge-publisher-loop.ndjson" -Tail 5
```

## Interpreting the publisher records

- `status/battle-bridge-current.json` is the live dashboard status input.
- `proof/battle-bridge-current.json` carries the proof references used by the feed.
- `capabilities/openclaw.json` keeps OpenClaw in the existing Shared Workspace capability format.
- `events/battle-bridge-current.json` is a dashboard-compatible current event record.
- `events/battle-bridge-publisher-loop.ndjson` is the no-visible-PowerShell-wall route for loop tick and failure events.

If any publisher cannot check a service, it must publish `UNKNOWN` or `STALE` plus the exact next action instead of claiming live health. The scheduler enforces a 30 second minimum interval even if startup requests a lower value, and `stop()` must be called during Battle Bridge shutdown cleanup.
