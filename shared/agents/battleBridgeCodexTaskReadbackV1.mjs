import { spawnSync } from 'node:child_process';
import {
  readLocalCodexTaskResult,
  readLocalCodexTaskStatus,
} from './localCodexExecIntegration.mjs';

export const GUARDED_CODEX_TASK_READBACK_OPERATION = 'READ_GUARDED_CODEX_TASK_RESULT';

const SHA40 = /^[0-9a-f]{40}$/i;
const TASK_ID = /^codex-job-[0-9a-f]{20}$/;
const ALLOWED_FIELDS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'taskId',
  'expiresAt',
]);
const TERMINAL_BLOCKERS = new Set([
  'GUARDED_CODEX_READBACK_FIELD_NOT_ALLOWED',
  'GUARDED_CODEX_READBACK_EXPECTED_HEAD_REQUIRED',
  'GUARDED_CODEX_READBACK_TASK_ID_INVALID',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, requested: true, ...details });
}

function bounded(value, max = 4000) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function isTerminalizableGuardedCodexTaskReadbackBlocker(value) {
  return TERMINAL_BLOCKERS.has(String(value || ''));
}

export function validateGuardedCodexTaskReadbackCommandShape(command = {}) {
  if (String(command?.operation || '') !== GUARDED_CODEX_TASK_READBACK_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpected = Object.keys(command).find((field) => !ALLOWED_FIELDS.includes(field));
  if (unexpected) return fail('GUARDED_CODEX_READBACK_FIELD_NOT_ALLOWED', { field: unexpected });
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  if (!SHA40.test(expectedHead)) return fail('GUARDED_CODEX_READBACK_EXPECTED_HEAD_REQUIRED');
  const taskId = String(command.taskId || '').trim().toLowerCase();
  if (!TASK_ID.test(taskId)) return fail('GUARDED_CODEX_READBACK_TASK_ID_INVALID');
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    taskId,
    command: Object.freeze({ ...command, expectedHead, taskId }),
  });
}

function readCanonicalHead(repoRoot, spawnSyncFn = spawnSync) {
  if (!repoRoot) return '';
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  const result = spawnSyncFn(executable, ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 15_000,
  });
  return !result?.error && result?.status === 0
    ? String(result.stdout || '').trim().toLowerCase()
    : '';
}

function projectResult(taskId, status, result) {
  const sourceMutationDetected = result?.safety?.sourceMutationDetected === true;
  const generatedRuntimeMutationDetected = result?.safety?.generatedRuntimeMutationDetected === true;
  const sourceHeadBefore = String(result?.sourceHeadBefore || '').trim().toLowerCase();
  const sourceHeadAfter = String(result?.sourceHeadAfter || '').trim().toLowerCase();
  return Object.freeze({
    ok: true,
    blocker: bounded(result?.blocker, 240),
    finalVerdict: result
      ? (String(result?.verdict || '').toUpperCase() === 'PASS'
        ? 'GUARDED_CODEX_TASK_RESULT_PASS'
        : 'GUARDED_CODEX_TASK_RESULT_FAIL')
      : 'GUARDED_CODEX_TASK_RESULT_NOT_READY',
    taskId,
    codexTaskStatus: bounded(result?.status || status?.status || 'UNKNOWN', 80).toUpperCase(),
    codexResultVerdict: bounded(result?.resultVerdict || result?.verdict || '', 80).toUpperCase(),
    codexLastMessage: bounded(result?.lastMessage, 4000),
    codexNextOperatorAction: bounded(result?.nextOperatorAction, 1200),
    codexSourceHeadBefore: SHA40.test(sourceHeadBefore) ? sourceHeadBefore : '',
    codexSourceHeadAfter: SHA40.test(sourceHeadAfter) ? sourceHeadAfter : '',
    codexSourceHeadUnchanged: result?.sourceHeadUnchanged === true,
    codexSourceMutationDetected: sourceMutationDetected,
    codexGeneratedRuntimeMutationDetected: generatedRuntimeMutationDetected,
    codexEventCount: Number(result?.eventParsing?.eventCount || status?.eventCount || 0),
    resultAvailable: Boolean(result),
    mergeAuthority: false,
    sourceMutationAuthority: false,
    arbitraryShellAllowed: false,
    credentialsMayBeReadOrExported: false,
  });
}

export async function executeGuardedCodexTaskReadbackOnBattleBridge(command = {}, options = {}) {
  const shape = validateGuardedCodexTaskReadbackCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const repoRoot = String(options.repoRoot || process.env.STEPHANOS_REPO_ROOT || '');
  const workspaceRoot = String(options.sharedWorkspaceRoot
    || process.env.STEPHANOS_SHARED_WORKSPACE
    || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || '');
  const observedHead = typeof options.readCanonicalHeadFn === 'function'
    ? String(await options.readCanonicalHeadFn(repoRoot)).trim().toLowerCase()
    : readCanonicalHead(repoRoot, options.spawnSyncFn || spawnSync);
  if (observedHead !== shape.expectedHead) {
    return Object.freeze({
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      blocker: 'GUARDED_CODEX_READBACK_HEAD_MISMATCH',
      operation: GUARDED_CODEX_TASK_READBACK_OPERATION,
      requestId: String(command.requestId || ''),
      expectedHead: shape.expectedHead,
      observedHead,
      mergeAuthority: false,
      sourceMutationAuthority: false,
    });
  }

  const roots = {
    ...(repoRoot ? { repoRoot } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
  };
  let status = null;
  let result = null;
  try {
    status = readLocalCodexTaskStatus(shape.taskId, roots);
    result = readLocalCodexTaskResult(shape.taskId, roots);
  } catch (error) {
    return Object.freeze({
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      blocker: 'GUARDED_CODEX_READBACK_FAILED',
      operation: GUARDED_CODEX_TASK_READBACK_OPERATION,
      requestId: String(command.requestId || ''),
      taskId: shape.taskId,
      error: bounded(error?.message || error, 500),
      mergeAuthority: false,
      sourceMutationAuthority: false,
    });
  }
  if (!status && !result) {
    return Object.freeze({
      ok: false,
      verdict: 'COMMAND_EXECUTION_BLOCKED',
      blocker: 'GUARDED_CODEX_TASK_NOT_FOUND',
      operation: GUARDED_CODEX_TASK_READBACK_OPERATION,
      requestId: String(command.requestId || ''),
      taskId: shape.taskId,
      mergeAuthority: false,
      sourceMutationAuthority: false,
    });
  }
  return projectResult(shape.taskId, status, result);
}
