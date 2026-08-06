import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  createLocalCodexExecIntegration,
  LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
  parseLinuxDispatchLockProcessIdentity,
  readLocalCodexTaskResult,
  readLocalCodexTaskStatus,
  resolveLocalCodexDispatchPaths,
} from './localCodexExecIntegration.mjs';
import {
  buildGuardedCodexPrompt,
  classifyCodexExecution,
  classifyPostTaskDirt,
  compareDirtSnapshots,
  evaluateWorkerSourceSafety,
  parseCodexJsonEvents,
  parseGitStatusPaths,
  materializeExactHeadBuildTree,
  prepareExactHeadRuntimeBundle,
  resolveCodexExecInvocation,
  runBrowserRuntimeExactHeadProof,
  runCodexWorker,
  validateBrowserProofVerdict,
  validateExactHeadAtWorkerStart,
} from '../../scripts/stephanos-codex-dispatch-worker.mjs';
import {
  STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION,
  computeStephanosDistManifestFingerprint,
} from '../../scripts/stephanos-build-utils.mjs';

function tempRoots() {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-codex-dispatch-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  return { root, repoRoot, workspaceRoot };
}

function packet(jobId = 'codex-job-test-123') {
  return {
    jobId,
    issueNumber: 1293,
    branch: 'main',
    prompt: 'Run the bounded real Windows ignition proof and report exact evidence.',
    requestedProofCommands: ['git rev-parse HEAD'],
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1631,
      expectedHead: 'a'.repeat(40),
      proofTarget: 'PULL_REQUEST_HEAD',
      pullRequestHead: '',
      mergeCommitHead: '',
      githubMainHead: '',
      mergeCommitIncluded: false,
      proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
    },
    approvalRequirements: { approvalReceipt: 'operator-approved' },
    mergeAuthority: false,
  };
}

const SOURCE_FINGERPRINT = 'f'.repeat(64);
const DIST_MANIFEST_ENTRIES = Object.freeze([
  Object.freeze({
    path: 'index.html',
    size: 1,
    sha256: '1'.repeat(64),
  }),
]);
const DIST_FINGERPRINT = computeStephanosDistManifestFingerprint(DIST_MANIFEST_ENTRIES);
const DIST_MANIFEST = Object.freeze({
  schemaVersion: STEPHANOS_DIST_MANIFEST_SCHEMA_VERSION,
  fingerprint: DIST_FINGERPRINT,
  fileCount: DIST_MANIFEST_ENTRIES.length,
  totalBytes: 1,
  entries: DIST_MANIFEST_ENTRIES,
});
const DIST_MANIFEST_PATH = 'C:\\proof\\canonical-dist-manifest.json';
const TEST_BOOT_STARTED_AT = '2026-07-30T22:00:00.000Z';
const TEST_BOOT_ID = 'test-boot-generation-0001';
const TEST_PROCESS_START_ID = 'test-process-generation-0001';
const TEST_PROCESS_IDENTITY = Object.freeze({
  state: 'known',
  bootId: TEST_BOOT_ID,
  processStartId: TEST_PROCESS_START_ID,
});
const BROWSER_RUNTIME_PROOF_SCHEMA = 'stephanos.browser-runtime-exact-head-proof.v3';
const MUSIC_RATING_SCENARIO = 'MUSIC_RATING_PRESERVES_PLAYBACK';

function testGitBlobSha(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function musicRatingScenarioEvidence(overrides = {}, sourceHead = 'a'.repeat(40)) {
  return {
    schemaVersion: 'stephanos.browser-scenario-evidence.music-rating-preserves-playback.v2',
    proofScenario: MUSIC_RATING_SCENARIO,
    collector: 'playwright-page-v1',
    observed: true,
    sourceResponseBinding: {
      exact: true,
      blocker: '',
      sourceHead,
      fileCount: 3,
      responseBinding: 'playwright-scenario-source-responses-git-blob-v2',
      paths: [
        'apps/music-tile/index.html',
        'apps/music-tile/main.js',
        'shared/runtime/tileEventBridge.js',
      ],
    },
    ratingInteraction: {
      trackId: 'anyma-pictures-of-you',
      requestedRating: 2,
      persistedRating: 2,
      selectedButtonPressed: true,
      selectedButtonActive: true,
      cardRatingTextUpdated: true,
    },
    listeningDeckIframe: {
      beforePresent: true,
      sameNode: true,
      isConnected: true,
      srcUnchanged: true,
      contentWindowPreserved: true,
      frameIdentityPreserved: true,
      frameNavigationCount: 0,
      frameDetachCount: 0,
      playbackSentinelAdvanced: true,
    },
    discoveryIframe: {
      beforePresent: true,
      sameNode: true,
      isConnected: true,
      srcUnchanged: true,
      contentWindowPreserved: true,
      frameIdentityPreserved: true,
      frameNavigationCount: 0,
      frameDetachCount: 0,
      playbackSentinelAdvanced: true,
    },
    legacyRanking: {
      before: ['Other Artist - Alpha'],
      after: ['Anyma - Pictures Of You'],
      beforeIds: ['other-alpha', 'anyma-pictures-of-you'],
      afterIds: ['anyma-pictures-of-you', 'other-alpha'],
      targetId: 'anyma-pictures-of-you',
      targetLabel: 'Anyma - Pictures Of You',
      beforeIndex: 1,
      afterIndex: 0,
      beforeTargetScore: 0,
      afterTargetScore: 2.5,
      changed: true,
      targetMovedUp: true,
      sameMembers: true,
      legacyDomMatchesStoredBefore: true,
      legacyDomMatchesStoredAfter: true,
      candidateDomMatchesStoredBefore: true,
      candidateDomMatchesStoredAfter: true,
    },
    consoleErrors: [],
    pageErrors: [],
    blockers: [],
    ...overrides,
  };
}

function browserRunnerPayload(expectedHead, {
  proofScenario = '',
  proofTarget = 'PULL_REQUEST_HEAD',
  ...overrides
} = {}) {
  const scenarioRequested = proofScenario === MUSIC_RATING_SCENARIO;
  return {
    schemaVersion: BROWSER_RUNTIME_PROOF_SCHEMA,
    url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    observedUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    accepted: true,
    mergeReady: true,
    blocking: [],
    expectedHead,
    runtimeSourceHead: expectedHead,
    expectedHeadMatch: true,
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    runtimeSourceFingerprint: SOURCE_FINGERPRINT,
    expectedSourceFingerprintMatch: true,
    expectedDistFingerprint: DIST_FINGERPRINT,
    runtimeDistFingerprint: DIST_FINGERPRINT,
    expectedDistFingerprintMatch: true,
    proofScenario,
    proofTarget,
    scenarioEvidenceAccepted: scenarioRequested ? true : null,
    scenarioEvidence: scenarioRequested ? musicRatingScenarioEvidence({}, expectedHead) : null,
    ...overrides,
  };
}

function browserRunnerPayloadForArgs(args, expectedHead, overrides = {}) {
  const scenarioIndex = args.indexOf('--proof-scenario');
  const proofScenario = scenarioIndex >= 0 ? String(args[scenarioIndex + 1] || '') : '';
  const targetIndex = args.indexOf('--proof-target');
  const proofTarget = targetIndex >= 0 ? String(args[targetIndex + 1] || '') : '';
  return browserRunnerPayload(expectedHead, { proofScenario, proofTarget, ...overrides });
}

function workerOwnedScenarioProof(
  expectedHead,
  evidence = musicRatingScenarioEvidence({}, expectedHead),
) {
  return {
    ok: true,
    required: true,
    schemaVersion: BROWSER_RUNTIME_PROOF_SCHEMA,
    runtimeSourceHead: expectedHead,
    mergeReady: true,
    blocking: [],
    proofScenario: MUSIC_RATING_SCENARIO,
    scenarioEvidenceAccepted: true,
    scenarioEvidence: evidence,
  };
}

function exactRuntimeBundleFactory() {
  return Object.freeze({
    ok: true,
    required: true,
    canonicalBuildPerformed: true,
    canonicalVerifyPerformed: true,
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    distManifest: DIST_MANIFEST,
  });
}

function dispatchLockOwner(overrides = {}) {
  const acquiredAtUtc = overrides.acquiredAtUtc || '2026-07-30T23:00:00.000Z';
  const leaseDurationMs = overrides.leaseDurationMs ?? 1_000;
  return {
    schemaVersion: LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
    lockId: 'fixture-lock-owner-0001',
    pid: 777,
    hostname: 'test-host',
    acquiredAtUtc,
    expiresAtUtc: new Date(Date.parse(acquiredAtUtc) + leaseDurationMs).toISOString(),
    leaseDurationMs,
    processStartedAtUtc: '2026-07-30T22:59:00.000Z',
    bootStartedAtUtc: TEST_BOOT_STARTED_AT,
    bootId: TEST_BOOT_ID,
    processStartId: TEST_PROCESS_START_ID,
    ...overrides,
  };
}

function legacyV1DispatchLockOwner(overrides = {}) {
  const {
    leaseDurationMs = 60_000,
    ...ownerOverrides
  } = overrides;
  const acquiredAt = ownerOverrides.acquiredAt || '2026-07-30T23:00:00.000Z';
  return {
    ownerToken: 'legacy-owner-token-0001',
    ownerPid: 777,
    acquiredAt,
    expiresAt: new Date(Date.parse(acquiredAt) + leaseDurationMs).toISOString(),
    ...ownerOverrides,
  };
}

function writeLegacyV1DispatchLock(integration, owner) {
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  writeFileSync(
    join(integration.paths.dispatchLockPath, 'owner.json'),
    `${JSON.stringify(owner)}\n`,
  );
}

function successfulCodexProofChild(args, expectedHead) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const lastMessagePath = args[args.indexOf('--output-last-message') + 1];
  process.nextTick(() => {
    writeFileSync(lastMessagePath, JSON.stringify({
      verdict: 'PASS',
      proofScenario: MUSIC_RATING_SCENARIO,
      blockers: [],
    }));
    child.stdout.end('{"type":"turn.completed"}\n');
    child.stderr.end();
    child.emit('exit', 0, null);
  });
  return child;
}

test('local integration writes a durable task and accepted receipt before launching one detached worker', () => {
  const roots = tempRoots();
  const spawns = [];
  const child = new EventEmitter();
  child.pid = 4242;
  child.unref = () => { child.unrefCalled = true; };
  const integration = createLocalCodexExecIntegration({
    ...roots,
    workerPath: join(roots.repoRoot, 'worker.mjs'),
    now: () => '2026-07-15T20:00:00.000Z',
    idFactory: () => 'receipt-id',
    spawnFn: (...args) => { spawns.push(args); return child; },
  });

  const dispatchedPacket = packet();
  dispatchedPacket.exactHeadProof = {
    ...dispatchedPacket.exactHeadProof,
    proofTarget: 'MERGED_MAIN',
    pullRequestHead: 'b'.repeat(40),
    mergeCommitHead: 'c'.repeat(40),
    githubMainHead: dispatchedPacket.exactHeadProof.expectedHead,
    mergeCommitIncluded: true,
  };
  const receipt = integration.dispatch(dispatchedPacket);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.started, false);
  assert.equal(receipt.workerSpawned, true);
  assert.equal(receipt.workerPid, 4242);
  assert.equal(receipt.mergeAuthority, false);
  assert.equal(child.unrefCalled, true);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0][0], process.execPath);
  assert.deepEqual(spawns[0][1].slice(1), ['--task', integration.paths.tasksRoot + '/codex-job-test-123/task.json'].map((value) => value.replaceAll('/', process.platform === 'win32' ? '\\' : '/')));

  const status = integration.readStatus('codex-job-test-123');
  assert.equal(status.status, 'DISPATCHED');
  assert.equal(status.taskType, 'battle-bridge-proof');
  assert.deepEqual(status.exactHeadProof, dispatchedPacket.exactHeadProof);
  assert.equal(status.safety.mergeAllowed, false);
  assert.equal(status.safety.sourceMutationAllowed, false);
  assert.equal(readFileSync(receipt.taskPath, 'utf8').includes('Run the bounded real Windows ignition proof'), true);
});

test('local integration preserves merged-main provenance through task status and receipt', () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 4243, unref() {} }),
  });
  const mergedPacket = packet('codex-job-merged-main-provenance');
  mergedPacket.exactHeadProof = {
    ...mergedPacket.exactHeadProof,
    prNumber: 1628,
    expectedHead: 'd'.repeat(40),
    proofTarget: 'MERGED_MAIN',
    pullRequestHead: 'a'.repeat(40),
    mergeCommitHead: 'c'.repeat(40),
    githubMainHead: 'd'.repeat(40),
    mergeCommitIncluded: true,
  };
  const receipt = integration.dispatch(mergedPacket);
  assert.deepEqual(receipt.exactHeadProof, mergedPacket.exactHeadProof);
  assert.deepEqual(integration.readStatus(mergedPacket.jobId).exactHeadProof, mergedPacket.exactHeadProof);
  assert.deepEqual(JSON.parse(readFileSync(receipt.taskPath, 'utf8')).exactHeadProof, mergedPacket.exactHeadProof);
});

test('browser proof PASS trusts only exact machine-owned scenario evidence', () => {
  const task = packet();
  const modelPass = JSON.stringify({
    verdict: 'PASS',
    proofScenario: MUSIC_RATING_SCENARIO,
    blockers: [],
  });
  const valid = validateBrowserProofVerdict(
    modelPass,
    task,
    workerOwnedScenarioProof(task.exactHeadProof.expectedHead),
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.evidenceAuthority, 'worker-owned-playwright-runner');
  assert.equal(valid.modelScenarioEvidenceTrusted, false);
  assert.equal(valid.evidence.ratingInteraction.persistedRating, 2);

  const forgedModelOnly = validateBrowserProofVerdict(JSON.stringify({
    verdict: 'PASS',
    proofScenario: MUSIC_RATING_SCENARIO,
    evidence: {
      runtimeSourceHead: task.exactHeadProof.expectedHead,
      listeningDeckIframeIdentityPreserved: true,
      discoveryIframeIdentityPreserved: true,
      legacyRankingChanged: true,
      consoleErrors: [],
    },
    blockers: [],
  }), task);
  assert.equal(forgedModelOnly.ok, false);
  assert.equal(forgedModelOnly.blocker, 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED');

  for (const invalid of [
    '{"verdict":"FAIL","proofScenario":"MUSIC_RATING_PRESERVES_PLAYBACK","blockers":[]}',
    '{"verdict":"PASS","proofScenario":"WRONG","blockers":[]}',
    '{"verdict":"PASS","proofScenario":"MUSIC_RATING_PRESERVES_PLAYBACK","blockers":["proof incomplete"]}',
  ]) {
    assert.equal(
      validateBrowserProofVerdict(
        invalid,
        task,
        workerOwnedScenarioProof(task.exactHeadProof.expectedHead),
      ).ok,
      false,
    );
  }

  const navigatedEvidence = musicRatingScenarioEvidence({
    listeningDeckIframe: {
      ...musicRatingScenarioEvidence().listeningDeckIframe,
      frameNavigationCount: 1,
    },
  });
  const rejectedMachineEvidence = validateBrowserProofVerdict(
    modelPass,
    task,
    workerOwnedScenarioProof(task.exactHeadProof.expectedHead, navigatedEvidence),
  );
  assert.equal(rejectedMachineEvidence.ok, false);
  assert.equal(rejectedMachineEvidence.blocker, 'BROWSER_SCENARIO_LISTENING_IFRAME_REPLACED');
});

test('worker-owned browser runtime proof rejects a stale served head even if a model echoes the approved head', () => {
  const task = packet();
  const staleHead = 'b'.repeat(40);
  const browserRuntimeProof = runBrowserRuntimeExactHeadProof({
    ...task,
    repoRoot: 'C:\\stephan-os',
  }, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    spawnSyncFn() {
      return {
        status: 1,
        stdout: JSON.stringify({
          schemaVersion: 'stephanos.browser-runtime-exact-head-proof.v3',
          url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
          observedUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
          accepted: false,
          expectedHead: task.exactHeadProof.expectedHead,
          runtimeSourceHead: staleHead,
          expectedHeadMatch: false,
          expectedSourceFingerprint: SOURCE_FINGERPRINT,
          runtimeSourceFingerprint: SOURCE_FINGERPRINT,
          expectedSourceFingerprintMatch: true,
          expectedDistFingerprint: DIST_FINGERPRINT,
          runtimeDistFingerprint: DIST_FINGERPRINT,
          expectedDistFingerprintMatch: true,
        }),
      };
    },
  });
  assert.equal(browserRuntimeProof.ok, false);
  assert.equal(browserRuntimeProof.blocker, 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH');

  const selfReportedPass = JSON.stringify({
    verdict: 'PASS',
    proofScenario: task.exactHeadProof.proofScenario,
    evidence: {
      runtimeSourceHead: task.exactHeadProof.expectedHead,
      listeningDeckIframeIdentityPreserved: true,
      discoveryIframeIdentityPreserved: true,
      legacyRankingChanged: true,
      consoleErrors: [],
    },
    blockers: [],
  });
  const verdict = validateBrowserProofVerdict(selfReportedPass, task, browserRuntimeProof);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocker, 'BROWSER_PROOF_RUNTIME_HEAD_MISMATCH');
});

test('worker-owned browser runtime proof accepts schema v3 Playwright scenario evidence at the approved head', () => {
  const task = { ...packet(), repoRoot: 'C:\\stephan-os' };
  const expectedHead = task.exactHeadProof.expectedHead;
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    proofScenario: MUSIC_RATING_SCENARIO,
    spawnSyncFn(executable, args, options) {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args.slice(-16), [
        '--url',
        'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
        '--expected-head',
        expectedHead,
        '--proof-target',
        'PULL_REQUEST_HEAD',
        '--expected-source-fingerprint',
        SOURCE_FINGERPRINT,
        '--expected-dist-fingerprint',
        DIST_FINGERPRINT,
        '--expected-dist-manifest',
        DIST_MANIFEST_PATH,
        '--proof-scenario',
        MUSIC_RATING_SCENARIO,
        '--no-artifacts',
        '--machine-json',
      ]);
      assert.equal(options.cwd, task.repoRoot);
      return {
        status: 0,
        stdout: JSON.stringify(browserRunnerPayload(expectedHead, {
          proofScenario: MUSIC_RATING_SCENARIO,
        })),
      };
    },
  });
  assert.equal(proof.ok, true);
  assert.equal(proof.runtimeSourceHead, expectedHead);
  assert.equal(proof.runtimeSourceFingerprint, SOURCE_FINGERPRINT);
  assert.equal(proof.runtimeDistFingerprint, DIST_FINGERPRINT);
  assert.equal(proof.proofScenario, MUSIC_RATING_SCENARIO);
  assert.equal(proof.proofTarget, 'PULL_REQUEST_HEAD');
  assert.equal(proof.scenarioEvidenceAccepted, true);
  assert.equal(proof.scenarioEvidence.collector, 'playwright-page-v1');
});

test('worker-owned merged-main proof propagates its target and rejects a downgraded runner payload', () => {
  const baseTask = packet();
  const task = {
    ...baseTask,
    repoRoot: 'C:\\stephan-os',
    exactHeadProof: {
      ...baseTask.exactHeadProof,
      proofTarget: 'MERGED_MAIN',
      pullRequestHead: 'b'.repeat(40),
      mergeCommitHead: 'c'.repeat(40),
      githubMainHead: baseTask.exactHeadProof.expectedHead,
      mergeCommitIncluded: true,
    },
  };
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    proofScenario: MUSIC_RATING_SCENARIO,
    spawnSyncFn(executable, args) {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args.slice(args.indexOf('--proof-target'), args.indexOf('--proof-target') + 2), [
        '--proof-target',
        'MERGED_MAIN',
      ]);
      return {
        status: 0,
        stdout: JSON.stringify(browserRunnerPayload(task.exactHeadProof.expectedHead, {
          proofScenario: MUSIC_RATING_SCENARIO,
          proofTarget: 'PULL_REQUEST_HEAD',
        })),
      };
    },
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.blocker, 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED');
  assert.equal(proof.proofTarget, 'MERGED_MAIN');
  assert.equal(proof.payloadProofTarget, 'PULL_REQUEST_HEAD');
});

test('worker-owned browser runtime proof rejects accepted output with merge blockers', () => {
  const task = { ...packet(), repoRoot: 'C:\\stephan-os' };
  const expectedHead = task.exactHeadProof.expectedHead;
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    proofScenario: MUSIC_RATING_SCENARIO,
    spawnSyncFn() {
      return {
        status: 0,
        stdout: JSON.stringify(browserRunnerPayload(expectedHead, {
          proofScenario: MUSIC_RATING_SCENARIO,
          accepted: true,
          mergeReady: false,
          blocking: ['console error count 1'],
        })),
      };
    },
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.blocker, 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED');
});

test('worker-owned browser runtime proof rejects an alternate URL even when its footer matches', () => {
  const task = { ...packet(), repoRoot: 'C:\\stephan-os' };
  const expectedHead = task.exactHeadProof.expectedHead;
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    spawnSyncFn() {
      return {
        status: 0,
        stdout: JSON.stringify({
          schemaVersion: 'stephanos.browser-runtime-exact-head-proof.v3',
          url: 'http://127.0.0.1:9999/alternate.html',
          observedUrl: 'http://127.0.0.1:9999/alternate.html',
          accepted: true,
          mergeReady: true,
          blocking: [],
          expectedHead,
          runtimeSourceHead: expectedHead,
          expectedHeadMatch: true,
          expectedSourceFingerprint: SOURCE_FINGERPRINT,
          runtimeSourceFingerprint: SOURCE_FINGERPRINT,
          expectedSourceFingerprintMatch: true,
          expectedDistFingerprint: DIST_FINGERPRINT,
          runtimeDistFingerprint: DIST_FINGERPRINT,
          expectedDistFingerprintMatch: true,
        }),
      };
    },
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.blocker, 'BROWSER_RUNTIME_URL_MISMATCH');
});

test('worker-owned browser runtime proof converts runner launch exceptions into a deterministic blocker', () => {
  const task = { ...packet(), repoRoot: 'C:\\stephan-os' };
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    spawnSyncFn() { throw new Error('synthetic runner launch failure'); },
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.blocker, 'BROWSER_RUNTIME_EXACT_HEAD_PROOF_FAILED');
});

test('worker persists terminal failure when the guarded Codex child cannot launch', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-child-launch-fails'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    spawnFn() { throw new Error('synthetic Codex CLI launch failure'); },
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) {
        return {
          status: 0,
          stdout: JSON.stringify(browserRunnerPayloadForArgs(args, expectedHead)),
        };
      }
      if (executable === 'git' && args[0] === 'status') {
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
    sourceFingerprintFactory: () => SOURCE_FINGERPRINT,
    distFingerprintFactory: () => DIST_FINGERPRINT,
    runtimeBundleFactory: exactRuntimeBundleFactory,
    visibilityPublisher: async () => ({ ok: true }),
    now: () => '2026-07-30T23:00:00.000Z',
  });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.blocker, 'CODEX_CLI_STARTUP_FAILED');
  assert.equal(result.resultAvailable, true);
  assert.equal(integration.readStatus('codex-job-child-launch-fails').status, 'FAILED');
  assert.equal(integration.readResult('codex-job-child-launch-fails').blocker, 'CODEX_CLI_STARTUP_FAILED');
});

test('worker revalidates both PR and checkout heads immediately before execution', () => {
  const expectedHead = 'a'.repeat(40);
  const calls = [];
  const valid = validateExactHeadAtWorkerStart({
    repoRoot: 'C:\\stephan-os',
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1631,
      expectedHead,
    },
  }, {
    platform: 'win32',
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, cwd: options.cwd });
      if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
  });
  assert.equal(valid.ok, true);
  assert.deepEqual(calls.map((call) => call.executable), ['gh.exe', 'git.exe', 'git.exe']);
  assert.equal(calls[1].cwd, 'C:\\stephan-os');
  assert.equal(valid.sourceDirtClean, true);
});

test('worker owns the canonical build, verification, and frozen dist fingerprint', () => {
  const calls = [];
  const prepared = prepareExactHeadRuntimeBundle('/approved/repo', {
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
    distManifestFactory(root) {
      assert.equal(root, '/approved/repo');
      return DIST_MANIFEST;
    },
  });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.expectedDistFingerprint, DIST_FINGERPRINT);
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    [
      '/approved/repo/scripts/build-stephanos-ui.mjs',
      '/approved/repo/scripts/verify-stephanos-dist.mjs',
    ],
  );
  assert.equal(calls.every((call) => call.executable === process.execPath), true);
  assert.equal(calls.every((call) => call.options.cwd === '/approved/repo'), true);

  const failed = prepareExactHeadRuntimeBundle('/approved/repo', {
    spawnSyncFn() {
      return { status: 1, stdout: '', stderr: 'synthetic build failure' };
    },
    distManifestFactory: () => assert.fail('a failed build must not be fingerprinted'),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.blocker, 'CANONICAL_RUNTIME_BUILD_FAILED');
});

test('exact-head runtime builds use a detached approved worktree and bind copied dist to that build', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-runtime-test-'));
  const repoRoot = join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const expectedHead = 'a'.repeat(40);
  const expectedTree = 'c'.repeat(40);
  const calls = [];
  const manifestRoots = [];
  let buildRoot = '';
  let approvedDistRestoredBeforeWorktreeRemoval = false;
  try {
    const prepared = prepareExactHeadRuntimeBundle(repoRoot, {
      expectedHead,
      environment: {
        PATH: process.env.PATH,
        GIT_DIR: '/hostile/redirect',
        git_object_directory: '/hostile/objects',
      },
      sourceFingerprintFactory: () => SOURCE_FINGERPRINT,
      treeMaterializer({ buildRoot: materializedRoot }) {
        assert.equal(materializedRoot, buildRoot);
        mkdirSync(join(materializedRoot, 'stephanos-ui'), { recursive: true });
        writeFileSync(join(materializedRoot, 'stephanos-ui', 'package.json'), '{}\n');
        writeFileSync(join(materializedRoot, 'stephanos-ui', 'package-lock.json'), '{}\n');
        mkdirSync(join(materializedRoot, 'apps', 'stephanos', 'dist'), { recursive: true });
        writeFileSync(join(materializedRoot, 'apps', 'stephanos', 'dist', 'index.html'), '<!-- approved tracked dist -->\n');
        return { ok: true };
      },
      spawnSyncFn(executable, args, options) {
        calls.push({ executable, args, options });
        if (executable === 'git' && args[1] === 'rev-parse' && options.cwd === repoRoot) {
          return { status: 0, stdout: `${expectedTree}\n`, stderr: '' };
        }
        if (executable === 'git' && args[1] === 'worktree' && args[2] === 'add') {
          buildRoot = args[5];
          mkdirSync(buildRoot, { recursive: true });
        }
        if (executable === 'git' && args[1] === 'rev-parse' && options.cwd === buildRoot) {
          return { status: 0, stdout: `${expectedHead}\n${expectedTree}\n`, stderr: '' };
        }
        if (executable === 'npm' && args[0] === 'ci') {
          mkdirSync(join(options.cwd, 'node_modules'), { recursive: true });
        }
        if (executable === process.execPath && args[0].endsWith('build-stephanos-ui.mjs')) {
          mkdirSync(join(options.cwd, 'apps', 'stephanos', 'dist'), { recursive: true });
          writeFileSync(join(options.cwd, 'apps', 'stephanos', 'dist', 'index.html'), '<!-- approved -->\n');
        }
        if (executable === 'git' && args[1] === 'worktree' && args[2] === 'remove') {
          approvedDistRestoredBeforeWorktreeRemoval = (
            readFileSync(join(buildRoot, 'apps', 'stephanos', 'dist', 'index.html'), 'utf8')
            === '<!-- approved tracked dist -->\n'
          );
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      distManifestFactory(rootDir) {
        manifestRoots.push(rootDir);
        return DIST_MANIFEST;
      },
    });
    assert.equal(prepared.ok, true);
    assert.equal(prepared.immutableBuildSource, expectedHead);
    assert.equal(prepared.expectedSourceFingerprint, SOURCE_FINGERPRINT);
    assert.equal(manifestRoots[0], buildRoot);
    assert.equal(manifestRoots.at(-1), repoRoot);
    assert.equal(manifestRoots.length, 3);
    const gitCalls = calls.filter((call) => call.executable === 'git');
    assert.equal(gitCalls.every((call) => call.args[0] === '--no-replace-objects'), true);
    assert.equal(gitCalls.every((call) => call.options.env.GIT_NO_REPLACE_OBJECTS === '1'), true);
    assert.equal(gitCalls.every((call) => call.options.env.GIT_DIR === undefined), true);
    assert.equal(gitCalls.every((call) => call.options.env.git_object_directory === undefined), true);
    const add = calls.find((call) => call.executable === 'git' && call.args[1] === 'worktree' && call.args[2] === 'add');
    assert.deepEqual(add.args, ['--no-replace-objects', 'worktree', 'add', '--detach', '--no-checkout', buildRoot, expectedHead]);
    const readTree = calls.find((call) => call.executable === 'git' && call.args[1] === 'read-tree');
    assert.deepEqual(readTree.args, ['--no-replace-objects', 'read-tree', expectedHead]);
    assert.equal(readTree.options.cwd, buildRoot);
    const dependencyInstall = calls.find((call) => call.executable === 'npm' && call.args[0] === 'ci');
    assert.deepEqual(dependencyInstall.args, ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(dependencyInstall.options.cwd, join(buildRoot, 'stephanos-ui'));
    const buildAndVerify = calls.filter((call) => call.executable === process.execPath);
    assert.equal(buildAndVerify.length, 2);
    assert.equal(buildAndVerify.every((call) => call.options.cwd === buildRoot), true);
    assert.equal(buildAndVerify.every((call) => call.options.cwd !== repoRoot), true);
    const remove = calls.find((call) => call.executable === 'git' && call.args[1] === 'worktree' && call.args[2] === 'remove');
    assert.deepEqual(remove.args, ['--no-replace-objects', 'worktree', 'remove', buildRoot]);
    assert.equal(approvedDistRestoredBeforeWorktreeRemoval, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact-head tree materialization writes only immutable blob bytes without checkout filters', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-blob-materialization-test-'));
  const repoRoot = join(root, 'repo');
  const buildRoot = join(root, 'build');
  const expectedHead = 'a'.repeat(40);
  const approvedBytes = Buffer.from('approved bytes\r\n', 'utf8');
  const objectId = testGitBlobSha(approvedBytes);
  const targetPath = join(buildRoot, 'stephanos-ui', 'src', 'proof.txt');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(buildRoot, { recursive: true });
  const calls = [];
  try {
    const materialized = materializeExactHeadBuildTree({
      repoRoot,
      buildRoot,
      expectedHead,
      gitEnvironment: { PATH: process.env.PATH, GIT_NO_REPLACE_OBJECTS: '1' },
      spawnSyncFn(executable, args, options) {
        calls.push({ executable, args, options });
        if (args[1] === 'ls-tree') {
          return {
            status: 0,
            stdout: Buffer.from(`100644 blob ${objectId} ${approvedBytes.length}\tstephanos-ui/src/proof.txt\0`, 'utf8'),
            stderr: Buffer.alloc(0),
          };
        }
        if (args[1] === 'cat-file') {
          assert.deepEqual(options.input, Buffer.from(`${objectId}\n`, 'ascii'));
          return {
            status: 0,
            stdout: Buffer.concat([
              Buffer.from(`${objectId} blob ${approvedBytes.length}\n`, 'ascii'),
              approvedBytes,
              Buffer.from('\n', 'ascii'),
            ]),
            stderr: Buffer.alloc(0),
          };
        }
        return assert.fail(`unexpected Git command: ${args.join(' ')}`);
      },
    });
    assert.equal(materialized.ok, true);
    assert.equal(materialized.fileCount, 1);
    assert.equal(materialized.totalBytes, approvedBytes.length);
    assert.deepEqual(readFileSync(targetPath), approvedBytes);
    assert.equal(calls.length, 2);
    assert.equal(calls.every((call) => call.executable === 'git'), true);
    assert.equal(calls.every((call) => call.args[0] === '--no-replace-objects'), true);
    assert.equal(calls.every((call) => call.options.env.GIT_NO_REPLACE_OBJECTS === '1'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact-head tree materialization rejects checkout-populated or substituted bytes', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-filter-collision-test-'));
  const repoRoot = join(root, 'repo');
  const buildRoot = join(root, 'build');
  const expectedHead = 'b'.repeat(40);
  const approvedBytes = Buffer.from('approved\n', 'utf8');
  const objectId = testGitBlobSha(approvedBytes);
  const targetPath = join(buildRoot, 'stephanos-ui', 'src', 'proof.txt');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(join(buildRoot, 'stephanos-ui', 'src'), { recursive: true });
  writeFileSync(targetPath, 'smudge-filter substitution\n');
  try {
    const materialized = materializeExactHeadBuildTree({
      repoRoot,
      buildRoot,
      expectedHead,
      spawnSyncFn(executable, args) {
        assert.equal(executable, 'git');
        if (args[1] === 'ls-tree') {
          return {
            status: 0,
            stdout: Buffer.from(`100644 blob ${objectId} ${approvedBytes.length}\tstephanos-ui/src/proof.txt\0`, 'utf8'),
            stderr: Buffer.alloc(0),
          };
        }
        return {
          status: 0,
          stdout: Buffer.concat([
            Buffer.from(`${objectId} blob ${approvedBytes.length}\n`, 'ascii'),
            approvedBytes,
            Buffer.from('\n', 'ascii'),
          ]),
          stderr: Buffer.alloc(0),
        };
      },
    });
    assert.equal(materialized.ok, false);
    assert.equal(materialized.blocker, 'CANONICAL_RUNTIME_BUILD_BYTES_MISMATCH');
    assert.match(materialized.reason, /escapes or collides/);
    assert.equal(readFileSync(targetPath, 'utf8'), 'smudge-filter substitution\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact-head runtime rejects a materialized replacement tree before dependency install or build', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-replacement-tree-test-'));
  const repoRoot = join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const expectedHead = 'a'.repeat(40);
  const expectedTree = 'b'.repeat(40);
  const substitutedTree = 'c'.repeat(40);
  const calls = [];
  let buildRoot = '';
  try {
    const prepared = prepareExactHeadRuntimeBundle(repoRoot, {
      expectedHead,
      environment: {
        PATH: process.env.PATH,
        GIT_REPLACE_REF_BASE: 'refs/hostile/',
        Git_Dir: '/hostile/redirect',
      },
      spawnSyncFn(executable, args, options) {
        calls.push({ executable, args, options });
        if (executable === 'git' && args[1] === 'rev-parse' && options.cwd === repoRoot) {
          return { status: 0, stdout: `${expectedTree}\n`, stderr: '' };
        }
        if (executable === 'git' && args[1] === 'worktree' && args[2] === 'add') {
          buildRoot = args[5];
          mkdirSync(buildRoot, { recursive: true });
          return { status: 0, stdout: '', stderr: '' };
        }
        if (executable === 'git' && args[1] === 'rev-parse' && options.cwd === buildRoot) {
          return { status: 0, stdout: `${expectedHead}\n${substitutedTree}\n`, stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(prepared.ok, false);
    assert.equal(prepared.blocker, 'CANONICAL_RUNTIME_BUILD_WORKTREE_IDENTITY_MISMATCH');
    assert.equal(prepared.expectedHead, expectedHead);
    assert.equal(prepared.expectedTree, expectedTree);
    assert.equal(prepared.materializedTree, substitutedTree);
    assert.equal(calls.some((call) => call.executable === 'npm'), false);
    assert.equal(calls.some((call) => call.executable === process.execPath), false);
    const gitCalls = calls.filter((call) => call.executable === 'git');
    assert.equal(gitCalls.every((call) => call.args[0] === '--no-replace-objects'), true);
    assert.equal(gitCalls.every((call) => call.options.env.GIT_REPLACE_REF_BASE === undefined), true);
    assert.equal(gitCalls.every((call) => call.options.env.Git_Dir === undefined), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact-head runtime blocks when the approved lockfile dependency install fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-exact-head-dependency-failure-test-'));
  const repoRoot = join(root, 'repo');
  mkdirSync(repoRoot, { recursive: true });
  const expectedHead = 'b'.repeat(40);
  const expectedTree = 'd'.repeat(40);
  const calls = [];
  let buildRoot = '';
  let partialInstallPath = '';
  let partialInstallRemovedBeforeWorktreeRemoval = false;
  try {
    const prepared = prepareExactHeadRuntimeBundle(repoRoot, {
      expectedHead,
      platform: 'linux',
      treeMaterializer({ buildRoot: materializedRoot }) {
        assert.equal(materializedRoot, buildRoot);
        mkdirSync(join(materializedRoot, 'stephanos-ui'), { recursive: true });
        writeFileSync(join(materializedRoot, 'stephanos-ui', 'package.json'), '{}\n');
        writeFileSync(join(materializedRoot, 'stephanos-ui', 'package-lock.json'), '{}\n');
        return { ok: true };
      },
      spawnSyncFn(executable, args, options) {
        calls.push({ executable, args, options });
        if (executable === 'git' && args[1] === 'rev-parse' && options.cwd === repoRoot) {
          return { status: 0, stdout: `${expectedTree}\n`, stderr: '' };
        }
        if (executable === 'git' && args[1] === 'worktree' && args[2] === 'add') {
          buildRoot = args[5];
          mkdirSync(buildRoot, { recursive: true });
        }
        if (executable === 'git' && args[1] === 'rev-parse' && options.cwd === buildRoot) {
          return { status: 0, stdout: `${expectedHead}\n${expectedTree}\n`, stderr: '' };
        }
        if (executable === 'npm') {
          partialInstallPath = join(options.cwd, 'node_modules');
          mkdirSync(join(partialInstallPath, 'partial-package'), { recursive: true });
          return { status: 1, stdout: '', stderr: 'dependency install failed' };
        }
        if (executable === 'git' && args[1] === 'worktree' && args[2] === 'remove') {
          partialInstallRemovedBeforeWorktreeRemoval = !existsSync(partialInstallPath);
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(prepared.ok, false);
    assert.equal(prepared.blocker, 'CANONICAL_RUNTIME_DEPENDENCY_INSTALL_FAILED');
    assert.equal(calls.some((call) => call.executable === process.execPath), false);
    assert.equal(partialInstallRemovedBeforeWorktreeRemoval, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('worker fails closed before proof execution when an exact head changes', () => {
  const expectedHead = 'a'.repeat(40);
  const changedHead = 'b'.repeat(40);
  let calls = 0;
  const result = validateExactHeadAtWorkerStart({
    repoRoot: 'C:\\stephan-os',
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1631,
      expectedHead,
    },
  }, {
    platform: 'win32',
    spawnSyncFn() {
      calls += 1;
      return { status: 0, stdout: `${changedHead}\n`, stderr: '' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PR_HEAD_MISMATCH');
  assert.equal(calls, 1);
});

test('worker revalidates merged-main PR provenance current main ancestry and local head', () => {
  const pullRequestHead = 'a'.repeat(40);
  const mergeCommitHead = 'c'.repeat(40);
  const currentMainHead = 'd'.repeat(40);
  const calls = [];
  const result = validateExactHeadAtWorkerStart({
    repoRoot: 'C:\\stephan-os',
    branch: 'main',
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1628,
      expectedHead: currentMainHead,
      proofTarget: 'MERGED_MAIN',
      pullRequestHead,
      mergeCommitHead,
      githubMainHead: currentMainHead,
      mergeCommitIncluded: true,
      proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
    },
  }, {
    platform: 'win32',
    spawnSyncFn(executable, args, options) {
      calls.push({ executable, args, options });
      if (executable === 'gh.exe' && args[1]?.endsWith('/pulls/1628')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            head: { sha: pullRequestHead },
            merge_commit_sha: mergeCommitHead,
            merged: true,
            state: 'closed',
            base: { ref: 'main' },
          }),
          stderr: '',
        };
      }
      if (executable === 'gh.exe') return { status: 0, stdout: `${currentMainHead}\n`, stderr: '' };
      if (args[0] === 'merge-base') return { status: 0, stdout: '', stderr: '' };
      if (args[0] === 'rev-parse') return { status: 0, stdout: `${currentMainHead}\n`, stderr: '' };
      if (args[0] === 'status') return { status: 0, stdout: ' M apps/stephanos/dist/index.html\n', stderr: '' };
      assert.fail(`unexpected command: ${executable} ${args.join(' ')}`);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.proofTarget, 'MERGED_MAIN');
  assert.equal(result.pullRequestHead, pullRequestHead);
  assert.equal(result.mergeCommitHead, mergeCommitHead);
  assert.equal(result.githubMainHead, currentMainHead);
  assert.equal(result.mergeCommitIncluded, true);
  const ancestryCall = calls.find((call) => call.args[0] === 'merge-base');
  assert.deepEqual(ancestryCall.args, ['merge-base', '--is-ancestor', mergeCommitHead, currentMainHead]);
  assert.equal(ancestryCall.options.env.GIT_NO_REPLACE_OBJECTS, '1');
});

test('worker rejects pre-existing source dirt before accepting an exact-head runtime proof', () => {
  const expectedHead = 'a'.repeat(40);
  const result = validateExactHeadAtWorkerStart({
    repoRoot: 'C:\\stephan-os',
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1631,
      expectedHead,
    },
  }, {
    platform: 'win32',
    spawnSyncFn(executable, args) {
      if (executable === 'gh.exe' || args[0] === 'rev-parse') {
        return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
      }
      return {
        status: 0,
        stdout: ' M scripts/dirty-source.mjs\n M apps/stephanos/dist/index.html\n',
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PRE_EXISTING_SOURCE_DIRT');
  assert.deepEqual(result.sourcePaths, ['scripts/dirty-source.mjs']);
});

test('worker permits generated runtime dirt when committed source is clean', () => {
  const expectedHead = 'a'.repeat(40);
  const result = validateExactHeadAtWorkerStart({
    repoRoot: 'C:\\stephan-os',
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1631,
      expectedHead,
    },
  }, {
    platform: 'win32',
    spawnSyncFn(executable, args) {
      if (executable === 'gh.exe' || args[0] === 'rev-parse') {
        return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
      }
      return { status: 0, stdout: ' M apps/stephanos/dist/index.html\n', stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.generatedRuntimePaths, ['apps/stephanos/dist/index.html']);
});

test('worker fails closed when exact-head source status cannot be read', () => {
  const expectedHead = 'a'.repeat(40);
  const result = validateExactHeadAtWorkerStart({
    repoRoot: 'C:\\stephan-os',
    exactHeadProof: {
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1631,
      expectedHead,
    },
  }, {
    platform: 'win32',
    spawnSyncFn(executable, args) {
      if (executable === 'gh.exe' || args[0] === 'rev-parse') {
        return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'status unavailable' };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'LOCAL_SOURCE_STATUS_LOOKUP_FAILED');
});

test('worker persists BLOCKED before browser or child execution when exact-head source is dirty', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-dirty-source'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  let browserRunnerCalls = 0;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    platform: 'win32',
    spawnFn: () => assert.fail('Codex child must not start from a dirty exact-head checkout'),
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) {
        browserRunnerCalls += 1;
        return { status: 1, stdout: '', stderr: '' };
      }
      if (executable === 'gh.exe' || args[0] === 'rev-parse') {
        return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
      }
      return { status: 0, stdout: ' M scripts/dirty-source.mjs\n', stderr: '' };
    },
    visibilityPublisher: async () => ({ ok: true }),
    now: () => '2026-07-30T23:10:00.000Z',
  });
  assert.equal(browserRunnerCalls, 0);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'PRE_EXISTING_SOURCE_DIRT');
  assert.equal(integration.readStatus('codex-job-dirty-source').status, 'BLOCKED');
  assert.equal(integration.readResult('codex-job-dirty-source').blocker, 'PRE_EXISTING_SOURCE_DIRT');
});

test('worker blocks before browser or child execution when the bracketing source status lookup fails', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-source-status-race'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  let statusCalls = 0;
  let browserCalls = 0;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    platform: 'win32',
    spawnFn: () => assert.fail('Codex child must not start when the bracket status lookup fails'),
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) {
        browserCalls += 1;
        return { status: 1, stdout: '', stderr: '' };
      }
      if (args[0] === 'status') {
        statusCalls += 1;
        return statusCalls === 1
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 1, stdout: '', stderr: 'status unavailable' };
      }
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
    sourceFingerprintFactory: () => SOURCE_FINGERPRINT,
    runtimeBundleFactory: exactRuntimeBundleFactory,
    visibilityPublisher: async () => ({ ok: true }),
  });
  assert.equal(statusCalls, 2);
  assert.equal(browserCalls, 0);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'LOCAL_SOURCE_STATUS_LOOKUP_FAILED');
});

test('worker-owned browser runtime proof rejects a fingerprint from a different source tree', () => {
  const task = { ...packet(), repoRoot: 'C:\\stephan-os' };
  const expectedHead = task.exactHeadProof.expectedHead;
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    spawnSyncFn() {
      return {
        status: 1,
        stdout: JSON.stringify({
          schemaVersion: 'stephanos.browser-runtime-exact-head-proof.v3',
          url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
          observedUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
          accepted: false,
          expectedHead,
          runtimeSourceHead: expectedHead,
          expectedHeadMatch: true,
          expectedSourceFingerprint: SOURCE_FINGERPRINT,
          runtimeSourceFingerprint: 'e'.repeat(64),
          expectedSourceFingerprintMatch: false,
          expectedDistFingerprint: DIST_FINGERPRINT,
          runtimeDistFingerprint: DIST_FINGERPRINT,
          expectedDistFingerprintMatch: true,
        }),
      };
    },
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.blocker, 'BROWSER_PROOF_RUNTIME_FINGERPRINT_MISMATCH');
});

test('worker-owned browser runtime proof rejects modified served assets even when head metadata matches', () => {
  const task = { ...packet(), repoRoot: 'C:\\stephan-os' };
  const expectedHead = task.exactHeadProof.expectedHead;
  const proof = runBrowserRuntimeExactHeadProof(task, {
    expectedSourceFingerprint: SOURCE_FINGERPRINT,
    expectedDistFingerprint: DIST_FINGERPRINT,
    expectedDistManifestPath: DIST_MANIFEST_PATH,
    spawnSyncFn() {
      return {
        status: 1,
        stdout: JSON.stringify({
          schemaVersion: 'stephanos.browser-runtime-exact-head-proof.v3',
          url: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
          observedUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
          accepted: false,
          expectedHead,
          runtimeSourceHead: expectedHead,
          expectedHeadMatch: true,
          expectedSourceFingerprint: SOURCE_FINGERPRINT,
          runtimeSourceFingerprint: SOURCE_FINGERPRINT,
          expectedSourceFingerprintMatch: true,
          expectedDistFingerprint: DIST_FINGERPRINT,
          runtimeDistFingerprint: 'e'.repeat(64),
          expectedDistFingerprintMatch: false,
        }),
      };
    },
  });
  assert.equal(proof.ok, false);
  assert.equal(proof.blocker, 'BROWSER_PROOF_RUNTIME_DIST_FINGERPRINT_MISMATCH');
});

test('worker blocks before browser or Codex launch when the canonical runtime build fails', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-runtime-build-fails'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  let browserCalls = 0;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    platform: 'win32',
    sourceFingerprintFactory: () => SOURCE_FINGERPRINT,
    runtimeBundleFactory: () => ({
      ok: false,
      required: true,
      blocker: 'CANONICAL_RUNTIME_BUILD_FAILED',
    }),
    spawnFn: () => assert.fail('Codex must not launch after a canonical build failure'),
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) browserCalls += 1;
      if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
    visibilityPublisher: async () => ({ ok: true }),
  });
  assert.equal(browserCalls, 0);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'CANONICAL_RUNTIME_BUILD_FAILED');
});

test('worker reuses the detached runtime source fingerprint across both browser proofs', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-frozen-fingerprint'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  const callOrder = [];
  let browserCalls = 0;
  const browserArgv = [];
  let mutableCheckoutFingerprintCalls = 0;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    platform: 'win32',
    sourceFingerprintFactory() {
      mutableCheckoutFingerprintCalls += 1;
      return mutableCheckoutFingerprintCalls === 1 ? SOURCE_FINGERPRINT : 'e'.repeat(64);
    },
    distFingerprintFactory: () => DIST_FINGERPRINT,
    runtimeBundleFactory: exactRuntimeBundleFactory,
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) {
        browserCalls += 1;
        browserArgv.push([...args]);
        callOrder.push(`browser-${browserCalls}`);
        return {
          status: 0,
          stdout: JSON.stringify(browserRunnerPayloadForArgs(args, expectedHead)),
        };
      }
      if (args[0] === 'status') {
        callOrder.push(browserCalls === 2 ? 'final-status' : 'status');
        return { status: 0, stdout: '', stderr: '' };
      }
      if (executable === 'git') {
        callOrder.push(browserCalls === 2 ? 'final-head' : 'head');
      }
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
    spawnFn(command, args) {
      return successfulCodexProofChild(args, expectedHead);
    },
    visibilityPublisher: async () => ({ ok: true }),
    heartbeatIntervalMs: 0,
  });

  assert.equal(result.status, 'DONE');
  assert.deepEqual(result.exactHeadProof, packet().exactHeadProof);
  assert.equal(mutableCheckoutFingerprintCalls, 0);
  assert.equal(browserCalls, 2);
  assert.equal(browserArgv.length, 2);
  for (const args of browserArgv) {
    assert.deepEqual(args.slice(args.indexOf('--proof-scenario'), args.indexOf('--proof-scenario') + 2), [
      '--proof-scenario',
      MUSIC_RATING_SCENARIO,
    ]);
    assert.deepEqual(args.slice(args.indexOf('--proof-target'), args.indexOf('--proof-target') + 2), [
      '--proof-target',
      'PULL_REQUEST_HEAD',
    ]);
  }
  assert.deepEqual(callOrder.slice(-3), ['browser-2', 'final-head', 'final-status']);
  assert.equal(result.browserRuntimeProofBefore.expectedSourceFingerprint, SOURCE_FINGERPRINT);
  assert.equal(result.browserRuntimeProofAfter.expectedSourceFingerprint, SOURCE_FINGERPRINT);
});

test('an exact-head proof is blocked when canonical dist bytes change during execution', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-dist-mutates'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    platform: 'win32',
    sourceFingerprintFactory: () => SOURCE_FINGERPRINT,
    runtimeBundleFactory: exactRuntimeBundleFactory,
    distFingerprintFactory: () => 'e'.repeat(64),
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) {
        return {
          status: 0,
          stdout: JSON.stringify(browserRunnerPayloadForArgs(args, expectedHead)),
        };
      }
      if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
    spawnFn(command, args) {
      return successfulCodexProofChild(args, expectedHead);
    },
    visibilityPublisher: async () => ({ ok: true }),
    heartbeatIntervalMs: 0,
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.blocker, 'GENERATED_RUNTIME_INTEGRITY_MISMATCH');
  assert.equal(result.sourceSafety.exactHeadRuntimeBound, false);
  assert.equal(result.runtimeDistFingerprintAfter, 'e'.repeat(64));
});

test('an otherwise passing exact-head proof is BLOCKED when the final status snapshot fails', async () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 333, unref() {} }),
  });
  const dispatchReceipt = integration.dispatch(packet('codex-job-final-status-fails'));
  const expectedHead = packet().exactHeadProof.expectedHead;
  let statusCalls = 0;
  let browserCalls = 0;
  const result = await runCodexWorker(dispatchReceipt.taskPath, {
    platform: 'win32',
    sourceFingerprintFactory: () => SOURCE_FINGERPRINT,
    distFingerprintFactory: () => DIST_FINGERPRINT,
    runtimeBundleFactory: exactRuntimeBundleFactory,
    spawnSyncFn(executable, args) {
      if (executable === process.execPath) {
        browserCalls += 1;
        return {
          status: 0,
          stdout: JSON.stringify(browserRunnerPayloadForArgs(args, expectedHead)),
        };
      }
      if (args[0] === 'status') {
        statusCalls += 1;
        return statusCalls < 3
          ? { status: 0, stdout: '', stderr: '' }
          : { status: 1, stdout: '', stderr: 'final status unavailable' };
      }
      return { status: 0, stdout: `${expectedHead}\n`, stderr: '' };
    },
    spawnFn(command, args) {
      return successfulCodexProofChild(args, expectedHead);
    },
    visibilityPublisher: async () => ({ ok: true }),
    heartbeatIntervalMs: 0,
  });

  assert.equal(browserCalls, 2);
  assert.equal(statusCalls, 3);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.blocker, 'LOCAL_SOURCE_STATUS_LOOKUP_FAILED');
  assert.equal(result.browserProof.ok, true);
  assert.equal(result.sourceSafety.exactHeadStatusAvailable, false);
});

test('local integration enforces the one-active-job rule', () => {
  const roots = tempRoots();
  const child = { pid: 111, unref() {} };
  const integration = createLocalCodexExecIntegration({ ...roots, spawnFn: () => child });
  integration.dispatch(packet('codex-job-first'));
  assert.throws(() => integration.dispatch(packet('codex-job-second')), /already DISPATCHED/);
  assert.throws(() => integration.dispatch(packet('codex-job-first')), /already DISPATCHED/);
});

test('local integration fails closed when current task truth is malformed', () => {
  const roots = tempRoots();
  let spawnCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => {
      spawnCalls += 1;
      return { pid: 111, unref() {} };
    },
  });
  mkdirSync(integration.paths.dispatchRoot, { recursive: true });
  writeFileSync(integration.paths.currentPath, '{"jobId":"truncated');
  assert.throws(
    () => integration.dispatch(packet('codex-job-current-unverifiable')),
    /LOCAL_CODEX_DISPATCH_CURRENT_UNVERIFIABLE/,
  );
  assert.equal(spawnCalls, 0);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('local integration fails closed when current task truth has an unknown status', () => {
  const roots = tempRoots();
  let spawnCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => {
      spawnCalls += 1;
      return { pid: 111, unref() {} };
    },
  });
  mkdirSync(integration.paths.dispatchRoot, { recursive: true });
  writeFileSync(integration.paths.currentPath, JSON.stringify({
    schemaVersion: 'stephanos.codex-dispatch-task.v1',
    kind: 'stephanos.codex_dispatch.local_task',
    taskId: 'existing-unknown-job',
    jobId: 'existing-unknown-job',
    status: 'PAUSED',
  }));
  assert.throws(
    () => integration.dispatch(packet('codex-job-unknown-current-status')),
    /LOCAL_CODEX_DISPATCH_CURRENT_UNVERIFIABLE/,
  );
  assert.equal(spawnCalls, 0);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('local integration acquires an atomic dispatch lock before checking or claiming the active slot', () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => assert.fail('spawn must not run while another dispatcher owns the lock'),
  });
  mkdirSync(integration.paths.dispatchRoot, { recursive: true });
  mkdirSync(integration.paths.dispatchLockPath);
  assert.throws(
    () => integration.dispatch(packet('codex-job-concurrent')),
    /another dispatch is claiming the one-active-job slot/,
  );
  assert.equal(integration.readStatus('codex-job-concurrent'), null);
});

test('a paused populated candidate cannot overwrite a contender that publishes first', () => {
  const roots = tempRoots();
  let spawnCalls = 0;
  const contenderId = 'winning-contender-lock-0001';
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'paused-candidate-lock-0001',
    dispatchLockHostname: 'test-host',
    dispatchLockBootStartedAtUtc: TEST_BOOT_STARTED_AT,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => TEST_PROCESS_IDENTITY,
    dispatchLockBeforePublish({ lockPath, candidatePath }) {
      assert.equal(existsSync(lockPath), false);
      assert.deepEqual(readdirSync(candidatePath), ['owner-paused-candidate-lock-0001.json']);
      const contenderCandidate = `${lockPath}.candidate-${contenderId}`;
      mkdirSync(contenderCandidate);
      writeFileSync(
        join(contenderCandidate, `owner-${contenderId}.json`),
        `${JSON.stringify(dispatchLockOwner({
          lockId: contenderId,
          acquiredAtUtc: '2026-07-30T23:10:00.000Z',
          leaseDurationMs: 60_000,
        }))}\n`,
      );
      renameSync(contenderCandidate, lockPath);
    },
    spawnFn: () => {
      spawnCalls += 1;
      return { pid: 444, unref() {} };
    },
  });

  assert.throws(
    () => integration.dispatch(packet('codex-job-paused-candidate')),
    /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
  );
  assert.equal(spawnCalls, 0);
  assert.deepEqual(
    readdirSync(integration.paths.dispatchLockPath),
    [`owner-${contenderId}.json`],
  );
});

test('an exact expired v1 owner is migrated only after its PID is definitively dead', () => {
  const roots = tempRoots();
  let probeCalls = 0;
  let publishedOwnerFiles = [];
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'replacement-v2-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      probeCalls += 1;
      assert.equal(pid, 777);
      return { state: 'dead' };
    },
    spawnFn: () => {
      publishedOwnerFiles = readdirSync(integration.paths.dispatchLockPath);
      return { pid: 444, unref() {} };
    },
  });
  writeLegacyV1DispatchLock(integration, legacyV1DispatchLockOwner());

  const receipt = integration.dispatch(packet('codex-job-after-v1-owner'));
  assert.equal(receipt.accepted, true);
  assert.equal(probeCalls, 1);
  assert.deepEqual(publishedOwnerFiles, ['owner-replacement-v2-lock-0001.json']);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('an unexpired v1 owner remains contended without probing or spawning', () => {
  const roots = tempRoots();
  const owner = legacyV1DispatchLockOwner({
    acquiredAt: '2026-07-30T23:09:30.000Z',
    leaseDurationMs: 60_000,
  });
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-unexpired-contender-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => assert.fail('an unexpired v1 owner must not be probed'),
    spawnFn: () => assert.fail('an unexpired v1 owner must not be replaced'),
  });
  writeLegacyV1DispatchLock(integration, owner);

  assert.throws(
    () => integration.dispatch(packet('codex-job-v1-unexpired')),
    /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(integration.paths.dispatchLockPath, 'owner.json'), 'utf8')),
    owner,
  );
});

test('expired v1 owners remain fail-closed when their PID is live or unverifiable', () => {
  for (const [state, expectedError] of [
    ['known', /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/],
    ['unknown', /LOCAL_CODEX_DISPATCH_LOCK_OWNER_UNVERIFIABLE/],
  ]) {
    const roots = tempRoots();
    const owner = legacyV1DispatchLockOwner({ ownerToken: `legacy-${state}-owner-0001` });
    const integration = createLocalCodexExecIntegration({
      ...roots,
      now: () => '2026-07-30T23:10:00.000Z',
      lockIdFactory: () => `v1-${state}-contender-0001`,
      dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
      dispatchLockProcessIdentityProbe: () => (
        state === 'known' ? TEST_PROCESS_IDENTITY : { state: 'unknown' }
      ),
      spawnFn: () => assert.fail('a live or unverifiable v1 owner must not be replaced'),
    });
    writeLegacyV1DispatchLock(integration, owner);

    assert.throws(
      () => integration.dispatch(packet(`codex-job-v1-${state}`)),
      expectedError,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(join(integration.paths.dispatchLockPath, 'owner.json'), 'utf8')),
      owner,
    );
  }
});

test('malformed or out-of-bounds v1 owners remain invalid and untouched', () => {
  const scenarios = [
    {
      label: 'extra-field',
      owner: { ...legacyV1DispatchLockOwner(), hostname: 'legacy-host' },
      filename: 'owner.json',
    },
    {
      label: 'wrong-filename',
      owner: legacyV1DispatchLockOwner(),
      filename: 'legacy-owner.json',
    },
    {
      label: 'noncanonical-time',
      owner: legacyV1DispatchLockOwner({ acquiredAt: '2026-07-30 23:00:00Z' }),
      filename: 'owner.json',
    },
    {
      label: 'oversized-lease',
      owner: legacyV1DispatchLockOwner({ leaseDurationMs: 300_001 }),
      filename: 'owner.json',
    },
  ];
  for (const scenario of scenarios) {
    const roots = tempRoots();
    const integration = createLocalCodexExecIntegration({
      ...roots,
      now: () => '2026-07-30T23:10:00.000Z',
      lockIdFactory: () => `invalid-v1-${scenario.label}-0001`,
      dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
      dispatchLockProcessIdentityProbe: () => assert.fail('invalid v1 data must not be probed'),
      spawnFn: () => assert.fail('invalid v1 data must not be replaced'),
    });
    mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
    const ownerPath = join(integration.paths.dispatchLockPath, scenario.filename);
    writeFileSync(ownerPath, `${JSON.stringify(scenario.owner)}\n`);

    assert.throws(
      () => integration.dispatch(packet(`codex-job-invalid-v1-${scenario.label}`)),
      /LOCAL_CODEX_DISPATCH_LOCK_INVALID/,
    );
    assert.deepEqual(JSON.parse(readFileSync(ownerPath, 'utf8')), scenario.owner);
  }
});

test('v1 recovery rechecks ownership and cannot unlink a replacement winner', () => {
  const roots = tempRoots();
  const replacement = legacyV1DispatchLockOwner({
    ownerToken: 'legacy-replacement-owner-0001',
    acquiredAt: '2026-07-30T23:09:30.000Z',
    leaseDurationMs: 60_000,
  });
  let probeCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-race-loser-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => {
      probeCalls += 1;
      const ownerPath = join(integration.paths.dispatchLockPath, 'owner.json');
      unlinkSync(ownerPath);
      writeFileSync(ownerPath, `${JSON.stringify(replacement)}\n`);
      return { state: 'dead' };
    },
    spawnFn: () => assert.fail('the stale contender must lose to the replacement owner'),
  });
  writeLegacyV1DispatchLock(integration, legacyV1DispatchLockOwner());

  assert.throws(
    () => integration.dispatch(packet('codex-job-v1-replacement-race')),
    /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
  );
  assert.equal(probeCalls, 1);
  assert.deepEqual(
    JSON.parse(readFileSync(join(integration.paths.dispatchLockPath, 'owner.json'), 'utf8')),
    replacement,
  );
});

test('v1 recovery retains a moved replacement until its PID is definitively dead', () => {
  const roots = tempRoots();
  const recoveryStartedAt = '2026-07-30T23:10:00.000Z';
  const replacement = legacyV1DispatchLockOwner({
    ownerToken: 'legacy-post-compare-winner-0001',
    acquiredAt: '2026-07-30T23:09:30.000Z',
    leaseDurationMs: 60_000,
  });
  let moveHookCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => recoveryStartedAt,
    lockIdFactory: () => 'v1-post-compare-loser-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => ({ state: 'dead' }),
    dispatchLockBeforeLegacyOwnerMove({ ownerPath, tombstonePath }) {
      moveHookCalls += 1;
      assert.equal(existsSync(tombstonePath), false);
      unlinkSync(ownerPath);
      writeFileSync(ownerPath, `${JSON.stringify(replacement)}\n`);
    },
    spawnFn: () => assert.fail('the stale contender must not delete or pass the replacement'),
  });
  writeLegacyV1DispatchLock(integration, legacyV1DispatchLockOwner());

  assert.throws(
    () => integration.dispatch(packet('codex-job-v1-post-compare-race')),
    /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
  );
  assert.equal(moveHookCalls, 1);
  assert.deepEqual(readdirSync(integration.paths.dispatchLockPath), []);
  const replacementTombstone = (
    `${integration.paths.dispatchLockPath}.legacy-v1-owner-v1-post-compare-loser-0001`
    + `.at-${Date.parse(recoveryStartedAt)}.tombstone`
  );
  assert.deepEqual(
    JSON.parse(readFileSync(replacementTombstone, 'utf8')),
    replacement,
  );

  // The historical claimant may have attempted its one-shot release while
  // owner.json was absent. No finite timeout proves that a live claimant has
  // left its critical section, so the marker remains authoritative.
  const freshTime = new Date('2026-07-30T23:19:59.000Z');
  utimesSync(integration.paths.dispatchLockPath, freshTime, freshTime);
  let laterProbeCalls = 0;
  const laterIntegration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:20:00.000Z',
    lockIdFactory: () => 'v1-after-recovery-grace-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      laterProbeCalls += 1;
      assert.equal(pid, replacement.ownerPid);
      return TEST_PROCESS_IDENTITY;
    },
    spawnFn: () => assert.fail('a known-live moved replacement must remain owned'),
  });
  assert.throws(
    () => laterIntegration.dispatch(packet('codex-job-v1-after-recovery-grace')),
    /LOCAL_CODEX_DISPATCH_LOCK_LEGACY_RECOVERY_REQUIRED/,
  );
  assert.equal(laterProbeCalls, 1);
  assert.equal(existsSync(replacementTombstone), true);

  const staleAfterOwnerDeath = new Date('2026-07-30T23:10:00.000Z');
  utimesSync(
    integration.paths.dispatchLockPath,
    staleAfterOwnerDeath,
    staleAfterOwnerDeath,
  );
  let deadProbeCalls = 0;
  const deadOwnerIntegration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:20:00.000Z',
    lockIdFactory: () => 'v1-after-owner-death-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      deadProbeCalls += 1;
      assert.equal(pid, replacement.ownerPid);
      return { state: 'dead' };
    },
    spawnFn: () => ({ pid: 444, unref() {} }),
  });
  const receipt = deadOwnerIntegration.dispatch(
    packet('codex-job-v1-after-owner-death'),
  );
  assert.equal(receipt.accepted, true);
  assert.equal(deadProbeCalls, 2);
  assert.equal(existsSync(replacementTombstone), false);
});

test('dead marker cleanup preserves the fresh empty-lock grace', () => {
  const roots = tempRoots();
  let probeCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-after-crash-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      probeCalls += 1;
      assert.equal(pid, 777);
      return { state: 'dead' };
    },
    spawnFn: () => assert.fail('a fresh empty legacy claim must retain its grace'),
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  const freshTime = new Date('2026-07-30T23:09:59.000Z');
  utimesSync(integration.paths.dispatchLockPath, freshTime, freshTime);
  const orphanTombstone = (
    `${integration.paths.dispatchLockPath}.legacy-v1-owner-crashed-recovery-0001`
    + `.at-${Date.parse('2026-07-30T23:00:00.000Z')}.tombstone`
  );
  writeFileSync(
    orphanTombstone,
    `${JSON.stringify(legacyV1DispatchLockOwner())}\n`,
  );

  assert.throws(
    () => integration.dispatch(packet('codex-job-after-v1-move-crash')),
    /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
  );
  assert.equal(probeCalls, 2);
  assert.equal(existsSync(integration.paths.dispatchLockPath), true);
  assert.equal(existsSync(orphanTombstone), false);

  const afterGrace = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:20:00.000Z',
    lockIdFactory: () => 'v1-after-empty-grace-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => ({ pid: 444, unref() {} }),
  });
  const receipt = afterGrace.dispatch(packet('codex-job-after-v1-empty-grace'));
  assert.equal(receipt.accepted, true);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('dead-marker recovery rechecks for a live marker before publication', () => {
  const roots = tempRoots();
  let deadOwnerProbeCalls = 0;
  let liveOwnerProbeCalls = 0;
  let liveTombstone = '';
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-marker-recheck-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      if (pid === 777) {
        deadOwnerProbeCalls += 1;
        if (deadOwnerProbeCalls === 2) {
          liveTombstone = (
            `${integration.paths.dispatchLockPath}.legacy-v1-owner-concurrent-live-0001`
            + `.at-${Date.parse('2026-07-30T23:09:00.000Z')}.tombstone`
          );
          writeFileSync(
            liveTombstone,
            `${JSON.stringify(legacyV1DispatchLockOwner({
              ownerToken: 'concurrent-live-owner-0001',
              ownerPid: 888,
            }))}\n`,
          );
        }
        return { state: 'dead' };
      }
      assert.equal(pid, 888);
      liveOwnerProbeCalls += 1;
      return TEST_PROCESS_IDENTITY;
    },
    spawnFn: () => assert.fail('the newly observed live marker must block publication'),
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  const staleTime = new Date('2026-07-30T23:00:00.000Z');
  utimesSync(integration.paths.dispatchLockPath, staleTime, staleTime);
  const deadTombstone = (
    `${integration.paths.dispatchLockPath}.legacy-v1-owner-dead-before-recheck-0001`
    + `.at-${Date.parse('2026-07-30T23:00:00.000Z')}.tombstone`
  );
  writeFileSync(
    deadTombstone,
    `${JSON.stringify(legacyV1DispatchLockOwner())}\n`,
  );

  assert.throws(
    () => integration.dispatch(packet('codex-job-v1-marker-recheck')),
    /LOCAL_CODEX_DISPATCH_LOCK_LEGACY_RECOVERY_REQUIRED/,
  );
  assert.equal(deadOwnerProbeCalls, 2);
  assert.equal(liveOwnerProbeCalls, 1);
  assert.equal(existsSync(deadTombstone), false);
  assert.equal(existsSync(liveTombstone), true);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('canonical v1 recovery rechecks for a live marker after directory removal', () => {
  const roots = tempRoots();
  let liveOwnerProbeCalls = 0;
  let liveTombstone = '';
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-canonical-recheck-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      if (pid === 777) return { state: 'dead' };
      assert.equal(pid, 888);
      liveOwnerProbeCalls += 1;
      return TEST_PROCESS_IDENTITY;
    },
    dispatchLockBeforeLegacyOwnerMove() {
      liveTombstone = (
        `${integration.paths.dispatchLockPath}.legacy-v1-owner-canonical-race-live-0001`
        + `.at-${Date.parse('2026-07-30T23:09:00.000Z')}.tombstone`
      );
      writeFileSync(
        liveTombstone,
        `${JSON.stringify(legacyV1DispatchLockOwner({
          ownerToken: 'canonical-race-live-owner-0001',
          ownerPid: 888,
        }))}\n`,
      );
    },
    spawnFn: () => assert.fail('the concurrent live marker must block publication'),
  });
  writeLegacyV1DispatchLock(integration, legacyV1DispatchLockOwner());

  assert.throws(
    () => integration.dispatch(packet('codex-job-v1-canonical-marker-recheck')),
    /LOCAL_CODEX_DISPATCH_LOCK_LEGACY_RECOVERY_REQUIRED/,
  );
  assert.equal(liveOwnerProbeCalls, 1);
  assert.equal(existsSync(liveTombstone), true);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('a crash-left sibling v1 tombstone preserves a live owner', () => {
  const roots = tempRoots();
  let probeCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-live-crash-contender-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: (pid) => {
      probeCalls += 1;
      assert.equal(pid, 777);
      return TEST_PROCESS_IDENTITY;
    },
    spawnFn: () => assert.fail('a live crash-left owner must not be replaced'),
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  const staleTime = new Date('2026-07-30T23:00:00.000Z');
  utimesSync(integration.paths.dispatchLockPath, staleTime, staleTime);
  const orphanTombstone = (
    `${integration.paths.dispatchLockPath}.legacy-v1-owner-live-recovery-0001`
    + `.at-${Date.parse('2026-07-30T23:09:00.000Z')}.tombstone`
  );
  const owner = legacyV1DispatchLockOwner();
  writeFileSync(orphanTombstone, `${JSON.stringify(owner)}\n`);

  assert.throws(
    () => integration.dispatch(packet('codex-job-after-live-v1-move-crash')),
    /LOCAL_CODEX_DISPATCH_LOCK_LEGACY_RECOVERY_REQUIRED/,
  );
  assert.equal(probeCalls, 1);
  assert.deepEqual(
    JSON.parse(readFileSync(orphanTombstone, 'utf8')),
    owner,
  );
  assert.deepEqual(readdirSync(integration.paths.dispatchLockPath), []);
});

test('v1 recovery never advances past an active current job', () => {
  const roots = tempRoots();
  let spawnCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'v1-active-current-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => ({ state: 'dead' }),
    spawnFn: () => {
      spawnCalls += 1;
      return { pid: 444, unref() {} };
    },
  });
  writeLegacyV1DispatchLock(integration, legacyV1DispatchLockOwner());
  mkdirSync(integration.paths.dispatchRoot, { recursive: true });
  writeFileSync(integration.paths.currentPath, JSON.stringify({
    schemaVersion: 'stephanos.codex-dispatch-task.v1',
    kind: 'stephanos.codex_dispatch.local_task',
    taskId: 'existing-active-v1-job',
    jobId: 'existing-active-v1-job',
    status: 'RUNNING',
  }));

  assert.throws(
    () => integration.dispatch(packet('codex-job-v1-active-current')),
    /existing-active-v1-job is already RUNNING/,
  );
  assert.equal(spawnCalls, 0);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('malformed nonempty locks fail closed in place instead of quarantining a live replacement path', () => {
  const roots = tempRoots();
  let spawnCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'malformed-contender-lock-0001',
    dispatchLockLeaseMs: 1_000,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => {
      spawnCalls += 1;
      return { pid: 444, unref() {} };
    },
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  const malformedPath = join(integration.paths.dispatchLockPath, 'owner-malformed-lock-0001.json');
  writeFileSync(malformedPath, '{not-json');
  const staleTime = new Date('2026-07-30T23:00:00.000Z');
  utimesSync(malformedPath, staleTime, staleTime);
  utimesSync(integration.paths.dispatchLockPath, staleTime, staleTime);

  assert.throws(
    () => integration.dispatch(packet('codex-job-malformed-lock')),
    /LOCAL_CODEX_DISPATCH_LOCK_INVALID/,
  );
  assert.equal(spawnCalls, 0);
  assert.equal(readFileSync(malformedPath, 'utf8'), '{not-json');
  assert.deepEqual(readdirSync(integration.paths.dispatchLockPath), ['owner-malformed-lock-0001.json']);
});

test('legacy empty-lock recovery uses the global maximum grace rather than a contender lease', () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'short-lease-contender-lock-0001',
    dispatchLockLeaseMs: 1_000,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => assert.fail('a two-second-old legacy lock must remain within the global grace'),
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  const twoSecondsOld = new Date('2026-07-30T23:09:58.000Z');
  utimesSync(integration.paths.dispatchLockPath, twoSecondsOld, twoSecondsOld);
  assert.throws(
    () => integration.dispatch(packet('codex-job-global-lock-grace')),
    /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
  );
});

test('local integration reclaims an expired lock only when its same-host owner is definitively dead', () => {
  const roots = tempRoots();
  const lockId = 'abandoned-lock-0001';
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'replacement-lock-0001',
    dispatchLockLeaseMs: 1_000,
    dispatchLockHostname: 'test-host',
    dispatchLockBootStartedAtUtc: TEST_BOOT_STARTED_AT,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => ({ state: 'dead' }),
    spawnFn: () => ({ pid: 444, unref() {} }),
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  writeFileSync(
    join(integration.paths.dispatchLockPath, `owner-${lockId}.json`),
    `${JSON.stringify({
      schemaVersion: LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
      lockId,
      pid: 999_999,
      hostname: 'test-host',
      acquiredAtUtc: '2026-07-30T23:00:00.000Z',
      expiresAtUtc: '2026-07-30T23:00:01.000Z',
      leaseDurationMs: 1_000,
      processStartedAtUtc: '2026-07-30T22:59:00.000Z',
      bootStartedAtUtc: TEST_BOOT_STARTED_AT,
      bootId: TEST_BOOT_ID,
      processStartId: 'abandoned-process-generation',
    })}\n`,
  );
  const receipt = integration.dispatch(packet('codex-job-after-abandoned-lock'));
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.workerPid, 444);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('stale-lock recovery never overrides an active current job', () => {
  const roots = tempRoots();
  const lockId = 'abandoned-lock-active-job';
  let spawnCalls = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'replacement-lock-active-job',
    dispatchLockLeaseMs: 1_000,
    dispatchLockHostname: 'test-host',
    dispatchLockBootStartedAtUtc: TEST_BOOT_STARTED_AT,
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    dispatchLockProcessIdentityProbe: () => ({ state: 'dead' }),
    spawnFn: () => {
      spawnCalls += 1;
      return { pid: 444, unref() {} };
    },
  });
  mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
  writeFileSync(
    join(integration.paths.dispatchLockPath, `owner-${lockId}.json`),
    `${JSON.stringify({
      schemaVersion: LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
      lockId,
      pid: 999_999,
      hostname: 'test-host',
      acquiredAtUtc: '2026-07-30T23:00:00.000Z',
      expiresAtUtc: '2026-07-30T23:00:01.000Z',
      leaseDurationMs: 1_000,
      processStartedAtUtc: '2026-07-30T22:59:00.000Z',
      bootStartedAtUtc: TEST_BOOT_STARTED_AT,
      bootId: TEST_BOOT_ID,
      processStartId: 'abandoned-process-generation',
    })}\n`,
  );
  writeFileSync(integration.paths.currentPath, JSON.stringify({
    schemaVersion: 'stephanos.codex-dispatch-task.v1',
    kind: 'stephanos.codex_dispatch.local_task',
    taskId: 'existing-active-job',
    jobId: 'existing-active-job',
    status: 'RUNNING',
  }));
  assert.throws(
    () => integration.dispatch(packet('codex-job-must-not-replace-active')),
    /existing-active-job is already RUNNING/,
  );
  assert.equal(spawnCalls, 0);
  assert.equal(existsSync(integration.paths.dispatchLockPath), false);
});

test('local integration does not reclaim an expired lock whose owner is alive or unknowable', () => {
  for (const liveness of ['alive', 'unknown']) {
    const roots = tempRoots();
    const lockId = `retained-lock-${liveness}`;
    const integration = createLocalCodexExecIntegration({
      ...roots,
      now: () => '2026-07-30T23:10:00.000Z',
      lockIdFactory: () => `contender-lock-${liveness}`,
      dispatchLockLeaseMs: 1_000,
      dispatchLockHostname: 'test-host',
      dispatchLockBootStartedAtUtc: TEST_BOOT_STARTED_AT,
      dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
      dispatchLockProcessIdentityProbe: () => (
        liveness === 'alive'
          ? TEST_PROCESS_IDENTITY
          : { state: 'unknown' }
      ),
      spawnFn: () => assert.fail('spawn must not run without definitive stale-lock evidence'),
    });
    mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
    writeFileSync(
      join(integration.paths.dispatchLockPath, `owner-${lockId}.json`),
      `${JSON.stringify({
        schemaVersion: LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
        lockId,
        pid: 777,
        hostname: 'test-host',
        acquiredAtUtc: '2026-07-30T23:00:00.000Z',
        expiresAtUtc: '2026-07-30T23:00:01.000Z',
        leaseDurationMs: 1_000,
        processStartedAtUtc: '2026-07-30T22:59:00.000Z',
        bootStartedAtUtc: TEST_BOOT_STARTED_AT,
        bootId: TEST_BOOT_ID,
        processStartId: TEST_PROCESS_START_ID,
      })}\n`,
    );
    assert.throws(
      () => integration.dispatch(packet(`codex-job-${liveness}-lock`)),
      liveness === 'alive'
        ? /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/
        : /LOCAL_CODEX_DISPATCH_LOCK_OWNER_UNVERIFIABLE/,
    );
    assert.equal(existsSync(integration.paths.dispatchLockPath), true);
  }
});

test('expired owners are reclaimed when an exact boot or process generation proves PID reuse', () => {
  for (const [label, probedIdentity] of [
    ['previous-boot', { state: 'known', bootId: 'new-boot-generation', processStartId: TEST_PROCESS_START_ID }],
    ['reused-pid', { state: 'known', bootId: TEST_BOOT_ID, processStartId: 'new-process-generation' }],
  ]) {
    const roots = tempRoots();
    const integration = createLocalCodexExecIntegration({
      ...roots,
      now: () => '2026-07-30T23:10:00.000Z',
      lockIdFactory: () => `replacement-${label}-lock-0001`,
      dispatchLockHostname: 'test-host',
      dispatchLockBootStartedAtUtc: TEST_BOOT_STARTED_AT,
      dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
      dispatchLockProcessIdentityProbe: () => probedIdentity,
      spawnFn: () => ({ pid: 456, unref() {} }),
    });
    const owner = dispatchLockOwner({ lockId: `expired-${label}-lock-0001` });
    mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
    writeFileSync(
      join(integration.paths.dispatchLockPath, `owner-${owner.lockId}.json`),
      `${JSON.stringify(owner)}\n`,
    );
    const result = integration.dispatch(packet(`codex-job-${label}`));
    assert.equal(result.accepted, true);
    assert.equal(existsSync(integration.paths.dispatchLockPath), false);
  }
});

test('Linux zombie and terminal process states are dead lock owners', () => {
  const statLine = (state) => (
    `777 (node worker) ${[state, ...Array(18).fill('0'), '987654'].join(' ')}`
  );
  for (const state of ['Z', 'X', 'x']) {
    assert.deepEqual(
      parseLinuxDispatchLockProcessIdentity(statLine(state), TEST_BOOT_ID),
      { state: 'dead' },
    );
  }
  assert.deepEqual(
    parseLinuxDispatchLockProcessIdentity(statLine('S'), TEST_BOOT_ID),
    {
      state: 'known',
      bootId: TEST_BOOT_ID,
      processStartId: '987654',
    },
  );
});

test('persisted lock leases are bounded and temporally plausible', () => {
  for (const scenario of [
    {
      label: 'maximum-valid',
      owner: dispatchLockOwner({
        lockId: 'maximum-valid-lease-lock-0001',
        acquiredAtUtc: '2026-07-30T23:09:00.000Z',
        leaseDurationMs: 300_000,
      }),
      expected: /LOCAL_CODEX_DISPATCH_LOCK_CONTENDED/,
    },
    {
      label: 'maximum-plus-one',
      owner: dispatchLockOwner({
        lockId: 'oversized-lease-lock-0001',
        acquiredAtUtc: '2026-07-30T23:00:00.000Z',
        leaseDurationMs: 300_001,
      }),
      expected: /LOCAL_CODEX_DISPATCH_LOCK_INVALID/,
    },
    {
      label: 'future-acquisition',
      owner: dispatchLockOwner({
        lockId: 'future-acquisition-lock-0001',
        acquiredAtUtc: '2026-07-30T23:11:00.000Z',
        leaseDurationMs: 60_000,
      }),
      expected: /LOCAL_CODEX_DISPATCH_LOCK_INVALID/,
    },
  ]) {
    const roots = tempRoots();
    const integration = createLocalCodexExecIntegration({
      ...roots,
      now: () => '2026-07-30T23:10:00.000Z',
      lockIdFactory: () => `lease-contender-${scenario.label}-0001`,
      dispatchLockHostname: 'test-host',
      dispatchLockBootStartedAtUtc: TEST_BOOT_STARTED_AT,
      dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
      dispatchLockProcessIdentityProbe: () => TEST_PROCESS_IDENTITY,
      spawnFn: () => assert.fail('invalid or owned lease must not spawn'),
    });
    mkdirSync(integration.paths.dispatchLockPath, { recursive: true });
    writeFileSync(
      join(integration.paths.dispatchLockPath, `owner-${scenario.owner.lockId}.json`),
      `${JSON.stringify(scenario.owner)}\n`,
    );
    assert.throws(
      () => integration.dispatch(packet(`codex-job-lease-${scenario.label}`)),
      scenario.expected,
    );
  }
});

test('configured lease bounds are clamped before a complete owner is published', () => {
  for (const [configured, expected] of [[1, 1_000], [999_999, 300_000]]) {
    const roots = tempRoots();
    let observedLease = 0;
    const integration = createLocalCodexExecIntegration({
      ...roots,
      lockIdFactory: () => `clamped-lease-${expected}-lock`,
      dispatchLockLeaseMs: configured,
      dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
      dispatchLockBeforePublish({ owner }) {
        observedLease = owner.leaseDurationMs;
      },
      spawnFn: () => ({ pid: 456, unref() {} }),
    });
    assert.equal(integration.dispatch(packet(`codex-job-clamped-${expected}`)).accepted, true);
    assert.equal(observedLease, expected);
  }
});

test('lock-path filesystem faults are surfaced as I/O failures, not contention', () => {
  const roots = tempRoots();
  const integration = createLocalCodexExecIntegration({
    ...roots,
    lockIdFactory: () => 'io-failure-contender-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => assert.fail('filesystem faults must fail before spawn'),
  });
  mkdirSync(integration.paths.dispatchRoot, { recursive: true });
  writeFileSync(integration.paths.dispatchLockPath, 'not-a-directory');
  assert.throws(
    () => integration.dispatch(packet('codex-job-lock-io-failure')),
    /LOCAL_CODEX_DISPATCH_LOCK_IO_FAILED/,
  );
});

test('local integration recovers a stale empty legacy lock but preserves a fresh one', () => {
  const staleRoots = tempRoots();
  const staleIntegration = createLocalCodexExecIntegration({
    ...staleRoots,
    now: () => '2026-07-30T23:10:00.000Z',
    lockIdFactory: () => 'legacy-recovery-lock-0001',
    dispatchLockLeaseMs: 1_000,
    spawnFn: () => ({ pid: 555, unref() {} }),
  });
  mkdirSync(staleIntegration.paths.dispatchLockPath, { recursive: true });
  const staleTime = new Date('2026-07-30T23:00:00.000Z');
  utimesSync(staleIntegration.paths.dispatchLockPath, staleTime, staleTime);
  assert.equal(staleIntegration.dispatch(packet('codex-job-after-legacy-lock')).accepted, true);

  const freshRoots = tempRoots();
  const freshIntegration = createLocalCodexExecIntegration({
    ...freshRoots,
    lockIdFactory: () => 'fresh-contender-lock-0001',
    dispatchLockLeaseMs: 60_000,
    spawnFn: () => assert.fail('fresh empty lock must remain fail-closed'),
  });
  mkdirSync(freshIntegration.paths.dispatchLockPath, { recursive: true });
  assert.throws(
    () => freshIntegration.dispatch(packet('codex-job-fresh-legacy-lock')),
    /another dispatch is claiming the one-active-job slot/,
  );
});

test('an old lock owner cannot release a newer replacement owner', () => {
  const roots = tempRoots();
  let integration;
  integration = createLocalCodexExecIntegration({
    ...roots,
    lockIdFactory: () => 'original-owner-lock-0001',
    spawnFn: () => {
      const [ownerFilename] = readdirSync(integration.paths.dispatchLockPath);
      unlinkSync(join(integration.paths.dispatchLockPath, ownerFilename));
      writeFileSync(
        join(integration.paths.dispatchLockPath, 'owner-replacement-owner-lock-0001.json'),
        `${JSON.stringify({
          schemaVersion: LOCAL_CODEX_DISPATCH_LOCK_SCHEMA,
          lockId: 'replacement-owner-lock-0001',
          pid: 888,
          hostname: 'test-host',
          acquiredAtUtc: '2026-07-30T23:10:00.000Z',
          expiresAtUtc: '2026-07-30T23:11:00.000Z',
          leaseDurationMs: 60_000,
          processStartedAtUtc: '2026-07-30T23:00:00.000Z',
          bootStartedAtUtc: TEST_BOOT_STARTED_AT,
          bootId: TEST_BOOT_ID,
          processStartId: 'replacement-process-generation',
        })}\n`,
      );
      return { pid: 666, unref() {} };
    },
  });
  const receipt = integration.dispatch(packet('codex-job-owner-replaced'));
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.lockReleased, false);
  assert.equal(receipt.blocker, 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED');
  assert.equal(receipt.lockRelease.reason, 'owner-changed');
  assert.deepEqual(
    readdirSync(integration.paths.dispatchLockPath),
    ['owner-replacement-owner-lock-0001.json'],
  );
  const persisted = JSON.parse(readFileSync(
    resolveLocalCodexDispatchPaths({
      ...roots,
      jobId: 'codex-job-owner-replaced',
    }).receiptPath,
    'utf8',
  ));
  assert.equal(persisted.lockReleased, false);
  assert.equal(persisted.lockRelease.blocker, 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED');
});

test('release directory failure is returned and persisted without hiding the spawned worker', () => {
  const roots = tempRoots();
  let integration;
  integration = createLocalCodexExecIntegration({
    ...roots,
    lockIdFactory: () => 'release-directory-failure-lock-0001',
    dispatchLockProcessIdentity: TEST_PROCESS_IDENTITY,
    spawnFn: () => {
      writeFileSync(join(integration.paths.dispatchLockPath, 'unexpected-entry'), 'blocks rmdir');
      return { pid: 777, unref() {} };
    },
  });
  const receipt = integration.dispatch(packet('codex-job-release-directory-failure'));
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.workerPid, 777);
  assert.equal(receipt.lockReleased, false);
  assert.equal(receipt.blocker, 'LOCAL_CODEX_DISPATCH_LOCK_RELEASE_FAILED');
  assert.equal(['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(receipt.lockRelease.reason), true);
  const persisted = JSON.parse(readFileSync(
    resolveLocalCodexDispatchPaths({
      ...roots,
      jobId: 'codex-job-release-directory-failure',
    }).receiptPath,
    'utf8',
  ));
  assert.equal(persisted.accepted, true);
  assert.equal(persisted.lockReleased, false);
});

test('local integration refuses to overwrite a terminal task with the same id', () => {
  const roots = tempRoots();
  const paths = resolveLocalCodexDispatchPaths({ ...roots, jobId: 'codex-job-terminal' });
  mkdirSync(paths.taskRoot, { recursive: true });
  writeFileSync(paths.statusPath, JSON.stringify({ jobId: 'codex-job-terminal', status: 'DONE' }));
  const integration = createLocalCodexExecIntegration({
    ...roots,
    spawnFn: () => ({ pid: 111, unref() {} }),
  });
  assert.throws(() => integration.dispatch(packet('codex-job-terminal')), /already exists/);
});

test('worker spawn failure writes terminal truth and does not strand the one-active-job gate', () => {
  const roots = tempRoots();
  let attempt = 0;
  const integration = createLocalCodexExecIntegration({
    ...roots,
    idFactory: () => `receipt-${attempt}`,
    spawnFn: () => {
      attempt += 1;
      if (attempt === 1) throw new Error('synthetic launch failure');
      return { pid: 222, unref() {} };
    },
  });

  assert.throws(() => integration.dispatch(packet('codex-job-launch-fails')), /failed to launch/);
  const failedStatus = integration.readStatus('codex-job-launch-fails');
  const failedResult = integration.readResult('codex-job-launch-fails');
  assert.equal(failedStatus.status, 'BLOCKED');
  assert.equal(failedStatus.blocker, 'LOCAL_CODEX_WORKER_LAUNCH_FAILED');
  assert.equal(failedResult.resultAvailable, true);
  const failedPaths = resolveLocalCodexDispatchPaths({ ...roots, jobId: 'codex-job-launch-fails' });
  const failedReceipt = JSON.parse(readFileSync(failedPaths.receiptPath, 'utf8'));
  assert.equal(failedReceipt.accepted, false);
  assert.equal(failedReceipt.started, false);

  const next = integration.dispatch(packet('codex-job-after-launch-failure'));
  assert.equal(next.accepted, true);
  assert.equal(next.workerPid, 222);
});

test('status and result readers are bounded to safe job ids', () => {
  const roots = tempRoots();
  const paths = resolveLocalCodexDispatchPaths({ ...roots, jobId: 'codex-job-readable' });
  mkdirSync(paths.taskRoot, { recursive: true });
  writeFileSync(paths.statusPath, JSON.stringify({ status: 'RUNNING' }));
  writeFileSync(paths.resultPath, JSON.stringify({ verdict: 'PASS' }));
  assert.equal(readLocalCodexTaskStatus('codex-job-readable', roots).status, 'RUNNING');
  assert.equal(readLocalCodexTaskResult('codex-job-readable', roots).verdict, 'PASS');
  assert.throws(() => readLocalCodexTaskStatus('../escape', roots), /Unsafe Codex job id/);
});

test('worker dirt classification permits generated dist but identifies source dirt', () => {
  const output = ' M apps/stephanos/dist/index.html\n?? apps/stephanos/dist/assets/new.js\n M scripts/unsafe.mjs\n';
  assert.deepEqual(parseGitStatusPaths(output), ['apps/stephanos/dist/index.html', 'apps/stephanos/dist/assets/new.js', 'scripts/unsafe.mjs']);
  const classified = classifyPostTaskDirt(output);
  assert.deepEqual(classified.generated, ['apps/stephanos/dist/index.html', 'apps/stephanos/dist/assets/new.js']);
  assert.deepEqual(classified.source, ['scripts/unsafe.mjs']);
  assert.equal(classified.safe, false);
  assert.equal(classifyPostTaskDirt(' M apps/stephanos/dist/index.html\n').safe, true);
});

test('unchanged pre-existing source dirt is reported but not falsely attributed to the dispatched task', () => {
  const before = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n M apps/stephanos/dist/index.html\n');
  const after = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n M apps/stephanos/dist/index.html\n');
  const delta = compareDirtSnapshots(before, after);
  assert.equal(delta.preExistingSourceDirt, true);
  assert.equal(delta.sourceMutationDetected, false);
  assert.equal(delta.generatedRuntimeMutationDetected, false);
  assert.equal(delta.sourceDirtUnchanged, true);
  assert.deepEqual(delta.newSourcePaths, []);
  assert.deepEqual(delta.removedSourcePaths, []);
});

test('new or removed source dirt is classified as a task-time mutation', () => {
  const before = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n');
  const after = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n?? scripts/new-file.mjs\n');
  const delta = compareDirtSnapshots(before, after);
  assert.equal(delta.sourceMutationDetected, true);
  assert.deepEqual(delta.newSourcePaths, ['scripts/new-file.mjs']);
});

test('exact-head source safety requires both status snapshots, while non-exact work keeps delta semantics', () => {
  const shared = {
    sourceHeadBefore: { ok: true, stdout: 'a'.repeat(40) },
    sourceHeadAfter: { ok: true, stdout: 'a'.repeat(40) },
    dirtBefore: classifyPostTaskDirt(' M scripts/pre-existing.mjs\n'),
    dirtAfter: classifyPostTaskDirt(' M scripts/pre-existing.mjs\n'),
    dirtDelta: { sourceMutationDetected: false },
  };
  const exact = evaluateWorkerSourceSafety({
    ...shared,
    exactHeadRequired: true,
    expectedHead: 'a'.repeat(40),
    statusBefore: { ok: true },
    statusAfter: { ok: false },
  });
  assert.equal(exact.sourceSafe, false);
  assert.equal(exact.exactHeadStatusAvailable, false);
  assert.equal(exact.exactHeadSourceClean, false);
  assert.equal(exact.exactHeadRuntimeBound, false);

  const nonExact = evaluateWorkerSourceSafety({
    ...shared,
    exactHeadRequired: false,
    statusBefore: { ok: false },
    statusAfter: { ok: false },
  });
  assert.equal(nonExact.sourceSafe, true);
  assert.equal(nonExact.exactHeadStatusAvailable, true);
  assert.equal(nonExact.exactHeadSourceClean, true);
  assert.equal(nonExact.exactHeadRuntimeBound, true);
});

test('exact-head source safety also binds the frozen canonical dist fingerprint', () => {
  const shared = {
    exactHeadRequired: true,
    expectedHead: 'a'.repeat(40),
    expectedDistFingerprint: DIST_FINGERPRINT,
    sourceHeadBefore: { ok: true, stdout: 'a'.repeat(40) },
    sourceHeadAfter: { ok: true, stdout: 'a'.repeat(40) },
    statusBefore: { ok: true },
    statusAfter: { ok: true },
    dirtBefore: classifyPostTaskDirt(' M apps/stephanos/dist/index.html\n'),
    dirtAfter: classifyPostTaskDirt(' M apps/stephanos/dist/index.html\n'),
    dirtDelta: {
      sourceMutationDetected: false,
      generatedRuntimeMutationDetected: false,
    },
  };
  const matching = evaluateWorkerSourceSafety({
    ...shared,
    runtimeDistFingerprintAfter: DIST_FINGERPRINT,
  });
  assert.equal(matching.sourceSafe, true);
  assert.equal(matching.exactHeadRuntimeBound, true);

  const changed = evaluateWorkerSourceSafety({
    ...shared,
    runtimeDistFingerprintAfter: 'e'.repeat(64),
  });
  assert.equal(changed.sourceSafe, false);
  assert.equal(changed.exactHeadRuntimeBound, false);
});

test('worker invocation keeps approval policy global and isolates the exec child by ignoring user config', () => {
  const windows = resolveCodexExecInvocation({ platform: 'win32', env: { STEPHANOS_CODEX_COMMAND: 'codex.cmd' }, lastMessagePath: 'C:\\proof\\last.txt' });
  assert.equal(windows.command, 'cmd.exe');
  assert.deepEqual(windows.args.slice(0, 4), ['/d', '/s', '/c', 'codex.cmd']);
  assert.deepEqual(windows.codexArgs.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
  const execIndex = windows.codexArgs.indexOf('exec');
  assert.equal(windows.codexArgs.slice(execIndex + 1).includes('--ask-for-approval'), false);
  assert.equal(windows.codexArgs.includes('--json'), true);
  assert.equal(windows.codexArgs.includes('--ephemeral'), true);
  assert.equal(windows.codexArgs.includes('--ignore-user-config'), true);
  assert.equal(windows.codexArgs.includes('read-only'), true);
  assert.equal(windows.codexArgs.includes('workspace-write'), false);
  assert.equal(windows.codexArgs.includes('--config'), false);
  assert.equal(windows.codexArgs.some((arg) => String(arg).includes('mcp_servers.')), false);
  assert.equal(windows.args.at(-1), '-');

  const promptText = buildGuardedCodexPrompt({
    prompt: 'Prove ignition.',
    repoRoot: 'C:\\repo',
    requestedProofCommands: ['git rev-parse HEAD'],
  });
  assert.match(promptText, /Do not push, merge, delete branches/);
  assert.match(promptText, /Do not modify source files/);
  assert.match(promptText, /Do not call MCP tools/);
  assert.match(promptText, /read-only and non-interactive/);
  assert.match(promptText, /User configuration is not loaded/);
  assert.match(promptText, /git rev-parse HEAD/);
});

test('exact-head browser prompt leaves scenario evidence to the worker-owned Playwright runner', () => {
  const promptText = buildGuardedCodexPrompt({
    ...packet(),
    repoRoot: 'C:\\repo',
  });
  assert.match(promptText, /Return only one JSON object/);
  assert.match(promptText, /"proofScenario":"MUSIC_RATING_PRESERVES_PLAYBACK"/);
  assert.match(promptText, /worker-owned Playwright runner/);
  assert.match(promptText, /sole authority for scenario evidence/);
  assert.match(promptText, /Do not self-attest scenario booleans or browser facts/);
  assert.doesNotMatch(promptText, /listeningDeckIframeIdentityPreserved/);
  assert.doesNotMatch(promptText, /runtimeSourceHead/);
  assert.match(promptText, /PASS is forbidden/);
});

test('worker source invokes the exported guarded prompt builder without a misspelled call site', () => {
  const workerSource = readFileSync(new URL('../../scripts/stephanos-codex-dispatch-worker.mjs', import.meta.url), 'utf8');
  const integrationSource = readFileSync(new URL('./localCodexExecIntegration.mjs', import.meta.url), 'utf8');
  assert.match(workerSource, /const prompt = buildGuardedCodexPrompt\(task\);/);
  assert.doesNotMatch(workerSource, /buildGuaredCodexPrompt/);
  for (const source of [workerSource, integrationSource]) {
    assert.match(source, /const tempPath = `\$\{path\}\.\$\{process\.pid\}\.\$\{randomUUID\(\)\}\.tmp`;/);
    assert.match(source, /renameSync\(tempPath, path\);/);
  }
});

test('JSON event parsing and completed-turn classification prove a successful Codex run', () => {
  const parsed = parseCodexJsonEvents([
    '{"type":"thread.started","thread_id":"thread-1"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"PASS"}}',
    '{"type":"turn.completed"}',
  ].join('\n'));
  assert.equal(parsed.invalidLines.length, 0);
  const execution = classifyCodexExecution({ exit: { code: 0, error: '' }, events: parsed.events, lastMessage: 'PASS' });
  assert.equal(execution.passed, true);
  assert.equal(execution.turnCompleted, true);
  assert.equal(execution.reason, '');
});

test('exact-head Codex execution requires the machine-readable final verdict contract', () => {
  const events = [{ type: 'turn.started' }, { type: 'turn.completed' }];
  const missing = classifyCodexExecution({
    exit: { code: 0, error: '' },
    events,
    lastMessage: 'The browser proof looks good.',
    requiresStructuredVerdict: true,
    expectedProofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
  });
  assert.equal(missing.passed, false);
  assert.equal(missing.reason, 'CODEX_STRUCTURED_VERDICT_MISSING');

  const blocked = classifyCodexExecution({
    exit: { code: 0, error: '' },
    events,
    lastMessage: JSON.stringify({
      verdict: 'PASS',
      proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
      blockers: ['BROWSER_PROOF_NOT_OBSERVED'],
    }),
    requiresStructuredVerdict: true,
    expectedProofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
  });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.reason, 'CODEX_STRUCTURED_VERDICT_BLOCKERS_REMAIN');

  const passed = classifyCodexExecution({
    exit: { code: 0, error: '' },
    events,
    lastMessage: JSON.stringify({
      verdict: 'PASS',
      proofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
      blockers: [],
    }),
    requiresStructuredVerdict: true,
    expectedProofScenario: 'MUSIC_RATING_PRESERVES_PLAYBACK',
  });
  assert.equal(passed.passed, true);
  assert.equal(passed.structuredVerdictPresent, true);
});

test('exit zero with user-cancelled MCP text cannot be misreported as success', () => {
  const parsed = parseCodexJsonEvents('{"type":"turn.started"}\n');
  const execution = classifyCodexExecution({ exit: { code: 0, error: '' }, events: parsed.events, lastMessage: 'user cancelled MCP tool call' });
  assert.equal(execution.passed, false);
  assert.equal(execution.cancelled, true);
  assert.equal(execution.reason, 'CODEX_EXEC_CANCELLED');
});

test('turn.failed and error JSON events remain failures even when the process exits zero', () => {
  for (const type of ['turn.failed', 'error']) {
    const execution = classifyCodexExecution({
      exit: { code: 0, error: '' },
      events: [{ type }],
      lastMessage: '',
    });
    assert.equal(execution.passed, false);
    assert.equal(execution.failureEventType, type);
    assert.match(execution.reason, /^CODEX_EVENT_/);
  }
});

test('missing turn.completed is a deterministic failure rather than an assumed pass', () => {
  const execution = classifyCodexExecution({
    exit: { code: 0, error: '' },
    events: [{ type: 'thread.started' }, { type: 'turn.started' }],
    lastMessage: 'Partial output',
  });
  assert.equal(execution.passed, false);
  assert.equal(execution.reason, 'CODEX_TURN_COMPLETION_MISSING');
});

test('zero-event CLI startup failures retain bounded stderr instead of becoming opaque codex-exit-1', () => {
  const execution = classifyCodexExecution({
    exit: { code: 2, error: '' },
    events: [],
    stderr: "error: unexpected argument '--ask-for-approval' found",
  });
  assert.equal(execution.passed, false);
  assert.equal(execution.reason, 'CODEX_CLI_STARTUP_FAILED');
  assert.match(execution.stderrExcerpt, /unexpected argument '--ask-for-approval'/);
});
