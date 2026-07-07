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

## Backend dashboard feed and startup loop proof

These commands prove the running Stephanos backend exposes the read-only Shared Workspace dashboard feed and starts/stops the Battle Bridge publisher loop only when the configured workspace already exists. They do not run arbitrary shell from the backend, kill processes, restart services, dump secrets, write the dashboard, or mutate the repo from runtime.

### Endpoint unavailable state

```powershell
Remove-Item Env:STEPHANOS_SHARED_AGENT_WORKSPACE -ErrorAction SilentlyContinue
$env:PORT='8787'
$backend = Start-Process -FilePath node -ArgumentList 'stephanos-server/server.js' -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
Invoke-RestMethod 'http://127.0.0.1:8787/api/shared-workspace/dashboard-feed' | Select-Object state,reason,workspaceRoot,exactNextAction
Stop-Process -Id $backend.Id
```

Expected truth: `state` is `unavailable`, `workspaceRoot` is `UNKNOWN`, and `exactNextAction` is exactly `Set STEPHANOS_SHARED_AGENT_WORKSPACE to an existing external Shared Agent Workspace directory, then restart Battle Bridge startup supervision.`

### Endpoint ready path with a temp Shared Workspace

```powershell
$workspace = Join-Path $env:TEMP ('stephanos-openclaw-workspace-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
'goals','status','proof','capabilities','events' | ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $workspace $_) | Out-Null }
$env:STEPHANOS_SHARED_AGENT_WORKSPACE=$workspace
$env:PORT='8787'
$backend = Start-Process -FilePath node -ArgumentList 'stephanos-server/server.js' -WorkingDirectory (Get-Location) -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 3
Invoke-RestMethod 'http://127.0.0.1:8787/api/shared-workspace/dashboard-feed' | Select-Object route,readOnly,state,reason,workspaceRoot
Stop-Process -Id $backend.Id
```

Expected truth: `route` is `/api/shared-workspace/dashboard-feed`, `readOnly` is `True`, and `workspaceRoot` is the temp workspace. If no records have been published yet, `state` remains `unavailable` with `reason` `NO_WORKSPACE_RECORDS`; after current publisher records exist, the same endpoint can become `ready` or `stale` based on record freshness.

### Publisher loop startup/shutdown smoke proof

```powershell
$workspace = Join-Path $env:TEMP ('stephanos-openclaw-workspace-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $workspace | Out-Null
$env:STEPHANOS_SHARED_AGENT_WORKSPACE=$workspace
node --input-type=module -e "import { startBattleBridgePublisherLoopForBackend } from './stephanos-server/services/battleBridgePublisherLifecycle.js'; const handle = await startBattleBridgePublisherLoopForBackend({ env: process.env, repoRoot: process.cwd(), runImmediately: true, intervalMs: 30000 }); setTimeout(() => { console.log(JSON.stringify({ started: handle.started, state: handle.state, reason: handle.reason, stop: handle.stop() }, null, 2)); }, 1500);"
Get-Content (Join-Path $workspace 'status\battle-bridge-current.json') -Raw
Get-Content (Join-Path $workspace 'events\battle-bridge-publisher-loop.ndjson') -Tail 5
```

Expected truth: startup reports `started: true`; shutdown reports `BATTLE_BRIDGE_PUBLISHER_LOOP_STOPPED`; published records use `UNKNOWN` or `STALE` plus exact next action unless live service proof is available.
