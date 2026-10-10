import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BATTLE_BRIDGE_MAILBOX_MAX_RECEIPT_PUBLICATION_ATTEMPTS_PER_CYCLE,
  buildRejectedMailboxTerminalReceipt,
  checkpointAcceptedMailboxReceipt,
  renewAcceptedMailboxReceiptHeartbeat,
  checkpointMailboxReceiptPublication,
  checkpointTerminalMailboxReceipt,
  createBoundedMailboxReceiptPublisher,
  createSanitizedMailboxReceiptProjection,
  createSanitizedCriticalBacklogStatusProjection,
  createSanitizedProgrammeAuthorityStatusProjection,
  createWindowsSafeMailboxReceiptFilename,
  flushMailboxReceiptPublicationOutbox,
  ensureProgrammeAuthorityTerminalTelemetry,
  decideMailboxProcessGeneration,
  shouldRolloverMailboxGenerationAfterTerminal,
  parseBoundedGitHubJson,
  preflightMailboxControlExpectedHead,
  readMailboxReceipt,
  serializeBoundedReceiptJson,
  terminalizeRejectedMailboxCommands,
  validateBattleBridgeRecoveryMeshInstallReceipt,
} from './battle-bridge-github-command-mailbox.mjs';
import { planForgeShadowM3RunnerAdmission } from '../shared/agents/forgeShadowM3RunnerAdmissionV1.mjs';
import { CRITICAL_BACKLOG_DECISION } from '../shared/agents/criticalBacklogConveyor.mjs';

const installerPath = new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url);
const hiddenLauncherPath = new URL('./windows/run-battle-bridge-github-command-mailbox-hidden.ps1', import.meta.url);
const windowlessLauncherPath = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);
const mailboxSourcePath = new URL('./battle-bridge-github-command-mailbox.mjs', import.meta.url);

test('renews accepted mailbox heartbeat without changing command identity', () => {
  const state = { consumedRequestIds: [], acceptedRequestIds: [] };
  const writes = [];
  let persistCount = 0;
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'accepted-heartbeat-renewal-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    state: 'ACCEPTED',
    acceptedAt: '2026-10-03T22:00:00.000Z',
    heartbeatAt: '2026-10-03T22:00:00.000Z',
    completedAt: '',
    expectedHead: 'd'.repeat(40),
    proofRefs: [],
  };

  const result = renewAcceptedMailboxReceiptHeartbeat(
    state,
    receipt,
    '2026-10-03T22:10:00.000Z',
    {
      persist: () => { persistCount += 1; },
      writeReceiptFn: (value) => {
        writes.push(value);
        return { ref: 'receipts/github-command-mailbox/accepted-heartbeat-renewal-001.json' };
      },
    },
  );

  assert.equal(result.receipt.requestId, receipt.requestId);
  assert.equal(result.receipt.acceptedAt, receipt.acceptedAt);
  assert.equal(result.receipt.heartbeatAt, '2026-10-03T22:10:00.000Z');
  assert.equal(result.receipt.state, 'ACCEPTED');
  assert.equal(result.receiptLocation.ref, 'receipts/github-command-mailbox/accepted-heartbeat-renewal-001.json');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].heartbeatAt, '2026-10-03T22:10:00.000Z');
  assert.deepEqual(state.acceptedRequestIds, [receipt.requestId]);
  assert.equal(state.lastAcceptedReceipt.heartbeatAt, '2026-10-03T22:10:00.000Z');
  assert.equal(persistCount, 1);
});

const FORGE_HEAD = 'a'.repeat(40);
const FORGE_TREE = 'b'.repeat(40);
const FORGE_IMAGE = `sha256:${'c'.repeat(64)}`;
const FORGE_BACKUP = 'd'.repeat(64);

function forgeM2Receipt(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'forge-m2-install-ready-001',
    operation: 'INSTALL_FORGE_SHADOW_M2',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: FORGE_HEAD,
    forgejoVersion: '15.0.6',
    forgejoImageDigest: FORGE_IMAGE,
    runtimeBoundary: 'podman-wsl-rootless',
    m2Only: true,
    state: 'DONE',
    acceptedAt: '2026-08-09T17:00:00Z',
    heartbeatAt: '2026-08-09T17:05:00Z',
    completedAt: '2026-08-09T17:10:00Z',
    blocker: '',
    proofRefs: ['receipts/github-command-mailbox/forge-m2-install-ready-001.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'INSTALL_FORGE_SHADOW_M2',
      requestId: 'forge-m2-install-ready-001',
      result: {
        ok: true,
        blocker: '',
        finalVerdict: 'FORGE_SHADOW_M2_READY',
        repository: 'Cheekyfellastef/stephan-os',
        sourceHead: FORGE_HEAD,
        canonicalTree: FORGE_TREE,
        installerBlob: 'e'.repeat(40),
        forgejoVersion: '15.0.6',
        podmanVersion: '6.0.2',
        forgejoImageDigest: FORGE_IMAGE,
        runtimeBoundary: 'podman-wsl-rootless',
        machine: 'stephanos-forge-shadow',
        podmanConnection: 'stephanos-forge-shadow',
        container: 'stephanos-forge-shadow',
        listener: '127.0.0.1:3340',
        mirrorHead: FORGE_HEAD,
        mirrorTree: FORGE_TREE,
        backupDigest: FORGE_BACKUP,
        backupVolume: `stephanos-forge-shadow-backup-${FORGE_BACKUP.slice(0, 16)}`,
        restoreDrillPassed: true,
        rootFilesystemReadOnly: true,
        allCapabilitiesDropped: true,
        noNewPrivileges: true,
        githubCredentialUsed: false,
        credentialPersisted: false,
        credentialLogged: false,
        runnerRegistration: false,
        actionsExecution: false,
        mergeAuthority: false,
        readyForM3: true,
      },
    },
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    credentialsMayBeReadOrExported: false,
    ...overrides,
  };
}

function forgeRunnerPool(runnerClass) {
  const linux = runnerClass === 'linux-isolated';
  return {
    poolId: linux ? 'forge-linux-build-test-v1' : 'forge-windows-proof-v1',
    runnerClass,
    count: linux ? 3 : 1,
    runtimeBoundary: linux ? 'forge-linux-rootless-ephemeral' : 'battle-bridge-windows-proof-sandbox',
    runtimeArtifactDigest: `sha256:${(linux ? '1' : '2').repeat(64)}`,
    workloadIds: linux ? ['linux-shared-agent-tests', 'linux-stephanos-ui-build'] : ['windows-source-controlled-proof'],
    cpuLimit: linux ? 4 : 2,
    memoryMiB: 4096,
    diskMiB: 16384,
    maxJobMinutes: linux ? 45 : 60,
    maxConcurrentJobs: linux ? 3 : 1,
    artifactRetentionDays: 14,
    maxArtifactBytes: 512 * 1024 * 1024,
    workspacePolicy: 'ephemeral-per-job',
    artifactPolicy: 'immutable-content-addressed',
    networkPolicy: linux ? 'forge-loopback-and-approved-readonly-egress' : 'battle-bridge-loopback-and-approved-readonly-egress',
    registrationMode: 'disabled-pending-runtime-authorization',
    ephemeralWorkspace: true,
    limitedUser: true,
    privileged: false,
    hostNetwork: false,
    hostProcessAccess: false,
    canonicalCheckoutMounted: false,
    containerSocketMounted: false,
    githubCredentialAvailable: false,
    persistentSecrets: false,
    publicInbound: false,
    tailscaleInbound: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    registrationRequested: false,
    executed: false,
  };
}

test('critical backlog status projection stays aligned with the canonical conveyor decision vocabulary', () => {
  for (const decision of Object.values(CRITICAL_BACKLOG_DECISION)) {
    assert.equal(
      createSanitizedCriticalBacklogStatusProjection({ decision }).decision,
      decision,
      `mailbox must accept canonical conveyor decision ${decision}`,
    );
  }
  assert.equal(
    createSanitizedCriticalBacklogStatusProjection({ decision: 'UNTRUSTED_ARBITRARY_DECISION' }).decision,
    '',
  );
});

test('mailbox process generation binding fails closed on checkout drift before command acceptance', () => {
  const headA = 'a'.repeat(40);
  const headB = 'b'.repeat(40);
  assert.equal(decideMailboxProcessGeneration(headA, headA), false);
  assert.deepEqual(decideMailboxProcessGeneration(headA, headB), {
    yield: true,
    reason: 'CHECKOUT_HEAD_CHANGED_SINCE_PROCESS_START',
    processSourceHead: headA,
    sourceHead: headB,
  });
  assert.deepEqual(decideMailboxProcessGeneration('', headB), {
    yield: true,
    reason: 'MAILBOX_PROCESS_SOURCE_HEAD_UNPROVEN',
    processSourceHead: '',
    sourceHead: headB,
  });
  assert.deepEqual(decideMailboxProcessGeneration(headA, ''), {
    yield: true,
    reason: 'MAILBOX_CHECKOUT_HEAD_UNPROVEN',
    processSourceHead: headA,
    sourceHead: '',
  });
});

test('mailbox generation rollover follows exact source change even when later runtime verification blocks', () => {
  const selected = {
    command: {
      operation: 'UPDATE_STEPHANOS_FROM_CHAT',
      expectedHead: 'a'.repeat(40),
    },
  };
  const sourceChangedUpdate = {
    sourceInstalled: true,
    sourceHead: 'a'.repeat(40),
    expectedHeadMatch: true,
    sync: { updated: true, afterHead: 'a'.repeat(40) },
  };
  for (const terminal of [
    {
      receipt: { state: 'DONE' },
      execution: { ok: true, result: structuredClone(sourceChangedUpdate) },
    },
    {
      receipt: { state: 'BLOCKED' },
      execution: {
        ok: false,
        blocker: 'IGNITION_REFRESH_FAILED',
        result: { ...structuredClone(sourceChangedUpdate), ok: false, blocker: 'IGNITION_REFRESH_FAILED' },
      },
    },
  ]) {
    assert.deepEqual(shouldRolloverMailboxGenerationAfterTerminal(selected, terminal), {
      yield: true,
      reason: 'SOURCE_GENERATION_ADVANCED',
      sourceHead: 'a'.repeat(40),
    });
  }

  const terminal = {
    receipt: { state: 'DONE' },
    execution: { ok: true, result: structuredClone(sourceChangedUpdate) },
  };
  for (const mutate of [
    (candidate) => { candidate.execution.result.sourceInstalled = false; },
    (candidate) => { candidate.execution.result.sync.updated = false; },
    (candidate) => { candidate.execution.result.expectedHeadMatch = false; },
    (candidate) => { candidate.execution.result.sourceHead = 'b'.repeat(40); },
    (candidate) => { candidate.execution.result.sync.afterHead = 'b'.repeat(40); },
  ]) {
    const candidate = structuredClone(terminal);
    mutate(candidate);
    assert.equal(shouldRolloverMailboxGenerationAfterTerminal(selected, candidate), false);
  }
  assert.equal(shouldRolloverMailboxGenerationAfterTerminal({
    command: { operation: 'READ_PROGRAMME_AUTHORITY_STATUS', expectedHead: 'a'.repeat(40) },
  }, terminal), false);
});

test('mailbox task uses the fixed windowless launcher instead of allocating a Node console', async () => {
  const [installer, hiddenLauncher, windowlessLauncher] = await Promise.all([
    readFile(installerPath, 'utf8'),
    readFile(hiddenLauncherPath, 'utf8'),
    readFile(windowlessLauncherPath, 'utf8'),
  ]);

  assert.match(installer, /New-ScheduledTaskAction -Execute \$wscriptExe/);
  assert.match(installer, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(installer, /battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /runnerPath = \(Resolve-Path[\s\S]{0,180}battle-bridge-github-command-mailbox-outbox-guard-v1\.mjs/);
  assert.match(installer, /childRunnerPath = \(Resolve-Path[\s\S]{0,180}battle-bridge-github-command-mailbox-with-receipt-index\.mjs/);
  assert.match(installer, /receiptIndexEnabled = \$true/);
  assert.match(installer, /\/\/B \/\/NoLogo/);
  assert.match(installer, /github-command-mailbox/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction -Execute \$(?:node|nodeExe|npm)/);

  const mailboxSource = await readFile(mailboxSourcePath, 'utf8');
  assert.match(mailboxSource, /selectBattleBridgeGitHubCommandBatch\(comments/);
  assert.match(mailboxSource, /executeBattleBridgeGitHubCommandBatch\(batch/);
  assert.match(mailboxSource, /beforeExecute:\s*async \(selected\)/);
  assert.match(mailboxSource, /onTerminal:\s*async \(selected, execution\)/);
  assert.match(mailboxSource, /shouldYieldBeforeExecute:\s*async \(\) => decideMailboxProcessGeneration/);
  assert.match(mailboxSource, /MAILBOX_PROCESS_SOURCE_HEAD/);
  assert.match(mailboxSource, /processSourceHead:\s*MAILBOX_PROCESS_SOURCE_HEAD/);
  assert.match(mailboxSource, /processSourceHead:\s*safeTelemetrySha\(receipt\?\.processSourceHead\)/);
  assert.match(mailboxSource, /CHECKOUT_HEAD_CHANGED_SINCE_PROCESS_START/);
  assert.match(mailboxSource, /shouldYieldAfterTerminal:\s*shouldRolloverMailboxGenerationAfterTerminal/);
  assert.match(mailboxSource, /MAILBOX_PROCESS_GENERATION_ROLLOVER/);
  assert.match(mailboxSource, /generationBoundaryDeferredCount/);
  assert.match(mailboxSource, /checkpointTerminalMailboxReceipt\(state, receipt\)/);
  assert.doesNotMatch(mailboxSource, /for \(const selected of batch\.commands\) \{[\s\S]{0,500}state: 'ACCEPTED'/);
  assert.match(mailboxSource, /maxBatch: 1/);
  assert.match(mailboxSource, /const currentHead = readGitHubMainHead\(\)/);
  assert.match(mailboxSource, /currentHead,/);
  assert.match(mailboxSource, /const totalDeferredCount = batch\.deferredCount \+ generationBoundaryDeferredCount/);
  assert.match(mailboxSource, /updateStephanosFromChat\(\{[\s\S]{0,180}expectedHead: command\.expectedHead/);
  assert.doesNotMatch(mailboxSource, /BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE\s*=\s*[^1]*2|issueNumber:\s*1508/);

  assert.match(
    windowlessLauncher,
    /Case "github-command-mailbox"\s+targetPath = fileSystem\.BuildPath\(repoRoot, "scripts\\windows\\run-battle-bridge-github-command-mailbox-hidden\.ps1"\)\s+command = Quote\(powershellExe\) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote\(targetPath\)/,
  );
  assert.match(windowlessLauncher, /shell\.Run\(command, 0, True\)/);
  assert.doesNotMatch(windowlessLauncher, /WScript\.Arguments\(1\)|cmd\.exe|Invoke-Expression/i);

  assert.match(hiddenLauncher, /Documents\\GitHub\\stephan-os/);
  assert.match(hiddenLauncher, /battle-bridge-github-command-mailbox-outbox-guard-v1\.mjs/);
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

test('expired protected merge rejection is terminalized from the selector allowlist', () => {
  const rejection = {
    blocker: 'PROTECTED_MERGE_EXPIRED',
    commentUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-8',
    command: {
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId: 'req-protected-merge-expired-1',
      operation: 'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1507,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: 'a'.repeat(40),
      expiresAt: '2026-08-11T11:00:00.000Z',
    },
  };
  const receipt = buildRejectedMailboxTerminalReceipt(rejection, '2026-08-11T11:30:00.000Z');
  assert.equal(receipt.state, 'BLOCKED');
  assert.equal(receipt.acceptedAt, '');
  assert.equal(receipt.blocker, 'PROTECTED_MERGE_EXPIRED');
});

test('look-alike protected merge rejection outside the selector allowlist is rejected', () => {
  assert.throws(() => buildRejectedMailboxTerminalReceipt({
    blocker: 'PROTECTED_MERGE_FORGED_TERMINAL_CODE',
    command: {
      requestId: 'req-protected-merge-forged-1',
      operation: 'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE',
    },
  }, '2026-08-11T11:30:00.000Z'), /MAILBOX_REJECTION_RECEIPT_INVALID/);
});

test('one shared publication budget pre-defers sustained rejection debt without loss or identity drift', () => {
  assert.equal(BATTLE_BRIDGE_MAILBOX_MAX_RECEIPT_PUBLICATION_ATTEMPTS_PER_CYCLE, 1);
  const oldReceipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-old-outbox-1',
    operation: 'READ_DEPLOYMENT_STATUS',
    state: 'BLOCKED',
    blocker: 'RECEIPT_PUBLICATION_FAILED',
    completedAt: '2026-08-11T11:29:00.000Z',
  };
  const state = {
    consumedRequestIds: [],
    acceptedRequestIds: [],
    pendingReceiptPublications: [{
      publicationId: 'req-1507-old-outbox-1:BLOCKED:2026-08-11T11:29:00.000Z',
      receipt: oldReceipt,
    }],
  };
  const networkAttempts = [];
  const budget = createBoundedMailboxReceiptPublisher({
    publish: (receipt) => {
      networkAttempts.push(receipt.requestId);
      return { ok: false, blocker: 'SIMULATED_PUBLICATION_OUTAGE' };
    },
  });
  const flushed = flushMailboxReceiptPublicationOutbox(state, {
    publish: budget.publish,
    persist: () => {},
  });
  assert.deepEqual(flushed, { attemptedCount: 1, publishedCount: 0, pendingCount: 1 });

  const rejections = Array.from({ length: 150 }, (_, index) => {
    const requestId = `req-1507-rejected-${String(index).padStart(4, '0')}`;
    return {
      blocker: 'COMMAND_EXPIRY_TOO_FAR_AHEAD',
      commentUrl: `https://github.com/Cheekyfellastef/stephan-os/issues/1507#issuecomment-${index + 10}`,
      command: {
        schemaVersion: 'stephanos.battle-bridge-github-command.v1',
        requestId,
        operation: 'UPDATE_STEPHANOS_FROM_CHAT',
        repository: 'Cheekyfellastef/stephan-os',
        issueNumber: 1507,
        branch: 'main',
        operatorApproval: 'operator-approved',
        expectedHead: 'a'.repeat(40),
        expiresAt: '2026-08-11T18:00:00.000Z',
      },
    };
  });
  const terminalized = terminalizeRejectedMailboxCommands(state, rejections, {
    now: () => new Date('2026-08-11T11:30:00.000Z'),
    write: (receipt) => ({ ref: `receipts/github-command-mailbox/${receipt.requestId}.json` }),
    publish: budget.publish,
    persist: () => {},
  });

  assert.equal(terminalized.length, 150);
  assert.deepEqual(networkAttempts, ['req-1507-old-outbox-1']);
  assert.deepEqual(budget.snapshot(), { maxAttempts: 1, attemptedCount: 1, deferredCount: 150 });
  assert.equal(state.pendingReceiptPublications.length, 151);
  assert.equal(new Set(state.pendingReceiptPublications.map((entry) => entry.publicationId)).size, 151);
  assert.deepEqual(
    state.pendingReceiptPublications.slice(1).map((entry) => entry.receipt.requestId),
    rejections.map((rejection) => rejection.command.requestId),
  );
  assert.deepEqual(state.consumedRequestIds, rejections.map((rejection) => rejection.command.requestId));
});

test('canonical mailbox wires the shared publication budget across every receipt publication phase', async () => {
  const source = await readFile(mailboxSourcePath, 'utf8');
  assert.match(source, /flushMailboxReceiptPublicationOutbox\(state, \{\s*publish: publicationBudget\.publish,/);
  assert.match(source, /terminalizeRejectedMailboxCommands\(state, batch\.terminalRejections, \{\s*now,\s*publish: publicationBudget\.publish,/);
  assert.equal(
    [...source.matchAll(/checkpointMailboxReceiptPublication\(state, publishable, publicationBudget\.publish\(publishable\)\)/g)].length,
    2,
  );
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

test('terminal publication discards an obsolete failed acceptance for the same request', () => {
  const state = { pendingReceiptPublications: [] };
  const accepted = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'req-1507-publish-terminal-1',
    operation: 'UPDATE_STEPHANOS_FROM_CHAT',
    state: 'ACCEPTED',
    acceptedAt: '2026-08-11T11:30:00.000Z',
  };
  checkpointMailboxReceiptPublication(state, accepted, { ok: false }, { persist: () => {} });
  assert.equal(state.pendingReceiptPublications.length, 1);
  checkpointMailboxReceiptPublication(state, {
    ...accepted,
    state: 'DONE',
    completedAt: '2026-08-11T11:31:00.000Z',
  }, { ok: true }, { persist: () => {} });
  assert.deepEqual(state.pendingReceiptPublications, []);
});

test('main-targeting control preflight blocks a stale head and ignores observations', () => {
  const stale = preflightMailboxControlExpectedHead({
    partition: 'CONTROL',
    command: { operation: 'UPDATE_STEPHANOS_FROM_CHAT', expectedHead: 'a'.repeat(40) },
  }, { readMainHead: () => 'b'.repeat(40) });
  assert.equal(stale.ok, false);
  assert.equal(stale.blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  const remoteStale = preflightMailboxControlExpectedHead({
    partition: 'CONTROL',
    command: { operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION', expectedHead: 'a'.repeat(40) },
  }, { readMainHead: () => 'b'.repeat(40) });
  assert.equal(remoteStale.ok, false);
  assert.equal(remoteStale.blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  const observation = preflightMailboxControlExpectedHead({
    partition: 'OBSERVATION',
    command: { operation: 'READ_DEPLOYMENT_STATUS', expectedHead: 'a'.repeat(40) },
  }, { readMainHead: () => { throw new Error('must not read'); } });
  assert.equal(observation.ok, true);
});

test('Sovereign Commander remote receipts preserve bounded mobile proof metadata', () => {
  const head = 'c'.repeat(40);
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'sovereign-mobile-proof-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    acceptedAt: '2026-10-01T08:00:00.000Z',
    heartbeatAt: '2026-10-01T08:00:01.000Z',
    completedAt: '2026-10-01T08:00:02.000Z',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'sovereign-mobile-proof-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
        remoteAction: 'battle-bridge-status',
        sourceHead: head,
        proofHash: 'd'.repeat(64),
        processId: 'battle-bridge-status',
        status: 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
        coreDaemonStatus: {
          available: true,
          daemonHealthy: true,
          readiness: 'READY',
          sourceHead: head,
          heartbeatAgeSeconds: 12,
          sovereignCommanderHealthy: true,
          backendHealthy: true,
          missionWorkerHealthy: true,
          gamingActive: false,
          uiRequired: false,
          sourceMutationAllowed: false,
          schedulerAuthority: false,
          mergeAuthority: false,
          vendorMeterRequired: false,
          remoteCommanderRequired: false,
          rawStdout: 'must-not-survive',
          localPath: 'C:\\secret',
        },
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.remoteAction, 'battle-bridge-status');
  assert.equal(projected.operationResult.proofHash, 'd'.repeat(64));
  assert.equal(projected.operationResult.processId, 'battle-bridge-status');
  assert.equal(projected.operationResult.maintenanceStatus, 0);
  assert.equal(projected.operationResult.sourceHead, head);
  assert.equal(projected.operationResult.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE');
  assert.deepEqual(projected.operationResult.coreDaemonStatus, {
    available: true,
    daemonHealthy: true,
    readiness: 'READY',
    sourceHead: head,
    heartbeatAgeSeconds: 12,
    sovereignCommanderHealthy: true,
    backendHealthy: true,
    missionWorkerHealthy: true,
    gamingActive: false,
    uiRequired: false,
    sourceMutationAllowed: false,
    schedulerAuthority: false,
    mergeAuthority: false,
    vendorMeterRequired: false,
    remoteCommanderRequired: false,
  });
  assert.equal(Object.hasOwn(projected.operationResult.coreDaemonStatus, 'rawStdout'), false);
  assert.equal(Object.hasOwn(projected.operationResult.coreDaemonStatus, 'localPath'), false);
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(serialized.result.result.remoteAction, 'battle-bridge-status');
  assert.equal(serialized.result.result.proofHash, 'd'.repeat(64));
  assert.equal(serialized.result.result.processId, 'battle-bridge-status');
  assert.equal(serialized.result.result.maintenanceStatus, 0);
  assert.equal(serialized.result.result.sourceHead, head);
  assert.equal(serialized.result.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE');
  assert.equal(serialized.result.result.coreDaemonStatus.daemonHealthy, true);
  assert.equal(serialized.result.result.coreDaemonStatus.readiness, 'READY');
  assert.equal(serialized.result.result.coreDaemonStatus.sourceHead, head);
  assert.equal(serialized.result.result.coreDaemonStatus.remoteCommanderRequired, false);
  assert.equal(Object.hasOwn(serialized.result.result.coreDaemonStatus, 'rawStdout'), false);
  assert.equal(Object.hasOwn(serialized.result.result.coreDaemonStatus, 'localPath'), false);
});

test('Sovereign Commander blocked receipts preserve only bounded failure diagnostics', () => {
  const head = 'c'.repeat(40);
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'sovereign-mobile-failure-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    state: 'BLOCKED',
    blocker: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED',
    result: {
      ok: false,
      verdict: 'BLOCKED',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'sovereign-mobile-failure-001',
      blocker: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED',
      remoteAction: 'ignite-stephanos',
      status: 2,
      processId: 'ignite-stephanos',
      errorCode: 'IGNITION_EXIT_2',
      executionBlocker: 'fixed-process-exit-2',
      publicReceiptSafe: true,
      secretMaterialReturned: false,
      stdout: 'PRIVATE RAW STDOUT C:\\Users\\Operator\\secret-path',
      stderr: 'PRIVATE RAW STDERR',
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.remoteAction, 'ignite-stephanos');
  assert.equal(projected.operationResult.processId, 'ignite-stephanos');
  assert.equal(projected.operationResult.maintenanceStatus, 2);
  assert.equal(projected.operationResult.errorCode, 'IGNITION_EXIT_2');
  assert.equal(projected.operationResult.executionBlocker, 'fixed-process-exit-2');
  assert.equal(projected.operationResult.publicReceiptSafe, true);
  assert.equal(projected.operationResult.secretMaterialReturned, false);
  const encoded = JSON.stringify(projected);
  assert.doesNotMatch(encoded, /PRIVATE RAW|secret-path|stderr|stdout/i);

  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(serialized.result.result.remoteAction, 'ignite-stephanos');
  assert.equal(serialized.result.result.processId, 'ignite-stephanos');
  assert.equal(serialized.result.result.maintenanceStatus, 2);
  assert.equal(serialized.result.result.errorCode, 'IGNITION_EXIT_2');
  assert.equal(serialized.result.result.executionBlocker, 'fixed-process-exit-2');
  assert.doesNotMatch(JSON.stringify(serialized), /PRIVATE RAW|secret-path/i);
});

test('mailbox receipt preserves bounded project search paths and strips private preview data', () => {
  const head = 'c'.repeat(40);
  const query = 'Remote Commander';
  const queryHash = createHash('sha256').update(query).digest('hex');
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'project-scan-readback-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'project-scan-readback-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PROJECT_SEARCH_COMPLETE',
        remoteAction: 'search-project',
        sourceHead: head,
        proofHash: 'f'.repeat(64),
        queryHash,
        resultCount: 2,
        truncated: false,
        results: [
          { relativePath: 'shared/agents/sovereignCommanderV1.mjs', line: 42, column: 7, preview: 'PRIVATE PREVIEW' },
          { relativePath: 'scripts/sovereign-commander-mcp.mjs', line: 88, column: 3, preview: 'PRIVATE PREVIEW 2' },
        ],
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.deepEqual(projected.operationResult.projectSearch, {
    queryHash,
    resultCount: 2,
    truncated: false,
    results: [
      { relativePath: 'shared/agents/sovereignCommanderV1.mjs', line: 42, column: 7 },
      { relativePath: 'scripts/sovereign-commander-mcp.mjs', line: 88, column: 3 },
    ],
  });
  const encoded = JSON.stringify(projected);
  assert.doesNotMatch(encoded, /PRIVATE PREVIEW/);

  const onceSerialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  const twiceProjected = createSanitizedMailboxReceiptProjection(onceSerialized);
  assert.deepEqual(twiceProjected.operationResult.projectSearch, projected.operationResult.projectSearch);
  const twiceSerialized = JSON.parse(serializeBoundedReceiptJson(onceSerialized));
  assert.deepEqual(twiceSerialized.result.result.projectSearch, projected.operationResult.projectSearch);
  assert.doesNotMatch(JSON.stringify(twiceSerialized), /PRIVATE PREVIEW/);
});

test('mailbox receipt preserves only bounded parity summary', () => {
  const head = 'd'.repeat(40);
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'parity-readback-proof-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'parity-readback-proof-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
        remoteAction: 'reconcile-remote-commander-parity',
        sourceHead: head,
        proofHash: 'e'.repeat(64),
        processId: 'reconcile-remote-commander-parity',
        status: 0,
        capabilityParity: {
          canonicalOwnerGoal: '#2573',
          retainedCapabilityCount: 14,
          parityPresentCount: 12,
          buildableGapCount: 0,
          boundaryHoldCount: 2,
          zeroGapInvariantSatisfied: true,
          closureRequired: false,
          daemonMayReportGreen: true,
          mustContinueUntilZero: true,
          finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
          privatePath: 'C:\\secret\\parity.json',
        },
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.deepEqual(projected.operationResult.capabilityParity, {
    canonicalOwnerGoal: '#2573',
    retainedCapabilityCount: 14,
    parityPresentCount: 12,
    buildableGapCount: 0,
    boundaryHoldCount: 2,
    zeroGapInvariantSatisfied: true,
    closureRequired: false,
    daemonMayReportGreen: true,
    mustContinueUntilZero: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN',
  });
  const encoded = JSON.stringify(projected);
  assert.doesNotMatch(encoded, /secret\\parity|privatePath/);
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

test('programme authority telemetry preserves bounded scheduler, capacity, heartbeat and backlog truth', () => {
  const raw = {
    status: 'READY',
    finalVerdict: 'AUTHORITATIVE_PROGRAMME_PROJECTION_READY',
    blockers: [],
    sourceConstructionMode: 'production-contracts',
    scheduler: {
      failClosed: false,
      programmeStatus: 'READY_TO_ADVANCE',
      selectedGoal: '#2314',
      selectedLifecycle: 'READY',
      selectedRoute: 'OPENCLAW_LOCAL',
      parallelCandidateDetails: [{ candidateId: '#2314', issue: 2314 }],
      parallelHeld: [{ candidateId: '#2315', issue: 2315, reasonCode: 'RESOURCE_CONFLICT' }],
      elasticCapacity: { status: 'RUNNING', scaleAction: 'EXPAND', desiredWidth: 8, remainingAdmissionSlots: 7 },
      portfolio: [
        { issue: 2314, lifecycle: 'READY' },
        { issue: 2315, lifecycle: 'BLOCKED' },
        { issue: 2316, lifecycle: 'MERGE_READY' },
      ],
      decisionReceipt: {
        status: 'LANE_SELECTED',
        selectedIssue: 2314,
        selectedLifecycle: 'READY',
        route: 'OPENCLAW_LOCAL',
        contradictionCodes: [],
      },
    },
    logicalGoalControllerFabric: {
      schemaVersion: 'stephanos.logical-goal-controller-fabric.v1',
      valid: true,
      controllers: [
        {
          logicalControllerId: 'logical-goal-2314',
          goalIssueNumber: 2314,
          goalTitle: 'Canary Goal',
          lifecycle: 'ACTIVE',
          continuityState: 'ACTIVE',
          route: 'OPENCLAW_LOCAL',
          hostControllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
          hostControllerTitle: 'Stephanos Autonomous Goal Builder',
          selectedForAdmission: true,
          resourceIds: ['repo:path:doc'],
        },
        {
          logicalControllerId: 'logical-goal-2519',
          goalIssueNumber: 2519,
          goalTitle: 'Sovereign Commander',
          lifecycle: 'BLOCKED',
          continuityState: 'PARKED',
          route: 'STEPHANOS_NATIVE',
          hostControllerId: '6ac3999164b88191a1c866c70ab51bd7',
          hostControllerTitle: 'Stephanos Continuous Foreman',
          selectedForAdmission: false,
          resourceIds: [],
        },
      ],
    },
    controllerHeartbeat: {
      valid: true,
      fresh: true,
      cycleState: 'IDLE',
      sourceRevision: 'a'.repeat(40),
    },
    workerHeartbeat: {
      valid: true,
      fresh: true,
      headSha: 'a'.repeat(40),
    },
    criticalBacklog: {
      decision: 'PARKED_BLOCKERS_ONLY',
      activeMission: null,
      remainingItemIds: [],
    },
    sourceReads: {
      repositoryHead: 'CANONICAL_REPOSITORY_HEAD_READ',
      controllerHeartbeat: 'PROGRAMME_CONTROLLER_HEARTBEAT_PASS',
      workerHeartbeat: 'MISSION_WORKER_HEARTBEAT_PASS',
      githubGoalEstate: 'GITHUB_GOAL_ESTATE_FETCHED',
    },
  };
  const packet = createSanitizedProgrammeAuthorityStatusProjection(raw);
  assert.equal(packet.programmeStatus, 'READY');
  assert.equal(packet.schedulerSelectedIssue, 2314);
  assert.equal(packet.schedulerSelectedLifecycle, 'READY');
  assert.deepEqual(packet.schedulerParallelCandidateIssues, [2314]);
  assert.deepEqual(packet.schedulerReadyIssues, [2314]);
  assert.deepEqual(packet.schedulerBlockedIssues, [2315]);
  assert.deepEqual(packet.schedulerMergeReadyIssues, [2316]);
  assert.equal(packet.elasticCapacityStatus, 'RUNNING');
  assert.equal(packet.logicalGoalControllerTruth, 'CURRENT');
  assert.equal(packet.logicalGoalControllerCount, 2);
  assert.equal(packet.logicalActiveMaterialLaneCount, 1);
  assert.equal(packet.logicalParkedLaneCount, 1);
  assert.deepEqual(packet.logicalSelectedIssueNumbers, [2314]);
  assert.equal(packet.logicalGoalLanes[0].goalRef, '#2314');
  assert.equal(packet.controllerFresh, true);
  assert.equal(packet.workerFresh, true);
  assert.equal(packet.criticalBacklogDecision, 'PARKED_BLOCKERS_ONLY');
  assert.equal(packet.sourceReadGithubGoalEstate, 'GITHUB_GOAL_ESTATE_FETCHED');

  const receipt = {
    requestId: 'programme-authority-status-0001',
    operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
    state: 'DONE',
    expectedHead: 'a'.repeat(40),
    result: {
      ok: true,
      result: {
        ok: true,
        finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
        sourceHead: 'a'.repeat(40),
        branch: 'main',
        expectedHeadMatch: true,
        programmeAuthorityTelemetry: true,
        programmeAuthority: packet,
      },
    },
  };
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.schedulerSelectedIssue, 2314);
  assert.equal(projected.operationResult.logicalActiveMaterialLaneCount, 1);
  assert.deepEqual(projected.operationResult.logicalSelectedIssueNumbers, [2314]);
  assert.equal(projected.operationResult.logicalGoalLanes[0].hostControllerTitle, 'Stephanos Autonomous Goal Builder');
  assert.deepEqual(projected.operationResult.schedulerParallelHeld, [{
    issueNumber: 2315,
    candidateId: '#2315',
    reasonCode: 'RESOURCE_CONFLICT',
  }]);
  const compact = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(compact.result.result.schedulerSelectedIssue, 2314);
  assert.deepEqual(compact.result.result.schedulerReadyIssues, [2314]);
  assert.equal(compact.result.result.logicalGoalControllerCount, 2);
  assert.equal(compact.result.result.logicalActiveMaterialLaneCount, 1);
  assert.deepEqual(compact.result.result.logicalSelectedIssueNumbers, [2314]);
  assert.equal('programmeAuthority' in compact.result.result, false);
});

test('terminal Programme Authority observation reconstructs missing telemetry once and fails closed if it is still absent', async () => {
  const command = {
    operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
    requestId: 'programme-authority-terminal-repair-0001',
  };
  const lost = {
    ok: true,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: command.operation,
    requestId: command.requestId,
    result: {
      ok: true,
      finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
      programmeAuthorityTelemetry: true,
    },
  };
  let reads = 0;
  const repaired = await ensureProgrammeAuthorityTerminalTelemetry(command, lost, {
    readStatus: async () => {
      reads += 1;
      return {
        ok: true,
        finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
        sourceHead: 'a'.repeat(40),
        branch: 'main',
        expectedHeadMatch: true,
        programmeAuthorityTelemetry: true,
        programmeAuthority: {
          programmeStatus: 'READY',
          schedulerSelectedIssue: 2314,
          schedulerSelectedLifecycle: 'READY',
          schedulerParallelCandidateIssues: [2314],
          elasticCapacityStatus: 'RUNNING',
          workerFresh: true,
          criticalBacklogDecision: 'PARKED_BLOCKERS_ONLY',
          sourceReadRepositoryHead: 'CANONICAL_REPOSITORY_HEAD_READ',
          sourceReadGithubGoalEstate: 'GITHUB_GOAL_ESTATE_FETCHED',
        },
      };
    },
  });
  assert.equal(reads, 1, 'boolean telemetry marker without a usable packet must be re-read');
  assert.equal(repaired.ok, true);
  assert.equal(repaired.result.programmeAuthorityTelemetry, true);
  const repairedReceipt = {
    requestId: command.requestId,
    operation: command.operation,
    state: 'DONE',
    expectedHead: 'a'.repeat(40),
    result: repaired,
  };
  const compact = JSON.parse(serializeBoundedReceiptJson(repairedReceipt));
  assert.equal(compact.result.result.programmeStatus, 'READY');
  assert.equal(compact.result.result.schedulerSelectedIssue, 2314);
  assert.deepEqual(compact.result.result.schedulerParallelCandidateIssues, [2314]);

  const blocked = await ensureProgrammeAuthorityTerminalTelemetry(command, lost, {
    readStatus: async () => ({
      ok: true,
      finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
      programmeAuthorityTelemetry: true,
      programmeAuthority: {
        programmeStatus: 'READY',
        sourceReadRepositoryHead: '',
        sourceReadGithubGoalEstate: '',
      },
    }),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocker, 'PROGRAMME_AUTHORITY_TELEMETRY_MISSING');
  assert.equal(blocked.result.finalVerdict, 'PROGRAMME_AUTHORITY_TELEMETRY_BLOCKED');
  assert.equal(blocked.result.programmeAuthorityTelemetry, false);

  const alreadyComplete = await ensureProgrammeAuthorityTerminalTelemetry(command, repaired, {
    readStatus: async () => {
      throw new Error('must not re-read complete telemetry');
    },
  });
  assert.equal(alreadyComplete, repaired);
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

test('Forge M2 receipt serialization preserves the closed-world proof required by M3 admission', () => {
  const receipt = forgeM2Receipt({
    token: 'ghp_this-must-not-leak',
    result: {
      ...forgeM2Receipt().result,
      result: {
        ...forgeM2Receipt().result.result,
        command: 'powershell.exe -File C:\\Users\\Stephan\\secret.ps1',
        credential: 'must-not-leak',
      },
    },
  });
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));

  assert.equal(serialized.forgejoVersion, '15.0.6');
  assert.equal(serialized.forgejoImageDigest, FORGE_IMAGE);
  assert.equal(serialized.runtimeBoundary, 'podman-wsl-rootless');
  assert.equal(serialized.m2Only, true);
  assert.equal(serialized.credentialsMayBeReadOrExported, false);
  assert.equal(serialized.result.result.canonicalTree, FORGE_TREE);
  assert.equal(serialized.result.result.mirrorHead, FORGE_HEAD);
  assert.equal(serialized.result.result.mirrorTree, FORGE_TREE);
  assert.equal(serialized.result.result.backupDigest, FORGE_BACKUP);
  assert.equal(serialized.result.result.restoreDrillPassed, true);
  assert.equal(serialized.result.result.rootFilesystemReadOnly, true);
  assert.equal(serialized.result.result.allCapabilitiesDropped, true);
  assert.equal(serialized.result.result.noNewPrivileges, true);
  assert.equal(serialized.result.result.githubCredentialUsed, false);
  assert.equal(serialized.result.result.credentialPersisted, false);
  assert.equal(serialized.result.result.credentialLogged, false);
  assert.equal(serialized.result.result.readyForM3, true);
  assert.doesNotMatch(JSON.stringify(serialized), /ghp_this|must-not-leak|secret\.ps1/i);
  assert.equal(Object.hasOwn(serialized, 'token'), false);
  assert.equal(Object.hasOwn(serialized.result.result, 'command'), false);
  assert.equal(Object.hasOwn(serialized.result.result, 'credential'), false);

  const admission = planForgeShadowM3RunnerAdmission({
    repository: 'Cheekyfellastef/stephan-os',
    canonicalMainHead: FORGE_HEAD,
    canonicalMainTree: FORGE_TREE,
    nowUtc: '2026-08-09T17:30:00Z',
    m2Receipt: serialized,
    runnerPools: [forgeRunnerPool('windows-proof-isolated'), forgeRunnerPool('linux-isolated')],
  });
  assert.equal(admission.valid, true, admission.blockers.join(','));
  assert.equal(admission.m2Evidence.sourceHead, FORGE_HEAD);
  assert.equal(admission.m2Evidence.sourceTree, FORGE_TREE);
});

test('Forge digest diagnostics survive bounded serialization without path or credential leakage', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'forge-m2-diagnostics-001',
    operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
    state: 'BLOCKED',
    result: {
      ok: false,
      result: {
        blocker: 'worker-head-mismatch',
        forgeShadowM2DigestResolution: {
          ok: true,
          status: 'FORGE_SHADOW_M2_DIGEST_READY',
          blocker: '',
          imageTag: 'code.forgejo.org/forgejo/forgejo:15.0.6-rootless',
          imageDigest: FORGE_IMAGE,
          forgejoVersion: '15.0.6',
          podmanVersion: '6.0.2',
          podmanExecutableIdentity: 'fixed-user-podman',
          runtimePlatform: 'linux/amd64',
          tlsVerified: true,
          registryCredentialUsed: false,
          mutationPerformed: false,
          pullPerformed: false,
          containerMutationPerformed: false,
          observedVersion: 'token=ghp_this-must-not-leak at C:\\Users\\Stephan\\podman.exe',
        },
      },
    },
  };

  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  const resolution = serialized.result.result.forgeShadowM2DigestResolution;
  assert.equal(resolution.ok, true);
  assert.equal(resolution.imageDigest, FORGE_IMAGE);
  assert.equal(resolution.podmanVersion, '6.0.2');
  assert.equal(resolution.tlsVerified, true);
  assert.equal(resolution.registryCredentialUsed, false);
  assert.equal(resolution.matchingDescriptorCount, null);
  assert.equal(resolution.observedVersion, '');
  assert.doesNotMatch(JSON.stringify(serialized), /ghp_this|C:\\Users/i);

  receipt.result.result.forgeShadowM2DigestResolution.matchingDescriptorCount = 1;
  const counted = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(counted.result.result.forgeShadowM2DigestResolution.matchingDescriptorCount, 1);
});

test('malformed Forge proof values fail closed during projection', () => {
  const receipt = forgeM2Receipt({ expectedHead: '', forgejoImageDigest: 'latest' });
  receipt.result.result.expectedHead = FORGE_HEAD;
  receipt.result.result.backupVolume = '..\\unsafe';
  receipt.result.result.readyForM3 = 'true';
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(serialized.expectedHead, '');
  assert.equal(serialized.forgejoImageDigest, '');
  assert.equal(serialized.result.result.backupVolume, '');
  assert.equal(serialized.result.result.readyForM3, null);
  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.forgejoImageDigest, '');
  assert.equal(projected.operationResult.readyForM3, null);
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


test('oversized public receipt falls back to bounded core evidence instead of crashing the mailbox', () => {
  const head = 'a'.repeat(40);
  const meters = Array.from({ length: 40 }, (_, index) => ({
    meterId: `meter-${index}`,
    provider: `provider-${index % 5}`,
    source: 'sovereign-local',
    observationState: 'CURRENT',
    trafficLight: index % 7 === 0 ? 'RED' : 'GREEN',
    remainingPercent: 100 - index,
    availability: 'AVAILABLE',
    truthState: 'OBSERVED',
    observedAtUtc: '2026-10-02T18:00:00.000Z',
    ageSeconds: index,
    naturalResetAtUtc: '2026-10-03T00:00:00.000Z',
    meterTruthUsable: true,
    observableBySovereign: true,
    limit: 1000,
    remaining: 900 - index,
    blocker: '',
  }));
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'oversized-public-receipt-core-fallback-0001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    state: 'DONE',
    completedAt: '2026-10-02T18:01:00.000Z',
    expectedHead: head,
    processSourceHead: head,
    proofRefs: Array.from({ length: 20 }, (_, index) => `proofs/receipt-${index}.json`),
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'oversized-public-receipt-core-fallback-0001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_ACTION_COMPLETE',
        expectedHead: head,
        sourceHead: head,
        branch: 'main',
        expectedHeadMatch: true,
        remoteAction: 'meter-status',
        proofHash: 'b'.repeat(64),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
        codexLastMessage: 'SAFE_STATUS '.repeat(600),
        codexNextOperatorAction: 'SAFE_ACTION '.repeat(200),
        blockers: Array.from({ length: 30 }, (_, index) => `BLOCKER_${String(index).padStart(2, '0')}_${'X'.repeat(120)}`),
        warnings: Array.from({ length: 30 }, (_, index) => `WARNING_${String(index).padStart(2, '0')}_${'Y'.repeat(120)}`),
        meterStatus: {
          schemaVersion: 'stephanos.sovereign-meter-status.v1',
          ok: true,
          capturedAtUtc: '2026-10-02T18:00:00.000Z',
          meters,
          readOnly: true,
          arbitraryShellAllowed: false,
          secretMaterialIncluded: false,
          unknownMeansGreen: false,
          finalVerdict: 'SOVEREIGN_METER_STATUS_RED_PRESENT',
        },
      },
    },
  };

  const serialized = serializeBoundedReceiptJson(receipt, 9 * 1024);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 9 * 1024);
  const projected = JSON.parse(serialized);
  assert.equal(projected.requestId, receipt.requestId);
  assert.equal(projected.expectedHead, head);
  assert.equal(projected.processSourceHead, head);
  assert.equal(projected.result.result.remoteAction, 'meter-status');
  assert.equal(projected.result.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_ACTION_COMPLETE');
  assert.equal(projected.result.result.githubProjectionTruncated, true);
  assert.equal(projected.githubProjectionTruncated, true);
  assert.ok(projected.result.result.meterStatus);
  assert.ok(projected.result.result.meterStatus.metersPublished <= 24);
  assert.equal(projected.result.result.meterStatus.secretMaterialIncluded, false);
  assert.doesNotMatch(serialized, /codexLastMessage|SAFE_STATUS|SAFE_ACTION/);
});

test('Sovereign Commander watchdog diagnosis is projected without stderr or path-shaped data', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'sovereign-watchdog-diagnostic-0001',
    operation: 'INSTALL_AND_PROVE_SOVEREIGN_COMMANDER',
    state: 'BLOCKED',
    expectedHead: 'a'.repeat(40),
    result: {
      ok: false,
      verdict: 'BLOCKED',
      blocker: 'SOVEREIGN_COMMANDER_WATCHDOG_START_FAILED',
      watchdogBlocker: 'SOVEREIGN_COMMANDER_NOT_HEALTHY',
      watchdogHealthy: false,
      watchdogStartRequested: true,
      watchdogAfterProcessCount: 1,
      watchdogStatus: 2,
      taskAlreadyInstalled: true,
      installerRun: false,
      watchdogStderr: 'secret path C:\\Users\\Operator\\token.txt',
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.sovereignWatchdogBlocker, 'SOVEREIGN_COMMANDER_NOT_HEALTHY');
  assert.equal(projected.operationResult.sovereignWatchdogHealthy, false);
  assert.equal(projected.operationResult.sovereignWatchdogStartRequested, true);
  assert.equal(projected.operationResult.sovereignWatchdogAfterProcessCount, 1);
  assert.equal(projected.operationResult.sovereignWatchdogStatus, 2);
  assert.equal(projected.operationResult.sovereignTaskAlreadyInstalled, true);
  assert.equal(projected.operationResult.sovereignInstallerRun, false);

  const compact = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(compact.result.result.sovereignWatchdogBlocker, 'SOVEREIGN_COMMANDER_NOT_HEALTHY');
  assert.equal(compact.result.result.sovereignWatchdogAfterProcessCount, 1);
  assert.equal(compact.result.result.sovereignWatchdogStatus, 2);

  const unknownStatusReceipt = {
    ...receipt,
    result: {
      ...receipt.result,
      watchdogStatus: null,
    },
  };
  const unknownProjected = createSanitizedMailboxReceiptProjection(unknownStatusReceipt);
  const unknownCompact = JSON.parse(serializeBoundedReceiptJson(unknownStatusReceipt));
  assert.equal(unknownProjected.operationResult.sovereignWatchdogStatus, null);
  assert.equal(unknownCompact.result.result.sovereignWatchdogStatus, null);

  const json = JSON.stringify(compact);
  assert.doesNotMatch(json, /watchdogStderr|C:\\Users|token\.txt/i);
});


test('Sovereign Commander installer failure is classified without exposing stderr', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'sovereign-installer-diagnostic-0001',
    operation: 'INSTALL_AND_PROVE_SOVEREIGN_COMMANDER',
    state: 'BLOCKED',
    expectedHead: 'a'.repeat(40),
    result: {
      ok: false,
      verdict: 'BLOCKED',
      blocker: 'SOVEREIGN_COMMANDER_INSTALL_FAILED',
      status: 1,
      stderr: 'Register-ScheduledTask : Access is denied at C:\\Users\\Operator\\secret-path',
      taskAlreadyInstalled: true,
      installerRun: true,
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.sovereignInstallStatus, 1);
  assert.equal(projected.operationResult.sovereignInstallFailureClass, 'ACCESS_DENIED');

  const compact = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.equal(compact.result.result.sovereignInstallStatus, 1);
  assert.equal(compact.result.result.sovereignInstallFailureClass, 'ACCESS_DENIED');
  const json = JSON.stringify(compact);
  assert.doesNotMatch(json, /Register-ScheduledTask|C:\\Users|secret-path|stderr/i);
});


test('Sovereign remote plan receipts preserve bounded ordered proof without raw output', () => {
  const head = 'a'.repeat(40);
  const remotePlan = ['battle-bridge-status', 'repair-control-plane', 'ignite-stephanos'];
  const completedSteps = remotePlan.map((remoteAction, stepIndex) => ({
    stepIndex,
    remoteAction,
    proofHash: String(stepIndex + 1).repeat(64),
    processId: remoteAction,
    status: 0,
    errorCode: '',
    stdout: 'PRIVATE RAW OUTPUT MUST NOT ESCAPE',
  }));
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'sovereign-remote-plan-1001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    state: 'DONE',
    expectedHead: head,
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'sovereign-remote-plan-1001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE',
        sourceHead: head,
        remotePlan,
        stepCount: remotePlan.length,
        completedSteps,
        planProofHash: 'f'.repeat(64),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
        contentText: 'C:\\Users\\Operator\\secret.txt',
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.deepEqual(projected.operationResult.remotePlan, remotePlan);
  assert.equal(projected.operationResult.stepCount, 3);
  assert.equal(projected.operationResult.completedSteps.length, 3);
  assert.equal(projected.operationResult.completedSteps[1].remoteAction, 'repair-control-plane');
  assert.equal(projected.operationResult.completedSteps[1].status, 0);
  assert.equal(projected.operationResult.planProofHash, 'f'.repeat(64));
  assert.equal(projected.operationResult.publicReceiptSafe, true);
  assert.equal(projected.operationResult.secretMaterialReturned, false);

  const serialized = serializeBoundedReceiptJson(receipt);
  const compact = JSON.parse(serialized).result.result;
  assert.deepEqual(compact.remotePlan, remotePlan);
  assert.equal(compact.stepCount, 3);
  assert.equal(compact.completedSteps.length, 3);
  assert.equal(compact.planProofHash, 'f'.repeat(64));
  assert.doesNotMatch(serialized, /PRIVATE RAW OUTPUT|C:\\Users|secret\.txt/i);
});


test('public mailbox receipt preserves only bounded Battle Bridge observation facts', () => {
  const head = 'a'.repeat(40);
  const observation = {
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T10:55:00.000Z',
    hostRole: 'battle-bridge',
    uptimeSeconds: 12345,
    memory: { totalBytes: 68719476736, freeBytes: 25769803776, usedBytes: 42949672960 },
    gpu: {
      available: true,
      name: 'NVIDIA GeForce RTX 5090',
      memoryTotalMiB: 32768,
      memoryUsedMiB: 8192,
      memoryFreeMiB: 24576,
      utilizationGpuPercent: 17,
    },
    ollama: {
      reachable: true,
      installedModels: [{
        name: 'qwen3.5:27b',
        sizeBytes: 17000000000,
        parameterSize: '27.8B',
        quantizationLevel: 'Q4_K_M',
        family: 'qwen3',
        privatePath: 'C:\\private\\models',
      }],
      loadedModels: [{
        name: 'qwen:14b',
        sizeBytes: 8200000000,
        sizeVramBytes: 7900000000,
        contextLength: 32768,
      }],
    },
    services: {
      ui: { reachable: true, ready: true, httpStatus: 200 },
      backend: { reachable: true, ready: true, httpStatus: 200 },
      openclaw: { reachable: true, ready: true, httpStatus: 200 },
      'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
      ollama: { reachable: true, ready: true, httpStatus: 200 },
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
    bearerToken: 'MUST_NOT_ESCAPE',
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'battle-bridge-observe-proof-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    state: 'DONE',
    acceptedAt: '2026-10-02T10:54:00.000Z',
    heartbeatAt: '2026-10-02T10:55:00.000Z',
    completedAt: '2026-10-02T10:55:00.000Z',
    expectedHead: head,
    processSourceHead: head,
    proofRefs: [],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'battle-bridge-observe-proof-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
        remoteAction: 'battle-bridge-observe',
        sourceHead: head,
        proofHash: 'b'.repeat(64),
        processId: 'battle-bridge-observe',
        status: 0,
        observation,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = JSON.parse(serializeBoundedReceiptJson(receipt));
  const remote = projected.result.result;
  assert.equal(remote.remoteAction, 'battle-bridge-observe');
  assert.equal(remote.observation.schemaVersion, 'stephanos.battle-bridge-observation.v1');
  assert.equal(remote.observation.gpu.name, 'NVIDIA GeForce RTX 5090');
  assert.equal(remote.observation.ollama.installedModels[0].name, 'qwen3.5:27b');
  assert.equal(remote.observation.ollama.loadedModels[0].contextLength, 32768);
  assert.equal(remote.observation.services['sovereign-commander'].ready, true);
  assert.equal(remote.observation.ok, true);

  const deferredProjection = JSON.parse(serializeBoundedReceiptJson(projected));
  assert.equal(deferredProjection.result.result.observation.ok, true);
  assert.equal(deferredProjection.result.result.observation.schemaVersion, 'stephanos.battle-bridge-observation.v1');
  assert.equal(deferredProjection.result.result.observation.gpu.name, 'NVIDIA GeForce RTX 5090');

  const encoded = JSON.stringify(deferredProjection);
  assert.doesNotMatch(encoded, /MUST_NOT_ESCAPE|private\\\\models|bearerToken/);
});


test('core status projection strips private fields while preserving bounded health', () => {
  const head = 'c'.repeat(40);
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'core-health-projection-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    state: 'DONE',
    acceptedAt: '2026-10-02T11:00:00.000Z',
    heartbeatAt: '2026-10-02T11:00:01.000Z',
    completedAt: '2026-10-02T11:00:01.000Z',
    expectedHead: head,
    processSourceHead: head,
    proofRefs: [],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'core-health-projection-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
        remoteAction: 'status-stephanos-core-daemon',
        sourceHead: head,
        proofHash: 'd'.repeat(64),
        processId: 'status-stephanos-core-daemon',
        status: 0,
        coreDaemonStatus: {
          available: true,
          daemonHealthy: true,
          readiness: 'READY',
          sourceHead: head,
          heartbeatAgeSeconds: 12,
          sovereignCommanderHealthy: true,
          backendHealthy: true,
          missionWorkerHealthy: true,
          gamingActive: false,
          uiRequired: false,
          sourceMutationAllowed: false,
          schedulerAuthority: false,
          mergeAuthority: false,
          vendorMeterRequired: false,
          remoteCommanderRequired: false,
          rawStdout: 'must-not-survive',
          localPath: 'C:\\secret',
        },
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };
  const projected = JSON.parse(serializeBoundedReceiptJson(receipt));
  const status = projected.result.result.coreDaemonStatus;
  assert.equal(status.daemonHealthy, true);
  assert.equal(status.readiness, 'READY');
  assert.equal(status.sourceHead, head);
  assert.equal(status.remoteCommanderRequired, false);
  assert.equal(Object.hasOwn(status, 'rawStdout'), false);
  assert.equal(Object.hasOwn(status, 'localPath'), false);
});

test('mailbox receipt preserves bounded meter glass and strips private meter data', () => {
  const head = 'a'.repeat(40);
  const meterStatus = {
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T12:32:00.000Z',
    counts: { total: 3, green: 1, amber: 1, red: 0, grey: 1 },
    meters: [
      {
        meterId: 'github-core',
        provider: 'github',
        source: 'github-rate-limit-api',
        observationState: 'CURRENT',
        trafficLight: 'GREEN',
        remainingPercent: 82,
        availability: 'AVAILABLE',
        truthState: 'CURRENT',
        observedAtUtc: '2026-10-02T12:32:00.000Z',
        ageSeconds: 0,
        naturalResetAtUtc: '2026-10-02T13:00:00.000Z',
        meterTruthUsable: true,
        observableBySovereign: true,
        limit: 5000,
        remaining: 4100,
        privatePath: 'C:\\secret\\meter.json',
      },
      {
        meterId: 'codex-capacity',
        provider: 'codex',
        source: 'shared-workspace',
        observationState: 'STALE',
        trafficLight: 'AMBER',
        remainingPercent: 60,
        availability: 'AVAILABLE',
        truthState: 'CURRENT',
        observedAtUtc: '2026-10-02T11:00:00.000Z',
        ageSeconds: 5520,
        naturalResetAtUtc: '',
        meterTruthUsable: true,
        observableBySovereign: true,
      },
      {
        meterId: 'remote-desktop-commander',
        provider: 'desktop-commander',
        source: 'external-observation-required',
        observationState: 'UNKNOWN',
        trafficLight: 'GREY',
        remainingPercent: null,
        availability: 'UNKNOWN',
        truthState: 'UNKNOWN',
        observedAtUtc: '',
        ageSeconds: null,
        naturalResetAtUtc: '',
        meterTruthUsable: false,
        observableBySovereign: false,
        blocker: 'EXTERNAL_CONNECTOR_METER_NOT_PUBLISHED',
        token: 'MUST_NOT_SURVIVE',
      },
    ],
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_METER_STATUS_AMBER_PRESENT',
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'meter-glass-readback-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'meter-glass-readback-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_COMPLETE',
        remoteAction: 'meter-status',
        sourceHead: head,
        proofHash: 'b'.repeat(64),
        meterStatus,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.meterStatus.counts.total, 3);
  assert.equal(projected.operationResult.meterStatus.counts.green, 1);
  assert.equal(projected.operationResult.meterStatus.counts.amber, 1);
  assert.equal(projected.operationResult.meterStatus.counts.grey, 1);
  assert.equal(projected.operationResult.meterStatus.meters[0].meterId, 'github-core');
  assert.equal(projected.operationResult.meterStatus.meters[0].remainingPercent, 82);
  assert.equal(projected.operationResult.meterStatus.meters[2].trafficLight, 'GREY');
  assert.doesNotMatch(JSON.stringify(projected), /MUST_NOT_SURVIVE|privatePath|secret\\\\meter/);

  const once = JSON.parse(serializeBoundedReceiptJson(receipt));
  const twice = createSanitizedMailboxReceiptProjection(once);
  assert.deepEqual(twice.operationResult.meterStatus, projected.operationResult.meterStatus);
});

test('mailbox receipt preserves controller lane glass and strips private controller data', () => {
  const head = 'a'.repeat(40);
  const controllerLaneStatus = {
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc: '2026-10-02T14:30:00.000Z',
    physical: {
      expected: 5,
      building: 4,
      amber: 1,
      red: 0,
      unknown: 0,
      allCurrent: true,
      allObservedEnabled: true,
      finalVerdict: 'CONTROLLER_FLEET_ENABLED_BUT_NOT_ALL_BUILDING',
      controllers: [{
        controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
        title: 'Stephanos Autonomous Goal Builder',
        freshness: 'CURRENT',
        activityState: 'BUILDING',
        trafficLight: 'GREEN',
        materialLaneCount: 7,
        activeLaneCount: 7,
        parkedLaneCount: 0,
        safeEligibleWorkRemaining: 0,
        blocker: '',
        privatePath: 'C:\\secret\\controller.json',
      }],
    },
    logical: {
      current: true,
      valid: true,
      observedAtUtc: '2026-10-02T14:29:00.000Z',
      physicalControllerCount: 5,
      total: 40,
      active: 11,
      tracking: 21,
      parked: 8,
      retired: 0,
      selectedForAdmission: 7,
      finalVerdict: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY',
      hostLoads: [{
        controllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
        title: 'Stephanos Autonomous Goal Builder',
        logicalControllerCount: 8,
        activeCount: 3,
        trackingCount: 4,
        parkedCount: 1,
      }],
    },
    lanes: {
      targetMaterialLanes: 15,
      activeMaterialLaneCount: 7,
      activeLaneClaimCount: 7,
      reportedMaterialLaneCountSum: 12,
      occupancyPercent: 46.67,
      freeTargetLaneSlots: 8,
      runnableBacklogCount: 8,
      parkedPhysicalLaneCount: 1,
      reportedSafeEligibleWorkMax: 8,
      reportedSafeEligibleWorkSum: 8,
      refillHealth: 'AMBER',
      refillState: 'SAFE_WORK_WAITING_WITH_TARGET_CAPACITY_FREE',
    },
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
    token: 'MUST_NOT_SURVIVE',
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'controller-lane-glass-readback-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'controller-lane-glass-readback-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_COMPLETE',
        remoteAction: 'controller-lane-status',
        sourceHead: head,
        proofHash: 'c'.repeat(64),
        controllerLaneStatus,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.controllerLaneStatus.physical.building, 4);
  assert.equal(projected.operationResult.controllerLaneStatus.logical.total, 40);
  assert.equal(projected.operationResult.controllerLaneStatus.lanes.targetMaterialLanes, 15);
  assert.equal(projected.operationResult.controllerLaneStatus.lanes.activeMaterialLaneCount, 7);
  assert.equal(projected.operationResult.controllerLaneStatus.lanes.freeTargetLaneSlots, 8);
  assert.equal(projected.operationResult.controllerLaneStatus.lanes.runnableBacklogCount, 8);
  assert.equal(projected.operationResult.controllerLaneStatus.lanes.refillHealth, 'AMBER');
  assert.doesNotMatch(JSON.stringify(projected), /MUST_NOT_SURVIVE|privatePath|secret\\\\controller/);

  const once = JSON.parse(serializeBoundedReceiptJson(receipt));
  const twice = createSanitizedMailboxReceiptProjection(once);
  assert.deepEqual(twice.operationResult.controllerLaneStatus, projected.operationResult.controllerLaneStatus);
});


test('mailbox receipt preserves bounded VR acceptance verdict without raw output', () => {
  const head = 'a'.repeat(40);
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'vr-acceptance-public-proof-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    processSourceHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'vr-acceptance-public-proof-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_COMPLETE',
        expectedHead: head,
        sourceHead: head,
        expectedHeadMatch: true,
        remoteAction: 'vr-virtual-airlink-acceptance',
        proofHash: 'b'.repeat(64),
        processId: 'vr-virtual-airlink-acceptance',
        status: 2,
        acceptancePassed: false,
        acceptance: {
          ok: false,
          finalVerdict: 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED',
          blocker: 'VR_ACCEPTANCE_LOCAL_MODEL_RESPAWNED',
          virtualAirLinkTestUsed: true,
          virtualAirLinkRestoredOff: true,
          launchAllowed: false,
          realHeadsetProofClaimed: false,
          loadedModelsBefore: ['qwen:14b'],
          heavyModelsBefore: ['qwen:14b'],
          heavyModelSamplesDuringGuard: ['qwen:14b'],
          loadedModelsAfterGuard: ['qwen:14b'],
          heavyModelsAfterGuard: ['qwen:14b'],
          vramReleasedMiB: 0,
          observationSeconds: 12,
          rawStdout: 'must-not-survive',
          localPath: 'C:\\secret\\vr.json',
        },
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.deepEqual(projected.operationResult.vrAcceptance, {
    acceptancePassed: false,
    ok: false,
    finalVerdict: 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED',
    blocker: 'VR_ACCEPTANCE_LOCAL_MODEL_RESPAWNED',
    virtualAirLinkTestUsed: true,
    virtualAirLinkRestoredOff: true,
    launchAllowed: false,
    realHeadsetProofClaimed: false,
    loadedModelsBefore: ['qwen:14b'],
    heavyModelsBefore: ['qwen:14b'],
    heavyModelSamplesDuringGuard: ['qwen:14b'],
    loadedModelsAfterGuard: ['qwen:14b'],
    heavyModelsAfterGuard: ['qwen:14b'],
    vramReleasedMiB: 0,
    observationSeconds: 12,
  });
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.deepEqual(serialized.result.result.vrAcceptance, projected.operationResult.vrAcceptance);
  assert.doesNotMatch(JSON.stringify(serialized), /must-not-survive|secret\\\\vr\.json|rawStdout|localPath/);
});

test('mailbox receipt preserves bounded Starfield VR preflight proof without raw output', () => {
  const head = 'b'.repeat(40);
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'starfield-vr-preflight-public-proof-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    processSourceHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'starfield-vr-preflight-public-proof-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_PREFLIGHT_COMPLETE',
        expectedHead: head,
        sourceHead: head,
        expectedHeadMatch: true,
        remoteAction: 'starfield-vr-resource-preflight',
        proofHash: 'c'.repeat(64),
        processId: 'starfield-vr-resource-preflight',
        status: 1,
        preflightPassed: false,
        preflight: {
          ok: false,
          finalVerdict: 'STARFIELD_VR_RESOURCE_PREFLIGHT_FAILED',
          blocker: 'STARFIELD_VR_RESOURCE_PREFLIGHT_STRICTMODE_PROPERTY',
          status: 1,
          phase: '',
          active: false,
          reason: '',
          profileName: '',
          profileProcessName: '',
          parkAllModels: false,
          localModelAllowed: null,
          zeroLocalModelInvariant: false,
          evictionHealthy: false,
          loadedModelsBefore: [],
          loadedModelsAfter: [],
          reappearanceDetected: false,
          reappearanceCount: 0,
          diagnostic: 'The property cannot be found on this object. %USERPROFILE%',
          rawStdout: 'must-not-survive',
          localPath: 'C:\\secret\\vr-state.json',
        },
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.deepEqual(projected.operationResult.starfieldVrPreflight, {
    preflightPassed: false,
    ok: false,
    finalVerdict: 'STARFIELD_VR_RESOURCE_PREFLIGHT_FAILED',
    blocker: 'STARFIELD_VR_RESOURCE_PREFLIGHT_STRICTMODE_PROPERTY',
    status: 1,
    phase: '',
    active: false,
    reason: '',
    profileName: '',
    profileProcessName: '',
    parkAllModels: false,
    localModelAllowed: null,
    zeroLocalModelInvariant: false,
    evictionHealthy: false,
    loadedModelsBefore: [],
    loadedModelsAfter: [],
    reappearanceDetected: false,
    reappearanceCount: 0,
    diagnostic: 'The property cannot be found on this object. %USERPROFILE%',
  });
  const serialized = JSON.parse(serializeBoundedReceiptJson(receipt));
  assert.deepEqual(serialized.result.result.starfieldVrPreflight, projected.operationResult.starfieldVrPreflight);
  assert.doesNotMatch(JSON.stringify(serialized), /must-not-survive|secret\\\\vr-state\.json|rawStdout|localPath/);
});


test('fast mailbox receipt preserves bounded Starfield VR telemetry headline without raw host data', () => {
  const head = 'f'.repeat(40);
  const telemetry = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-03T17:35:00.000Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
    sessionId: 'starfield-vr-performance-20261003-183500-001',
    degraded: true,
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: false,
    sharedWorkspacePublished: false,
    headline: {
      focus: 'PERFORMANCE_IMPROVED',
      provider: 'mutar-openxr',
      providerIdentityStatus: 'VERIFIED_PROVIDER',
      launchSessionId: 'launch-20261003-1',
      sourceHead: head,
      telemetrySessionId: 'starfield-vr-performance-20261003-183500-001',
      signals: ['frame-rate-improved'],
      sessionOutcome: 'COMPLETED',
      partialTelemetry: false,
      crashEvidenceCount: 0,
      sampleCount: 144,
      avgGpuUtilPct: 82.4,
      maxGpuUtilPct: 99,
      maxGpuMemoryPct: 74.2,
      avgStarfieldCpuPct: 31.5,
      avgSystemCpuPct: 48.1,
      maxLlamaServerCount: 0,
      airLinkRuntimeSamplePct: 100,
      minGameDriveFreeGiB: 205.7,
      minGameDriveFreePct: 11,
      avgGameDriveActivePct: 3.2,
      maxGameDriveLatencyMs: 1.8,
      maxGameDriveQueueLength: 1,
      maxPagesPerSec: 14,
      storageTelemetryAvailable: true,
      topRecommendation: 'Keep the current VR resource policy for the next controlled playtest',
      topRecommendationSource: 'Starfield VR performance loop',
      projectLoopState: 'READY',
      projectTelemetryGapCount: 1,
      projectNextExperiment: 'Repeat the same scene and compare frame pacing',
    },
    history: {
      sessionCount: 31,
      newestSessionId: 'starfield-vr-performance-20261003-183500-001',
    },
    publication: { packet: true, history: true, loop: false, event: true },
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'starfield-vr-telemetry-readback-test-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    expectedHead: head,
    processSourceHead: head,
    state: 'DONE',
    acceptedAt: '2026-10-03T17:35:00.000Z',
    heartbeatAt: '2026-10-03T17:35:02.000Z',
    completedAt: '2026-10-03T17:35:02.000Z',
    blocker: '',
    proofRefs: ['receipts/github-command-mailbox/starfield-vr-telemetry-readback-test-001.json'],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'starfield-vr-telemetry-readback-test-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED',
        remoteAction: 'starfield-vr-telemetry-refresh',
        sourceHead: head,
        proofHash: 'a'.repeat(64),
        processId: 'starfield-vr-telemetry-refresh',
        status: 0,
        telemetry,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.starfieldVrTelemetry.sessionId, telemetry.sessionId);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.provider, 'mutar-openxr');
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxGpuMemoryPct, 74.2);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxLlamaServerCount, 0);
  assert.equal(projected.operationResult.starfieldVrTelemetry.publication.packet, true);
  assert.equal(projected.operationResult.starfieldVrTelemetry.publication.loop, false);

  const serialized = serializeBoundedReceiptJson(receipt);
  assert.match(serialized, /starfieldVrTelemetry/);
  assert.match(serialized, /frame-rate-improved/);
  assert.match(serialized, /82\.4/);
  assert.doesNotMatch(serialized, /C:\\\\Users\\\\/i);
  assert.doesNotMatch(serialized, /PRIVATE RAW TELEMETRY/i);
});


test('fast mailbox finds Starfield VR telemetry inside nested remote-action result envelope', () => {
  const head = '9'.repeat(40);
  const telemetry = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-03T17:46:51.000Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
    sessionId: 'starfield-vr-performance-live-test',
    degraded: true,
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: false,
    sharedWorkspacePublished: false,
    headline: {
      provider: 'mutar-openxr',
      providerIdentityStatus: 'VERIFIED_PROVIDER',
      sourceHead: head,
      telemetrySessionId: 'starfield-vr-performance-live-test',
      signals: ['frame-rate-improved'],
      sessionOutcome: 'COMPLETED',
      sampleCount: 42,
      maxLlamaServerCount: 0,
    },
    history: { sessionCount: 2, newestSessionId: 'starfield-vr-performance-live-test' },
    publication: { packet: true, history: true, loop: false, event: true },
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'nested-starfield-vr-telemetry-test',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED',
        remoteAction: 'starfield-vr-telemetry-refresh',
        sourceHead: head,
        proofHash: '8'.repeat(64),
        processId: 'starfield-vr-telemetry-refresh',
        status: 0,
        result: { telemetry },
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.starfieldVrTelemetry.sessionId, telemetry.sessionId);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.provider, 'mutar-openxr');
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.sampleCount, 42);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxLlamaServerCount, 0);
  assert.deepEqual(projected.operationResult.starfieldVrTelemetry.headline.signals, ['frame-rate-improved']);
});


test('fast mailbox schema-search finds Starfield VR telemetry through bounded receipt wrapper graph', () => {
  const head = '7'.repeat(40);
  const telemetry = {
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: true,
    generatedAtUtc: '2026-10-03T17:51:35.000Z',
    finalVerdict: 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED',
    sessionId: 'starfield-vr-performance-schema-search-live',
    degraded: true,
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: false,
    sharedWorkspacePublished: false,
    headline: {
      provider: 'mutar-openxr',
      providerIdentityStatus: 'VERIFIED_PROVIDER',
      sourceHead: head,
      telemetrySessionId: 'starfield-vr-performance-schema-search-live',
      signals: ['frame-rate-improved'],
      sessionOutcome: 'COMPLETED',
      sampleCount: 77,
      maxGpuMemoryPct: 68.5,
      maxLlamaServerCount: 0,
      frameTimeTelemetryAvailable: true,
      avgApplicationFrameTimeMs: 11.2,
      p95ApplicationFrameTimeMs: 13.4,
      p99ApplicationFrameTimeMs: 18.1,
      avgDeliveredCadenceHz: 89.5,
      headsetRefreshRateHz: 90,
      maxEyePresentationSkewMs: 2.3,
      maxPoseAgeMs: 7.1,
      avgNetworkLatencyMs: 4.2,
      maxPacketLossPct: 0.1,
      maxJitterMs: 1.2,
      maxControllerProblemCount: 0,
      adaptiveCaptureSampleCount: 6,
    },
    history: { sessionCount: 3, newestSessionId: 'starfield-vr-performance-schema-search-live' },
    publication: { packet: true, history: true, loop: false, event: true },
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  };
  const wrapped = { result: { structuredContent: { result: { result: { telemetry } } } } };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'schema-search-starfield-vr-telemetry-test',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    branch: 'main',
    expectedHead: head,
    state: 'DONE',
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED',
        remoteAction: 'starfield-vr-telemetry-refresh',
        sourceHead: head,
        proofHash: '6'.repeat(64),
        processId: 'starfield-vr-telemetry-refresh',
        status: 0,
        result: wrapped,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.starfieldVrTelemetry.sessionId, telemetry.sessionId);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.sampleCount, 77);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxGpuMemoryPct, 68.5);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.frameTimeTelemetryAvailable, true);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.avgApplicationFrameTimeMs, 11.2);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.p95ApplicationFrameTimeMs, 13.4);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.avgDeliveredCadenceHz, 89.5);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.headsetRefreshRateHz, 90);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxEyePresentationSkewMs, 2.3);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxPoseAgeMs, 7.1);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.avgNetworkLatencyMs, 4.2);
  assert.equal(projected.operationResult.starfieldVrTelemetry.headline.maxPacketLossPct, 0.1);

  const serialized = serializeBoundedReceiptJson(receipt);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.result.result.starfieldVrTelemetry.sessionId, telemetry.sessionId);
  assert.equal(parsed.result.result.starfieldVrTelemetry.headline.provider, 'mutar-openxr');
  assert.equal(parsed.result.result.starfieldVrTelemetry.rawTelemetryReturned, false);
  assert.equal(parsed.result.result.starfieldVrTelemetry.hostPathsReturned, false);
});

test('mailbox receipt preserves Sovereign visibility headline and strips private fields', () => {
  const head = 'f'.repeat(40);
  const visibilitySnapshot = {
    schemaVersion: 'stephanos.sovereign-visibility-snapshot.v1',
    ok: true,
    capturedAtUtc: '2026-10-04T12:00:00.000Z',
    repository: { available: true, head, branch: 'main', dirty: false, changedEntryCount: 0, trackedChangeCount: 0, untrackedCount: 0, remoteMainAvailable: true, remoteMainHead: head, rawPathsReturned: false, localPath: 'C:\\secret' },
    observation: {
      schemaVersion: 'stephanos.battle-bridge-observation.v1',
      ok: true,
      capturedAtUtc: '2026-10-04T12:00:00.000Z',
      hostRole: 'battle-bridge',
      uptimeSeconds: 1,
      memory: { totalBytes: 1, freeBytes: 1, usedBytes: 0 },
      gpu: { available: false, name: '', memoryTotalMiB: null, memoryUsedMiB: null, memoryFreeMiB: null, utilizationGpuPercent: null },
      ollama: { reachable: false, installedModelCount: 0, loadedModelCount: 0, installedModels: [], loadedModels: [] },
      services: {
        ui: { reachable: true, ready: true, httpStatus: 200 },
        backend: { reachable: true, ready: true, httpStatus: 200 },
        openclaw: { reachable: true, ready: true, httpStatus: 200 },
        'sovereign-commander': { reachable: true, ready: true, httpStatus: 200 },
        ollama: { reachable: false, ready: false, httpStatus: 0 },
      },
      readOnly: true,
      arbitraryShellAllowed: false,
      secretMaterialIncluded: false,
      finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
    },
    core: { available: true, ok: true, processCount: 1, daemonHealthy: true, readiness: 'READY', wakeState: 'AWAKE', awake: true, repairRequired: false, repairReason: '', controlPlaneFinalVerdict: 'STEPHANOS_CONTROL_PLANE_AWAKE', sourceHead: head, heartbeatAgeSeconds: 3, sovereignCommanderHealthy: true, backendHealthy: true, missionWorkerHealthy: true, gamingActive: false },
    headSync: {
      schemaVersion: 'stephanos.sovereign-head-sync.v1',
      canonicalMainHead: head,
      repositoryHead: head,
      runtimeHead: head,
      remoteMainAvailable: true,
      repositoryMatchesMain: true,
      runtimeMatchesRepository: true,
      runtimeMatchesMain: true,
      exactHeadChainProven: true,
      mainChangedSinceRepository: false,
      mainChangedSinceRuntime: false,
      syncState: 'CURRENT',
      trafficLight: 'GREEN',
      exactNextAction: 'NONE',
      readOnly: true,
      sourceMutationAllowed: false,
      unknownMeansGreen: false,
      finalVerdict: 'SOVEREIGN_HEAD_SYNC_CURRENT',
      privateHeadSync: 'MUST_NOT_ESCAPE',
    },
    selfHeal: { available: true, dependencySelfHealEnabled: true, dependencySelfHealLastAttemptAtUtc: '2026-10-04T11:59:00.000Z', dependencySelfHealAttemptCount: 3, dependencySelfHealLastVerdict: 'CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED', dependencySelfHealLastBlocker: '', dependencySelfHealProofHashes: ['1'.repeat(64)], octopusSelfHealEnabled: true, octopusSelfHealLastAttemptAtUtc: '', octopusSelfHealAttemptCount: 0, octopusSelfHealLastVerdict: '', octopusSelfHealLastBlocker: '', octopusSelfHealLastProofHash: '', flywheelCycleRunning: false, flywheelLastCycleFinishedAtUtc: '', flywheelLastStatus: 'READY', flywheelLastAction: 'REFILL', flywheelLastBlockerCount: 0, secret: 'MUST_NOT_ESCAPE' },
    controllers: {
      schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
      ok: true,
      capturedAtUtc: '2026-10-04T12:00:00.000Z',
      physical: { expected: 5, building: 5, amber: 0, red: 0, unknown: 0, allCurrent: true, allObservedEnabled: true, finalVerdict: 'READY', controllers: [] },
      logical: { current: true, valid: true, observedAtUtc: '2026-10-04T12:00:00.000Z', physicalControllerCount: 5, total: 5, active: 5, tracking: 0, parked: 0, retired: 0, selectedForAdmission: 5, finalVerdict: 'READY', hostLoads: [] },
      lanes: { targetMaterialLanes: 15, activeMaterialLaneCount: 15, activeLaneClaimCount: 15, reportedMaterialLaneCountSum: 15, occupancyPercent: 100, freeTargetLaneSlots: 0, runnableBacklogCount: 0, parkedPhysicalLaneCount: 0, reportedSafeEligibleWorkMax: 0, reportedSafeEligibleWorkSum: 0, refillHealth: 'GREEN', refillState: 'TARGET_MATERIAL_LANES_FILLED' },
      readOnly: true,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      secretMaterialIncluded: false,
      unknownMeansGreen: false,
      finalVerdict: 'SOVEREIGN_CONTROLLER_LANE_STATUS_READY',
    },
    meters: { schemaVersion: 'stephanos.sovereign-meter-status.v1', ok: true, capturedAtUtc: '2026-10-04T12:00:00.000Z', counts: { total: 0, green: 0, amber: 0, red: 0, grey: 0 }, attentionMeters: [], attentionMetersTruncated: false, readOnly: true, arbitraryShellAllowed: false, secretMaterialIncluded: false, unknownMeansGreen: false, finalVerdict: 'SOVEREIGN_METER_STATUS_READY' },
    relay: { available: true, daemonHealthy: true, carrierHealthy: true, deliveryState: 'FAST_ACTIVE', adaptivePollMode: 'HOT', nextPollMs: 2500, heartbeatAtUtc: '2026-10-04T12:00:00.000Z', heartbeatAgeSeconds: 1, carrierConsecutiveFailures: 0, scheduledMailboxFallbackExpected: true, fallbackCovered: false, retryIdentityPreserved: true, blocker: '', finalVerdict: 'SOVEREIGN_RELAY_DAEMON_HEALTHY' },
    health: { repository: 'GREEN', core: 'GREEN', headSync: 'GREEN', services: 'AMBER', laneRefill: 'GREEN', transport: 'GREEN' },
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryProcessInspectionAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    remoteCommanderRequired: false,
    unknownMeansGreen: false,
    finalVerdict: 'SOVEREIGN_VISIBILITY_SNAPSHOT_DEGRADED_OR_INCOMPLETE',
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'visibility-snapshot-public-001',
    operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main',
    state: 'DONE',
    acceptedAt: '2026-10-04T12:00:00.000Z',
    heartbeatAt: '2026-10-04T12:00:01.000Z',
    completedAt: '2026-10-04T12:00:01.000Z',
    expectedHead: head,
    processSourceHead: head,
    proofRefs: [],
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
      requestId: 'visibility-snapshot-public-001',
      result: {
        ok: true,
        finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_COMPLETE',
        remoteAction: 'visibility-snapshot',
        sourceHead: head,
        proofHash: '2'.repeat(64),
        visibilitySnapshot,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      },
    },
  };
  // Use a wider test-only bound to exercise the full sanitised visibility
  // projection. The production 9 KiB path is exercised below and is expected
  // to compact into visibilityHeadline as the snapshot grows.
  const projected = JSON.parse(serializeBoundedReceiptJson(receipt, 16 * 1024));
  const visibility = projected.result.result.visibilitySnapshot;
  assert.equal(visibility.repository.head, head);
  assert.equal(visibility.repository.remoteMainHead, head);
  assert.equal(visibility.headSync.syncState, 'CURRENT');
  assert.equal(visibility.headSync.exactHeadChainProven, true);
  assert.equal(visibility.health.headSync, 'GREEN');
  assert.equal(visibility.core.wakeState, 'AWAKE');
  assert.equal(visibility.core.repairRequired, false);
  assert.equal(visibility.selfHeal.dependencySelfHealAttemptCount, 3);
  assert.equal(visibility.controllers.lanes.activeMaterialLaneCount, 15);
  assert.equal(visibility.relay.deliveryState, 'FAST_ACTIVE');
  assert.equal(visibility.health.services, 'AMBER');

  const oversizedReceipt = JSON.parse(JSON.stringify(receipt));
  oversizedReceipt.result.result.codexLastMessage = 'SAFE_STATUS '.repeat(1800);
  oversizedReceipt.result.result.codexNextOperatorAction = 'SAFE_ACTION '.repeat(600);
  oversizedReceipt.result.result.blockers = Array.from(
    { length: 30 },
    (_, index) => `VISIBILITY_BLOCKER_${index}_${'X'.repeat(120)}`,
  );
  const coreProjected = JSON.parse(serializeBoundedReceiptJson(oversizedReceipt, 9 * 1024));
  assert.equal(coreProjected.githubProjectionTruncated, true);
  const headline = coreProjected.result.result.visibilityHeadline;
  assert.equal(headline.schemaVersion, 'stephanos.sovereign-visibility-headline.v1');
  assert.equal(headline.repository.head, head);
  assert.equal(headline.repository.remoteMainHead, head);
  assert.equal(headline.headSync.syncState, 'CURRENT');
  assert.equal(headline.headSync.canonicalMainHead, head);
  assert.equal(headline.headSync.repositoryHead, head);
  assert.equal(headline.headSync.runtimeHead, head);
  assert.equal(headline.headSync.exactHeadChainProven, true);
  assert.equal(headline.headSync.exactNextAction, 'NONE');
  assert.equal(headline.services.ui.ready, true);
  assert.equal(headline.core.wakeState, 'AWAKE');
  assert.equal(headline.core.heartbeatAgeSeconds, 3);
  assert.equal(headline.core.repairRequired, false);
  assert.equal(headline.selfHeal.dependencySelfHealEnabled, true);
  assert.equal(headline.selfHeal.dependencySelfHealAttemptCount, 3);
  assert.equal(headline.selfHeal.dependencySelfHealLastVerdict, 'CORE_DEPENDENCY_SELF_HEAL_VERIFIED_RECOVERED');
  assert.equal(headline.controllers.lanes.activeMaterialLaneCount, 15);
  assert.equal(headline.controllers.lanes.refillHealth, 'GREEN');
  assert.equal(headline.relay.deliveryState, 'FAST_ACTIVE');
  assert.equal(headline.relay.heartbeatAgeSeconds, 1);
  assert.equal(headline.health.headSync, 'GREEN');
  assert.equal(headline.health.services, 'AMBER');
  assert.equal(headline.remoteCommanderRequired, false);
  assert.equal(headline.unknownMeansGreen, false);
  assert.ok(Buffer.byteLength(JSON.stringify(coreProjected), 'utf8') <= 9 * 1024);
  assert.doesNotMatch(JSON.stringify(coreProjected), /SAFE_STATUS|SAFE_ACTION/);

  const encoded = JSON.stringify(projected);
  assert.doesNotMatch(encoded, /MUST_NOT_ESCAPE|privateHeadSync|C:\\\\secret|localPath|\"secret\":/);
});

test('oversized Programme Authority receipt retains precise HOLD diagnosis while discarding raw lane payload', () => {
  const head = 'a'.repeat(40);
  const packet = {
    programmeStatus: 'HOLD',
    programmeFinalVerdict: 'PROGRAMME_AUTHORITY_HOLD',
    programmeBlockers: [
      'source:NO_EXECUTION_RECEIPTS',
      'controller-heartbeat-invalid-or-missing',
      'private C:\\Users\\Operator\\secret.txt',
    ],
    schedulerFailClosed: true,
    schedulerProgrammeStatus: 'HOLD',
    schedulerDecisionStatus: 'BLOCKED',
    schedulerSelectedIssue: 2956,
    elasticCapacityStatus: 'PAUSED',
    elasticDesiredWidth: 15,
    elasticRemainingAdmissionSlots: 0,
    controllerValid: false,
    controllerFresh: false,
    workerValid: true,
    workerFresh: true,
    criticalBacklogDecision: 'PARKED_BLOCKERS_ONLY',
    sourceReadRepositoryHead: 'CANONICAL_REPOSITORY_HEAD_READ',
    sourceReadControllerHeartbeat: 'CONTROLLER_HEARTBEAT_STALE',
    sourceReadWorkerHeartbeat: 'MISSION_WORKER_HEARTBEAT_CURRENT',
    sourceReadGithubGoalEstate: 'GITHUB_GOAL_ESTATE_FETCHED',
    logicalGoalLanes: Array.from({ length: 59 }, (_, index) => ({
      issueNumber: index + 2500,
      continuityState: 'TRACKING',
      controllerId: 'logical-goal-' + index,
    })),
  };
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'programme-overlarge-diagnostic-001',
    operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 2808,
    branch: 'main', state: 'DONE', expectedHead: head,
    result: {
      ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
      requestId: 'programme-overlarge-diagnostic-001',
      result: {
        ok: true,
        finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
        sourceHead: head,
        programmeAuthorityTelemetry: true,
        programmeAuthority: packet,
        codexLastMessage: 'ignored large raw payload '.repeat(300),
      },
    },
  };
  const maxBytes = 4600;
  const compactJson = serializeBoundedReceiptJson(receipt, maxBytes);
  assert.ok(Buffer.byteLength(compactJson, 'utf8') <= maxBytes);
  const result = JSON.parse(compactJson);
  const summary = result.result.result;
  assert.equal(result.githubProjectionTruncated, true);
  assert.equal(summary.programmeStatus, 'HOLD');
  assert.equal(summary.schedulerFailClosed, true);
  assert.deepEqual(summary.programmeBlockers, [
    'SOURCE:NO_EXECUTION_RECEIPTS', 'CONTROLLER-HEARTBEAT-INVALID-OR-MISSING',
  ]);
  assert.equal(summary.criticalBacklogDecision, 'PARKED_BLOCKERS_ONLY');
  assert.equal(summary.sourceReadRepositoryHead, 'CANONICAL_REPOSITORY_HEAD_READ');
  assert.equal(summary.sourceReadGithubGoalEstate, 'GITHUB_GOAL_ESTATE_FETCHED');
  assert.equal(summary.originalProgrammeLaneListOmitted, true);
  assert.equal(summary.logicalGoalLanes, undefined);
  assert.doesNotMatch(compactJson, /Users|secret\.txt|ignored large raw payload/i);
});

test('double-serialized 32KB Programme Authority HOLD retains original blockers at the real 9KB public limit', () => {
  const sha = 'a'.repeat(40);
  const rawDiagnostic = {
    programmeStatus: 'HOLD',
    programmeFinalVerdict: 'PROGRAMME_AUTHORITY_HOLD',
    programmeBlockers: [
      'source:NO_EXECUTION_RECEIPTS',
      'lane:elastic-mission-phase-binding-unproven',
      'controller-heartbeat-active-lane-mismatch',
    ],
    schedulerFailClosed: true,
    schedulerProgrammeStatus: 'HOLD',
    schedulerDecisionStatus: 'BLOCKED',
    schedulerSelectedIssue: 2956,
    elasticCapacityStatus: 'PAUSED',
    elasticDesiredWidth: 15,
    elasticRemainingAdmissionSlots: 0,
    workerValid: true, workerFresh: true,
    controllerValid: false, controllerFresh: false,
    criticalBacklogDecision: 'PARKED_BLOCKERS_ONLY',
    sourceReadRepositoryHead: 'CANONICAL_REPOSITORY_HEAD_READ',
    sourceReadControllerHeartbeat: 'CONTROLLER_HEARTBEAT_STALE',
    sourceReadWorkerHeartbeat: 'MISSION_WORKER_HEARTBEAT_CURRENT',
    sourceReadGithubGoalEstate: 'GITHUB_GOAL_ESTATE_FETCHED',
    logicalGoalLanes: Array.from({ length: 59 }, (_, index) => ({
      issueNumber: 2600 + index,
      continuityState: 'TRACKING',
      proofRefs: ['private C:\\Users\\operator\\secret.txt'],
      hostControllerTitle: 'canonical goal controller ' + index,
    })),
  };
  const full = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'elastic-authority-double-publication-proof-001',
    operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 2808,
    branch: 'main', state: 'DONE', expectedHead: sha, processSourceHead: sha,
    result: {
      ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'READ_PROGRAMME_AUTHORITY_STATUS',
      requestId: 'elastic-authority-double-publication-proof-001',
      result: {
        ok: true, finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
        sourceHead: sha, programmeAuthorityTelemetry: true,
        programmeAuthority: rawDiagnostic,
      },
    },
  };
  const locallyCheckpointed = JSON.parse(serializeBoundedReceiptJson(full, 256 * 1024));
  assert.equal(locallyCheckpointed.result.result.programmeStatus, 'HOLD');
  assert.equal(locallyCheckpointed.result.result.programmeAuthority, undefined);
  const githubJson = serializeBoundedReceiptJson(locallyCheckpointed);
  assert.ok(Buffer.byteLength(githubJson, 'utf8') <= 9 * 1024);
  const publicReceipt = JSON.parse(githubJson);
  assert.equal(publicReceipt.result.result.programmeStatus, 'HOLD');
  assert.equal(publicReceipt.result.result.programmeFinalVerdict, 'PROGRAMME_AUTHORITY_HOLD');
  assert.deepEqual(publicReceipt.result.result.programmeBlockers, [
    'source:NO_EXECUTION_RECEIPTS',
    'lane:elastic-mission-phase-binding-unproven',
    'controller-heartbeat-active-lane-mismatch',
  ]);
  assert.equal(publicReceipt.result.result.workerFresh, true);
  assert.equal(publicReceipt.result.result.controllerFresh, false);
  assert.equal(publicReceipt.result.result.criticalBacklogDecision, 'PARKED_BLOCKERS_ONLY');
  assert.equal(publicReceipt.result.result.sourceReadGithubGoalEstate, 'GITHUB_GOAL_ESTATE_FETCHED');
  assert.doesNotMatch(githubJson, /operator|secret\.txt|hostControllerTitle/i);
});

test('second-pass Programme Authority packet is never reconstructed from an incomplete success marker', () => {
  const incomplete = {
    operation: 'READ_PROGRAMME_AUTHORITY_STATUS', state: 'DONE',
    requestId: 'elastic-incomplete-authority-proof-001',
    result: { ok: true, result: {
      ok: true, finalVerdict: 'PROGRAMME_AUTHORITY_STATUS_READY',
      programmeStatus: 'HOLD',
      programmeBlockers: ['source:NO_EXECUTION_RECEIPTS'],
      // No repository-head or GitHub-estate source receipts.
    } },
  };
  const projection = JSON.parse(serializeBoundedReceiptJson(incomplete));
  assert.equal(projection.result.result.programmeStatus, undefined);
  assert.equal(projection.result.result.programmeBlockers, undefined);
  assert.equal(projection.result.result.finalVerdict, 'PROGRAMME_AUTHORITY_STATUS_READY');
});
