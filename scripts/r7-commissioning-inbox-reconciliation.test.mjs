import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectR7CommissioningRequest, reconcileR7CommissioningInbox } from './r7-commissioning-inbox-reconciliation.mjs';
import { acquireSharedWorkspaceOperationLock } from '../shared/agents/executionReceiptV1.mjs';

const stamp = '2026-10-21T14:50:38.411Z';
const nowMs = Date.parse(stamp) + 1000;
function record() {
  const id = 'r7-executor-admission-test';
  return { schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.record.message', messageId: 'next-action-packet-' + id,
    participantId: 'chatgpt-bridge', timestampUtc: stamp, correlationId: 'r7-executor-admission-3123',
    relatedIssue: '#3123', relatedPr: '#3178', proofRefs: ['receipts/' + id],
    channel: 'chatgpt-participant-bridge', summary: 'Reconcile the existing R7 request.',
    body: JSON.stringify({ recordKind: 'next-action-packet', boundedPayload: {
      summary: 'Reconcile the existing R7 request.',
      requestRef: 'https://github.com/Cheekyfellastef/stephan-os/issues/3123#issuecomment-6318917386',
      diagnosticCode: 'R7_COMMISSIONING_EXECUTOR_ADMISSION_NOT_PROVEN',
      engineeringOwner: 'Existing coordinator', independentReviewProvider: 'Existing qualified reviewer',
      executionIdentityStatus: 'NOT_PROVEN', decisionRequested: 'Resolve independently admitted host authority.',
      requiredEvidence: ['Complete candidate and independently admitted roots'],
      newWorkerRequested: false, newMissionRequested: false, sourceMutationAuthorized: false,
      runtimeMutationAuthorized: false, signerEnrollmentAuthorized: false, leaseReleaseAuthorized: false,
    } }) };
}
function noAuthority(r) {
  for (const field of ['hostExecutionAuthorized', 'sourceMutationAuthorized', 'signerEnrollmentAuthorized',
    'leaseReleaseAuthorized', 'operatorApprovalCreated', 'historicalReceiptReconstructed'])
    assert.equal(r[field], false, field);
}
async function fixture(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'r7-inbox-tests-'));
  const item = record();
  const segments = ['inbox', 'r7-executor-admission-test.json'];
  await mkdir(path.join(root, 'inbox'));
  await writeFile(path.join(root, ...segments), JSON.stringify(item));
  try {
    await fn({ root, segments, record: item, writeOptions: { repoRoot: path.join(root, 'separate-repository'), nowMs } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('bounded delivered request reconciles to durable HOLD; repeat reuses exact receipt', async () => {
  await fixture(async args => {
    const first = await reconcileR7CommissioningInbox(args);
    assert.equal(first.ok, true, first.reason); assert.equal(first.held, true); noAuthority(first);
    const target = path.join(args.root, 'receipts', first.receiptId + '.json');
    const bytes = await readFile(target, 'utf8');
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.admissionReconciliation.status, 'HELD'); noAuthority(receipt.admissionReconciliation);
    assert.ok(receipt.admissionReconciliation.blockers.includes('R7_WINDOWS_EXECUTOR_ADMISSION_ISSUER_UNDEFINED'));
    const repeat = await reconcileR7CommissioningInbox({ ...args, writeOptions: { ...args.writeOptions, nowMs: nowMs + 86_400_000 } });
    assert.equal(repeat.reason, 'R7_ADMISSION_ALREADY_RECONCILED_HELD');
    assert.equal(await readFile(target, 'utf8'), bytes);
    assert.deepEqual((await readdir(path.join(args.root, 'receipts'))).filter(x => x.endsWith('.json')), [first.receiptId + '.json']);
  });
});

test('request-supplied authority, identity, issuer or arbitrary operation never become a grant', () => {
  for (const [key, value] of [
    ['leaseReleaseAuthorized', true], ['runtimeMutationAuthorized', true],
    ['sourceMutationAuthorized', true], ['signerEnrollmentAuthorized', true],
    ['newWorkerRequested', true], ['newMissionRequested', true],
    ['authenticated', true], ['windowsSid', 'S-1-5-18'], ['issuer', 'coordinator'],
    ['candidateHead', 'a'.repeat(40)], ['operation', 'INSTALL'], ['executionIdentityStatus', 'ADMIN'],
    ['requestRef', 'https://example.com/approve'], ['requiredEvidence', []],
  ]) {
    const item = record(); const body = JSON.parse(item.body);
    body.boundedPayload[key] = value; item.body = JSON.stringify(body);
    const result = inspectR7CommissioningRequest(item, { nowMs });
    assert.equal(result.ok, false, key); noAuthority(result);
  }
});

test('missing, mismatched and future envelope identity is rejected; unrelated records remain untouched', () => {
  for (const change of [
    { participantId: 'operator' }, { channel: 'other' }, { relatedIssue: '#2961' },
    { relatedPr: '#3172' }, { correlationId: 'other' }, { messageId: 'another-message' },
    { proofRefs: ['receipts/unrelated'] }, { timestampUtc: '2026-10-21T15:50:38.411Z' },
  ]) {
    const result = inspectR7CommissioningRequest({ ...record(), ...change }, { nowMs });
    assert.equal(result.ok, false, JSON.stringify(change)); noAuthority(result);
  }
  assert.equal(inspectR7CommissioningRequest({ body: '{}' }, { nowMs }).applicable, false);
  assert.equal(inspectR7CommissioningRequest({ body: '{' }, { nowMs }).applicable, false);
});

test('conflicting durable inbox and receipt are never overwritten', async () => {
  await fixture(async args => {
    await writeFile(path.join(args.root, ...args.segments), JSON.stringify({ ...args.record, summary: 'Changed' }));
    const result = await reconcileR7CommissioningInbox(args);
    assert.equal(result.reason, 'R7_ADMISSION_PERSISTED_INBOX_CONFLICT'); noAuthority(result);
  });
  await fixture(async args => {
    const first = await reconcileR7CommissioningInbox(args);
    const target = path.join(args.root, 'receipts', first.receiptId + '.json');
    const conflict = '{"unrelated":true}';
    await writeFile(target, conflict);
    assert.equal((await reconcileR7CommissioningInbox(args)).reason, 'R7_ADMISSION_RECEIPT_CONFLICT');
    assert.equal(await readFile(target, 'utf8'), conflict);
  });
});

test('concurrent duplicate requests serialize and publish one identical held receipt', async () => {
  await fixture(async args => {
    const results = await Promise.all(Array.from({ length: 4 }, () => reconcileR7CommissioningInbox(args)));
    assert.ok(results.every(r => r.ok && r.held));
    assert.equal(new Set(results.map(r => r.receiptId)).size, 1);
    results.forEach(noAuthority);
  });
});

test('write denial, lost readback and busy lock cannot report reconciliation success', async () => {
  await fixture(async args => {
    let result = await reconcileR7CommissioningInbox({ ...args, writeAtomicJsonFn: async () => ({ ok: false }) });
    assert.equal(result.reason, 'R7_ADMISSION_RECEIPT_WRITE_FAILED'); noAuthority(result);
    result = await reconcileR7CommissioningInbox({ ...args, writeAtomicJsonFn: async () => ({ ok: true }) });
    assert.equal(result.reason, 'R7_ADMISSION_RECEIPT_READBACK_FAILED'); noAuthority(result);
    result = await reconcileR7CommissioningInbox({ ...args, acquireLockFn: async () => ({ ok: false }) });
    assert.equal(result.reason, 'R7_ADMISSION_RECONCILIATION_BUSY'); noAuthority(result);
    result = await reconcileR7CommissioningInbox({ ...args, segments: ['inbox', 'different.json'] });
    assert.equal(result.reason, 'R7_ADMISSION_NOT_EXACT_INBOX'); noAuthority(result);
  });
});

test('resumed delivery uses durable timestamp and rejects every other changed field', async () => {
  await fixture(async args => {
    const first = await reconcileR7CommissioningInbox(args);
    const retried = { ...args.record, timestampUtc: new Date(nowMs).toISOString() };
    const resumed = await reconcileR7CommissioningInbox({ ...args, record: retried, resumed: true });
    assert.equal(resumed.reason, 'R7_ADMISSION_ALREADY_RECONCILED_HELD');
    assert.equal(resumed.receiptId, first.receiptId); noAuthority(resumed);
    const conflict = await reconcileR7CommissioningInbox({
      ...args, resumed: true, record: { ...retried, summary: 'Different body identity' },
    });
    assert.equal(conflict.reason, 'R7_ADMISSION_PERSISTED_INBOX_CONFLICT');
    noAuthority(conflict);
  });
});

test('no success escapes a false, missing, truthy or throwing lock release', async () => {
  for (const release of [async () => false, async () => undefined, async () => 'true',
    async () => { throw new Error('disposable release fault'); }]) {
    await fixture(async args => {
      for (const repeat of [false, true]) {
        if (repeat) assert.equal((await reconcileR7CommissioningInbox(args)).ok, true);
        let releases = 0;
        const result = await reconcileR7CommissioningInbox({ ...args,
          acquireLockFn: async () => ({ ok: true, verifyOwnership: async () => true,
            release: async () => { releases++; return release(); } }),
        });
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'R7_ADMISSION_OPERATION_LOCK_RELEASE_UNPROVEN');
        assert.equal(releases, 1); noAuthority(result);
      }
    });
  }
});

test('lost ownership before mutation prevents writes and still releases once', async () => {
  for (const lostOn of [1, 2]) {
    await fixture(async args => {
      let checks = 0, writes = 0, releases = 0;
      const result = await reconcileR7CommissioningInbox({ ...args,
        acquireLockFn: async () => ({ ok: true,
          verifyOwnership: async () => ++checks < lostOn,
          release: async () => { releases++; return true; } }),
        writeAtomicJsonFn: async () => { writes++; throw new Error('must not write'); },
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'R7_ADMISSION_OPERATION_LOCK_LOST');
      assert.equal(writes, 0); assert.equal(releases, 1); noAuthority(result);
    });
  }
});

test('actual changed owner after readback cannot claim reconciliation or delete another owner lock', async () => {
  await fixture(async args => {
    let lockPath, ownerPath, changed = false;
    const result = await reconcileR7CommissioningInbox({ ...args,
      acquireLockFn: async (root, segments, options) => {
        lockPath = path.join(root, ...segments);
        return acquireSharedWorkspaceOperationLock(root, segments, options);
      },
      readFileFn: async (file, encoding) => {
        const bytes = await readFile(file, encoding);
        if (file.endsWith('.json') && path.basename(file).startsWith('r7-admission-')) {
          const names = await readdir(lockPath);
          assert.equal(names.length, 1);
          ownerPath = path.join(lockPath, names[0]);
          const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
          await writeFile(ownerPath, JSON.stringify({ ...owner, token: 'different-fixture-owner' }));
          changed = true;
        }
        return bytes;
      },
    });
    assert.equal(changed, true);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'R7_ADMISSION_OPERATION_LOCK_RELEASE_UNPROVEN');
    assert.equal(JSON.parse(await readFile(ownerPath, 'utf8')).token,
      'different-fixture-owner');
    noAuthority(result);
  });
});

test('existing relay invokes consumer and backfills completed delivery without resubmission', async t => {
  const { runChatGptSharedWorkspaceGitHubRelay, CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
    CHATGPT_SHARED_WORKSPACE_OWNER } = await import('./chatgpt-shared-workspace-github-relay.mjs');
  await fixture(async args => {
    await rm(path.join(args.root, ...args.segments));
    let responseWrites = 0;
    const request = {
      schemaVersion: 'chatgpt-participant-bridge.v1', requestId: 'r7-executor-admission-test',
      timestampUtc: stamp, participantId: 'chatgpt-bridge', operation: 'WRITE_NEXT_ACTION_PACKET',
      recordKind: 'next-action-packet', relatedGoal: '#3123', relatedPr: '#3178',
      correlationId: 'r7-executor-admission-3123', boundedPayload: JSON.parse(args.record.body).boundedPayload,
      approvalRef: '', expiryUtc: '2026-10-21T15:00:38.411Z',
      redactionPolicy: 'sanitize-secrets-and-runtime-paths',
    };
    const body = CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER + '\n' +
      '\`\`\`json\n' + JSON.stringify({ schemaVersion: 'chatgpt-participant-bridge.v1',
        state: 'REQUEST_READY', request }) + '\n\`\`\`';
    const options = {
      now: new Date(nowMs), paths: { workspaceRoot: args.root, repoRoot: args.writeOptions.repoRoot },
      adapter: {
        readRequest: () => ({ ok: true, body, authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }),
        writeResponse: () => { responseWrites++; return { ok: true }; },
      },
      headTruthEvidenceLoader: async () => ({ records: { sync: {
        schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.status',
        statusId: 'battle-bridge-github-sync-current', participantId: 'codex', timestampUtc: stamp,
        classification: 'SYNC_NO_CHANGE', status: 'SYNC_NO_CHANGE', localHeadBefore: 'a'.repeat(40),
        remoteHeadObserved: 'a'.repeat(40), repositoryIdentity: 'Cheekyfellastef/stephan-os',
        branch: 'main', remote: 'origin', taskName: 'Stephanos Battle Bridge GitHub Sync',
        syncRecordKind: 'battle-bridge-github-sync-receipt',
        proofRefs: ['receipts/battle-bridge-github-sync/current.json'],
      } } }),
      participantStatusLoader: async () => ({ ok: true, records: [] }),
    };
    const first = await runChatGptSharedWorkspaceGitHubRelay(options);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.deliveryStatus, 'WORKSPACE_WRITE_PASS');
    assert.equal(first.commissioningReconciliation.held, true);
    noAuthority(first.commissioningReconciliation);
    const receipt = path.join(args.root, 'receipts', first.commissioningReconciliation.receiptId + '.json');
    // Simulate an older completed delivery predating this consumer. Deleting
    // only our disposable diagnostic receipt must not replay delivery or intent.
    await rm(receipt);
    const second = await runChatGptSharedWorkspaceGitHubRelay(options);
    assert.equal(second.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
    assert.equal(second.commissioningReconciliation.reason, 'R7_ADMISSION_RECONCILED_HELD');
    assert.equal(responseWrites, 1);
    assert.equal(JSON.parse(await readFile(receipt, 'utf8')).admissionReconciliation.status, 'HELD');
    const completion = path.join(args.root, 'receipts', first.completionReceiptId + '.json');
    const completionBytes = await readFile(completion, 'utf8');
    const lockPath = path.join(args.root, 'receipts', first.commissioningReconciliation.receiptId + '.lock');
    const isInbox = file => path.basename(file) === args.segments.at(-1);
    const isDiagnostic = file => path.basename(file) === path.basename(receipt);
    const denied = () => Object.assign(new Error('disposable access denial'), { code: 'EACCES' });
    const faults = [
      ['inbox read', { readFileFn: async (...a) => { if (isInbox(a[0])) throw denied(); return readFile(...a); } }],
      ['inbox parse', { readFileFn: async (...a) => isInbox(a[0]) ? '{' : readFile(...a) }],
      ['inbox identity changed', { readFileFn: async (...a) => isInbox(a[0]) ? JSON.stringify({ body: '{}' }) : readFile(...a) }],
      ['receipt write', { writeAtomicJsonFn: async () => ({ ok: false }) }],
      ['receipt readback', { readFileFn: async (...a) => {
        const bytes = await readFile(...a); if (isDiagnostic(a[0])) throw denied(); return bytes;
      } }],
      ['receipt readback conflict', { readFileFn: async (...a) => {
        const bytes = await readFile(...a); return isDiagnostic(a[0]) ? '{}' : bytes;
      } }],
      ['busy actual lock', {}],
      ['lost actual owner after readback', { readFileFn: async (...a) => {
        const bytes = await readFile(...a);
        if (isDiagnostic(a[0])) {
          const names = await readdir(lockPath); assert.equal(names.length, 1);
          const ownerPath = path.join(lockPath, names[0]);
          const owner = JSON.parse(await readFile(ownerPath, 'utf8'));
          await writeFile(ownerPath, JSON.stringify({ ...owner, token: 'different-backfill-fixture-owner' }));
        }
        return bytes;
      } }],
    ];
    for (const [name, fault] of faults) await t.test('failed backfill: ' + name, async () => {
      await rm(receipt, { force: true });
      let guard;
      if (name === 'busy actual lock') {
        guard = await acquireSharedWorkspaceOperationLock(args.root,
          ['receipts', path.basename(lockPath)], { repoRoot: args.writeOptions.repoRoot });
        assert.equal(guard.ok, true);
      }
      try {
        const failed = await runChatGptSharedWorkspaceGitHubRelay({ ...options, ...fault });
        assert.equal(failed.ok, false, JSON.stringify(failed));
        assert.equal(failed.classification, 'CHATGPT_SHARED_WORKSPACE_R7_RECONCILIATION_FAILED');
        assert.equal(failed.deliveryPreviouslyCompleted, true);
        assert.equal(failed.deliveryClassification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
        assert.equal(failed.commissioningReconciliation.ok, false);
        noAuthority(failed.commissioningReconciliation);
        assert.equal(failed.responsePublished, false);
        assert.equal(responseWrites, 1);
        assert.equal(await readFile(completion, 'utf8'), completionBytes);
      } finally {
        if (guard) assert.equal(await guard.release(), true);
        if (name === 'lost actual owner after readback') {
          const names = await readdir(lockPath);
          assert.equal(JSON.parse(await readFile(path.join(lockPath, names[0]), 'utf8')).token,
            'different-backfill-fixture-owner');
          // Only our disposable fixture; production did not delete that owner.
          await rm(lockPath, { recursive: true });
        }
      }
    });
    await t.test('unrelated completed request is not reclassified as R7 on missing inbox', async () => {
      const unrelatedBody = body.replace('R7_COMMISSIONING_EXECUTOR_ADMISSION_NOT_PROVEN', 'UNRELATED_DIAGNOSTIC_ONLY');
      const unrelated = await runChatGptSharedWorkspaceGitHubRelay({ ...options,
        adapter: { ...options.adapter, readRequest: () => ({ ok: true, body: unrelatedBody,
          authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER }) },
        readFileFn: async (...a) => { if (isInbox(a[0])) throw denied(); return readFile(...a); },
      });
      assert.equal(unrelated.ok, true);
      assert.equal(unrelated.classification, 'CHATGPT_SHARED_WORKSPACE_REQUEST_ALREADY_PROCESSED');
      assert.equal(unrelated.commissioningReconciliation, null);
      assert.equal(responseWrites, 1);
    });
    const recovered = await runChatGptSharedWorkspaceGitHubRelay(options);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.commissioningReconciliation.held, true);
    assert.equal(responseWrites, 1);
    assert.equal(await readFile(completion, 'utf8'), completionBytes);
  });
});
