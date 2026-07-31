import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSanitizedMailboxReceiptProjection,
  createWindowsSafeMailboxReceiptFilename,
  parseBoundedGitHubJson,
  readMailboxReceipt,
  serializeBoundedReceiptJson,
} from './battle-bridge-github-command-mailbox.mjs';

const installerPath = new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url);
const hiddenLauncherPath = new URL('./windows/run-battle-bridge-github-command-mailbox-hidden.ps1', import.meta.url);
const windowlessLauncherPath = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);

test('mailbox task uses the fixed windowless launcher instead of allocating a Node console', async () => {
  const [installer, hiddenLauncher, windowlessLauncher] = await Promise.all([
    readFile(installerPath, 'utf8'),
    readFile(hiddenLauncherPath, 'utf8'),
    readFile(windowlessLauncherPath, 'utf8'),
  ]);

  assert.match(installer, /New-ScheduledTaskAction -Execute \$wscriptExe/);
  assert.match(installer, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(installer, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /receiptIndexEnabled = \$true/);
  assert.match(installer, /\/\/B \/\/NoLogo/);
  assert.match(installer, /github-command-mailbox/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction -Execute \$(?:node|nodeExe|npm)/);

  assert.match(
    windowlessLauncher,
    /Case "github-command-mailbox"\s+targetPath = fileSystem\.BuildPath\(repoRoot, "scripts\\windows\\run-battle-bridge-github-command-mailbox-hidden\.ps1"\)\s+command = Quote\(powershellExe\) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote\(targetPath\)/,
  );
  assert.match(windowlessLauncher, /shell\.Run\(command, 0, True\)/);
  assert.doesNotMatch(windowlessLauncher, /WScript\.Arguments\(1\)|cmd\.exe|Invoke-Expression/i);

  assert.match(hiddenLauncher, /Documents\\GitHub\\stephan-os/);
  assert.match(hiddenLauncher, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.doesNotMatch(hiddenLauncher, /scripts\\battle-bridge-github-command-mailbox\.mjs/);
  assert.match(hiddenLauncher, /Get-Command node\.exe/);
  assert.match(hiddenLauncher, /\*> \$null/);
  assert.doesNotMatch(hiddenLauncher, /\[string\]\s*\$|Invoke-Expression|Start-Process|cmd\.exe/i);
});

test('parses a GitHub issue-comment response larger than the diagnostic truncation limit', () => {
  const body = 'x'.repeat(424_551);
  const payload = JSON.stringify([{ id: 4998034338, body, user: { login: 'Cheekyfellastef' } }]);
  const parsed = parseBoundedGitHubJson(payload);
  assert.equal(parsed[0].id, 4998034338);
  assert.equal(parsed[0].body.length, 424_551);
});

test('fails closed when the GitHub response exceeds the bounded intake limit', () => {
  assert.throws(
    () => parseBoundedGitHubJson(JSON.stringify({ body: 'x'.repeat(256) }), 128),
    /GITHUB_RESPONSE_TOO_LARGE/,
  );
});

test('classifies invalid JSON without exposing truncated parser input', () => {
  assert.throws(
    () => parseBoundedGitHubJson('{"comments":'),
    /GITHUB_RESPONSE_JSON_INVALID/,
  );
});

test('GitHub receipt projection preserves bounded live worker telemetry', () => {
  const projected = createSanitizedMailboxReceiptProjection({
    requestId: 'battle-bridge-observability-0001',
    operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
    state: 'BLOCKED',
    result: {
      ok: false,
      result: {
        blocker: 'WORKER_HEARTBEAT_STALE',
        workerTelemetry: {
          schemaVersion: 'stephanos.battle-bridge.worker-telemetry.v1',
          ok: false,
          workerActive: false,
          workerAlive: false,
          workerStatus: 'NOT_PROVEN',
          worker: {
            pid: 0,
            observedPid: 0,
            commandIdentity: 'scripts/mission-orchestrator-worker-supervised.mjs',
            commandLineVerified: false,
            taskName: 'Stephanos Mission Orchestrator Worker',
            scheduledTaskState: 'READY',
          },
          task: {
            taskId: 'task-1631',
            goalId: '#1507',
            issueNumber: 1507,
            prNumber: 1631,
            branch: 'main',
            headSha: 'a'.repeat(40),
            phase: 'BLOCKED',
            boundedAction: 'Publish a fresh heartbeat.',
          },
          heartbeat: {
            timestampUtc: '2026-07-31T15:00:00.000Z',
            ageMs: 360000,
            fresh: false,
            headSha: 'a'.repeat(40),
            branch: 'main',
            tickVerdict: 'MISSION_WORKER_TICK_RUNNING',
            errors: ['stale-heartbeat'],
          },
          lease: { observed: false, valid: false, active: false, errors: ['lease-not-observed'] },
          latestExecutionReceipt: null,
          testsChecksReview: {
            tests: { state: 'UNKNOWN' },
            checks: { state: 'UNKNOWN' },
            review: { state: 'UNKNOWN' },
          },
          blockers: ['WORKER_HEARTBEAT_STALE'],
          operatorActionRequired: false,
          nextAction: 'Use the existing watchdog route to publish fresh evidence.',
          finalVerdict: 'WORKER_TELEMETRY_BLOCKED',
        },
      },
    },
  });
  assert.equal(projected.workerTelemetry.workerActive, false);
  assert.equal(projected.workerTelemetry.task.prNumber, 1631);
  assert.deepEqual(projected.workerTelemetry.blockers, ['WORKER_HEARTBEAT_STALE']);
  assert.deepEqual(projected.workerTelemetry.evidenceRefs, [
    'status/mission-orchestrator-worker-heartbeat.json',
    'status/source-mutation-lease-current.json',
    'status/battle-bridge-mailbox-receipt-index.json',
  ]);
});

test('GitHub receipt projections redact path- and credential-shaped free-form telemetry', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'battle-bridge-observability-0002',
    operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
    state: 'BLOCKED',
    expectedHead: 'a'.repeat(40),
    blocker: 'worker at C:\\Users\\Stephan\\Documents\\secret.json',
    result: {
      ok: false,
      result: {
        blocker: 'token=ghp_this-must-not-leak',
        finalVerdict: 'read /etc/stephanos/config with sk-proj-this-must-not-leak',
        sourceHead: 'a'.repeat(40),
        branch: 'main',
        workerTelemetry: {
          task: {
            boundedAction: 'Inspect /workspace/stephan-os with password=must-not-leak',
          },
          blockers: ['C:\\Users\\Stephan\\credential.txt'],
          nextAction: 'Use bearer secret at /var/run/stephanos/token',
          latestExecutionReceipt: {
            blocker: 'private_key=/tmp/private.pem',
            expectedNextAction: 'Open C:\\Users\\Stephan\\Desktop\\proof.txt',
          },
        },
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  const serialized = serializeBoundedReceiptJson(receipt);
  const json = `${JSON.stringify(projected)}${serialized}`;
  assert.doesNotMatch(json, /C:\\Users|\/home\/stephan|\/workspace\/stephan|\/etc\/stephanos|ghp_this|sk-proj-this|password=|bearer secret|private_key|\.env/i);
  assert.equal(projected.expectedHead, 'a'.repeat(40));
  assert.equal(projected.blocker, '');
  assert.equal(projected.operationResult.blocker, '');
  assert.equal(projected.workerTelemetry.task.boundedAction, '');
  assert.deepEqual(projected.workerTelemetry.blockers, []);
  assert.equal(projected.workerTelemetry.latestExecutionReceipt.blocker, '');
});

test('exact-head proof projections retain the verified PR and local heads', () => {
  const expectedHead = 'a'.repeat(40);
  const receipt = {
    requestId: 'windows-proof-1631-0001',
    operation: 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
    state: 'DONE',
    expectedHead,
    prNumber: 1628,
    proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
    result: {
      ok: true,
      result: {
        ok: true,
        operation: 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
        finalVerdict: 'WINDOWS_BROWSER_PROOF_DISPATCHED',
        expectedHead,
        prNumber: 1628,
        proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
        taskId: 'codex-job-1631',
        pullRequestHead: expectedHead,
        localHead: expectedHead,
        expectedHeadMatch: false,
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.prNumber, 1628);
  assert.equal(projected.proofScenario, 'MUSIC_RATING_PRESERVES_PLAYBACK');
  assert.equal(projected.taskId, 'codex-job-1631');
  assert.equal(projected.pullRequestHead, expectedHead);
  assert.equal(projected.localHead, expectedHead);
  assert.equal(projected.operationResult.expectedHeadMatch, true);
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(serialized.result.result.pullRequestHead, expectedHead);
  assert.equal(serialized.result.result.localHead, expectedHead);
  assert.equal(serialized.result.result.expectedHeadMatch, true);

  const mismatch = createSanitizedMailboxReceiptProjection({
    ...receipt,
    result: {
      ...receipt.result,
      result: { ...receipt.result.result, localHead: 'b'.repeat(40), expectedHeadMatch: true },
    },
  });
  assert.equal(mismatch.operationResult.expectedHeadMatch, false);

  const mergeCommitHead = 'c'.repeat(40);
  const mergedMainHead = 'd'.repeat(40);
  const mergedReceipt = {
    ...receipt,
    expectedHead: mergedMainHead,
    proofTarget: 'MERGED_MAIN',
    result: {
      ...receipt.result,
      result: {
        ...receipt.result.result,
        expectedHead: mergedMainHead,
        proofTarget: 'MERGED_MAIN',
        pullRequestHead: expectedHead,
        mergeCommitHead,
        githubMainHead: mergedMainHead,
        mergeCommitIncluded: true,
        localHead: mergedMainHead,
      },
    },
  };
  const merged = createSanitizedMailboxReceiptProjection(mergedReceipt);
  assert.equal(merged.proofTarget, 'MERGED_MAIN');
  assert.equal(merged.mergeCommitHead, mergeCommitHead);
  assert.equal(merged.githubMainHead, mergedMainHead);
  assert.equal(merged.mergeCommitIncluded, true);
  assert.equal(merged.operationResult.expectedHeadMatch, true);
  const mergedSerialized = JSON.parse(serializeBoundedReceiptJson(mergedReceipt));
  assert.equal(mergedSerialized.proofTarget, 'MERGED_MAIN');
  assert.equal(mergedSerialized.mergeCommitHead, mergeCommitHead);
  assert.equal(mergedSerialized.githubMainHead, mergedMainHead);
  assert.equal(mergedSerialized.mergeCommitIncluded, true);
  assert.equal(mergedSerialized.result.result.expectedHeadMatch, true);

  const observedDifferentHead = 'e'.repeat(40);
  const provenanceMismatchReceipt = {
    ...mergedReceipt,
    pullRequestHead: expectedHead,
    result: {
      ...mergedReceipt.result,
      result: {
        ...mergedReceipt.result.result,
        pullRequestHead: observedDifferentHead,
      },
    },
  };
  const provenanceMismatch = createSanitizedMailboxReceiptProjection(provenanceMismatchReceipt);
  assert.equal(provenanceMismatch.pullRequestHead, expectedHead);
  assert.equal(provenanceMismatch.requestedPullRequestHead, expectedHead);
  assert.equal(provenanceMismatch.observedPullRequestHead, observedDifferentHead);
  assert.equal(provenanceMismatch.operationResult.pullRequestHead, expectedHead);
  assert.equal(provenanceMismatch.operationResult.requestedPullRequestHead, expectedHead);
  assert.equal(provenanceMismatch.operationResult.observedPullRequestHead, observedDifferentHead);
  assert.equal(provenanceMismatch.operationResult.expectedHeadMatch, false);
  const mismatchSerialized = JSON.parse(serializeBoundedReceiptJson(provenanceMismatchReceipt));
  assert.equal(mismatchSerialized.pullRequestHead, expectedHead);
  assert.equal(mismatchSerialized.requestedPullRequestHead, expectedHead);
  assert.equal(mismatchSerialized.observedPullRequestHead, observedDifferentHead);
  assert.equal(mismatchSerialized.result.result.pullRequestHead, expectedHead);
  assert.equal(mismatchSerialized.result.result.requestedPullRequestHead, expectedHead);
  assert.equal(mismatchSerialized.result.result.observedPullRequestHead, observedDifferentHead);
  assert.equal(mismatchSerialized.result.result.expectedHeadMatch, false);

  const missingAncestry = createSanitizedMailboxReceiptProjection({
    ...mergedReceipt,
    result: {
      ...mergedReceipt.result,
      result: { ...mergedReceipt.result.result, mergeCommitIncluded: false },
    },
  });
  assert.equal(missingAncestry.operationResult.expectedHeadMatch, false);
});

test('derives a deterministic Windows-safe receipt filename for colon-bearing request IDs', () => {
  const requestId = 'proof:2026-07-30T20:00:00Z';
  const filename = createWindowsSafeMailboxReceiptFilename(requestId);
  assert.match(filename, /^_request-[0-9a-f]{32}\.json$/);
  assert.doesNotMatch(filename, /[<>:"/\\|?*]/);
  assert.equal(createWindowsSafeMailboxReceiptFilename(requestId), filename);
  assert.equal(createWindowsSafeMailboxReceiptFilename('request-safe-0001'), 'request-safe-0001.json');
});

test('hashes Windows reserved device basenames while preserving safe boundary names', () => {
  const reserved = [
    'CON.proof',
    'prn.receipt',
    'AuX.trace',
    'nul.output',
    'CON..proof',
    'cOn.proof',
    'CoM1.proof',
    'lPt9.proof',
    ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}.proof`),
    ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}.proof`),
  ];
  for (const requestId of reserved) {
    assert.match(createWindowsSafeMailboxReceiptFilename(requestId), /^_request-[0-9a-f]{32}\.json$/);
  }
  for (const requestId of [
    'com0.proof',
    'com10.proof',
    'lpt0.proof',
    'lpt10.proof',
    'console.proof',
    'aux-proof',
    'nul_value',
    'x.con.proof',
    'request-safe-0001',
  ]) {
    assert.equal(createWindowsSafeMailboxReceiptFilename(requestId), `${requestId}.json`);
  }
  assert.notEqual(
    createWindowsSafeMailboxReceiptFilename('CON.proof'),
    createWindowsSafeMailboxReceiptFilename('con.proof'),
  );
  const oldRawAlias = createWindowsSafeMailboxReceiptFilename('CON.proof')
    .slice('_request-'.length, -'.json'.length);
  assert.notEqual(
    createWindowsSafeMailboxReceiptFilename('CON.proof'),
    createWindowsSafeMailboxReceiptFilename(`request-${oldRawAlias}`),
  );
  const uppercase = createWindowsSafeMailboxReceiptFilename('Request-safe-0001');
  const lowercase = createWindowsSafeMailboxReceiptFilename('request-safe-0001');
  assert.match(uppercase, /^_request-[0-9a-f]{32}\.json$/);
  assert.notEqual(uppercase.toLowerCase(), lowercase.toLowerCase());
});

test('point lookup reads an exact legacy receipt but never falls through a malformed canonical receipt', async () => {
  const receiptRoot = await mkdtemp(join(tmpdir(), 'mailbox-point-read-'));
  const targetRequestId = 'proof:2026-07-30T20:00:00Z';
  const digest = createHash('sha256').update(targetRequestId).digest('hex').slice(0, 32);
  const legacyPath = join(receiptRoot, `request-${digest}.json`);
  const receipt = {
    requestId: targetRequestId,
    operation: 'RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF',
    state: 'DONE',
    completedAt: '2026-07-30T20:01:00.000Z',
  };
  const options = {
    receiptRoot,
    readSourceIdentity: async () => ({ ok: true, sourceHead: 'a'.repeat(40), branch: 'main' }),
  };
  try {
    await writeFile(legacyPath, `${JSON.stringify(receipt)}\n`, 'utf8');
    const legacy = await readMailboxReceipt({ targetRequestId }, options);
    assert.equal(legacy.ok, true);
    assert.equal(legacy.receipt.requestId, targetRequestId);

    const canonicalPath = join(
      receiptRoot,
      createWindowsSafeMailboxReceiptFilename(targetRequestId),
    );
    await writeFile(canonicalPath, '{"requestId":', 'utf8');
    const failClosed = await readMailboxReceipt({ targetRequestId }, options);
    assert.equal(failClosed.ok, false);
    assert.equal(failClosed.blocker, 'MAILBOX_RECEIPT_JSON_INVALID');
  } finally {
    await rm(receiptRoot, { recursive: true, force: true });
  }
});

test('point lookup rejects oversized and symlinked canonical receipt candidates', async () => {
  const receiptRoot = await mkdtemp(join(tmpdir(), 'mailbox-point-read-bounds-'));
  const options = {
    receiptRoot,
    readSourceIdentity: async () => ({ ok: true, sourceHead: 'a'.repeat(40), branch: 'main' }),
  };
  try {
    const oversizedRequestId = 'proof:oversized-receipt-0001';
    await writeFile(
      join(receiptRoot, createWindowsSafeMailboxReceiptFilename(oversizedRequestId)),
      'x'.repeat((256 * 1024) + 1),
      'utf8',
    );
    const oversized = await readMailboxReceipt({ targetRequestId: oversizedRequestId }, options);
    assert.equal(oversized.ok, false);
    assert.equal(oversized.blocker, 'MAILBOX_RECEIPT_TOO_LARGE');

    const symlinkRequestId = 'proof:symlink-receipt-0001';
    const symlinkTarget = join(receiptRoot, 'symlink-target.json');
    await writeFile(symlinkTarget, `${JSON.stringify({ requestId: symlinkRequestId })}\n`, 'utf8');
    await symlink(
      symlinkTarget,
      join(receiptRoot, createWindowsSafeMailboxReceiptFilename(symlinkRequestId)),
    );
    const linked = await readMailboxReceipt({ targetRequestId: symlinkRequestId }, options);
    assert.equal(linked.ok, false);
    assert.equal(linked.blocker, 'MAILBOX_RECEIPT_NOT_REGULAR_FILE');
  } finally {
    await rm(receiptRoot, { recursive: true, force: true });
  }
});
