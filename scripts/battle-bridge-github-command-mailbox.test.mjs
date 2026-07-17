import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_STALE_AFTER_MS,
  createSharedWorkspaceStatusRecord,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  createSanitizedCriticalBacklogStatusProjection,
  createSanitizedMailboxReceiptProjection,
  parseBoundedGitHubJson,
  serializeBoundedReceiptJson,
  validateCriticalBacklogStatusRecord,
} from './battle-bridge-github-command-mailbox.mjs';

const runnerPath = new URL('./battle-bridge-github-command-mailbox.mjs', import.meta.url);

function backlogStatusRecord(timestampUtc = '2026-07-17T19:00:00.000Z') {
  return {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'critical-backlog-conveyor-current',
      participantId: 'critical-backlog-conveyor',
      timestampUtc,
      status: 'CRITICAL_BACKLOG_CONVEYOR_ACTIVE',
      summary: 'Critical backlog WAIT_ACTIVE_MISSION: worker-watchdog-self-heal.',
      proofRefs: [],
    }),
    decision: 'WAIT_ACTIVE_MISSION',
    selectedItemId: 'worker-watchdog-self-heal',
    activeMissionId: 'critical-1291-worker-watchdog-repair',
    activePhase: 'AGENT_IMPLEMENTATION',
    completedItemIds: [],
    remainingItemIds: ['worker-watchdog-self-heal', 'post-sync-runtime-refresh'],
    exactNextAction: 'Continue critical-1291-worker-watchdog-repair until it reaches a terminal state.',
    oneActiveMissionEnforced: true,
    duplicateCodexDispatchAllowed: false,
    mergeAuthority: false,
    exactHeadApprovalRequired: true,
  };
}

test('parses a GitHub issue-comment response larger than the diagnostic truncation limit', () => {
  const body = 'x'.repeat(424_551);
  const payload = JSON.stringify([{ id: 4998034338, body, user: { login: 'Cheekyfellastef' } }]);
  const parsed = parseBoundedGitHubJson(payload);
  assert.equal(parsed[0].id, 4998034338);
  assert.equal(parsed[0].body.length, 424_551);
});

test('fails closed when the GitHub response exceeds the bounded intake limit', () => {
  assert.throws(() => parseBoundedGitHubJson(JSON.stringify({ body: 'x'.repeat(256) }), 128), /GITHUB_RESPONSE_TOO_LARGE/);
});

test('classifies invalid JSON without exposing truncated parser input', () => {
  assert.throws(() => parseBoundedGitHubJson('{"comments":'), /GITHUB_RESPONSE_JSON_INVALID/);
});

test('sanitized receipt projection preserves watchdog evidence but removes machine paths and raw payloads', () => {
  const projection = createSanitizedMailboxReceiptProjection({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1291-watchdog-acceptance-20260717T1710Z',
    operation: 'RUN_WORKER_WATCHDOG_ACCEPTANCE',
    state: 'BLOCKED',
    blocker: 'INITIAL_WORKER_NOT_CANONICAL_AND_HEALTHY',
    proofRefs: [
      'receipts/github-command-mailbox/req-1291-watchdog-acceptance-20260717T1710Z.json',
      'C:\\Users\\Stephan Callear\\secret.json',
      '../escape.json',
    ],
    result: {
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      operation: 'RUN_WORKER_WATCHDOG_ACCEPTANCE',
      requestId: 'req-1291-watchdog-acceptance-20260717T1710Z',
      result: {
        ok: false,
        blocker: 'INITIAL_WORKER_NOT_CANONICAL_AND_HEALTHY',
        sourceHead: 'ff7f1194eff9e6146a6e27104d71b91b631ccacf',
        initialPid: 123,
        rawPayload: 'must-not-survive',
        localPath: 'C:\\Users\\Stephan Callear\\Documents',
      },
    },
  });
  assert.equal(projection.state, 'BLOCKED');
  assert.equal(projection.operationResult.blocker, 'INITIAL_WORKER_NOT_CANONICAL_AND_HEALTHY');
  assert.equal(projection.operationResult.sourceHead, 'ff7f1194eff9e6146a6e27104d71b91b631ccacf');
  assert.equal(projection.operationResult.initialPid, 123);
  assert.deepEqual(projection.proofRefs, ['receipts/github-command-mailbox/req-1291-watchdog-acceptance-20260717T1710Z.json']);
  assert.equal('rawPayload' in projection.operationResult, false);
  assert.equal('localPath' in projection.operationResult, false);
  assert.equal(projection.arbitraryFilesystemAccess, false);
  assert.doesNotMatch(JSON.stringify(projection), /C:\\Users|\.\.\//i);
});

test('monitor evidence remains available after backlog reader reconciliation', () => {
  const projection = createSanitizedMailboxReceiptProjection({
    operation: 'RUN_MONITOR_MULTIPLEXER_ACCEPTANCE',
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_PASS',
        monitorCount: 4,
        executedCount: 4,
        notificationCount: 1,
        notificationSurface: 'shared-workspace',
        receiptCount: 4,
      },
    },
  });
  assert.equal(projection.operationResult.monitorCount, 4);
  assert.equal(projection.operationResult.executedCount, 4);
  assert.equal(projection.operationResult.notificationCount, 1);
  assert.equal(projection.operationResult.notificationSurface, 'shared-workspace');
  assert.equal(projection.operationResult.receiptCount, 4);
});

test('critical backlog projection preserves only fixed bounded fields and freshness metadata', () => {
  const timestampUtc = '2026-07-17T19:00:00.000Z';
  const projection = createSanitizedCriticalBacklogStatusProjection({
    ...backlogStatusRecord(timestampUtc),
    completedItemIds: ['done-one', '../escape'],
    remainingItemIds: ['post-sync-runtime-refresh'],
    localPath: 'C:\\Users\\Stephan Callear\\Documents',
    rawPayload: { secret: true },
  }, {
    nowMs: Date.parse('2026-07-17T19:30:00.000Z'),
  });
  assert.equal(projection.decision, 'WAIT_ACTIVE_MISSION');
  assert.equal(projection.selectedItemId, 'worker-watchdog-self-heal');
  assert.equal(projection.activeMissionId, 'critical-1291-worker-watchdog-repair');
  assert.equal(projection.activePhase, 'AGENT_IMPLEMENTATION');
  assert.deepEqual(projection.completedItemIds, ['done-one']);
  assert.deepEqual(projection.remainingItemIds, ['post-sync-runtime-refresh']);
  assert.equal(projection.statusTimestampUtc, timestampUtc);
  assert.equal(projection.statusAgeMs, 30 * 60 * 1000);
  assert.equal(projection.staleAfterMs, DEFAULT_STALE_AFTER_MS);
  assert.equal(projection.oneActiveMissionEnforced, true);
  assert.equal(projection.duplicateCodexDispatchAllowed, false);
  assert.equal(projection.mergeAuthority, false);
  assert.equal(projection.exactHeadApprovalRequired, true);
  assert.equal('localPath' in projection, false);
  assert.equal('rawPayload' in projection, false);
  assert.doesNotMatch(JSON.stringify(projection), /C:\\Users|\.\.\//i);
});

test('fresh critical backlog status is ready within the canonical one-hour window', () => {
  const status = validateCriticalBacklogStatusRecord(backlogStatusRecord(), {
    nowMs: Date.parse('2026-07-17T19:30:00.000Z'),
  });
  assert.equal(status.ok, true);
  assert.equal(status.blocker, '');
  assert.equal(status.validation.stale, false);
  assert.equal(status.statusTimestampUtc, '2026-07-17T19:00:00.000Z');
  assert.equal(status.statusAgeMs, 30 * 60 * 1000);
  assert.equal(status.staleAfterMs, DEFAULT_STALE_AFTER_MS);
});

test('stale critical backlog status fails closed instead of reporting an obsolete mission decision', () => {
  const status = validateCriticalBacklogStatusRecord(backlogStatusRecord(), {
    nowMs: Date.parse('2026-07-17T20:01:00.000Z'),
  });
  assert.equal(status.ok, false);
  assert.equal(status.blocker, 'CRITICAL_BACKLOG_STATUS_STALE');
  assert.equal(status.validation.stale, true);
  assert.equal(status.statusTimestampUtc, '2026-07-17T19:00:00.000Z');
  assert.equal(status.statusAgeMs, 61 * 60 * 1000);
});

test('invalid status identity fails closed before readiness', () => {
  const status = validateCriticalBacklogStatusRecord({
    ...backlogStatusRecord(),
    participantId: 'other-participant',
  }, {
    nowMs: Date.parse('2026-07-17T19:30:00.000Z'),
  });
  assert.equal(status.ok, false);
  assert.equal(status.blocker, 'CRITICAL_BACKLOG_STATUS_IDENTITY_MISMATCH');
});

test('critical backlog receipt projection preserves fixed status and freshness fields', () => {
  const projection = createSanitizedMailboxReceiptProjection({
    requestId: 'req-1507-read-critical-backlog-status',
    operation: 'READ_CRITICAL_BACKLOG_STATUS',
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'CRITICAL_BACKLOG_STATUS_READY',
        decision: 'WAIT_ACTIVE_MISSION',
        selectedItemId: 'worker-watchdog-self-heal',
        activeMissionId: 'critical-1291-worker-watchdog-repair',
        activePhase: 'AGENT_IMPLEMENTATION',
        completedItemIds: [],
        remainingItemIds: ['worker-watchdog-self-heal', 'post-sync-runtime-refresh'],
        exactNextAction: 'Continue critical-1291-worker-watchdog-repair until it reaches a terminal state.',
        statusTimestampUtc: '2026-07-17T19:00:00.000Z',
        statusAgeMs: 30 * 60 * 1000,
        staleAfterMs: DEFAULT_STALE_AFTER_MS,
        oneActiveMissionEnforced: true,
        duplicateCodexDispatchAllowed: false,
        mergeAuthority: false,
        exactHeadApprovalRequired: true,
      },
    },
  });
  assert.equal(projection.operationResult.decision, 'WAIT_ACTIVE_MISSION');
  assert.equal(projection.operationResult.activeMissionId, 'critical-1291-worker-watchdog-repair');
  assert.equal(projection.operationResult.statusTimestampUtc, '2026-07-17T19:00:00.000Z');
  assert.equal(projection.operationResult.statusAgeMs, 30 * 60 * 1000);
  assert.equal(projection.operationResult.staleAfterMs, DEFAULT_STALE_AFTER_MS);
  assert.equal(projection.operationResult.oneActiveMissionEnforced, true);
  assert.equal(projection.operationResult.duplicateCodexDispatchAllowed, false);
  assert.equal(projection.operationResult.mergeAuthority, false);
});

test('oversized GitHub receipt becomes valid structured JSON rather than a sliced document', () => {
  const json = serializeBoundedReceiptJson({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-large-receipt',
    operation: 'RUN_WORKER_WATCHDOG_ACCEPTANCE',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    state: 'DONE',
    proofRefs: ['receipts/github-command-mailbox/req-1507-large-receipt.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'WORKER_WATCHDOG_ACCEPTANCE_PASS',
        sourceHead: '704f64a1662de33bfd3ac2ff6531ad296bf5e846',
        initialPid: 101,
        recoveredPid: 202,
        workerKilledObserved: true,
        supervisorDetectedWorkerDown: true,
        supervisorRestartedWorker: true,
        workerRecovered: true,
        workerFromMain: true,
        proofWrittenToSharedWorkspace: true,
        payload: 'x'.repeat(20_000),
      },
    },
  }, 4096);
  const parsed = JSON.parse(json);
  assert.equal(parsed.githubProjectionTruncated, true);
  assert.equal(parsed.result.result.finalVerdict, 'WORKER_WATCHDOG_ACCEPTANCE_PASS');
  assert.equal(parsed.result.result.workerKilledObserved, true);
  assert.ok(Buffer.byteLength(json, 'utf8') <= 4096);
});

test('runner wires freshness, monitor, capability, workspace, critical backlog, fixed receipt and watchdog operations', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /DEFAULT_STALE_AFTER_MS/);
  assert.match(source, /validateSharedWorkspaceRecord/);
  assert.match(source, /CRITICAL_BACKLOG_STATUS_STALE/);
  assert.match(source, /runBattleBridgeMonitorMultiplexerCanary/);
  assert.match(source, /buildStephanosCapabilityRegistrySummary/);
  assert.match(source, /createSanitizedSharedWorkspaceProjection/);
  assert.match(source, /runBattleBridgeWorkerWatchdogAcceptance/);
  assert.match(source, /readCriticalBacklogStatus/);
  assert.match(source, /criticalBacklogStatusPath/);
  assert.match(source, /critical-backlog-conveyor-current\.json/);
  assert.match(source, /readMailboxReceipt/);
  assert.match(source, /targetRequestId/);
  assert.match(source, /join\(canonicalReceiptRoot, `\$\{targetRequestId\}\.json`\)/);
  assert.match(source, /MAILBOX_RECEIPT_NOT_FOUND/);
  assert.match(source, /MAILBOX_RECEIPT_ID_MISMATCH/);
  assert.match(source, /arbitraryFilesystemAccess:\s*false/);
  assert.doesNotMatch(source, /Invoke-Expression|cmd\.exe|git\.exe', \['(?:reset|clean|checkout|push|rebase)/i);
});

test('published receipt reference maps to the canonical Shared Workspace receipt file', async () => {
  const source = await readFile(runnerPath, 'utf8');
  assert.match(source, /canonicalReceiptRoot = join\(sharedWorkspaceRoot, 'receipts', 'github-command-mailbox'\)/);
  assert.match(source, /writeFileSync\(canonicalPath, payload, 'utf8'\)/);
  assert.match(source, /ref: `receipts\/github-command-mailbox\/\$\{filename\}`/);
  assert.match(source, /writeFileSync\(legacyPath, payload, 'utf8'\)/);
  assert.doesNotMatch(source, /postReceipt\(\{ \.\.\.receipt, receiptPath \}\)/);
});
