import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const runnerPath = new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url);
const statusPath = new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url);
const httpPath = new URL('../../scripts/sovereign-commander-http.mjs', import.meta.url);
const autohealPath = new URL('../../scripts/sovereign-commander-ignition-autoheal.mjs', import.meta.url);
const remotePath = new URL('./sovereignCommanderRemoteMailboxV1.mjs', import.meta.url);
const commanderPath = new URL('./sovereignCommanderV1.mjs', import.meta.url);
const refreshPath = new URL('./postSyncRuntimeRefreshCoordinator.mjs', import.meta.url);

test('Sovereign Commander supervises exactly the fixed Stephanos Core Daemon', async () => {
  const [runner, commander, remote, status, refresh, http, autoheal] = await Promise.all([
    readFile(runnerPath, 'utf8'),
    readFile(commanderPath, 'utf8'),
    readFile(remotePath, 'utf8'),
    readFile(statusPath, 'utf8'),
    readFile(refreshPath, 'utf8'),
    readFile(httpPath, 'utf8'),
    readFile(autohealPath, 'utf8'),
  ]);

  assert.match(runner, /scripts\\stephanos-core-daemon\.mjs/);
  assert.match(runner, /SOVEREIGN_COMMANDER_CORE_DAEMON_NOT_HEALTHY/);
  assert.match(runner, /sourceMutationDelegatedToMissionWorker = \$true/);
  assert.match(runner, /duplicateSchedulerAllowed = \$false/);
  assert.match(runner, /coreDaemonHealthy = \[bool\]\$coreDaemonOk/);
  assert.match(runner, /\[switch\]\$SkipCoreDaemonLifecycle/);
  assert.match(runner, /if \(\$SkipCoreDaemonLifecycle\)/);
  assert.match(runner, /if \(-not \$coreDaemonOk -and -not \$SkipCoreDaemonLifecycle\) \{ exit 5 \}/);
  assert.match(autoheal, /'-SkipCoreDaemonLifecycle'/);
  assert.match(commander, /'status-stephanos-core-daemon': frozen\(\{/);
  assert.match(remote, /'status-stephanos-core-daemon'/);
  assert.match(remote, /remoteCommanderRequired: false/);
  assert.match(status, /sourceMutationAllowed = \$false/);
  assert.match(status, /schedulerAuthority = \$false/);
  assert.match(status, /wakeState = if \(\$null -ne \$status/);
  assert.match(status, /awake = if \(\$null -ne \$status/);
  assert.match(status, /repairRequired = if \(\$null -ne \$status/);
  assert.match(status, /repairReason = if \(\$null -ne \$status/);
  assert.match(status, /controlPlaneFinalVerdict = if \(\$null -ne \$status/);
  assert.doesNotMatch(status, /exit 2/);
  assert.match(refresh, /scripts\/stephanos-core-daemon\.mjs/);
  assert.match(refresh, /scripts\/windows\/status-stephanos-core-daemon\.ps1/);
  assert.match(http, /2026-10-04-stephanos-repair-time-budget-v1/);
  assert.match(autoheal, /2026-10-04-stephanos-repair-time-budget-v1/);
});
