import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexBankedResetTelemetryIssueBody,
  createCodexBankedResetTelemetryRecord,
  extractTrustedCodexResetReceipt,
  projectCodexResetExecutionReceipt,
} from './codexBankedResetTelemetryMirror.mjs';

const ownerLogin = 'Cheekyfellastef';

function comment(receipt, { login = ownerLogin, id = 1 } = {}) {
  return {
    id,
    user: { login },
    body: `<!-- stephanos-battle-bridge-command-receipt -->\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\``,
  };
}

function receipt(operation, result, overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: overrides.requestId || `request-${operation.toLowerCase().replace(/_/g, '-')}`,
    operation,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    state: overrides.state || (result.ok === false ? 'BLOCKED' : 'DONE'),
    acceptedAt: overrides.acceptedAt || '2026-07-21T09:00:00.000Z',
    heartbeatAt: overrides.heartbeatAt || '2026-07-21T09:01:00.000Z',
    completedAt: overrides.completedAt || '2026-07-21T09:01:00.000Z',
    blocker: overrides.blocker || result.blocker || '',
    resetId: overrides.resetId || '',
    resetExpiresAtUtc: overrides.resetExpiresAtUtc || '',
    latestSafeExecutionUtc: overrides.latestSafeExecutionUtc || '',
    fixedUiActionOnly: overrides.fixedUiActionOnly === true,
    singlePressOnly: overrides.singlePressOnly === true,
    proofRefs: ['receipts/github-command-mailbox/test.json'],
    result: { ok: result.ok !== false, verdict: result.ok === false ? 'COMMAND_EXECUTION_BLOCKED' : 'COMMAND_EXECUTION_COMPLETE', result },
  };
}

test('rejects untrusted receipt authors', () => {
  const raw = receipt('READ_CODEX_BANKED_RESET_STATUS', { ok: true });
  assert.equal(extractTrustedCodexResetReceipt(comment(raw, { login: 'attacker' }), { ownerLogin }), null);
});

test('projects a read-only status receipt with zero press telemetry and labeled navigation evidence', () => {
  const status = receipt('READ_CODEX_BANKED_RESET_STATUS', {
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_STATUS_READY',
    observedAtUtc: '2026-07-21T09:01:00.000Z',
    matchedWindow: 'ChatGPT',
    matchedProfileControl: 'Profile menu',
    matchedUsageControl: '',
    matchedUsageLabel: '1 reset available',
    usageControlResolution: 'labeled-ancestor',
    navigationAttempted: true,
    profileMenuOpened: true,
    usagePanelOpened: true,
    meterSummary: 'Codex weekly remaining 0%',
    expiryTexts: ['Banked reset expires 24 Jul 2026'],
    resetButtons: ['Use reset'],
    activeCodexTask: false,
    desktopInteractive: true,
    appWindowFound: true,
    usageSurfaceMatched: true,
    pressAttempted: false,
    pressCount: 0,
  });
  const record = createCodexBankedResetTelemetryRecord([comment(status)], { ownerLogin, timestampUtc: '2026-07-21T09:02:00.000Z' });
  assert.equal(record.status, 'STATUS_READY');
  assert.equal(record.pressAttempted, false);
  assert.equal(record.latestStatus.matchedUsageLabel, '1 reset available');
  assert.equal(record.latestStatus.usageControlResolution, 'labeled-ancestor');
  assert.equal(record.latestStatus.meterSummary, 'Codex weekly remaining 0%');
  assert.deepEqual(record.latestStatus.resetButtons, ['Use reset']);
});

test('distinguishes one attempted but unconfirmed press', () => {
  const execution = receipt('REDEEM_BANKED_CODEX_RATE_LIMIT_RESET', {
    ok: false,
    blocker: 'RESET_CONFIRMATION_NOT_PROVEN',
    finalVerdict: 'CODEX_BANKED_RESET_EXECUTION_BLOCKED',
    matchedUsageLabel: '1 reset available',
    usageControlResolution: 'labeled-ancestor',
    pressAttempted: true,
    pressCount: 1,
    meterBefore: 'Codex weekly remaining 0%',
    meterAfter: 'Codex weekly remaining 0%',
    meterRestored: false,
    resetControlDisappeared: false,
    usageSurfaceMatched: true,
  }, {
    requestId: 'reset-attempt-001',
    resetId: 'banked-reset-001',
    resetExpiresAtUtc: '2026-07-24T20:00:00.000Z',
    latestSafeExecutionUtc: '2026-07-21T10:00:00.000Z',
    fixedUiActionOnly: true,
    singlePressOnly: true,
  });
  const projection = projectCodexResetExecutionReceipt(execution);
  assert.equal(projection.status, 'ATTEMPTED_NOT_CONFIRMED');
  assert.equal(projection.matchedUsageLabel, '1 reset available');
  assert.equal(projection.usageControlResolution, 'labeled-ancestor');
  assert.equal(projection.pressAttempted, true);
  assert.equal(projection.pressCount, 1);
  assert.equal(projection.meterRestored, false);
  assert.equal(projection.repeatedPressAllowed, false);
});

test('confirms exactly one successful press with before and after proof', () => {
  const execution = receipt('REDEEM_BANKED_CODEX_RATE_LIMIT_RESET', {
    ok: true,
    finalVerdict: 'CODEX_BANKED_RESET_CONFIRMED',
    observedAtUtc: '2026-07-21T09:10:00.000Z',
    completedAtUtc: '2026-07-21T09:10:08.000Z',
    matchedWindow: 'Codex usage',
    matchedProfileControl: 'Profile menu',
    matchedUsageLabel: '1 reset available',
    usageControlResolution: 'labeled-ancestor',
    matchedButton: 'Use reset',
    matchedExpiryText: 'Banked reset expires 24 Jul 2026',
    meterBefore: 'Codex weekly remaining 0%',
    meterAfter: 'Codex weekly remaining 100%',
    pressAttempted: true,
    pressCount: 1,
    meterRestored: true,
    resetControlDisappeared: true,
    confirmationEvidencePresent: true,
    desktopInteractive: true,
    appWindowFound: true,
    usageSurfaceMatched: true,
    fixedUiActionOnly: true,
    singlePressOnly: true,
  }, {
    requestId: 'reset-confirmed-001',
    resetId: 'banked-reset-001',
    resetExpiresAtUtc: '2026-07-24T20:00:00.000Z',
    latestSafeExecutionUtc: '2026-07-21T10:00:00.000Z',
    fixedUiActionOnly: true,
    singlePressOnly: true,
  });
  const record = createCodexBankedResetTelemetryRecord([comment(execution)], { ownerLogin, timestampUtc: '2026-07-21T09:11:00.000Z' });
  assert.equal(record.status, 'CONFIRMED');
  assert.equal(record.pressAttempted, true);
  assert.equal(record.pressCount, 1);
  assert.equal(record.meterRestored, true);
  assert.equal(record.confirmationEvidencePresent, true);
  assert.equal(record.latestExecution.matchedUsageLabel, '1 reset available');
  assert.equal(record.latestExecution.usageControlResolution, 'labeled-ancestor');
  assert.equal(record.latestExecution.meterAfter, 'Codex weekly remaining 100%');
  assert.match(buildCodexBankedResetTelemetryIssueBody(record), /"status": "CONFIRMED"/);
});

test('latest receipt wins and unsafe telemetry text is suppressed', () => {
  const oldExecution = receipt('REDEEM_BANKED_CODEX_RATE_LIMIT_RESET', {
    ok: false,
    blocker: 'BEARER TOKEN secret-value',
    finalVerdict: 'CODEX_BANKED_RESET_EXECUTION_BLOCKED',
    pressAttempted: false,
    pressCount: 0,
  }, { requestId: 'reset-old-001', completedAt: '2026-07-21T09:00:00.000Z' });
  const newExecution = receipt('REDEEM_BANKED_CODEX_RATE_LIMIT_RESET', {
    ok: false,
    blocker: 'RESET_BUTTON_NOT_FOUND',
    finalVerdict: 'CODEX_BANKED_RESET_EXECUTION_BLOCKED',
    pressAttempted: false,
    pressCount: 0,
  }, { requestId: 'reset-new-001', completedAt: '2026-07-21T09:05:00.000Z' });
  const record = createCodexBankedResetTelemetryRecord([comment(oldExecution, { id: 1 }), comment(newExecution, { id: 2 })], { ownerLogin });
  assert.equal(record.latestExecution.requestId, 'reset-new-001');
  assert.equal(record.blocker, 'RESET_BUTTON_NOT_FOUND');
});
