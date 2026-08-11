import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRejectedMailboxTerminalReceipt,
  checkpointAcceptedMailboxReceipt,
  checkpointMailboxReceiptPublication,
  checkpointTerminalMailboxReceipt,
  createSanitizedMailboxReceiptProjection,
  createWindowsSafeMailboxReceiptFilename,
  flushMailboxReceiptPublicationOutbox,
  parseBoundedGitHubJson,
  preflightMailboxControlExpectedHead,
  readMailboxReceipt,
  serializeBoundedReceiptJson,
  terminalizeRejectedMailboxCommands,
  validateBattleBridgeRecoveryMeshInstallReceipt,
} from './battle-bridge-github-command-mailbox.mjs';

const installerPath = new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url);
const hiddenLauncherPath = new URL('./windows/run-battle-bridge-github-command-mailbox-hidden.ps1', import.meta.url);
const windowlessLauncherPath = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);
const mailboxSourcePath = new URL('./battle-bridge-github-command-mailbox.mjs', import.meta.url);

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

  const mailboxSource = await readFile(mailboxSourcePath, 'utf8');
  assert.match(mailboxSource, /selectBattleBridgeGitHubCommandBatch\(comments/);
  assert.match(mailboxSource, /executeBattleBridgeGitHubCommandBatch\(batch/);
  assert.match(mailboxSource, /beforeExecute:\s*async \(selected\)/);
  assert.match(mailboxSource, /onTerminal:\s*async \(selected, execution\)/);
  assert.match(mailboxSource, /checkpointTerminalMailboxReceipt\(state, receipt\)/);
  assert.doesNotMatch(mailboxSource, /for \(const selected of batch\.commands\) \{[\s\S]{0,500}state: 'ACCEPTED'/);
  assert.match(mailboxSource, /maxBatch: BATTLE_BRIDGE_MAILBOX_MAX_BATCH/);
  assert.match(mailboxSource, /deferredCount: batch\.deferredCount/);
  assert.match(mailboxSource, /updateStephanosFromChat\(\{[\s\S]{0,180}expectedHead: command\.expectedHead/);
  assert.doesNotMatch(mailboxSource, /BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE\s*=\s*[^1]*2|issueNumber:\s*1508/);

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

test('terminal checkpoint persists each request immediately and bounds replay history', () => {
  const state = { consumedRequestIds: ['req-1507-old-1'] };
  const snapshots = [];
  const receipt = {
    requestId: 'req-1507-done-2',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    state: 'DONE',
  };
  checkpointTerminalMailboxReceipt(state, receipt, {
    persist: (value) => snapshots.push(JSON.parse(JSON.stringify(value))),
  });
  assert.deepEqual(snapshots[0].consumedRequestIds, ['req-1507-old-1', 'req-1507-done-2']);
  assert.equal(snapshots[0].lastReceipt.requestId, 'req-1507-done-2');
  assert.equal(snapshots[0].lastReceipt.state, 'DONE');
  assert.throws(
    () => checkpointTerminalMailboxReceipt({}, { ...receipt, state: 'ACCEPTED' }),
    /MAILBOX_TERMINAL_CHECKPOINT_INVALID/,
  );
});

test('accepted checkpoint prevents crash replay until a terminal receipt replaces it', () => {
  const state = { consumedRequestIds: [], acceptedRequestIds: [] };
  const snapshots = [];
  checkpointAcceptedMailboxReceipt(state, {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-accepted-1',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    state: 'ACCEPTED',
  }, { persist: (value) => snapshots.push(structuredClone(value)) });
  assert.deepEqual(state.acceptedRequestIds, ['req-1507-accepted-1']);
  assert.equal(snapshots.length, 1);
  checkpointTerminalMailboxReceipt(state, {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-accepted-1',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    state: 'BLOCKED',
  }, { persist: (value) => snapshots.push(structuredClone(value)) });
  assert.deepEqual(state.acceptedRequestIds, []);
  assert.deepEqual(state.consumedRequestIds, ['req-1507-accepted-1']);
});

test('safe owner rejection is terminalized once without an accepted state', () => {
  const state = { consumedRequestIds: [], acceptedRequestIds: [] };
  const writes = [];
  const publications = [];
  const rejection = {
    blocker: 'COMMAND_EXPIRY_TOO_FAR_AHEAD',
    commentUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-7',
    command: {
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId: 'req-1507-rejected-1',
      operation: 'UPDATE_STEPHANOS_FROM_CHAT',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1507,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: 'a'.repeat(40),
      expiresAt: '2026-08-11T18:00:00.000Z',
    },
  };
  const receipt = buildRejectedMailboxTerminalReceipt(rejection, '2026-08-11T11:30:00.000Z');
  assert.equal(receipt.state, 'BLOCKED');
  assert.equal(receipt.acceptedAt, '');
  assert.equal(receipt.blocker, 'COMMAND_EXPIRY_TOO_FAR_AHEAD');
  const options = {
    now: () => new Date('2026-08-11T11:30:00.000Z'),
    write: (value) => {
      writes.push(value);
      return { ref: `receipts/github-command-mailbox/${value.requestId}.json` };
    },
    publish: (value) => publications.push(value),
    persist: () => {},
  };
  assert.equal(terminalizeRejectedMailboxCommands(state, [rejection], options).length, 1);
  assert.equal(terminalizeRejectedMailboxCommands(state, [rejection], options).length, 0);
  assert.equal(writes.length, 1);
  assert.equal(publications.length, 1);
  assert.deepEqual(state.consumedRequestIds, ['req-1507-rejected-1']);
});

test('failed receipt publication is retried from outbox without replaying the command', () => {
  const state = { pendingReceiptPublications: [] };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-publish-1',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    state: 'BLOCKED',
    blocker: 'COMMAND_EXPECTED_HEAD_SUPERSEDED',
    completedAt: '2026-08-11T11:30:00.000Z',
  };
  checkpointMailboxReceiptPublication(state, receipt, { ok: false }, { persist: () => {} });
  assert.equal(state.pendingReceiptPublications.length, 1);
  const published = [];
  const flushed = flushMailboxReceiptPublicationOutbox(state, {
    publish: (value) => {
      published.push(value.requestId);
      return { ok: true };
    },
    persist: () => {},
  });
  assert.deepEqual(published, ['req-1507-publish-1']);
  assert.deepEqual(flushed, { attemptedCount: 1, publishedCount: 1, pendingCount: 0 });
  assert.deepEqual(state.pendingReceiptPublications, []);
});

test('main-targeting control preflight blocks a stale head and ignores observations', () => {
  const stale = preflightMailboxControlExpectedHead({
    partition: 'CONTROL',
    command: { operation: 'UPDATE_STEPHANOS_FROM_CHAT', expectedHead: 'a'.repeat(40) },
  }, { readMainHead: () => 'b'.repeat(40) });
  assert.equal(stale.ok, false);
  assert.equal(stale.blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  const observation = preflightMailboxControlExpectedHead({
    partition: 'OBSERVATION',
    command: { operation: 'READ_DEPLOYMENT_STATUS', expectedHead: 'a'.repeat(40) },
  }, { readMainHead: () => { throw new Error('must not read'); } });
  assert.equal(observation.ok, true);
});

test('GitHub recovery wake binds the authenticated mailbox receipt instead of self-asserting a route boolean', async () => {
  const source = await readFile(mailboxSourcePath, 'utf8');
  assert.match(source, /RECOVERY_MESH_GITHUB_EVIDENCE_INVALID/);
  assert.match(source, /receipts\\\/github-command-mailbox/);
  assert.match(source, /'-EvidenceIssuer', 'battle-bridge-github-command-mailbox'/);
  assert.match(source, /'-EvidenceSubject', evidenceSubject/);
  assert.match(source, /'-EvidenceProofRef', evidenceProofRef/);
  assert.match(source, /wakeBattleBridgeRecoveryMesh\(command, \{ receiptRef \}\)/);
  assert.match(source, /BATTLE_BRIDGE_WINDOWS_HOST\.powershell/);
  assert.match(source, /BATTLE_BRIDGE_WINDOWS_HOST\.git/);
  assert.match(source, /BATTLE_BRIDGE_WINDOWS_HOST\.githubCli/);
  assert.doesNotMatch(source, /run\(['"]powershell\.exe['"]|run\(['"]git\.exe['"]|run\(['"]gh\.exe['"]/);
  assert.doesNotMatch(source, /ownerAuthenticated:\s*true/);
});

test('recovery mesh installation succeeds only from a truthful fixed postcondition receipt', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-recovery-mesh-install.v1',
    taskName: 'Stephanos Battle Bridge Recovery Mesh',
    installed: true,
    startedNow: true,
    taskPresentAfter: true,
    whatIf: false,
    maximumConcurrentExecutors: 1,
    recoveryRoutes: [
      'LOCAL_WINDOWS_SUPERVISOR',
      'GITHUB_MAILBOX',
      'TAILSCALE_CONTROL',
      'OPENCLAW_WHATSAPP',
      'AUTHENTICATED_BREAK_GLASS',
    ],
    arbitraryShellAllowed: false,
    arbitraryTaskNameAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
  };
  assert.equal(validateBattleBridgeRecoveryMeshInstallReceipt(receipt).ok, true);
  for (const corrupt of [
    { ...receipt, installed: false },
    { ...receipt, startedNow: false },
    { ...receipt, taskPresentAfter: false },
    { ...receipt, whatIf: true },
    { ...receipt, maximumConcurrentExecutors: 2 },
    { ...receipt, recoveryRoutes: receipt.recoveryRoutes.slice(0, 4) },
  ]) {
    assert.deepEqual(validateBattleBridgeRecoveryMeshInstallReceipt(corrupt), {
      ok: false,
      blocker: 'RECOVERY_MESH_INSTALL_POSTCONDITION_FAILED',
    });
  }
});

test('mailbox installer handler parses and validates the fixed install receipt before claiming success', async () => {
  const source = await readFile(mailboxSourcePath, 'utf8');
  assert.match(source, /preserveStdout: true/);
  assert.match(source, /validateBattleBridgeRecoveryMeshInstallReceipt\(parseBoundedGitHubJson\(result\.stdout/);
  assert.match(source, /installReceiptVerified: receiptValidation\.ok/);
  assert.match(source, /RECOVERY_MESH_INSTALL_RECEIPT_INVALID/);
  assert.match(source, /RECOVERY_MESH_INSTALL_POSTCONDITION_FAILED/);
  assert.doesNotMatch(source, /ok: result\.ok,[\s\S]{0,160}BATTLE_BRIDGE_RECOVERY_MESH_INSTALLED/);
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

test('failed chat updates retain installed source truth and bounded post-sync test evidence', () => {
  const head = '10ce35ad3d9542694f02e6727954b965d3de4f6b';
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'post-sync-evidence-001',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    expectedHead: head,
    state: 'BLOCKED',
    result: {
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      result: {
        ok: false,
        blocker: 'POST_SYNC_VERIFICATION_FAILED',
        finalVerdict: 'POST_SYNC_VERIFICATION_FAILED',
        sourceInstalled: true,
        sourceHead: head,
        branch: 'main',
        expectedHeadMatch: true,
        sync: {
          tests: {
            ok: false,
            status: 1,
            signal: null,
            stdout: `${'ok 1 - earlier passing evidence\n'.repeat(220)}\n...[truncated]`,
            stderr: 'C:\\Users\\Stephan\\secret-shaped-local-path',
            tapSummary: {
              summaryComplete: true,
              tests: 145,
              pass: 143,
              fail: 2,
              cancelled: 0,
              skipped: 0,
              todo: 0,
              failingTests: [
                'preserves canonical source truth',
                'reports bounded verification evidence',
              ],
            },
          },
        },
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt).operationResult;
  assert.equal(projected.sourceHead, head);
  assert.equal(projected.expectedHeadMatch, true);
  assert.equal(projected.sourceInstalled, true);
  assert.deepEqual(projected.postSyncVerification, {
    ok: false,
    status: 1,
    signal: '',
    summaryComplete: true,
    tests: 145,
    pass: 143,
    fail: 2,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    failingTests: [
      'preserves canonical source truth',
      'reports bounded verification evidence',
    ],
    outputTruncated: true,
  });

  const serialized = serializeBoundedReceiptJson(receipt);
  const compact = JSON.parse(serialized).result.result;
  assert.deepEqual(compact.postSyncVerification, projected.postSyncVerification);
  assert.doesNotMatch(serialized, /C:\\Users|secret-shaped/i);
});

test('incomplete post-sync TAP evidence projects unknown totals without dropping partial failures', () => {
  const receipt = {
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    result: {
      result: {
        sync: {
          tests: {
            ok: false,
            status: null,
            signal: 'SIGTERM',
            stdout: 'not ok 2 - partial Windows failure',
            tapSummary: {
              summaryComplete: false,
              tests: null,
              pass: null,
              fail: null,
              cancelled: null,
              skipped: null,
              todo: null,
              failingTests: ['partial Windows failure'],
            },
          },
        },
      },
    },
  };
  const evidence = createSanitizedMailboxReceiptProjection(receipt).operationResult.postSyncVerification;
  assert.equal(evidence.summaryComplete, false);
  assert.equal(evidence.tests, null);
  assert.equal(evidence.pass, null);
  assert.equal(evidence.fail, null);
  assert.equal(evidence.signal, 'SIGTERM');
  assert.deepEqual(evidence.failingTests, ['partial Windows failure']);
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
