#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMonitorMultiplexerCanary } from '../shared/agents/monitorMultiplexerCanary.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from '../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

const SHA = /^[0-9a-f]{40}$/i;
const SAFE_REQUEST = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');

function fixedGit(args) {
  const result = spawnSync('git.exe', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: String(result.stdout || '').trim(),
  };
}

export function parseMonitorMultiplexerCanaryArguments(argv = [], {
  requestIdFactory = () => `req-monitor-canary-${randomUUID()}`,
} = {}) {
  const expectedFlags = argv.filter((arg) => arg.startsWith('--expected-head='));
  const requestFlags = argv.filter((arg) => arg.startsWith('--request-id='));
  const unknown = argv.filter((arg) => !arg.startsWith('--expected-head=') && !arg.startsWith('--request-id='));
  if (unknown.length > 0) return { ok: false, blocker: 'CANARY_ARGUMENT_NOT_ALLOWED' };
  if (expectedFlags.length !== 1) return { ok: false, blocker: 'CANARY_EXPECTED_HEAD_REQUIRED_ONCE' };
  if (requestFlags.length > 1) return { ok: false, blocker: 'CANARY_REQUEST_ID_ALLOWED_ONCE' };

  const expectedHead = expectedFlags[0].slice('--expected-head='.length).trim().toLowerCase();
  const suppliedRequestId = String(requestFlags[0] || '').slice('--request-id='.length).trim();
  const requestId = suppliedRequestId || String(requestIdFactory());
  if (!SHA.test(expectedHead)) return { ok: false, blocker: 'CANARY_EXPECTED_HEAD_INVALID' };
  if (!SAFE_REQUEST.test(requestId)) return { ok: false, blocker: 'CANARY_REQUEST_ID_INVALID' };
  return {
    ok: true,
    expectedHead,
    requestId,
  };
}

export function resolveMonitorMultiplexerCanaryWorkspace({ env = process.env } = {}) {
  const resolved = resolveSharedWorkspaceRuntimeConfig({ repoRoot, env });
  if (!resolved.ok) {
    return {
      ok: false,
      blocker: resolved.reason,
      finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED',
      arbitraryFilesystemAccess: false,
    };
  }
  return {
    ok: true,
    root: resolved.root,
    source: resolved.source,
    safeDisplayPath: resolved.safeDisplayPath,
    arbitraryFilesystemAccess: false,
  };
}

export async function runBattleBridgeMonitorMultiplexerCanary({
  expectedHead,
  requestId,
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform !== 'win32') {
    return { ok: false, blocker: 'WINDOWS_REQUIRED', finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return { ok: false, blocker: 'CANONICAL_CHECKOUT_REQUIRED', finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }
  if (!SHA.test(String(expectedHead || ''))) {
    return { ok: false, blocker: 'CANARY_EXPECTED_HEAD_INVALID', finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }
  if (!SAFE_REQUEST.test(String(requestId || ''))) {
    return { ok: false, blocker: 'CANARY_REQUEST_ID_INVALID', finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }

  const workspace = resolveMonitorMultiplexerCanaryWorkspace({ env });
  if (!workspace.ok) return workspace;

  const head = fixedGit(['rev-parse', 'HEAD']);
  const branch = fixedGit(['branch', '--show-current']);
  const sourceHead = head.stdout.toLowerCase();
  const branchName = branch.stdout;
  if (!head.ok || !branch.ok || !SHA.test(sourceHead)) {
    return { ok: false, blocker: 'SOURCE_IDENTITY_READ_FAILED', finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }
  if (branchName !== 'main') {
    return { ok: false, blocker: 'SOURCE_BRANCH_NOT_MAIN', sourceHead, branch: branchName, finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }
  if (sourceHead !== String(expectedHead).toLowerCase()) {
    return { ok: false, blocker: 'EXPECTED_HEAD_MISMATCH', sourceHead, expectedHead: String(expectedHead).toLowerCase(), branch: branchName, finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' };
  }

  const result = await runMonitorMultiplexerCanary({
    root: workspace.root,
    repoRoot,
    expectedHead: sourceHead,
    sourceHead,
    requestId,
  });
  return {
    ...result,
    branch: branchName,
    expectedHeadMatch: result.expectedHeadMatch === true,
    workspaceSource: workspace.source,
    visiblePowerShellRequired: false,
    fixedRunner: true,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    arbitraryFilesystemAccess: false,
    destructiveGitAllowed: false,
    sourceMutationAllowed: false,
    liveOpenClawUpdateAllowed: false,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const parsed = parseMonitorMultiplexerCanaryArguments(process.argv.slice(2));
  if (!parsed.ok) {
    process.stdout.write(`${JSON.stringify({ ...parsed, finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' }, null, 2)}\n`);
    process.exitCode = 1;
  } else {
    runBattleBridgeMonitorMultiplexerCanary(parsed)
      .then((result) => {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        process.exitCode = result.ok ? 0 : 1;
      })
      .catch(() => {
        process.stdout.write(`${JSON.stringify({ ok: false, blocker: 'MONITOR_MULTIPLEXER_CANARY_UNHANDLED_FAILURE', finalVerdict: 'MONITOR_MULTIPLEXER_CANARY_BLOCKED' }, null, 2)}\n`);
        process.exitCode = 1;
      });
  }
}
