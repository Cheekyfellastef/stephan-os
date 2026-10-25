import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { rescueIslandGovernorEnvironmentV1 } from './rescueIslandSupervisedHostV1.mjs';

export const RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION =
  'RUN_RESCUE_ISLAND_SUPERVISED_DOCUMENT_TASK';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const ISSUE_NUMBER = 3103;
const ISSUE_TITLE = 'Rescue Island: two independent proof-gated builders outside Goal Conveyor';
const WORKER_ID = 'rescue-island-02';
const TASK_SCHEMA = 'stephanos.rescue-island-pilot-task.v1';
const ASSURANCE_PROFILE = 'SUPERVISED_COOPERATIVE_V1';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TASK_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const TARGET = /^docs\/architecture\/rescue-island-pilot-[a-z0-9-]+\.md$/;
const BLOCKER = /^(?:ISLAND_HOST_|RESCUE_ISLAND_)[A-Z0-9_:,.-]+$/;
const PUBLIC_BLOCKER_ALIASES = Object.freeze(new Map([
  ['ISLAND_HOST_NATIVE_TOKEN_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_NATIVE_PRINCIPAL_UNAVAILABLE'],
  ['ISLAND_HOST_NON_ADMINISTRATIVE_TOKEN_REQUIRED', 'RESCUE_ISLAND_REMOTE_NON_ADMINISTRATIVE_PRINCIPAL_REQUIRED'],
  ['ISLAND_HOST_PRIMARY_TOKEN_REQUIRED', 'RESCUE_ISLAND_REMOTE_PRIMARY_PRINCIPAL_REQUIRED'],
  ['ISLAND_HOST_PROCESS_TOKEN_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_PROCESS_PRINCIPAL_UNAVAILABLE'],
  ['ISLAND_HOST_THREAD_TOKEN_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_THREAD_PRINCIPAL_UNAVAILABLE'],
  ['ISLAND_HOST_TOKEN_GROUPS_INVALID', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_GROUPS_INVALID'],
  ['ISLAND_HOST_TOKEN_INFORMATION_INVALID', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_INFORMATION_INVALID'],
  ['ISLAND_HOST_TOKEN_PRIVILEGES_INVALID', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_PRIVILEGES_INVALID'],
  ['ISLAND_HOST_TOKEN_READ_FAILED', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_READ_FAILED'],
  ['ISLAND_HOST_TOKEN_SIZE_UNAVAILABLE', 'RESCUE_ISLAND_REMOTE_PRINCIPAL_SIZE_UNAVAILABLE'],
]));
const ALLOWED_FIELDS = Object.freeze([
  'schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber',
  'branch', 'operatorApproval', 'expectedHead', 'expiresAt', 'commentId', 'task',
]);
const TASK_FIELDS = Object.freeze([
  'schemaVersion', 'repository', 'issueNumber', 'issueTitle', 'taskId',
  'workerId', 'baseHead', 'targetPath', 'content', 'testPath',
  'approvalSource', 'expiresAtUtc',
]);
const REQUIRED_STAGES = Object.freeze([
  'SELECTED', 'CLAIMED', 'BRANCH_RESERVED', 'PHYSICAL_PICKUP',
  'EDITED', 'TESTED', 'ISOLATED_COMMIT',
]);

const text = value => String(value ?? '').trim();
const digest = value => createHash('sha256').update(value).digest('hex');
const publicBlocker = value => {
  const observed = text(value);
  return PUBLIC_BLOCKER_ALIASES.get(observed)
    || (BLOCKER.test(observed) ? observed : 'RESCUE_ISLAND_REMOTE_EXECUTION_HELD');
};
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, requested: true, ...details });
}

function executionFail(command, blocker) {
  const result = Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'RESCUE_ISLAND_02_SUPERVISED_DOCUMENT_BUILD_BLOCKED',
    operation: RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION,
    requestId: text(command?.requestId),
    taskId: text(command?.task?.taskId),
    proofCompleted: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  });
  return Object.freeze({
    ...result,
    verdict: 'COMMAND_EXECUTION_BLOCKED',
    result,
  });
}

function validateTask(task, expectedHead, commandExpiresAt) {
  if (!exactKeys(task, TASK_FIELDS)) return fail('RESCUE_ISLAND_REMOTE_TASK_FIELDS_INVALID');
  const expires = Date.parse(text(task.expiresAtUtc));
  const envelopeExpires = Date.parse(text(commandExpiresAt));
  const targetPath = text(task.targetPath);
  if (task.schemaVersion !== TASK_SCHEMA
      || task.repository !== REPOSITORY
      || task.issueNumber !== ISSUE_NUMBER
      || task.issueTitle !== ISSUE_TITLE
      || task.workerId !== WORKER_ID
      || !TASK_ID.test(text(task.taskId))
      || task.baseHead !== expectedHead
      || !TARGET.test(targetPath)
      || targetPath !== 'docs/architecture/rescue-island-pilot-' + task.taskId + '.md'
      || task.testPath !== 'shared/agents/rescueIslandPreflightV1.test.mjs'
      || task.approvalSource !== 'EXTERNAL_OWNER_ATTESTATION_REQUIRED'
      || typeof task.content !== 'string'
      || !task.content.startsWith('# Rescue Island pilot\n')
      || Buffer.byteLength(task.content, 'utf8') < 40
      || Buffer.byteLength(task.content, 'utf8') > 8192
      || task.content.includes('\0')
      || !Number.isFinite(expires)
      || !Number.isFinite(envelopeExpires)
      || expires !== envelopeExpires) {
    return fail('RESCUE_ISLAND_REMOTE_TASK_INVALID');
  }
  return Object.freeze({ ok: true, task: Object.freeze({ ...task }) });
}

export function validateRescueIslandSupervisedDocumentCommandShape(command = {}) {
  if (text(command.operation) !== RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpected = Object.keys(command).find(field => !ALLOWED_FIELDS.includes(field));
  if (unexpected) return fail('RESCUE_ISLAND_REMOTE_FIELD_NOT_ALLOWED', { field: unexpected });
  const expectedHead = text(command.expectedHead).toLowerCase();
  const commentId = Number(command.commentId);
  if (!SHA.test(expectedHead)) return fail('RESCUE_ISLAND_REMOTE_EXPECTED_HEAD_REQUIRED');
  if (!Number.isSafeInteger(commentId) || commentId < 1) {
    return fail('RESCUE_ISLAND_REMOTE_COMMENT_ID_INVALID');
  }
  const task = validateTask(command.task, expectedHead, command.expiresAt);
  if (!task.ok) return task;
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({
      ...command,
      expectedHead,
      commentId,
      task: task.task,
    }),
  });
}

export function isTerminalizableRescueIslandSupervisedDocumentBlocker(value) {
  return [
    'RESCUE_ISLAND_REMOTE_FIELD_NOT_ALLOWED',
    'RESCUE_ISLAND_REMOTE_EXPECTED_HEAD_REQUIRED',
    'RESCUE_ISLAND_REMOTE_COMMENT_ID_INVALID',
    'RESCUE_ISLAND_REMOTE_TASK_FIELDS_INVALID',
    'RESCUE_ISLAND_REMOTE_TASK_INVALID',
  ].includes(text(value));
}

function projectSuccessfulBuild(result, task, commentId) {
  const stages = Array.isArray(result?.receipts)
    ? result.receipts.map(receipt => text(receipt?.stage))
    : [];
  if (result?.ok !== true
      || result.workerId !== WORKER_ID
      || result.taskId !== task.taskId
      || !SHA.test(text(result.head))
      || result.parent !== task.baseHead
      || result.changedPath !== task.targetPath
      || !SHA256.test(text(result.testResultHash))
      || JSON.stringify(stages) !== JSON.stringify(REQUIRED_STAGES)
      || result.assuranceProfile !== ASSURANCE_PROFILE
      || result.ownerCommentId !== commentId
      || !SHA256.test(text(result.taskFingerprint))
      || result.hostileWriterContainmentProven !== false
      || result.independentlyCommissionedWorker !== false
      || result.unattendedRefillsProven !== false
      || result.resourceScheduling !== 'CPU_ONLY_SERIAL_EXISTING_OWNER_LOCK'
      || result.reviewRequired !== true
      || result.published !== false
      || result.merged !== false
      || result.deployed !== false) {
    return null;
  }
  return Object.freeze({
    schemaVersion: 'stephanos.rescue-island-supervised-document-build.v1',
    workerId: WORKER_ID,
    taskId: task.taskId,
    ownerIssueNumber: ISSUE_NUMBER,
    ownerCommentId: commentId,
    sourceHead: task.baseHead,
    commitHead: result.head,
    targetPath: task.targetPath,
    contentSha256: digest(task.content),
    taskFingerprint: result.taskFingerprint,
    testResultHash: result.testResultHash,
    stages: REQUIRED_STAGES,
    assuranceProfile: ASSURANCE_PROFILE,
    resourceScheduling: 'CPU_ONLY_SERIAL_EXISTING_OWNER_LOCK',
    hostileWriterContainmentProven: false,
    independentlyCommissionedWorker: false,
    unattendedRefillsProven: false,
    reviewRequired: true,
    published: false,
    merged: false,
    deployed: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
    finalVerdict: 'RESCUE_ISLAND_02_SUPERVISED_DOCUMENT_BUILD_COMPLETE',
  });
}

export async function executeRescueIslandSupervisedDocumentOnBattleBridge(command, options = {}) {
  const shape = validateRescueIslandSupervisedDocumentCommandShape(command);
  if (!shape.ok) return shape;
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return executionFail(shape.command, 'RESCUE_ISLAND_REMOTE_WINDOWS_REQUIRED');
  const run = typeof options.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const nativeHost = join(repositoryRoot, 'src', 'windows', 'Stephanos.RescueIslandHost',
    'bin', 'Release', 'net8.0-windows', 'Stephanos.RescueIslandHost.exe');
  const input = JSON.stringify({
    commentId: shape.command.commentId,
    task: shape.command.task,
  });
  let execution;
  try {
    execution = run(nativeHost, ['--supervised-once'], {
      cwd: repositoryRoot,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 262144,
      input,
      env: rescueIslandGovernorEnvironmentV1(options.env || process.env),
    });
  } catch {
    return executionFail(shape.command, 'RESCUE_ISLAND_REMOTE_NATIVE_LAUNCH_FAILED');
  }
  const stdout = String(execution?.stdout || '');
  if (Buffer.byteLength(stdout, 'utf8') > 262144 || stdout.trim().split(/\r?\n/).length !== 1) {
    return executionFail(shape.command, 'RESCUE_ISLAND_REMOTE_NATIVE_RECEIPT_INVALID');
  }
  let result;
  try { result = JSON.parse(stdout.trim()); } catch {
    return executionFail(shape.command, 'RESCUE_ISLAND_REMOTE_NATIVE_RECEIPT_INVALID');
  }
  if (execution?.error || execution?.status !== 0) {
    const blocker = publicBlocker(result?.blocker);
    return executionFail(shape.command, blocker);
  }
  const build = projectSuccessfulBuild(result, shape.command.task, shape.command.commentId);
  if (!build) return executionFail(shape.command, 'RESCUE_ISLAND_REMOTE_NATIVE_RECEIPT_INVALID');
  const operationResult = Object.freeze({
    ok: true,
    finalVerdict: build.finalVerdict,
    operation: RESCUE_ISLAND_SUPERVISED_DOCUMENT_OPERATION,
    requestId: text(shape.command.requestId),
    taskId: build.taskId,
    sourceHead: build.sourceHead,
    branch: 'rescue-island/pilot-' + build.taskId,
    expectedHeadMatch: true,
    localHead: build.commitHead,
    executionProvider: WORKER_ID,
    proofCompleted: true,
    rescueIslandBuild: build,
    sourceMutationAuthority: true,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  });
  return Object.freeze({
    ...operationResult,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    result: operationResult,
  });
}
