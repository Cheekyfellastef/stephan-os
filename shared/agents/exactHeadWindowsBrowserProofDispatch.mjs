import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createCodexQueueRecord, transitionCodexQueueRecord } from './codexDispatchQueue.mjs';
import { dispatchQueuedCodexJob } from './automatedCodexDispatcher.mjs';
import { createLocalCodexExecIntegration } from './localCodexExecIntegration.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;
const CANONICAL_BROWSER_PROOF_URL = 'http://127.0.0.1:4173/apps/stephanos/dist/index.html';
export const WINDOWS_BROWSER_PROOF_TARGETS = Object.freeze({
  PULL_REQUEST_HEAD: 'PULL_REQUEST_HEAD',
  MERGED_MAIN: 'MERGED_MAIN',
});

const SCENARIO_PROMPTS = Object.freeze({
  MUSIC_RATING_PRESERVES_PLAYBACK: [
    'Run the Music Tile in Microsoft Edge on this Windows Battle Bridge.',
    'First prove git HEAD exactly matches the requested proof target head; otherwise stop with EXPECTED_HEAD_MISMATCH.',
    'Mount a Listening Deck Spotify iframe and a verified Discovery Spotify iframe.',
    'Retain direct references to both iframe DOM nodes, click a rating button, and prove both references remain strictly identical and isConnected after the click.',
    'Prove the non-player legacy discovery ranking changed truthfully and capture browser console errors.',
    'Read the full Git Commit from the live Edge DOM and return it as runtimeSourceHead; it must exactly equal the requested head.',
    'Do not substitute source inspection, regex assertions, DOM emulation, or Linux browser results.',
  ].join(' '),
});

export function createWindowsSafeBrowserProofJobId(requestId = '') {
  const digest = createHash('sha256').update(String(requestId)).digest('hex').slice(0, 32);
  return `windows-browser-proof-${digest}`;
}

export function buildExactHeadWindowsBrowserProofPacket(command = {}, timestampUtc = new Date().toISOString()) {
  const prompt = SCENARIO_PROMPTS[command.proofScenario];
  if (!prompt) throw new Error('WINDOWS_BROWSER_PROOF_SCENARIO_NOT_ALLOWED');
  const expectedHead = String(command.expectedHead).toLowerCase();
  const proofTarget = String(command.proofTarget || WINDOWS_BROWSER_PROOF_TARGETS.PULL_REQUEST_HEAD);
  const pullRequestHead = String(command.pullRequestHead || '').toLowerCase();
  const targetDescription = proofTarget === WINDOWS_BROWSER_PROOF_TARGETS.MERGED_MAIN
    ? `merged main head ${expectedHead}; PR provenance head ${pullRequestHead}`
    : `pull-request head ${expectedHead}`;
  const created = createCodexQueueRecord({
    jobId: createWindowsSafeBrowserProofJobId(command.requestId),
    issueNumber: 1507,
    branch: 'main',
    prompt: `PR #${command.prNumber}; ${targetDescription}. ${prompt}`,
    requestedProofCommands: [
      'git rev-parse HEAD',
      `node scripts/browser-proof-runner.mjs --url ${CANONICAL_BROWSER_PROOF_URL} --expected-head ${expectedHead} --proof-target ${proofTarget} --proof-scenario ${command.proofScenario} --no-artifacts --machine-json`,
    ],
    exactHeadProof: {
      repository: REPOSITORY,
      prNumber: Number(command.prNumber),
      expectedHead,
      proofTarget,
      pullRequestHead,
      mergeCommitHead: String(command.mergeCommitHead || '').toLowerCase(),
      githubMainHead: String(command.githubMainHead || '').toLowerCase(),
      mergeCommitIncluded: command.mergeCommitIncluded === true,
      proofScenario: String(command.proofScenario),
    },
    createdAt: timestampUtc,
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: true,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
    },
  });
  const waiting = transitionCodexQueueRecord(created, 'WAITING_OPERATOR_APPROVAL', {
    timestamp: timestampUtc,
    reason: 'GitHub mailbox received an owner-authored bounded Windows browser-proof request.',
  });
  if (!waiting.valid) throw new Error('WINDOWS_BROWSER_PROOF_QUEUE_APPROVAL_STATE_FAILED');
  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', {
    timestamp: timestampUtc,
    reason: 'Operator approval was validated by the Battle Bridge mailbox.',
    approvalReceipt: `mailbox-${command.requestId}`,
  });
  if (!ready.valid) throw new Error('WINDOWS_BROWSER_PROOF_QUEUE_READY_STATE_FAILED');
  return ready.record;
}

function captureHead(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
    windowsHide: true,
  });
  const head = String(result.stdout || '').trim().toLowerCase();
  if (result.error || result.status !== 0 || !EXACT_GIT_HEAD.test(head)) {
    return { ok: false, blocker: options.blocker };
  }
  return { ok: true, head };
}

export function readGitHubPullRequestIdentity(prNumber) {
  const result = spawnSync('gh.exe', [
    'api',
    `repos/${REPOSITORY}/pulls/${Number(prNumber)}`,
  ], {
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) return { ok: false, blocker: 'PR_IDENTITY_LOOKUP_FAILED' };
  try {
    const value = JSON.parse(String(result.stdout || ''));
    const head = String(value?.head?.sha || '').trim().toLowerCase();
    const mergeCommitHead = String(value?.merge_commit_sha || '').trim().toLowerCase();
    const baseBranch = String(value?.base?.ref || '').trim();
    if (!EXACT_GIT_HEAD.test(head)) return { ok: false, blocker: 'PR_IDENTITY_INVALID' };
    return {
      ok: true,
      head,
      merged: value?.merged === true,
      state: String(value?.state || '').trim().toLowerCase(),
      mergeCommitHead: EXACT_GIT_HEAD.test(mergeCommitHead) ? mergeCommitHead : '',
      baseBranch,
    };
  } catch {
    return { ok: false, blocker: 'PR_IDENTITY_JSON_INVALID' };
  }
}

export const readGitHubPullRequestHead = readGitHubPullRequestIdentity;

export function readGitHubMainHead() {
  return captureHead('gh.exe', [
    'api',
    `repos/${REPOSITORY}/commits/main`,
    '--jq',
    '.sha',
  ], { blocker: 'GITHUB_MAIN_HEAD_LOOKUP_FAILED' });
}

export function createProofGitEnvironment(environment = process.env, platform = process.platform) {
  const sanitized = { ...environment };
  for (const key of Object.keys(sanitized)) {
    if (key.toUpperCase().startsWith('GIT_')) delete sanitized[key];
  }
  return Object.freeze({
    ...sanitized,
    GIT_CONFIG_GLOBAL: platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  });
}

export function readMergeCommitAncestry(repoRoot, ancestorHead, descendantHead, {
  spawnSyncFn = spawnSync,
  platform = process.platform,
} = {}) {
  if (!String(repoRoot || '').trim()
    || !EXACT_GIT_HEAD.test(String(ancestorHead || ''))
    || !EXACT_GIT_HEAD.test(String(descendantHead || ''))) {
    return { ok: false, blocker: 'MERGE_ANCESTRY_LOOKUP_FAILED' };
  }
  const result = spawnSyncFn('git.exe', ['merge-base', '--is-ancestor', ancestorHead, descendantHead], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
    windowsHide: true,
    env: createProofGitEnvironment(process.env, platform),
  });
  if (!result.error && result.status === 0) return { ok: true, included: true };
  if (!result.error && result.status === 1) return { ok: true, included: false };
  return { ok: false, blocker: 'MERGE_ANCESTRY_LOOKUP_FAILED' };
}

export function readWindowsCheckoutHead(repoRoot) {
  if (!String(repoRoot || '').trim()) return { ok: false, blocker: 'LOCAL_HEAD_LOOKUP_FAILED' };
  return captureHead('git.exe', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    blocker: 'LOCAL_HEAD_LOOKUP_FAILED',
  });
}

function normalizeHeadResult(result, fallbackBlocker) {
  if (typeof result === 'string') {
    const head = result.trim().toLowerCase();
    return EXACT_GIT_HEAD.test(head) ? { ok: true, head } : { ok: false, blocker: fallbackBlocker };
  }
  const head = String(result?.head || '').trim().toLowerCase();
  if (result?.ok === true && EXACT_GIT_HEAD.test(head)) return { ok: true, head };
  return { ok: false, blocker: String(result?.blocker || fallbackBlocker) };
}

function normalizePullRequestIdentity(result, fallbackBlocker) {
  const normalized = normalizeHeadResult(result, fallbackBlocker);
  if (!normalized.ok) return normalized;
  return {
    ...normalized,
    merged: result?.merged === true,
    state: String(result?.state || '').trim().toLowerCase(),
    mergeCommitHead: String(result?.mergeCommitHead || result?.mergeCommit || '').trim().toLowerCase(),
    baseBranch: String(result?.baseBranch || result?.base || '').trim(),
  };
}

function validateProofTarget(command, pullRequest) {
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  const proofTarget = String(command.proofTarget || WINDOWS_BROWSER_PROOF_TARGETS.PULL_REQUEST_HEAD);
  if (proofTarget === WINDOWS_BROWSER_PROOF_TARGETS.PULL_REQUEST_HEAD) {
    return pullRequest.head === expectedHead
      ? { ok: true, proofTarget, pullRequestHead: pullRequest.head, mergeCommitHead: '' }
      : { ok: false, blocker: 'PR_HEAD_MISMATCH', pullRequestHead: pullRequest.head };
  }
  if (proofTarget !== WINDOWS_BROWSER_PROOF_TARGETS.MERGED_MAIN) {
    return { ok: false, blocker: 'WINDOWS_BROWSER_PROOF_TARGET_NOT_ALLOWED' };
  }
  const provenanceHead = String(command.pullRequestHead || '').trim().toLowerCase();
  if (!EXACT_GIT_HEAD.test(provenanceHead)) return { ok: false, blocker: 'PR_PROVENANCE_HEAD_REQUIRED' };
  if (pullRequest.head !== provenanceHead) return { ok: false, blocker: 'PR_HEAD_MISMATCH', pullRequestHead: pullRequest.head };
  if (pullRequest.merged !== true || pullRequest.state !== 'closed') return { ok: false, blocker: 'PR_NOT_MERGED', pullRequestHead: pullRequest.head };
  if (pullRequest.baseBranch !== 'main') return { ok: false, blocker: 'PR_BASE_BRANCH_MISMATCH', pullRequestHead: pullRequest.head };
  if (!EXACT_GIT_HEAD.test(pullRequest.mergeCommitHead)) {
    return {
      ok: false,
      blocker: 'PR_MERGE_COMMIT_INVALID',
      pullRequestHead: pullRequest.head,
      mergeCommitHead: pullRequest.mergeCommitHead,
    };
  }
  return {
    ok: true,
    proofTarget,
    pullRequestHead: pullRequest.head,
    mergeCommitHead: pullRequest.mergeCommitHead,
  };
}

function blocked(command, blocker, details = {}) {
  return {
    prNumber: Number(command.prNumber),
    expectedHead: String(command.expectedHead).toLowerCase(),
    proofTarget: String(command.proofTarget || WINDOWS_BROWSER_PROOF_TARGETS.PULL_REQUEST_HEAD),
    pullRequestHead: String(command.pullRequestHead || '').toLowerCase(),
    proofScenario: String(command.proofScenario),
    ...details,
    ok: false,
    finalVerdict: 'WINDOWS_BROWSER_PROOF_DISPATCH_BLOCKED',
    blocker,
    executionSurface: 'WINDOWS_BATTLE_BRIDGE_EDGE',
    mergeAuthority: false,
    sourceMutationAuthority: false,
  };
}

export async function dispatchExactHeadWindowsBrowserProof(command, {
  platform = process.platform,
  integration = null,
  now = () => new Date().toISOString(),
  readPullRequestHead = readGitHubPullRequestIdentity,
  readMainHead = readGitHubMainHead,
  readLocalHead = readWindowsCheckoutHead,
  readMergeAncestry = readMergeCommitAncestry,
} = {}) {
  if (platform !== 'win32') return { ok: false, blocker: 'WINDOWS_EXECUTION_SURFACE_REQUIRED' };
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  if (!EXACT_GIT_HEAD.test(expectedHead)) return blocked(command, 'EXPECTED_HEAD_INVALID');

  const pullRequest = normalizePullRequestIdentity(
    await readPullRequestHead(Number(command.prNumber)),
    'PR_IDENTITY_LOOKUP_FAILED',
  );
  if (!pullRequest.ok) return blocked(command, pullRequest.blocker);
  const target = validateProofTarget(command, pullRequest);
  if (!target.ok) return blocked(command, target.blocker, target);

  const activeIntegration = integration || createLocalCodexExecIntegration();
  let githubMainHead = '';
  let mergeCommitIncluded = false;
  if (target.proofTarget === WINDOWS_BROWSER_PROOF_TARGETS.MERGED_MAIN) {
    const main = normalizeHeadResult(await readMainHead(), 'GITHUB_MAIN_HEAD_LOOKUP_FAILED');
    if (!main.ok) return blocked(command, main.blocker, target);
    githubMainHead = main.head;
    if (githubMainHead !== expectedHead) {
      return blocked(command, 'GITHUB_MAIN_HEAD_MISMATCH', { ...target, githubMainHead });
    }
    const ancestry = await readMergeAncestry(
      activeIntegration?.paths?.repoRoot,
      target.mergeCommitHead,
      expectedHead,
    );
    if (ancestry?.ok !== true) {
      return blocked(command, String(ancestry?.blocker || 'MERGE_ANCESTRY_LOOKUP_FAILED'), {
        ...target,
        githubMainHead,
      });
    }
    if (ancestry.included !== true) {
      return blocked(command, 'PR_MERGE_NOT_IN_EXPECTED_MAIN', { ...target, githubMainHead });
    }
    mergeCommitIncluded = true;
  }
  const proofContext = {
    ...target,
    githubMainHead,
    mergeCommitIncluded,
  };
  const checkout = normalizeHeadResult(
    await readLocalHead(activeIntegration?.paths?.repoRoot),
    'LOCAL_HEAD_LOOKUP_FAILED',
  );
  if (!checkout.ok) return blocked(command, checkout.blocker, proofContext);
  if (checkout.head !== expectedHead) {
    return blocked(command, 'EXPECTED_HEAD_MISMATCH', {
      ...proofContext,
      localHead: checkout.head,
    });
  }

  const timestampUtc = now();
  const packet = buildExactHeadWindowsBrowserProofPacket({
    ...command,
    mergeCommitHead: proofContext.mergeCommitHead,
    githubMainHead,
    mergeCommitIncluded,
  }, timestampUtc);
  const pullRequestRecheck = normalizePullRequestIdentity(
    await readPullRequestHead(Number(command.prNumber)),
    'PR_IDENTITY_RECHECK_FAILED',
  );
  if (!pullRequestRecheck.ok) return blocked(command, pullRequestRecheck.blocker, { ...proofContext, localHead: checkout.head });
  const targetRecheck = validateProofTarget(command, pullRequestRecheck);
  if (!targetRecheck.ok) return blocked(command, targetRecheck.blocker, { ...targetRecheck, localHead: checkout.head });
  if (JSON.stringify(targetRecheck) !== JSON.stringify(target)) {
    return blocked(command, 'PR_IDENTITY_CHANGED_DURING_DISPATCH', { ...targetRecheck, localHead: checkout.head });
  }
  if (target.proofTarget === WINDOWS_BROWSER_PROOF_TARGETS.MERGED_MAIN) {
    const mainRecheck = normalizeHeadResult(await readMainHead(), 'GITHUB_MAIN_HEAD_RECHECK_FAILED');
    if (!mainRecheck.ok) return blocked(command, mainRecheck.blocker, { ...proofContext, localHead: checkout.head });
    if (mainRecheck.head !== githubMainHead || mainRecheck.head !== expectedHead) {
      return blocked(command, 'GITHUB_MAIN_HEAD_CHANGED_DURING_DISPATCH', {
        ...proofContext,
        githubMainHead: mainRecheck.head,
        localHead: checkout.head,
      });
    }
    const ancestryRecheck = await readMergeAncestry(
      activeIntegration?.paths?.repoRoot,
      target.mergeCommitHead,
      expectedHead,
    );
    if (ancestryRecheck?.ok !== true || ancestryRecheck.included !== true) {
      return blocked(command, ancestryRecheck?.ok === true
        ? 'PR_MERGE_NOT_IN_EXPECTED_MAIN'
        : String(ancestryRecheck?.blocker || 'MERGE_ANCESTRY_RECHECK_FAILED'), {
        ...proofContext,
        localHead: checkout.head,
      });
    }
  }
  const checkoutRecheck = normalizeHeadResult(
    await readLocalHead(activeIntegration?.paths?.repoRoot),
    'LOCAL_HEAD_RECHECK_FAILED',
  );
  if (!checkoutRecheck.ok) return blocked(command, checkoutRecheck.blocker, { ...proofContext, localHead: checkout.head });
  if (checkoutRecheck.head !== checkout.head || checkoutRecheck.head !== expectedHead) {
    return blocked(command, 'LOCAL_HEAD_CHANGED_DURING_DISPATCH', {
      ...proofContext,
      localHead: checkoutRecheck.head,
    });
  }
  const dispatcher = dispatchQueuedCodexJob({
    queueRecord: packet,
    integration: activeIntegration,
    now: timestampUtc,
  });
  const dispatchReceipt = dispatcher.dispatchReceipt || null;
  const ok = dispatcher.finalVerdict === 'CODEX_JOB_DISPATCHED';
  return {
    ok,
    finalVerdict: ok ? 'WINDOWS_BROWSER_PROOF_DISPATCHED' : 'WINDOWS_BROWSER_PROOF_DISPATCH_BLOCKED',
    blocker: ok ? '' : (
      dispatcher.blocker
      || dispatchReceipt?.blocker
      || dispatcher.reason
      || 'WINDOWS_BROWSER_PROOF_DISPATCH_FAILED'
    ),
    dispatchAccepted: dispatchReceipt?.accepted === true,
    workerSpawned: dispatchReceipt?.workerSpawned === true,
    lockReleased: dispatchReceipt?.lockReleased ?? null,
    lockRelease: dispatchReceipt?.lockRelease || null,
    taskId: dispatcher.record?.jobId || packet.jobId,
    prNumber: Number(command.prNumber),
    expectedHead,
    proofTarget: target.proofTarget,
    pullRequestHead: target.pullRequestHead,
    mergeCommitHead: target.mergeCommitHead,
    githubMainHead,
    mergeCommitIncluded,
    localHead: checkoutRecheck.head,
    proofScenario: String(command.proofScenario),
    executionSurface: 'WINDOWS_BATTLE_BRIDGE_EDGE',
    mergeAuthority: false,
    sourceMutationAuthority: false,
  };
}
