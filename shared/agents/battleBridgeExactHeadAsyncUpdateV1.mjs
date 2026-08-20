import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import {
  BATTLE_BRIDGE_CANONICAL_REMOTE_URL,
  BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS,
  battleBridgeCanonicalRepositoryArgs,
  createBattleBridgeMinimalChildEnvironment,
  inspectBattleBridgeGitTopology,
  validateBattleBridgeLocalGitConfiguration,
} from './battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { CODEX_DISPATCH_TEST_ARGS } from './codexDispatchHostOps.mjs';
import { classifyUpdateDirt } from './stephanosUpdateDirt.mjs';

export const BATTLE_BRIDGE_ASYNC_EXACT_HEAD_UPDATE_SCHEMA = 'stephanos.battle-bridge-async-exact-head-update.v1';
export const BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA = 'stephanos.battle-bridge-ignition-pipe-approval.v1';
const EXACT_HEAD = /^[0-9a-f]{40}$/;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_IGNITION_APPROVAL_BYTES = 4096;

// Node verification and ignition children can themselves invoke Git. Carry the
// fixed config through Git's counted environment format so descendants cannot
// fall back to user/system config, replace refs, hooks, fsmonitor, helpers, or
// recursive transports.
export function createBattleBridgeNestedGitChildEnvironment(environment = process.env) {
  const childEnvironment = {
    ...createBattleBridgeMinimalChildEnvironment(environment, { git: true }),
  };
  const entries = [];
  for (let index = 0; index < BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length; index += 2) {
    if (BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS[index] !== '-c') throw new Error('BATTLE_BRIDGE_FIXED_GIT_CONFIG_INVALID');
    const assignment = String(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS[index + 1] || '');
    const separator = assignment.indexOf('=');
    if (separator < 1) throw new Error('BATTLE_BRIDGE_FIXED_GIT_CONFIG_INVALID');
    entries.push([assignment.slice(0, separator), assignment.slice(separator + 1)]);
  }
  childEnvironment.GIT_CONFIG_COUNT = String(entries.length);
  entries.forEach(([key, value], index) => {
    childEnvironment[`GIT_CONFIG_KEY_${index}`] = key;
    childEnvironment[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return Object.freeze(childEnvironment);
}

function captureAsync(spawnFn, command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer;
    let killAckTimer;
    let spawned = false;
    let terminationError = null;
    let closeObservation = null;
    let approvalSettled = !options.ignitionApproval;
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killAckTimer);
      resolve(Object.freeze(value));
    };
    const finishUnprovenTermination = () => {
      const { status = null, signal = null } = closeObservation || {};
      finish({
        status,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: terminationError?.message || stderr.toString('utf8'),
        error: terminationError,
        spawnObserved: spawned,
        processTreeClosureProven: false,
        executionStateUnproven: true,
      });
    };
    const finishClosedChild = () => {
      if (!closeObservation || !approvalSettled) return;
      const { status, signal } = closeObservation;
      finish({
        status,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: terminationError?.message || stderr.toString('utf8'),
        error: terminationError,
        spawnObserved: spawned,
        // Clean completion is a contract of the three fixed command lanes:
        // synchronous Git, the fixed Node verification suite, or the fixed
        // ignition script after its runtime proofs. Any termination/write
        // ambiguity is never promoted to tree closure and retains the durable
        // owner lease. No caller-shaped executable or argv reaches this point.
        processTreeClosureProven: !spawned || !terminationError,
        executionStateUnproven: Boolean(spawned && terminationError),
      });
    };
    try {
      child = spawnFn(command, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: undefined,
        shell: false,
        windowsHide: true,
        stdio: options.ignitionApproval ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve(Object.freeze({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error,
        spawnObserved: false,
        processTreeClosureProven: true,
        executionStateUnproven: false,
      }));
      return;
    }
    const append = (current, chunk) => {
      if (current.length >= MAX_OUTPUT_BYTES) return current;
      const incoming = Buffer.from(chunk);
      const remaining = MAX_OUTPUT_BYTES - current.length;
      const next = Buffer.concat([current, incoming.subarray(0, remaining)]);
      if (incoming.length > remaining) {
        terminationError ||= new Error('BATTLE_BRIDGE_COMMAND_OUTPUT_TOO_LARGE');
        try { child.kill(); } catch { /* bounded failure */ }
      }
      return next;
    };
    child.once?.('spawn', () => {
      spawned = true;
      if (options.ignitionApproval) {
        const approvalStream = child.stdio?.[3];
        const childPid = Number(child.pid || 0);
        if (!approvalStream?.end || !Number.isSafeInteger(childPid) || childPid < 1) {
          terminationError ||= new Error('BATTLE_BRIDGE_IGNITION_APPROVAL_PIPE_UNAVAILABLE');
          approvalSettled = true;
          try { child.kill(); } catch { /* bounded failure */ }
          finishClosedChild();
          return;
        }
        try {
          const approval = JSON.stringify(Object.freeze({
            schemaVersion: BATTLE_BRIDGE_IGNITION_PIPE_APPROVAL_SCHEMA,
            action: 'RUN_EXACT_HEAD_IGNITION',
            expectedHead: options.ignitionApproval.expectedHead,
            receiptId: options.ignitionApproval.receiptId,
            parentPid: process.pid,
            childPid,
            nonce: randomBytes(16).toString('hex'),
          }));
          if (Buffer.byteLength(approval, 'utf8') > MAX_IGNITION_APPROVAL_BYTES) {
            throw new Error('BATTLE_BRIDGE_IGNITION_APPROVAL_TOO_LARGE');
          }
          approvalStream.once?.('error', (error) => {
            terminationError ||= error;
            approvalSettled = true;
            try { child.kill(); } catch { /* bounded failure */ }
            finishClosedChild();
          });
          approvalStream.end(approval, () => {
            approvalSettled = true;
            finishClosedChild();
          });
        } catch (error) {
          terminationError ||= error;
          approvalSettled = true;
          try { child.kill(); } catch { /* bounded failure */ }
          finishClosedChild();
        }
      }
    });
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.once?.('error', (error) => {
      if (!spawned) finish({
        status: null,
        signal: null,
        stdout: '',
        stderr: '',
        error,
        spawnObserved: false,
        processTreeClosureProven: true,
        executionStateUnproven: false,
      });
      else terminationError ||= error;
    });
    child.once?.('close', (status, signal) => {
      closeObservation = { status, signal };
      finishClosedChild();
    });
    timer = setTimeout(() => {
      terminationError ||= new Error('BATTLE_BRIDGE_COMMAND_TIMEOUT');
      const requestedKillAckTimeoutMs = Number(options.killAckTimeoutMs);
      const killAckTimeoutMs = Number.isFinite(requestedKillAckTimeoutMs) && requestedKillAckTimeoutMs > 0
        ? Math.min(requestedKillAckTimeoutMs, 5_000)
        : 250;
      killAckTimer = setTimeout(
        finishUnprovenTermination,
        killAckTimeoutMs,
      );
      try { child.kill(); } catch { /* bounded failure */ }
    }, Math.max(1, Number(options.timeout || 120_000)));
    timer.unref?.();
  });
}

function projectedCommand(command, args, raw) {
  return Object.freeze({
    command,
    args: Object.freeze([...args]),
    ok: !raw?.error && raw?.status === 0,
    status: raw?.status ?? null,
    signal: raw?.signal ?? null,
    stdout: String(raw?.stdout || '').trim(),
    stderr: String(raw?.stderr || '').trim().slice(0, 8000),
    error: raw?.error?.message || '',
    spawnObserved: raw?.spawnObserved === true,
    processTreeClosureProven: raw?.processTreeClosureProven !== false,
    executionStateUnproven: raw?.executionStateUnproven === true || raw?.processTreeClosureProven === false,
  });
}

export function evaluateBattleBridgeTrackedVisibility(output = '') {
  const hidden = String(output || '').split(/\r?\n/).filter((line) => (
    /^S\s/.test(line) || /^[a-z]\s/.test(line)
  ));
  return Object.freeze({
    ok: hidden.length === 0,
    blocker: hidden.length === 0 ? '' : 'HIDDEN_TRACKED_PATHS_PRESENT',
    hiddenCount: hidden.length,
  });
}

export function createBattleBridgeAsyncCommandRunner({
  spawnFn = spawn,
  environment = process.env,
  pathInvariant = null,
} = {}) {
  const gitEnvironment = createBattleBridgeMinimalChildEnvironment(environment, { git: true });
  // The fixed Node entry point imports ignition/test code that performs nested
  // Git reads. Give those descendants the same no-hook/no-helper/no-replace
  // boundary as direct Git commands, while still stripping Node injection.
  const nodeEnvironment = createBattleBridgeNestedGitChildEnvironment(environment);
  return async (command, args = [], options = {}) => {
    pathInvariant?.recheck?.();
    const isGit = String(command).replace(/\//g, '\\').toLowerCase() === BATTLE_BRIDGE_WINDOWS_HOST.git.toLowerCase();
    const isNode = String(command).replace(/\//g, '\\').toLowerCase() === BATTLE_BRIDGE_WINDOWS_HOST.node.toLowerCase();
    const fixedGitTail = isGit && args.slice(0, BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length)
      .every((value, index) => value === BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS[index])
      ? args.slice(BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS.length)
      : [];
    const repositoryArgs = battleBridgeCanonicalRepositoryArgs(options.cwd);
    const gitTail = fixedGitTail.slice(0, repositoryArgs.length)
      .every((value, index) => value === repositoryArgs[index])
      ? fixedGitTail.slice(repositoryArgs.length)
      : [];
    const allowedGit = isGit && (
      (gitTail.length === 2 && gitTail[0] === 'rev-parse' && gitTail[1] === 'HEAD')
      || (gitTail.length === 2 && gitTail[0] === 'branch' && gitTail[1] === '--show-current')
      || (gitTail.length === 4 && gitTail[0] === 'status' && gitTail[1] === '--porcelain=v1'
        && gitTail[2] === '--untracked-files=all' && gitTail[3] === '--ignored=matching')
      || (gitTail.length === 3 && gitTail[0] === 'ls-files' && gitTail[1] === '-v' && gitTail[2] === '--')
    );
    const ignitionPath = path.resolve(String(options.cwd || ''), 'scripts', 'run-battle-bridge-ignition.mjs');
    const approvalHead = String(options?.ignitionApproval?.expectedHead || '').trim().toLowerCase();
    const approvalReceiptId = String(options?.ignitionApproval?.receiptId || '').trim().toLowerCase();
    const allowedNode = isNode
      && args.length === 1
      && path.resolve(String(args[0] || '')) === ignitionPath
      && EXACT_HEAD.test(approvalHead)
      && /^[0-9a-f]{32}$/.test(approvalReceiptId);
    if (!allowedGit && !allowedNode) {
      return Object.freeze({ status: 86, signal: null, stdout: '', stderr: 'BATTLE_BRIDGE_ASYNC_COMMAND_NOT_ALLOWED', error: null });
    }
    const raw = await captureAsync(spawnFn, command, args, {
      ...options,
      env: allowedGit ? gitEnvironment : nodeEnvironment,
      ...(allowedNode ? { ignitionApproval: Object.freeze({ expectedHead: approvalHead, receiptId: approvalReceiptId }) } : {}),
    });
    pathInvariant?.recheck?.();
    return projectedCommand(command, args, raw);
  };
}

export async function syncBattleBridgeExactHeadAsyncV1({
  repoRoot,
  expectedBranch = 'main',
  expectedHead = '',
  operatorApproval = '',
  platform = process.platform,
  spawnFn = spawn,
  environment = process.env,
  pathInvariant = null,
  testTopologyProofFn = null,
} = {}) {
  const head = String(expectedHead || '').trim().toLowerCase();
  const base = { schemaVersion: BATTLE_BRIDGE_ASYNC_EXACT_HEAD_UPDATE_SCHEMA, expectedHead: head, mutationAttempted: false, destructiveGitAllowed: false };
  if (operatorApproval !== 'operator-approved') return Object.freeze({ ...base, ok: false, status: 'BLOCKED', blocker: 'OPERATOR_APPROVAL_REQUIRED' });
  if (platform !== 'win32') return Object.freeze({ ...base, ok: false, status: 'BLOCKED', blocker: 'WINDOWS_REQUIRED' });
  if (expectedBranch !== 'main' || !EXACT_HEAD.test(head)) return Object.freeze({ ...base, ok: false, status: 'BLOCKED', blocker: 'EXPECTED_HEAD_INVALID' });
  const gitEnv = createBattleBridgeMinimalChildEnvironment(environment, { git: true });
  const nodeEnv = createBattleBridgeNestedGitChildEnvironment(environment);
  const repositoryArgs = battleBridgeCanonicalRepositoryArgs(repoRoot);
  let mutationAttempted = false;
  let executionStateUnproven = false;
  let observedBranch = '';
  let observedHead = '';
  const run = async (command, args, { timeout = 120_000, env } = {}) => {
    pathInvariant?.recheck?.();
    const raw = await captureAsync(spawnFn, command, args, { cwd: repoRoot, timeout, env });
    pathInvariant?.recheck?.();
    const projected = projectedCommand(command, args, raw);
    if (projected.executionStateUnproven) executionStateUnproven = true;
    return projected;
  };
  const git = (args, timeout) => run(BATTLE_BRIDGE_WINDOWS_HOST.git, [...BATTLE_BRIDGE_GIT_FIXED_CONFIG_ARGS, ...repositoryArgs, ...args], { timeout, env: gitEnv });
  const blocked = (blocker, extra = {}) => Object.freeze({
    ...base,
    ok: false,
    status: 'BLOCKED',
    verdict: 'FAIL',
    blocker,
    mutationAttempted,
    executionStateUnproven,
    ...(observedBranch ? { branch: observedBranch } : {}),
    ...(observedHead ? {
      afterHead: observedHead,
      sourceInstalled: observedHead === head,
      expectedHeadMatch: observedHead === head,
    } : {}),
    ...extra,
  });
  const topologyProofFn = process.platform !== 'win32' && typeof testTopologyProofFn === 'function'
    ? testTopologyProofFn
    : inspectBattleBridgeGitTopology;
  let topologyBaseline = null;
  const proveTopology = () => {
    pathInvariant?.recheck?.();
    const proof = topologyProofFn(repoRoot);
    pathInvariant?.recheck?.();
    if (!proof?.ok) return proof;
    const identities = proof.stableIdentities || {};
    if (topologyBaseline === null) topologyBaseline = Object.freeze({ ...identities });
    else if (Object.entries(topologyBaseline).some(([pathname, identity]) => identities[pathname] !== identity)) {
      return Object.freeze({ ok: false, blocker: 'CANONICAL_GIT_TOPOLOGY_CHANGED' });
    }
    return proof;
  };
  const proveTrackedVisibility = async () => {
    const command = await git(['ls-files', '-v', '--']);
    if (!command.ok) return Object.freeze({ ok: false, blocker: 'TRACKED_VISIBILITY_UNPROVEN', command });
    const proof = evaluateBattleBridgeTrackedVisibility(command.stdout);
    return Object.freeze({ ...proof, command });
  };

  const initialTopology = proveTopology();
  if (!initialTopology.ok) return blocked(initialTopology.blocker);
  const config = await git(['config', '--local', '--null', '--list']);
  if (!config.ok) return blocked('CANONICAL_GIT_CONFIGURATION_UNPROVEN', { config });
  const configProof = validateBattleBridgeLocalGitConfiguration(config.stdout);
  if (!configProof.ok) return blocked(configProof.blocker);
  const replacements = await git(['for-each-ref', '--format=%(refname)', 'refs/replace']);
  if (!replacements.ok) return blocked('GIT_REPLACE_REFS_UNPROVEN');
  if (replacements.stdout) return blocked('GIT_REPLACE_REFS_PRESENT');
  const initialVisibility = await proveTrackedVisibility();
  if (!initialVisibility.ok) return blocked(initialVisibility.blocker);

  const branch = await git(['branch', '--show-current']);
  if (!branch.ok) return blocked('BRANCH_READ_FAILED');
  observedBranch = branch.stdout;
  if (branch.stdout !== expectedBranch) return blocked('UNEXPECTED_BRANCH', { actualBranch: branch.stdout });
  const beforeHead = await git(['rev-parse', 'HEAD']);
  const statusBefore = await git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
  if (!beforeHead.ok || !EXACT_HEAD.test(beforeHead.stdout) || !statusBefore.ok) return blocked('LOCAL_STATE_READ_FAILED');
  observedHead = beforeHead.stdout;
  const dirtBefore = classifyUpdateDirt(statusBefore.stdout);
  if (dirtBefore.sourceEntries.length > 0) return blocked('CANONICAL_CHECKOUT_DIRTY', { sourceDirt: dirtBefore.source, runtimeDirt: dirtBefore.runtime });

  const preFetchTopology = proveTopology();
  if (!preFetchTopology.ok) return blocked(preFetchTopology.blocker);
  const preFetchVisibility = await proveTrackedVisibility();
  if (!preFetchVisibility.ok) return blocked(preFetchVisibility.blocker);
  mutationAttempted = true;
  const fetchResult = await git(['fetch', '--prune', BATTLE_BRIDGE_CANONICAL_REMOTE_URL, 'main:refs/remotes/origin/main'], 120_000);
  if (!fetchResult.ok) return blocked('ORIGIN_FETCH_FAILED', { fetchResult });
  const remoteHead = await git(['rev-parse', 'origin/main']);
  if (!remoteHead.ok || remoteHead.stdout !== head) return blocked('REMOTE_HEAD_NOT_APPROVED', { remoteHead: remoteHead.stdout });
  const divergence = await git(['rev-list', '--left-right', '--count', `HEAD...${head}`]);
  const [aheadText, behindText] = divergence.stdout.split(/\s+/);
  const ahead = Number.parseInt(aheadText, 10);
  const behind = Number.parseInt(behindText, 10);
  if (!divergence.ok || !Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind) || ahead > 0) {
    return blocked('LOCAL_BRANCH_NOT_FAST_FORWARD_SAFE', { ahead, behind });
  }
  const statusBeforeMerge = await git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
  if (!statusBeforeMerge.ok) return blocked('LOCAL_STATE_READ_FAILED');
  if (classifyUpdateDirt(statusBeforeMerge.stdout).sourceEntries.length > 0) return blocked('CANONICAL_CHECKOUT_DIRTY');
  const preMergeVisibility = await proveTrackedVisibility();
  if (!preMergeVisibility.ok) return blocked(preMergeVisibility.blocker);
  let fastForward = null;
  if (behind > 0) {
    const preMergeTopology = proveTopology();
    if (!preMergeTopology.ok) return blocked(preMergeTopology.blocker);
    fastForward = await git(['merge', '--ff-only', head], 120_000);
    if (!fastForward.ok) return blocked('FAST_FORWARD_FAILED', { fastForward });
  }
  const afterHead = await git(['rev-parse', 'HEAD']);
  if (afterHead.ok && EXACT_HEAD.test(afterHead.stdout)) observedHead = afterHead.stdout;
  const statusAfter = await git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
  if (!afterHead.ok || afterHead.stdout !== head) return blocked('POST_SYNC_HEAD_MISMATCH', { afterHead: afterHead.stdout });
  if (!statusAfter.ok) return blocked('POST_SYNC_STATUS_READ_FAILED');
  if (classifyUpdateDirt(statusAfter.stdout).sourceEntries.length > 0) return blocked('CANONICAL_CHECKOUT_DIRTY');
  const diffNames = beforeHead.stdout === afterHead.stdout
    ? Object.freeze({ ok: true, stdout: '' })
    : await git(['diff', '--name-only', `${beforeHead.stdout}..${head}`]);
  if (!diffNames.ok) return blocked('POST_SYNC_CHANGED_FILES_READ_FAILED');
  const preTestTopology = proveTopology();
  if (!preTestTopology.ok) return blocked(preTestTopology.blocker);
  const preTestVisibility = await proveTrackedVisibility();
  if (!preTestVisibility.ok) return blocked(preTestVisibility.blocker);
  pathInvariant?.recheck?.();
  const tests = projectedCommand(BATTLE_BRIDGE_WINDOWS_HOST.node, CODEX_DISPATCH_TEST_ARGS, await captureAsync(
    spawnFn,
    BATTLE_BRIDGE_WINDOWS_HOST.node,
    CODEX_DISPATCH_TEST_ARGS,
    { cwd: repoRoot, timeout: 180_000, env: nodeEnv },
  ));
  if (tests.executionStateUnproven) executionStateUnproven = true;
  pathInvariant?.recheck?.();
  if (!tests.ok) return blocked('POST_SYNC_VERIFICATION_FAILED', { tests });
  const postTestVisibility = await proveTrackedVisibility();
  if (!postTestVisibility.ok) return blocked(postTestVisibility.blocker);
  const finalTopology = proveTopology();
  if (!finalTopology.ok) return blocked(finalTopology.blocker);
  const finalConfig = await git(['config', '--local', '--null', '--list']);
  if (!finalConfig.ok || !validateBattleBridgeLocalGitConfiguration(finalConfig.stdout).ok) {
    return blocked('CANONICAL_GIT_CONFIGURATION_CHANGED_AFTER_VERIFICATION');
  }
  const finalReplacements = await git(['for-each-ref', '--format=%(refname)', 'refs/replace']);
  if (!finalReplacements.ok || finalReplacements.stdout) return blocked('GIT_REPLACE_REFS_CHANGED_AFTER_VERIFICATION');
  const finalBranch = await git(['branch', '--show-current']);
  if (finalBranch.ok) observedBranch = finalBranch.stdout;
  if (!finalBranch.ok || finalBranch.stdout !== expectedBranch) return blocked('POST_VERIFICATION_BRANCH_MISMATCH');
  const finalHead = await git(['rev-parse', 'HEAD']);
  if (finalHead.ok && EXACT_HEAD.test(finalHead.stdout)) observedHead = finalHead.stdout;
  if (!finalHead.ok || finalHead.stdout !== head) return blocked('POST_VERIFICATION_HEAD_MISMATCH');
  const finalStatus = await git(['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']);
  if (!finalStatus.ok) return blocked('POST_SYNC_STATUS_READ_FAILED');
  if (classifyUpdateDirt(finalStatus.stdout).sourceEntries.length > 0) return blocked('CANONICAL_CHECKOUT_DIRTY_AFTER_VERIFICATION');
  const finalVisibility = await proveTrackedVisibility();
  if (!finalVisibility.ok) return blocked(finalVisibility.blocker);
  return Object.freeze({
    ...base,
    ok: true,
    status: 'DONE',
    verdict: 'PASS',
    blocker: '',
    branch: expectedBranch,
    beforeHead: beforeHead.stdout,
    remoteHead: remoteHead.stdout,
    afterHead: afterHead.stdout,
    expectedHeadMatch: true,
    updated: beforeHead.stdout !== afterHead.stdout,
    restartRequired: false,
    mutationAttempted,
    executionStateUnproven: false,
    fetchResult,
    fastForward,
    tests,
  });
}
