import { spawnSync } from 'node:child_process';
import { createCodexQueueRecord, transitionCodexQueueRecord } from './codexDispatchQueue.mjs';
import { dispatchQueuedCodexJob } from './automatedCodexDispatcher.mjs';
import { createLocalCodexExecIntegration } from './localCodexExecIntegration.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;

const SCENARIO_PROMPTS = Object.freeze({
  MUSIC_RATING_PRESERVES_PLAYBACK: [
    'Run the Music Tile in Microsoft Edge on this Windows Battle Bridge.',
    'First prove git HEAD exactly matches the requested PR head; otherwise stop with EXPECTED_HEAD_MISMATCH.',
    'Mount a Listening Deck Spotify iframe and a verified Discovery Spotify iframe.',
    'Retain direct references to both iframe DOM nodes, click a rating button, and prove both references remain strictly identical and isConnected after the click.',
    'Prove the non-player legacy discovery ranking changed truthfully and capture browser console errors.',
    'Do not substitute source inspection, regex assertions, DOM emulation, or Linux browser results.',
  ].join(' '),
});

export function buildExactHeadWindowsBrowserProofPacket(command = {}, timestampUtc = new Date().toISOString()) {
  const prompt = SCENARIO_PROMPTS[command.proofScenario];
  if (!prompt) throw new Error('WINDOWS_BROWSER_PROOF_SCENARIO_NOT_ALLOWED');
  const created = createCodexQueueRecord({
    jobId: `windows-browser-proof-${command.requestId}`,
    issueNumber: 1507,
    branch: 'main',
    prompt: `PR #${command.prNumber}; expected head ${command.expectedHead}. ${prompt}`,
    requestedProofCommands: ['git rev-parse HEAD', 'npm run stephanos:browser-proof'],
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

export function readGitHubPullRequestHead(prNumber) {
  return captureHead('gh.exe', [
    'api',
    `repos/${REPOSITORY}/pulls/${Number(prNumber)}`,
    '--jq',
    '.head.sha',
  ], { blocker: 'PR_HEAD_LOOKUP_FAILED' });
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

function blocked(command, blocker, details = {}) {
  return {
    ok: false,
    finalVerdict: 'WINDOWS_BROWSER_PROOF_DISPATCH_BLOCKED',
    blocker,
    prNumber: Number(command.prNumber),
    expectedHead: String(command.expectedHead).toLowerCase(),
    proofScenario: String(command.proofScenario),
    executionSurface: 'WINDOWS_BATTLE_BRIDGE_EDGE',
    mergeAuthority: false,
    sourceMutationAuthority: false,
    ...details,
  };
}

export async function dispatchExactHeadWindowsBrowserProof(command, {
  platform = process.platform,
  integration = null,
  now = () => new Date().toISOString(),
  readPullRequestHead = readGitHubPullRequestHead,
  readLocalHead = readWindowsCheckoutHead,
} = {}) {
  if (platform !== 'win32') return { ok: false, blocker: 'WINDOWS_EXECUTION_SURFACE_REQUIRED' };
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  if (!EXACT_GIT_HEAD.test(expectedHead)) return blocked(command, 'EXPECTED_HEAD_INVALID');

  const pullRequest = normalizeHeadResult(
    await readPullRequestHead(Number(command.prNumber)),
    'PR_HEAD_LOOKUP_FAILED',
  );
  if (!pullRequest.ok) return blocked(command, pullRequest.blocker);
  if (pullRequest.head !== expectedHead) {
    return blocked(command, 'PR_HEAD_MISMATCH', { pullRequestHead: pullRequest.head });
  }

  const activeIntegration = integration || createLocalCodexExecIntegration();
  const checkout = normalizeHeadResult(
    await readLocalHead(activeIntegration?.paths?.repoRoot),
    'LOCAL_HEAD_LOOKUP_FAILED',
  );
  if (!checkout.ok) return blocked(command, checkout.blocker, { pullRequestHead: pullRequest.head });
  if (checkout.head !== expectedHead) {
    return blocked(command, 'EXPECTED_HEAD_MISMATCH', {
      pullRequestHead: pullRequest.head,
      localHead: checkout.head,
    });
  }

  const timestampUtc = now();
  const packet = buildExactHeadWindowsBrowserProofPacket(command, timestampUtc);
  const dispatcher = dispatchQueuedCodexJob({
    queueRecord: packet,
    integration: activeIntegration,
    now: timestampUtc,
  });
  const ok = dispatcher.finalVerdict === 'CODEX_JOB_DISPATCHED';
  return {
    ok,
    finalVerdict: ok ? 'WINDOWS_BROWSER_PROOF_DISPATCHED' : 'WINDOWS_BROWSER_PROOF_DISPATCH_BLOCKED',
    blocker: ok ? '' : (dispatcher.blocker || dispatcher.reason || 'WINDOWS_BROWSER_PROOF_DISPATCH_FAILED'),
    taskId: dispatcher.record?.jobId || packet.jobId,
    prNumber: Number(command.prNumber),
    expectedHead,
    pullRequestHead: pullRequest.head,
    localHead: checkout.head,
    proofScenario: String(command.proofScenario),
    executionSurface: 'WINDOWS_BATTLE_BRIDGE_EDGE',
    mergeAuthority: false,
    sourceMutationAuthority: false,
  };
}
