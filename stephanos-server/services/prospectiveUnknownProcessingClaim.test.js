import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PROSPECTIVE_ORPHAN_APPROVAL_DOMAIN,
  PROSPECTIVE_ORPHAN_QUARANTINE_SCHEMA,
  PROSPECTIVE_ORPHAN_WITNESS_DOMAIN,
  authenticateProspectiveOrphanQuarantine,
} from './legacyOriginalSourceOrphanQuarantineV1.js';
import {
  PROSPECTIVE_ORPHAN_FENCE_SCHEMA,
  quarantineUnknownProcessingClaim,
} from './prospectiveUnknownProcessingClaimService.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const NOW = Date.parse('2026-11-04T12:10:00.000Z');
const missionId = 'critical-1574-elastic-goal';
const actionId = missionId + '-r5-101c4622bbe4';
const leaseKey = missionId + '-r5-lease';
const sourceRevision = '9c650175d569ab30f22a5f2f8970695372316dc5';
const operatorSourceRevision = '97242e214cd886357aacbb6043062829d4c3142a';

function signedPart(domain, claims, privateKey) {
  return {
    claims,
    algorithm: 'Ed25519',
    signatureBase64: sign(
      null,
      Buffer.from(domain + JSON.stringify(claims), 'utf8'),
      privateKey,
    ).toString('base64'),
  };
}

test('generic prospective containment authenticates exact UNKNOWN claim and rejects digest drift', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prospective-orphan-auth-'));
  const worktree = join(root, 'worktree');
  await mkdir(worktree);
  const witnessPair = generateKeyPairSync('ed25519');
  const operatorPair = generateKeyPairSync('ed25519');
  const witnessPath = join(root, 'witness.pem');
  const operatorPath = join(root, 'operator.pem');
  const evidencePath = join(root, 'evidence.json');
  const witnessBytes = witnessPair.publicKey.export({ type: 'spki', format: 'pem' });
  const operatorBytes = operatorPair.publicKey.export({ type: 'spki', format: 'pem' });
  await writeFile(witnessPath, witnessBytes);
  await writeFile(operatorPath, operatorBytes);

  const expected = {
    repository: 'Cheekyfellastef/stephan-os',
    missionId,
    missionRevision: 6,
    sourceExecutionId: actionId,
    sourceExecutionLeaseKey: leaseKey,
    processingClaimSha256: 'a'.repeat(64),
    branch: 'openclaw/elastic-goal-1574',
    sourceRevision,
    operatorSourceRevision,
    worktreePath: await realpath(worktree),
    commandId: 'quarantine-1574-r5-unknown',
    requestId: 'quarantine-1574-r5-request',
  };
  const witnessClaims = {
    ...expected,
    containmentEffectiveAtUtc: '2026-11-04T12:09:00.000Z',
    observedAtUtc: '2026-11-04T12:09:20.000Z',
    signedAtUtc: '2026-11-04T12:09:30.000Z',
    historicalTerminalReceiptPresent: false,
    historicalTerminalReceiptReconstructed: false,
    historicalExecutionOutcome: 'UNKNOWN',
    activeOriginalSourceWriters: 0,
    oldWriterAccessRevoked: true,
    outOfJobExecutionRevoked: true,
    wmiComRelaunchDenied: true,
    scheduledTaskRelaunchDenied: true,
    sourceWriteAccessDeniedToOriginalPrincipals: true,
    testedOldPrincipalWriteDenied: true,
    otherKnownWriterQueuesQuiesced: true,
    exactProcessingClaimQuarantinable: true,
    containmentRemainsEnforced: true,
    independentOsWitnessSid: 'S-1-5-80-12345',
    osEvidenceDigest: 'b'.repeat(64),
    denyAclPolicyDigest: 'c'.repeat(64),
    protectedWitnessLogId: 'prospective-witness-log-1574',
  };
  const osWitness = signedPart(
    PROSPECTIVE_ORPHAN_WITNESS_DOMAIN,
    witnessClaims,
    witnessPair.privateKey,
  );
  const witnessDigest = sha(Buffer.from(JSON.stringify(osWitness), 'utf8'));
  const approvalClaims = {
    repository: expected.repository,
    missionId,
    missionRevision: 6,
    sourceExecutionId: actionId,
    sourceExecutionLeaseKey: leaseKey,
    processingClaimSha256: expected.processingClaimSha256,
    commandId: expected.commandId,
    requestId: expected.requestId,
    witnessDigest,
    historicalOutcomeRemainsUnknown: true,
    deferGoalNotComplete: true,
    operatorApprovalKind: 'QUARANTINE_UNKNOWN_PROCESSING_CLAIM_ONLY',
    operatorSid: 'S-1-5-21-1000-1000-1000-1001',
    approvedAtUtc: '2026-11-04T12:09:40.000Z',
  };
  const record = {
    schemaVersion: PROSPECTIVE_ORPHAN_QUARANTINE_SCHEMA,
    osWitness,
    operatorApproval: signedPart(
      PROSPECTIVE_ORPHAN_APPROVAL_DOMAIN,
      approvalClaims,
      operatorPair.privateKey,
    ),
  };
  await writeFile(evidencePath, JSON.stringify(record));
  const env = {
    STEPHANOS_PROSPECTIVE_ORPHAN_EVIDENCE_PATH: evidencePath,
    STEPHANOS_PROSPECTIVE_ORPHAN_OS_WITNESS_PUBLIC_KEY_PATH: witnessPath,
    STEPHANOS_PROSPECTIVE_ORPHAN_OPERATOR_PUBLIC_KEY_PATH: operatorPath,
    STEPHANOS_PROSPECTIVE_ORPHAN_OS_WITNESS_PUBLIC_KEY_SHA256: sha(witnessBytes),
    STEPHANOS_PROSPECTIVE_ORPHAN_OPERATOR_PUBLIC_KEY_SHA256: sha(operatorBytes),
  };

  const accepted = await authenticateProspectiveOrphanQuarantine(expected, {
    env, now: () => NOW,
  });
  assert.equal(accepted.authenticated, true, JSON.stringify(accepted));
  assert.equal(accepted.processingClaimQuarantineAuthority, true);

  const drift = await authenticateProspectiveOrphanQuarantine({
    ...expected,
    processingClaimSha256: 'd'.repeat(64),
  }, { env, now: () => NOW });
  assert.equal(drift.authenticated, false);
});

function processingItem() {
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    missionId,
    actionId,
    adapter: 'foundry-forge',
    actionGrant: {
      schemaVersion: 'stephanos.mission-worker-action-grant.v1',
      missionId,
      actionId,
      missionRevision: 5,
      adapter: 'foundry-forge',
      sourceRevision,
    },
    executionBinding: {
      schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
      executionId: actionId,
      leaseKey,
      missionId,
      missionRevision: 5,
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1574,
      prNumber: null,
      branch: 'openclaw/elastic-goal-1574',
      headSha: '',
      sourceRevision,
    },
    payload: { missionId, actionId, adapter: 'foundry-forge' },
  };
}

test('UNKNOWN processing claim is fenced before exact bytes leave processing and replay is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prospective-orphan-claim-'));
  const queueRoot = join(root, 'queue');
  const processing = join(queueRoot, 'foundry-forge', 'processing');
  const failed = join(queueRoot, 'foundry-forge', 'failed');
  await mkdir(processing, { recursive: true });
  await mkdir(failed, { recursive: true });
  for (const stage of ['pending', 'completed']) {
    await mkdir(join(queueRoot, 'foundry-forge', stage), { recursive: true });
  }

  const claimPath = join(processing, actionId + '.json');
  const bytes = Buffer.from(JSON.stringify(processingItem()));
  await writeFile(claimPath, bytes);
  const claimSha = sha(bytes);
  const current = {
    missionId,
    revision: 6,
    repository: 'Cheekyfellastef/stephan-os',
    currentPhase: 'AGENT_IMPLEMENTATION',
    cancelled: false,
    dispatch: { status: 'running', adapter: 'foundry-forge' },
    git: {
      branch: 'openclaw/elastic-goal-1574',
      worktreePath: join(root, 'worktree'),
    },
    storeMetadata: {
      lastEventId: 'pickup-' + actionId,
      processedEventIds: ['pickup-' + actionId],
    },
  };
  await mkdir(current.git.worktreePath);
  let durable = current;
  const paths = {
    workspaceRoot: join(root, 'workspace'),
    repoRoot: join(root, 'repo'),
    orchestratorRoot: join(root, 'orchestrator'),
  };
  await mkdir(paths.workspaceRoot);
  await mkdir(paths.repoRoot);
  await mkdir(paths.orchestratorRoot);

  const options = {
    queueRoot,
    paths,
    env: {},
    readMissionRecord: async () => ({ state: durable }),
    readExecutionReceiptHistory: async () => ({
      ok: true, receipts: [], latestReceipt: null,
    }),
    authenticateProspectiveOrphanQuarantine: async expected => ({
      authenticated: true,
      historicalExecutionOutcome: 'UNKNOWN',
      eligibilityOnly: true,
      processingClaimQuarantineAuthority: true,
      leaseReleaseAuthority: false,
      evidenceDigest: 'e'.repeat(64),
      witnessDigest: 'f'.repeat(64),
      processingClaimSha256: expected.processingClaimSha256,
    }),
    withOriginalSourceLeaseFenceGuard: async operation => operation(),
    appendMissionEvent: async (_mission, event, appendOptions) => {
      const fence = await appendOptions.proveOriginalSourceQuarantine(durable);
      durable = {
        ...durable,
        revision: durable.revision + 1,
        currentPhase: 'CANCELLED',
        cancelled: true,
        storeMetadata: {
          ...durable.storeMetadata,
          originalSourceAttemptFence: fence,
          lastEventId: event.eventId,
          processedEventIds: [...durable.storeMetadata.processedEventIds, event.eventId],
        },
      };
      return { state: durable, duplicate: false, eventId: event.eventId };
    },
  };
  const input = {
    missionId,
    commandId: 'quarantine-1574-r5-unknown',
    operatorRequestId: 'quarantine-1574-r5-request',
    operatorSourceRevision,
    expectedMissionRevision: 6,
    sourceExecutionId: actionId,
    sourceExecutionLeaseKey: leaseKey,
    processingClaimSha256: claimSha,
    reason: 'Retire exact UNKNOWN processing claim.',
  };

  const first = await quarantineUnknownProcessingClaim(input, options);
  assert.equal(
    first.state.storeMetadata.originalSourceAttemptFence.schemaVersion,
    PROSPECTIVE_ORPHAN_FENCE_SCHEMA,
  );
  assert.equal(
    first.state.storeMetadata.originalSourceAttemptFence.historicalExecutionOutcome,
    'UNKNOWN',
  );
  assert.equal(first.processingClaimQuarantine.quarantined, true);
  assert.equal(first.processingClaimQuarantine.idempotent, false);
  const archived = join(failed, first.processingClaimQuarantine.archiveName);
  assert.equal(sha(await readFile(archived)), claimSha);
  await assert.rejects(readFile(claimPath), error => error.code === 'ENOENT');

  const replay = await quarantineUnknownProcessingClaim(input, options);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.processingClaimQuarantine.idempotent, true);

  await assert.rejects(
    quarantineUnknownProcessingClaim({
      ...input, processingClaimSha256: '0'.repeat(64),
    }, options),
    /PROSPECTIVE_ORPHAN_REPLAY_IDENTITY_MISMATCH/,
  );
});
