import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID,
  OPENCLAW_STAGED_UPDATE_ACTION,
  OPENCLAW_STAGED_UPDATE_STATUS,
  OPENCLAW_UPDATE_APPROVAL_SCHEMA,
  OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA,
  OPENCLAW_UPDATE_BACKUP_SCHEMA,
  OPENCLAW_UPDATE_POST_PROOF_SCHEMA,
  OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA,
  OPENCLAW_UPDATE_ROLLBACK_PROOF_SCHEMA,
  OPENCLAW_UPDATE_ROLLBACK_RECEIPT_SCHEMA,
  OPENCLAW_UPDATE_STAGE_SCHEMA,
  buildOpenClawStagedUpdateV1,
} from './openClawStagedUpdateV1.mjs';

const NOW = '2026-08-04T10:30:00.000Z';
const SOURCE_HEAD = 'a'.repeat(40);
const MANIFEST = 'b'.repeat(64);
const PACKET_SHA = 'c'.repeat(64);
const SOURCE_DIGESTS = ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)];
const FINGERPRINTS = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64)];

function preflight() {
  return {
    schema: 'stephanos.openclaw-update-preflight.v1',
    status: 'APPROVAL_REQUIRED',
    blockers: [],
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    currentOpenClaw: {
      version: '1.2.3',
      gatewayEndpoint: 'http://127.0.0.1:18789',
    },
    updatePacket: {
      packetId: 'openclaw-1.2.4',
      packetSha256: PACKET_SHA,
      targetVersion: '1.2.4',
    },
    preservationManifest: {
      manifestSha256: MANIFEST,
      entries: [
        {
          pathFingerprintSha256: FINGERPRINTS[0],
          classification: 'PRESERVE_SOURCE',
          exists: true,
          digestSha256: SOURCE_DIGESTS[0],
        },
        {
          pathFingerprintSha256: FINGERPRINTS[1],
          classification: 'PRESERVE_CONFIG',
          exists: true,
          digestSha256: SOURCE_DIGESTS[1],
        },
        {
          pathFingerprintSha256: FINGERPRINTS[2],
          classification: 'PRESERVE_RUNTIME',
          exists: true,
          digestSha256: SOURCE_DIGESTS[2],
        },
      ],
    },
    safety: { mutationAllowed: false, updateAttempted: false },
  };
}

function approval(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_APPROVAL_SCHEMA,
    approvalId: 'approval-1415-a',
    approvedBy: 'Cheekyfellastef',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    manifestSha256: MANIFEST,
    packetId: 'openclaw-1.2.4',
    packetSha256: PACKET_SHA,
    targetVersion: '1.2.4',
    mutationScope: OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE,
    singleUse: true,
    approvedAtUtc: '2026-08-04T10:00:00.000Z',
    expiresAtUtc: '2026-08-04T12:00:00.000Z',
    ...overrides,
  };
}

function stage(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_STAGE_SCHEMA,
    stageId: 'stage-openclaw-1.2.4',
    packetId: 'openclaw-1.2.4',
    packetSha256: PACKET_SHA,
    targetVersion: '1.2.4',
    isolationClass: 'ISOLATED_EXTERNAL_STAGING',
    insideRepository: false,
    insideOpenClawInstall: false,
    packageEntryCount: 12,
    executableEntryCount: 1,
    observedAtUtc: '2026-08-04T10:05:00.000Z',
    ...overrides,
  };
}

function backupSet(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_BACKUP_SCHEMA,
    backupSetId: 'backup-openclaw-1.2.3',
    manifestSha256: MANIFEST,
    storageClass: 'ISOLATED_EXTERNAL_BACKUP',
    insideRepository: false,
    insideOpenClawInstall: false,
    createdAtUtc: '2026-08-04T10:06:00.000Z',
    entries: FINGERPRINTS.map((fingerprint, index) => ({
      pathFingerprintSha256: fingerprint,
      sourceDigestSha256: SOURCE_DIGESTS[index],
      backupDigestSha256: String(index + 7).repeat(64),
      backupObjectId: `backup-object-${index + 1}`,
    })),
    ...overrides,
  };
}

function applyReceipt(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA,
    receiptId: 'apply-receipt-1',
    adapterId: OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID,
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    manifestSha256: MANIFEST,
    approvalId: 'approval-1415-a',
    stageId: 'stage-openclaw-1.2.4',
    backupSetId: 'backup-openclaw-1.2.3',
    packetId: 'openclaw-1.2.4',
    packetSha256: PACKET_SHA,
    beforeVersion: '1.2.3',
    targetVersion: '1.2.4',
    mutationAttempted: true,
    observedAtUtc: '2026-08-04T10:10:00.000Z',
    steps: [
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_PREFLIGHT,
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_APPROVAL,
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_STAGE,
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_BACKUP,
      OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE,
    ],
    ...overrides,
  };
}

function healthProof(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_POST_PROOF_SCHEMA,
    proofId: 'post-proof-1',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    manifestSha256: MANIFEST,
    observedVersion: '1.2.4',
    gatewayEndpoint: 'http://127.0.0.1:18789',
    observedAtUtc: '2026-08-04T10:15:00.000Z',
    health: {
      openClawGateway: true,
      stephanosBackend: true,
      stephanosUi: true,
      missionWorker: true,
      sharedWorkspaceWrite: true,
    },
    ...overrides,
  };
}

function comparison(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA,
    comparisonId: 'comparison-1',
    manifestSha256: MANIFEST,
    entries: FINGERPRINTS.map((fingerprint, index) => ({
      pathFingerprintSha256: fingerprint,
      beforeDigestSha256: SOURCE_DIGESTS[index],
      afterDigestSha256: SOURCE_DIGESTS[index],
    })),
    ...overrides,
  };
}

function rollbackReceipt(overrides = {}) {
  return {
    schema: OPENCLAW_UPDATE_ROLLBACK_RECEIPT_SCHEMA,
    receiptId: 'rollback-receipt-1',
    adapterId: OPENCLAW_BOUNDED_UPDATE_ADAPTER_ID,
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: SOURCE_HEAD,
    manifestSha256: MANIFEST,
    backupSetId: 'backup-openclaw-1.2.3',
    restoredVersion: '1.2.3',
    mutationAttempted: true,
    observedAtUtc: '2026-08-04T10:20:00.000Z',
    steps: [
      OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE,
      OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP,
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK,
    ],
    ...overrides,
  };
}

function rollbackProof(overrides = {}) {
  return {
    ...healthProof(),
    schema: OPENCLAW_UPDATE_ROLLBACK_PROOF_SCHEMA,
    proofId: 'rollback-proof-1',
    observedVersion: '1.2.3',
    observedAtUtc: '2026-08-04T10:22:00.000Z',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    nowUtc: NOW,
    preflight: preflight(),
    ...overrides,
  };
}

test('preflight alone requires an exact operator approval without granting mutation', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput());
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.APPROVAL_REQUIRED);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.safety.mutationAllowed, false);
  assert.equal(result.safety.battleBridgeAdapterRequired, true);
  assert.equal(result.applyPlan.some((step) => step.executed), false);
});

test('valid approval advances only to staging and backup requirements', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({ approval: approval() }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.STAGING_REQUIRED);
  assert.equal(result.blockers.length, 0);
});

test('isolated packet stage and complete backup set produce ready-to-apply truth', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY);
  assert.equal(result.blockers.length, 0);
  assert.match(result.evidence.backupSet.backupSetSha256, /^[a-f0-9]{64}$/);
});

test('forged, expired or wrong-scope approval fails closed', () => {
  for (const hostile of [
    approval({ approvedBy: 'someone-else' }),
    approval({ expiresAtUtc: '2026-08-04T10:01:00.000Z' }),
    approval({ mutationScope: 'ARBITRARY_SHELL' }),
  ]) {
    const result = buildOpenClawStagedUpdateV1(baseInput({ approval: hostile }));
    assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH);
    assert.ok(result.blockers.some((blocker) => blocker.startsWith('APPROVAL_')));
  }
});

test('stage inside repository or OpenClaw install cannot become update-ready', () => {
  for (const hostile of [
    stage({ insideRepository: true }),
    stage({ insideOpenClawInstall: true }),
    stage({ isolationClass: 'OPENCLAW_INSTALL_DIRECTORY' }),
  ]) {
    const result = buildOpenClawStagedUpdateV1(baseInput({
      approval: approval(),
      stage: hostile,
      backupSet: backupSet(),
    }));
    assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH);
    assert.ok(result.blockers.some((blocker) => blocker.startsWith('STAGE_')));
  }
});

test('backup must cover every protected identity with its exact source digest', () => {
  const missing = backupSet({ entries: backupSet().entries.slice(0, 2) });
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: missing,
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('BACKUP_ENTRY_MISSING:')));
});

test('a valid apply receipt never becomes success without health and preservation proof', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt(),
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.POST_UPDATE_PROOF_REQUIRED);
  assert.equal(result.blockers.length, 0);
});

test('complete exact health and unchanged protected identities prove update success', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt(),
    postUpdateProof: healthProof(),
    preservationComparison: comparison(),
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED);
  assert.equal(result.blockers.length, 0);
});

test('health failure or overwritten protected identity requires rollback', () => {
  const healthFailure = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt(),
    postUpdateProof: healthProof({ health: { ...healthProof().health, missionWorker: false } }),
    preservationComparison: comparison(),
  }));
  assert.equal(healthFailure.status, OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED);
  assert.ok(healthFailure.blockers.includes('POST_UPDATE_PROOF_HEALTH_FAILED:missionWorker'));

  const overwrite = comparison({
    entries: comparison().entries.map((entry, index) => (
      index === 1 ? { ...entry, afterDigestSha256: '9'.repeat(64) } : entry
    )),
  });
  const preservationFailure = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt(),
    postUpdateProof: healthProof(),
    preservationComparison: overwrite,
  }));
  assert.equal(preservationFailure.status, OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED);
  assert.ok(preservationFailure.blockers.some((blocker) => blocker.startsWith('PRESERVATION_COMPARISON_AFTER_DIGEST_MISMATCH:')));
});

test('invalid or unknown apply adapter is treated as mutation uncertainty and requires rollback', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt({ adapterId: 'generic-shell-adapter' }),
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED);
  assert.ok(result.blockers.includes('APPLY_RECEIPT_ADAPTER_MISMATCH'));
});

test('partial rollback evidence remains rollback-required until complete proof arrives', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt(),
    rollbackReceipt: rollbackReceipt(),
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED);
});

test('complete rollback proof restores prior version, health and protected identities', () => {
  const result = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
    applyReceipt: applyReceipt(),
    rollbackReceipt: rollbackReceipt(),
    rollbackProof: rollbackProof(),
    rollbackComparison: comparison({ comparisonId: 'rollback-comparison-1' }),
  }));
  assert.equal(result.status, OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED);
  assert.equal(result.blockers.length, 0);
});

test('backup-set digest is deterministic across inventory order', () => {
  const first = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet(),
  }));
  const second = buildOpenClawStagedUpdateV1(baseInput({
    approval: approval(),
    stage: stage(),
    backupSet: backupSet({ entries: [...backupSet().entries].reverse() }),
  }));
  assert.equal(first.evidence.backupSet.backupSetSha256, second.evidence.backupSet.backupSetSha256);
});

test('source contract contains no executable command or hidden authority surface', async () => {
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./openClawStagedUpdateV1.mjs', import.meta.url), 'utf8'));
  for (const forbidden of [
    'child_process',
    'execSync',
    'spawn(',
    'powershell',
    'cmd.exe',
    'git reset',
    'git clean',
    'process.env',
    'fs.readFile',
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden source capability: ${forbidden}`);
  }
  const result = buildOpenClawStagedUpdateV1(baseInput());
  assert.equal(result.safety.arbitraryShellAllowed, false);
  assert.equal(result.safety.sourceMutationAllowed, false);
  assert.equal(result.safety.mergeAuthority, false);
  assert.equal(result.safety.deploymentAuthority, false);
});
