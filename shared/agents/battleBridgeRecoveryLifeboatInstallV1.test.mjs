import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BATTLE_BRIDGE_LIFEBOAT_TASK_NAME,
  planBattleBridgeRecoveryLifeboatInstall,
} from './battleBridgeRecoveryLifeboatInstallV1.mjs';

const CANDIDATE = 'b'.repeat(64);
const ACTIVE = 'a'.repeat(64);

test('first installation bootstraps one bank without falsely claiming A/B rollback', () => {
  const plan = planBattleBridgeRecoveryLifeboatInstall({
    candidateVersion: '1.0.0',
    candidateManifestSha256: CANDIDATE,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.installPlan.mode, 'BOOTSTRAP_SINGLE_KNOWN_GOOD_BANK');
  assert.equal(plan.installPlan.targetBank, 'A');
  assert.equal(plan.installPlan.productionRedundancyReadyAfter, false);
  assert.equal(plan.activeBankOverwriteAllowed, false);
  assert.equal(plan.dualBankOverwriteAllowed, false);
});

test('known-good active A stages only distinct candidate into inactive B', () => {
  const plan = planBattleBridgeRecoveryLifeboatInstall({
    candidateVersion: '1.1.0',
    candidateManifestSha256: CANDIDATE,
    activeBank: 'A',
    activeManifestSha256: ACTIVE,
    activeSelfTestVerdict: 'PASS',
    activeHeartbeatFresh: true,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.installPlan.mode, 'STAGE_INACTIVE_BANK');
  assert.equal(plan.installPlan.targetBank, 'B');
  assert.equal(plan.installPlan.rollbackBank, 'A');
  assert.equal(plan.installPlan.atomicActiveBankSwitchRequired, true);
  assert.equal(plan.installPlan.retainRollbackBankRequired, true);
  assert.equal(plan.installPlan.productionRedundancyReadyAfter, true);
});

test('stale active bank recovers only through inactive bank and does not claim rollback redundancy', () => {
  const sameManifest = planBattleBridgeRecoveryLifeboatInstall({
    candidateVersion: '1.1.0',
    candidateManifestSha256: ACTIVE,
    activeBank: 'A',
    activeManifestSha256: ACTIVE,
    activeSelfTestVerdict: 'PASS',
    activeHeartbeatFresh: false,
  });
  assert.equal(sameManifest.ok, true);
  assert.equal(sameManifest.installPlan.mode, 'RECOVER_STALE_ACTIVE_THROUGH_INACTIVE_BANK');
  assert.equal(sameManifest.installPlan.targetBank, 'B');
  assert.equal(sameManifest.installPlan.rollbackBank, 'A');
  assert.equal(sameManifest.installPlan.requireCandidateSelfTestPass, true);
  assert.equal(sameManifest.installPlan.requireCandidateHeartbeatFresh, true);
  assert.equal(sameManifest.installPlan.productionRedundancyReadyAfter, false);
  assert.equal(sameManifest.activeBankOverwriteAllowed, false);
  assert.equal(sameManifest.dualBankOverwriteAllowed, false);

  const distinctManifest = planBattleBridgeRecoveryLifeboatInstall({
    candidateVersion: '1.1.0',
    candidateManifestSha256: CANDIDATE,
    activeBank: 'B',
    activeManifestSha256: ACTIVE,
    activeSelfTestVerdict: 'PASS',
    activeHeartbeatFresh: false,
  });
  assert.equal(distinctManifest.ok, true);
  assert.equal(distinctManifest.installPlan.targetBank, 'A');
  assert.equal(distinctManifest.installPlan.productionRedundancyReadyAfter, false);
});

test('failed active self-test still fails closed and healthy identical candidate remains rejected', () => {
  assert.equal(planBattleBridgeRecoveryLifeboatInstall({
    candidateVersion: '1.1.0', candidateManifestSha256: CANDIDATE,
    activeBank: 'A', activeManifestSha256: ACTIVE, activeSelfTestVerdict: 'FAIL', activeHeartbeatFresh: false,
  }).blocker, 'LIFEBOAT_ACTIVE_BANK_NOT_KNOWN_GOOD');
  assert.equal(planBattleBridgeRecoveryLifeboatInstall({
    candidateVersion: '1.1.0', candidateManifestSha256: ACTIVE,
    activeBank: 'A', activeManifestSha256: ACTIVE, activeSelfTestVerdict: 'PASS', activeHeartbeatFresh: true,
  }).blocker, 'LIFEBOAT_CANDIDATE_NOT_DISTINCT');
});

test('installer has one fixed limited-user task and fixed local recovery root', async () => {
  const source = await readFile(new URL('../../scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url), 'utf8');
  assert.match(source, new RegExp(BATTLE_BRIDGE_LIFEBOAT_TASK_NAME));
  assert.match(source, /LOCALAPPDATA/);
  assert.match(source, /Stephanos\\BattleBridgeRecoveryLifeboat/);
  assert.match(source, /RunLevel Limited/);
  assert.match(source, /RepetitionInterval \(New-TimeSpan -Minutes 2\)/);
  assert.match(source, /MultipleInstances IgnoreNew/);
  assert.doesNotMatch(source, /Param\([^)]*Path/i);
  assert.doesNotMatch(source, /Invoke-Expression/i);
  assert.doesNotMatch(source, /git\.exe/i);
  assert.doesNotMatch(source, /Restart-Computer/i);
});

test('candidate installed-bank heartbeat is required before atomic active-state publication', async () => {
  const source = await readFile(new URL('../../scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url), 'utf8');
  const executeCandidate = source.indexOf('$candidateOutput = @(');
  const verifyHeartbeat = source.indexOf('Read-FreshHealthyHeartbeat -BankId $targetBank');
  const publishState = source.indexOf('Write-AtomicJson -Path $activeStatePath');
  assert.ok(executeCandidate >= 0);
  assert.ok(verifyHeartbeat > executeCandidate);
  assert.ok(publishState > verifyHeartbeat);
  assert.match(source, /candidateHeartbeatRequiredBeforePromotion = \$true/);
  assert.match(source, /payloadHashVerificationRequired = \$true/);
});

test('bank runner verifies its own payload manifest and has no repo dependency', async () => {
  const source = await readFile(new URL('../../scripts/windows/run-battle-bridge-recovery-lifeboat-bank-v1.ps1', import.meta.url), 'utf8');
  assert.match(source, /Get-FileHash/);
  assert.match(source, /payload hash does not match its immutable manifest/);
  assert.match(source, /payloadVerified = \$true/);
  assert.match(source, /repoCheckoutRequired = \$false/);
  assert.match(source, /openClawGatewayRequired = \$false/);
  assert.doesNotMatch(source, /Documents\\GitHub\\stephan-os/i);
  assert.doesNotMatch(source, /git\.exe/i);
});

test('active launcher can select only A or B and requires proven state + manifest identity', async () => {
  const source = await readFile(new URL('../../scripts/windows/run-battle-bridge-recovery-lifeboat-active-v1.ps1', import.meta.url), 'utf8');
  assert.match(source, /activeBank/);
  assert.match(source, /@\('A', 'B'\)/);
  assert.match(source, /selfTestVerdict/);
  assert.match(source, /manifestSha256/);
  assert.doesNotMatch(source, /USERPROFILE/);
  assert.doesNotMatch(source, /Documents\\GitHub\\stephan-os/i);
});
