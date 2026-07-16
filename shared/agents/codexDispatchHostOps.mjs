import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CODEX_DISPATCH_REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const DEFAULT_BATTLE_BRIDGE_ENDPOINTS = Object.freeze([
  'http://127.0.0.1:4173/__stephanos/health',
  'http://127.0.0.1:8787/api/health',
  'http://127.0.0.1:18789/health',
]);
export const CODEX_DISPATCH_TEST_ARGS = Object.freeze([
  '--test',
  'shared/agents/localCodexExecIntegration.test.mjs',
  'shared/agents/codexDispatchMcp.test.mjs',
  'shared/agents/codexDispatchHostOps.test.mjs',
  'shared/agents/stephanosChatUpdate.test.mjs',
  'shared/agents/remoteCodexTaskVisibility.test.mjs',
  'scripts/remote-codex-task-visibility-observer.test.mjs',
  'scripts/remote-codex-github-mirror-publisher.test.mjs',
  'scripts/battle-bridge-worker-watchdog-runner.test.mjs',
]);

function bounded(value = '', limit = 6000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function capture(spawnSyncFn, command, args, { cwd, timeout = 120000 } = {}) {
  const result = spawnSyncFn(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
  });
  return Object.freeze({
    command,
    args: [...args],
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: bounded(result?.stdout),
    stderr: bounded(result?.stderr),
    error: result?.error?.message || '',
  });
}

function git(spawnSyncFn, repoRoot, args, timeout) {
  return capture(spawnSyncFn, 'git', args, { cwd: repoRoot, timeout });
}

function parseAheadBehind(output = '') {
  const [aheadText = '0', behindText = '0'] = String(output).trim().split(/\s+/);
  const ahead = Number.parseInt(aheadText, 10);
  const behind = Number.parseInt(behindText, 10);
  return {
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null,
  };
}

function changedFiles(output = '') {
  return String(output || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function syncCodexDispatchBridge({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  expectedBranch = 'main',
  operatorApproval = '',
  spawnSyncFn = spawnSync,
  nodeCommand = process.execPath,
} = {}) {
  if (operatorApproval !== 'operator-approved') {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'OPERATOR_APPROVAL_REQUIRED',
      nextOperatorAction: 'Ask the operator to explicitly approve updating to the latest canonical origin/main observed by this run.',
    });
  }

  const branch = git(spawnSyncFn, repoRoot, ['branch', '--show-current']);
  if (!branch.ok) return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'BRANCH_READ_FAILED', branch });
  if (branch.stdout !== expectedBranch) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'UNEXPECTED_BRANCH',
      expectedBranch,
      actualBranch: branch.stdout,
      nextOperatorAction: 'Return the canonical repository to main without discarding local work, then retry.',
    });
  }

  const beforeHead = git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']);
  const statusBefore = git(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (!beforeHead.ok || !statusBefore.ok) {
    return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'LOCAL_STATE_READ_FAILED', beforeHead, statusBefore });
  }

  const fetchResult = git(spawnSyncFn, repoRoot, ['fetch', 'origin', expectedBranch], 120000);
  if (!fetchResult.ok) {
    return Object.freeze({
      ok: false,
      status: 'FAILED',
      verdict: 'FAIL',
      blocker: 'ORIGIN_FETCH_FAILED',
      beforeHead: beforeHead.stdout,
      statusBefore: statusBefore.stdout,
      fetchResult,
    });
  }

  const remoteRef = `origin/${expectedBranch}`;
  const remoteHead = git(spawnSyncFn, repoRoot, ['rev-parse', remoteRef]);
  const divergence = git(spawnSyncFn, repoRoot, ['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
  if (!remoteHead.ok || !divergence.ok) {
    return Object.freeze({ ok: false, status: 'FAILED', verdict: 'FAIL', blocker: 'REMOTE_STATE_READ_FAILED', remoteHead, divergence });
  }

  const counts = parseAheadBehind(divergence.stdout);
  if (counts.ahead === null || counts.behind === null || counts.ahead > 0) {
    return Object.freeze({
      ok: false,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE',
      beforeHead: beforeHead.stdout,
      remoteHead: remoteHead.stdout,
      ahead: counts.ahead,
      behind: counts.behind,
      statusBefore: statusBefore.stdout,
      nextOperatorAction: 'Review local commits or divergence. No reset, clean, checkout, stash, or force operation was attempted.',
    });
  }

  let fastForward = null;
  if (counts.behind > 0) {
    fastForward = git(spawnSyncFn, repoRoot, ['merge', '--ff-only', remoteRef], 120000);
    if (!fastForward.ok) {
      return Object.freeze({
        ok: false,
        status: 'BLOCKED',
        verdict: 'FAIL',
        blocker: 'FAST_FORWARD_FAILED',
        beforeHead: beforeHead.stdout,
        remoteHead: remoteHead.stdout,
        ahead: counts.ahead,
        behind: counts.behind,
        statusBefore: statusBefore.stdout,
        fastForward,
        nextOperatorAction: 'Inspect the exact Git blocker. Existing work was not cleaned, stashed, reset, or discarded.',
      });
    }
  }

  const afterHead = git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']);
  const statusAfter = git(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const diffNames = beforeHead.stdout === afterHead.stdout
    ? Object.freeze({ ok: true, stdout: '', command: 'git', args: [] })
    : git(spawnSyncFn, repoRoot, ['diff', '--name-only', `${beforeHead.stdout}..${afterHead.stdout}`]);
  const filesChanged = diffNames.ok ? changedFiles(diffNames.stdout) : [];
  const tests = capture(spawnSyncFn, nodeCommand, CODEX_DISPATCH_TEST_ARGS, { cwd: repoRoot, timeout: 180000 });
  const restartRequired = filesChanged.some((path) => [
    'scripts/stephanos-codex-dispatch-mcp.mjs',
    'shared/agents/codexDispatchHostOps.mjs',
    'shared/agents/stephanosChatUpdate.mjs',
  ].includes(path));
  const passed = afterHead.ok
    && afterHead.stdout === remoteHead.stdout
    && statusAfter.ok
    && diffNames.ok
    && tests.ok;

  return Object.freeze({
    ok: passed,
    status: passed ? 'DONE' : 'FAILED',
    verdict: passed ? 'PASS' : 'FAIL',
    repoRoot,
    branch: branch.stdout,
    approvalScope: 'latest-canonical-origin-main-observed-after-fetch',
    approvedTargetHead: remoteHead.stdout,
    beforeHead: beforeHead.stdout,
    remoteHead: remoteHead.stdout,
    afterHead: afterHead.stdout,
    aheadBeforeSync: counts.ahead,
    behindBeforeSync: counts.behind,
    updated: beforeHead.stdout !== afterHead.stdout,
    filesChanged,
    preExistingDirt: Boolean(statusBefore.stdout),
    statusBefore: statusBefore.stdout,
    statusAfter: statusAfter.stdout,
    fetchResult,
    fastForward,
    tests,
    restartRequired,
    publicExposureChanged: false,
    destructiveCleanupPerformed: false,
    nextOperatorAction: passed
      ? (restartRequired ? 'Restart the desktop app before expecting newly changed MCP tools or server behavior.' : 'Continue from chat. No PowerShell action is required.')
      : 'Inspect the returned bounded Git or test failure. Do not discard local work.',
  });
}

async function probeEndpoint(url, { fetchFn = globalThis.fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, { method: 'GET', signal: controller.signal });
    const body = bounded(await response.text(), 2500);
    return Object.freeze({ url, ok: response.ok, status: response.status, body, error: '' });
  } catch (error) {
    return Object.freeze({ url, ok: false, status: null, body: '', error: error?.message || String(error) });
  } finally {
    clearTimeout(timer);
  }
}

export async function runBattleBridgeDiagnostics({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  endpoints = DEFAULT_BATTLE_BRIDGE_ENDPOINTS,
  spawnSyncFn = spawnSync,
  fetchFn = globalThis.fetch,
} = {}) {
  const commands = Object.freeze({
    repositoryTopLevel: git(spawnSyncFn, repoRoot, ['rev-parse', '--show-toplevel']),
    currentBranch: git(spawnSyncFn, repoRoot, ['branch', '--show-current']),
    fullHead: git(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']),
    configuredUpstream: git(spawnSyncFn, repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    completeGitStatus: git(spawnSyncFn, repoRoot, ['status', '--branch', '--untracked-files=all']),
  });
  const aheadBehind = commands.configuredUpstream.ok
    ? git(spawnSyncFn, repoRoot, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])
    : Object.freeze({ ok: false, status: null, stdout: '', stderr: '', error: 'UPSTREAM_UNAVAILABLE' });
  const health = await Promise.all(endpoints.map((url) => probeEndpoint(url, { fetchFn })));
  const gitPassed = Object.values(commands).every((result) => result.ok) && aheadBehind.ok;
  const healthPassed = health.every((result) => result.ok);
  const passed = gitPassed && healthPassed;
  const counts = aheadBehind.ok ? parseAheadBehind(aheadBehind.stdout) : { ahead: null, behind: null };

  return Object.freeze({
    ok: passed,
    status: passed ? 'DONE' : 'FAILED',
    verdict: passed ? 'PASS' : 'FAIL',
    repoRoot,
    repositoryTopLevel: commands.repositoryTopLevel.stdout,
    currentBranch: commands.currentBranch.stdout,
    fullHead: commands.fullHead.stdout,
    configuredUpstream: commands.configuredUpstream.stdout,
    ahead: counts.ahead,
    behind: counts.behind,
    completeGitStatus: commands.completeGitStatus.stdout,
    commands,
    aheadBehind,
    health,
    safety: {
      sourceMutationDetected: false,
      generatedRuntimeMutationDetected: false,
      mergePerformed: false,
      pushPerformed: false,
      processControlPerformed: false,
      publicExposureChanged: false,
    },
    execution: {
      directDeterministicHostProof: true,
      codexChildUsed: false,
      shellPolicyDependency: false,
    },
    nextOperatorAction: passed
      ? 'Use the verified diagnostic facts directly. No Codex child or PowerShell step was required.'
      : 'Inspect the exact failed Git read or endpoint result. No repair or mutation was attempted.',
  });
}
