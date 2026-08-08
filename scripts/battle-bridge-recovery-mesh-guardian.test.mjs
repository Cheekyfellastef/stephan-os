import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const guardianUrl = new URL('./windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1', import.meta.url);
const installerUrl = new URL('./windows/install-battle-bridge-recovery-mesh.ps1', import.meta.url);
const launcherUrl = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);
const [guardian, installer, launcher] = await Promise.all([
  readFile(guardianUrl, 'utf8'),
  readFile(installerUrl, 'utf8'),
  readFile(launcherUrl, 'utf8'),
]);

test('guardian has one fixed recovery-mesh mutation scope', () => {
  assert.match(guardian, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(guardian, /REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY/);
  assert.match(guardian, /-RecoveryMeshOnly/);
  assert.match(guardian, /-StartNow/);
  assert.doesNotMatch(guardian, /Register-ScheduledTask|New-ScheduledTaskAction|New-ScheduledTaskTrigger/);
  assert.doesNotMatch(guardian, /Invoke-Expression|\biex\b|Start-Process|cmd\.exe/i);
  assert.match(guardian, /arbitraryShellAllowed = \$false/);
  assert.match(guardian, /sourceMutationAllowed = \$false/);
  assert.match(guardian, /gitMutationAllowed = \$false/);
  assert.match(guardian, /arbitraryRuntimeMutationAllowed = \$false/);
  assert.match(guardian, /mergeAuthority = \$false/);
});

test('guardian fails closed unless canonical recovery source is locally trustworthy', () => {
  assert.match(guardian, /Documents\\GitHub\\stephan-os/);
  assert.match(guardian, /branch --show-current/);
  assert.match(guardian, /CANONICAL_MAIN_BRANCH_REQUIRED/);
  assert.match(guardian, /remote get-url origin/);
  assert.match(guardian, /CANONICAL_ORIGIN_REQUIRED/);
  assert.match(guardian, /ReparsePoint/);
  assert.match(guardian, /diff --quiet --/);
  assert.match(guardian, /diff --cached --quiet --/);
  assert.match(guardian, /RECOVERY_SOURCE_DIRTY/);
  assert.match(guardian, /RECOVERY_SOURCE_STAGED_DIRTY/);
  assert.doesNotMatch(guardian, /\b(?:reset|clean|stash|rebase|push|checkout|switch|merge|fetch)\b/i);
});

test('guardian treats missing failed and stale recovery mesh as repair conditions', () => {
  assert.match(guardian, /TASK_MISSING/);
  assert.match(guardian, /TASK_INFO_MISSING/);
  assert.match(guardian, /TASK_LAST_RESULT_FAILED/);
  assert.match(guardian, /TASK_HEARTBEAT_STALE/);
  assert.match(guardian, /StaleAfterMinutes = 4/);
  assert.match(guardian, /lastTaskResult -eq 0/);
  assert.match(guardian, /lastRunAgeMinutes -le \$StaleAfterMinutes/);
  assert.match(guardian, /BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_REPAIRED/);
  assert.match(guardian, /BATTLE_BRIDGE_RECOVERY_MESH_GUARDIAN_HEALTHY/);
});

test('recovery installer creates a separate wake-only guardian without a second controller', () => {
  assert.match(installer, /Stephanos Battle Bridge Recovery Mesh Guardian/);
  assert.match(installer, /recovery-mesh-guardian/);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 5\)/);
  assert.match(installer, /guardianStaleAfterMinutes = 4/);
  assert.match(installer, /guardianAuthority = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'/);
  assert.match(installer, /RecoveryMeshOnly/);
  assert.match(installer, /LOCAL_WINDOWS_GUARDIAN/);
  assert.match(installer, /maximumConcurrentExecutors = 1/);
  assert.match(installer, /arbitraryTaskNameAllowed = \$false/);
  assert.match(installer, /sourceMutationAllowed = \$false/);
  assert.match(installer, /gitMutationAllowed = \$false/);
  assert.match(installer, /mergeAuthority = \$false/);
});

test('windowless launcher exposes only the fixed guardian identity and script', () => {
  assert.match(launcher, /Case "recovery-mesh-guardian"/);
  assert.match(launcher, /run-battle-bridge-recovery-mesh-guardian-hidden\.ps1/);
  assert.doesNotMatch(launcher, /WScript\.Arguments\(1\)|ExecuteGlobal|Eval\(/i);
});
