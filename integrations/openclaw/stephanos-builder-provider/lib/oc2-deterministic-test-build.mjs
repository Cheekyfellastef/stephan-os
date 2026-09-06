import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { classifyDirt } from '../../../../scripts/battle-bridge-github-sync-policy.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../../../../shared/agents/battleBridgeWindowsHosts.mjs';
import {
  createExecutionReceipt,
  toSharedWorkspaceExecutionReceipt,
} from '../../../../shared/agents/executionReceiptV1.mjs';
import {
  createSharedWorkspaceMessageRecord,
  ensureSharedWorkspaceLayout,
  writeAtomicJson,
} from '../../../../shared/agents/sharedAgentWorkspaceStore.mjs';

export const OPENCLAW_OC2_TASK_CLASS = 'OC2_DETERMINISTIC_TEST_BUILD';
export const OPENCLAW_OC2_OPERATION = 'oc2-provider-regression-v1';
export const OPENCLAW_OC2_PROVIDER = 'openclaw-standalone';
export const OPENCLAW_OC2_PROVIDER_VERSION = '1.0.0';
export const OPENCLAW_OC2_ISSUE = 1725;
export const OPENCLAW_OC2_RESULT_SCHEMA = 'stephanos.openclaw-oc2-provider-result.v1';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'main';
const FULL_SHA = /^[0-9a-f]{40}$/;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const ACTION_ID = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const CANONICAL_ORIGIN = Object.freeze([
  /^https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?$/i,
  /^git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?$/i,
  /^ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?$/i,
]);

export const OPENCLAW_OC2_FIXED_PLAN = Object.freeze([
  Object.freeze({
    testId: 'OC2_PROVIDER_SOURCE_PARSE_V1',
    args: Object.freeze([
      '--check',
      'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs',
    ]),
  }),
  Object.freeze({
    testId: 'OC2_PROVIDER_REGRESSION_V1',
    args: Object.freeze([
      '--test',
      'integrations/openclaw/stephanos-builder-provider/oc2-deterministic-test-build.test.mjs',
      'integrations/openclaw/stephanos-builder-provider/oc2-gateway-provider.test.mjs',
      'scripts/mission-orchestrator-worker.oc2.test.mjs',
    ]),
  }),
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function bounded(value) {
  const output = String(value ?? '');
  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) throw new Error('OPENCLAW_OC2_OUTPUT_TOO_LARGE');
  return output;
}

function canonicalOrigin(value) {
  return CANONICAL_ORIGIN.some((pattern) => pattern.test(text(value)));
}

function runFixed(spawnSyncFn, executable, args, repoRoot, env, timeout = 120_000) {
  const result = spawnSyncFn(executable, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
  const stdout = bounded(result?.stdout || '');
  const stderr = bounded(result?.stderr || '');
  return Object.freeze({
    status: Number.isInteger(result?.status) ? result.status : -1,
    error: result?.error ? String(result.error.message || result.error) : '',
    stdout,
    stderr,
    outputSha256: sha256(`${stdout}\n${stderr}`),
  });
}

function runGit(spawnSyncFn, repoRoot, args, env) {
  const result = runFixed(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.git, args, repoRoot, env, 15_000);
  if (result.error || result.status !== 0) throw new Error('OPENCLAW_OC2_FIXED_GIT_FAILED');
  return result.stdout.trimEnd();
}

function blocker(reason, details = {}) {
  return Object.freeze({
    success: false,
    error: reason,
    qualificationEligible: false,
    changedFiles: Object.freeze([]),
    evidenceReceipts: Object.freeze([]),
    ...details,
  });
}

export async function validateOpenClawOc2QualificationContext(context = {}, { readFileFn = readFile } = {}) {
  const grant = context.actionGrant;
  const action = context.action;
  const claim = context.claim;
  const missionId = text(grant?.missionId).toLowerCase();
  const taskId = text(grant?.actionId).toLowerCase();
  const requestedSourceHead = text(context.requestedSourceHead).toLowerCase();

  if (grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || grant?.boundedActionCount !== 1
    || grant?.mergeAuthority !== false
    || grant?.leaseSeizureAllowed !== false
    || grant?.issueNumber !== OPENCLAW_OC2_ISSUE
    || text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(grant?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION
    || text(grant?.repository) !== REPOSITORY
    || !ACTION_ID.test(taskId)
    || !FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())) {
    return blocker('OPENCLAW_OC2_GRANT_INVALID');
  }
  if (context.taskClass !== OPENCLAW_OC2_TASK_CLASS
    || context.goalId !== `#${OPENCLAW_OC2_ISSUE}`
    || context.taskId !== taskId
    || context.providerVersion !== OPENCLAW_OC2_PROVIDER_VERSION
    || requestedSourceHead !== text(grant.sourceRevision).toLowerCase()) {
    return blocker('OPENCLAW_OC2_BINDING_INVALID');
  }
  if (claim?.adapter !== 'openclaw-readonly'
    || claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
    || text(claim?.item?.missionId).toLowerCase() !== missionId
    || text(claim?.item?.actionId).toLowerCase() !== taskId
    || !text(claim?.processingPath)
    || path.resolve(path.dirname(claim.processingPath)) !== path.resolve(text(claim?.paths?.processing))) {
    return blocker('OPENCLAW_OC2_CLAIM_INVALID');
  }
  if (action?.schemaVersion !== 'stephanos.mission-worker-action.v1'
    || action?.actionKind !== 'agent-handoff'
    || action?.adapter !== 'openclaw-readonly'
    || action?.executable !== true
    || text(action?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION
    || text(action?.missionId).toLowerCase() !== missionId
    || text(action?.actionId).toLowerCase() !== taskId
    || text(action?.repository) !== REPOSITORY
    || claim.item.payload !== action) {
    return blocker('OPENCLAW_OC2_LINEAGE_INVALID');
  }
  let persisted;
  try {
    persisted = JSON.parse(await readFileFn(claim.processingPath, 'utf8'));
  } catch {
    return blocker('OPENCLAW_OC2_CLAIM_UNREADABLE');
  }
  if (JSON.stringify(persisted) !== JSON.stringify(claim.item)) return blocker('OPENCLAW_OC2_CLAIM_MISMATCH');

  const task = Object.freeze({
    missionId,
    goalId: `#${OPENCLAW_OC2_ISSUE}`,
    taskId,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    repository: REPOSITORY,
    requestedSourceHead,
    provider: OPENCLAW_OC2_PROVIDER,
    providerVersion: OPENCLAW_OC2_PROVIDER_VERSION,
    operation: OPENCLAW_OC2_OPERATION,
    testPlanIds: Object.freeze(OPENCLAW_OC2_FIXED_PLAN.map((entry) => entry.testId)),
    grantId: text(grant.grantId),
    sourceMutationAuthority: false,
    arbitraryShellAuthority: false,
    arbitraryCommandAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    selfQualificationAuthority: false,
  });
  return Object.freeze({
    success: true,
    qualificationEligible: true,
    task: Object.freeze({ ...task, exactInputIdentity: sha256(JSON.stringify(task)) }),
  });
}

export async function executeClaimedOpenClawOc2DeterministicTestBuild(action, claim, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const spawnSyncFn = options.spawnSyncFn || spawnSync;
  const existsSyncFn = options.existsSyncFn || existsSync;
  const now = options.now instanceof Date ? options.now : new Date();
  if (platform !== 'win32') return blocker('OPENCLAW_OC2_WINDOWS_REQUIRED');
  if (!env.USERPROFILE) return blocker('OPENCLAW_OC2_USERPROFILE_REQUIRED');

  const taskContext = await validateOpenClawOc2QualificationContext({
    action,
    claim,
    actionGrant: options.actionGrant,
    taskClass: options.taskClass,
    goalId: options.goalId,
    taskId: text(options.actionGrant?.actionId).toLowerCase(),
    providerVersion: options.providerVersion,
    requestedSourceHead: options.requestedSourceHead,
  }, { readFileFn: options.readFileFn || readFile });
  if (!taskContext.success) return taskContext;
  const task = taskContext.task;

  const repoRoot = path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace');
  if (!existsSyncFn(repoRoot)) return blocker('OPENCLAW_OC2_REPOSITORY_MISSING');

  let topLevel;
  let origin;
  let branch;
  let sourceHead;
  let statusBefore;
  try {
    topLevel = path.resolve(runGit(spawnSyncFn, repoRoot, ['rev-parse', '--show-toplevel'], env));
    origin = runGit(spawnSyncFn, repoRoot, ['remote', 'get-url', 'origin'], env);
    branch = runGit(spawnSyncFn, repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], env);
    sourceHead = runGit(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD'], env).toLowerCase();
    statusBefore = runGit(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'], env);
  } catch (error) {
    return blocker(error?.message || 'OPENCLAW_OC2_REPOSITORY_PROOF_FAILED');
  }
  if (topLevel.toLowerCase() !== repoRoot.toLowerCase()) return blocker('OPENCLAW_OC2_REPOSITORY_ROOT_MISMATCH');
  if (!canonicalOrigin(origin)) return blocker('OPENCLAW_OC2_ORIGIN_MISMATCH');
  if (branch !== BRANCH) return blocker('OPENCLAW_OC2_BRANCH_MISMATCH');
  if (sourceHead !== task.requestedSourceHead) return blocker('OPENCLAW_OC2_SOURCE_HEAD_MISMATCH');
  const dirtBefore = classifyDirt(statusBefore ? statusBefore.split(/\r?\n/).filter(Boolean) : []);
  if (dirtBefore.blocksSync) return blocker('OPENCLAW_OC2_DIRTY_SOURCE_BLOCKS_TEST');

  const results = [];
  for (const plan of OPENCLAW_OC2_FIXED_PLAN) {
    const run = runFixed(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.node, [...plan.args], repoRoot, env);
    results.push(Object.freeze({ testId: plan.testId, status: run.status, outputSha256: run.outputSha256 }));
    if (run.error || run.status !== 0) {
      return blocker('OPENCLAW_OC2_FIXED_TEST_FAILED', { testResults: Object.freeze(results) });
    }
  }

  let finalHead;
  let statusAfter;
  try {
    finalHead = runGit(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD'], env).toLowerCase();
    statusAfter = runGit(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'], env);
  } catch (error) {
    return blocker(error?.message || 'OPENCLAW_OC2_POST_TEST_PROOF_FAILED');
  }
  if (finalHead !== sourceHead) return blocker('OPENCLAW_OC2_SOURCE_HEAD_MOVED');
  if (statusAfter !== statusBefore) return blocker('OPENCLAW_OC2_SOURCE_STATE_CHANGED');
  const dirtAfter = classifyDirt(statusAfter ? statusAfter.split(/\r?\n/).filter(Boolean) : []);
  if (dirtAfter.blocksSync) return blocker('OPENCLAW_OC2_POST_TEST_DIRT_BLOCKS_QUALIFICATION');

  const providerInstance = text(options.providerInstance);
  if (!/^openclaw-gateway:[1-9][0-9]*$/.test(providerInstance)) return blocker('OPENCLAW_OC2_GATEWAY_IDENTITY_REQUIRED');
  const taskHash = sha256(`${task.missionId}\n${task.taskId}`).slice(0, 32);
  const executionId = `oc2-${taskHash}`;
  const receiptId = `oc2-receipt-${taskHash}`;
  const proofRef = `proofs/openclaw-oc2/${executionId}.json`;
  const timestampUtc = now.toISOString();
  const resultCore = Object.freeze({
    schemaVersion: OPENCLAW_OC2_RESULT_SCHEMA,
    missionId: task.missionId,
    goalId: task.goalId,
    taskId: task.taskId,
    taskClass: task.taskClass,
    repository: REPOSITORY,
    requestedSourceHead: task.requestedSourceHead,
    observedSourceHead: sourceHead,
    exactInputIdentity: task.exactInputIdentity,
    provider: OPENCLAW_OC2_PROVIDER,
    providerInstance,
    providerVersion: OPENCLAW_OC2_PROVIDER_VERSION,
    operation: OPENCLAW_OC2_OPERATION,
    testResults: Object.freeze(results),
    changedFiles: Object.freeze([]),
    sourceMutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    selfQualificationAllowed: false,
    finalVerdict: 'OPENCLAW_OC2_PROVIDER_TASK_COMPLETED',
    completedAtUtc: timestampUtc,
  });
  const exactOutputIdentity = sha256(JSON.stringify(resultCore));
  const proofRecord = createSharedWorkspaceMessageRecord({
    messageId: executionId,
    participantId: 'openclaw',
    timestampUtc,
    correlationId: task.taskId,
    relatedIssue: String(OPENCLAW_OC2_ISSUE),
    relatedPr: '',
    proofRefs: [proofRef],
    channel: 'openclaw-provider-qualification',
    summary: 'OpenClaw OC2 canonical claimed deterministic test/build task completed with a fixed test plan and unchanged source state.',
    body: JSON.stringify({ ...resultCore, exactOutputIdentity }),
  });
  const layout = await (options.ensureSharedWorkspaceLayoutFn || ensureSharedWorkspaceLayout)({ root: workspaceRoot, repoRoot });
  if (!layout?.ok) return blocker('OPENCLAW_OC2_SHARED_WORKSPACE_UNAVAILABLE');
  const writeJson = options.writeAtomicJsonFn || writeAtomicJson;
  const proofWrite = await writeJson(workspaceRoot, ['proofs', 'openclaw-oc2', `${executionId}.json`], proofRecord, { repoRoot });
  if (!proofWrite?.ok) return blocker('OPENCLAW_OC2_PROOF_WRITE_FAILED');

  const workerId = `openclaw-${sha256(providerInstance).slice(0, 24)}`;
  const executionReceipt = createExecutionReceipt({
    receiptId,
    repository: REPOSITORY,
    issueNumber: OPENCLAW_OC2_ISSUE,
    prNumber: 0,
    branch,
    sourceHead,
    workerId,
    workerType: 'openclaw',
    executionId,
    leaseKey: `oc2-${taskHash}`,
    state: 'completed',
    phase: OPENCLAW_OC2_TASK_CLASS,
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc,
    heartbeatExpiresAtUtc: new Date(now.getTime() + 120_000).toISOString(),
    blocker: '',
    operatorActionRequired: false,
    proofRefs: [proofRef],
    expectedNextAction: 'Await independent Stephanos OC2 task-class qualification adjudication.',
  });
  const workspaceReceipt = toSharedWorkspaceExecutionReceipt(executionReceipt);
  if (!workspaceReceipt.ok) return blocker('OPENCLAW_OC2_EXECUTION_RECEIPT_INVALID');
  const receiptWrite = await writeJson(workspaceRoot, ['receipts', `${receiptId}.json`], workspaceReceipt.record, { repoRoot });
  if (!receiptWrite?.ok) return blocker('OPENCLAW_OC2_EXECUTION_RECEIPT_WRITE_FAILED');

  return Object.freeze({
    success: true,
    error: '',
    resultId: task.taskId,
    changedFiles: Object.freeze([]),
    completedAt: timestampUtc,
    qualificationEligible: true,
    providerInstance,
    exactInputIdentity: task.exactInputIdentity,
    exactOutputIdentity,
    receipt: Object.freeze({
      receiptId: `openclaw-oc2-result-${sha256(task.taskId).slice(0, 20)}`,
      requirement: 'provider-neutral OpenClaw OC2 deterministic test/build result',
      source: 'openclaw-standalone-oc2',
      evidenceType: 'provider-neutral-task-result',
      verified: true,
      commandOutputHash: exactOutputIdentity,
      createdAt: timestampUtc,
    }),
    evidenceReceipts: Object.freeze([Object.freeze({
      receiptId: `openclaw-oc2-proof-${sha256(proofRef).slice(0, 20)}`,
      requirement: 'OpenClaw OC2 canonical claimed-task proof',
      source: 'openclaw-standalone-oc2',
      evidenceType: 'shared-workspace-proof',
      verified: true,
      sha256: exactOutputIdentity,
      receiptPath: proofRef,
      createdAt: timestampUtc,
    })]),
  });
}
