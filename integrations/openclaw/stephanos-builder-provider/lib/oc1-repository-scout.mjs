import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

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

export const OPENCLAW_OC1_TASK_CLASS = 'OC1_REPOSITORY_SCOUT';
export const OPENCLAW_OC1_PROVIDER = 'openclaw-standalone';
export const OPENCLAW_OC1_PROVIDER_VERSION = '1.0.0';
export const OPENCLAW_OC1_COMMAND = 'scout';
export const OPENCLAW_OC1_ISSUE = 1725;
export const OPENCLAW_OC1_QUALIFICATION_TASK_SCHEMA = 'stephanos.openclaw-oc1-qualified-task.v1';
export const OPENCLAW_OC1_PROVIDER_RESULT_SCHEMA = 'stephanos.openclaw-oc1-provider-result.v1';

const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const CANONICAL_BRANCH = 'main';
const FULL_SHA = /^[0-9a-f]{40}$/i;
const SAFE_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SAFE_OUTPUT_ID = /^[a-f0-9]{32}$/;
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/;
const MAX_GIT_OUTPUT = 64 * 1024;
const MAX_PACKAGE_SCRIPTS = 128;
const MAX_SAFE_PATHS = 24;
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.env(?:\.|$)|[^\\/]*(?:secret|token|credential|password|session|private[-_]?key)[^\\/]*)/i;
const CANONICAL_ORIGIN = Object.freeze([
  /^https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?$/i,
  /^git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?$/i,
  /^ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?$/i,
]);

const RELEVANT_FILES = Object.freeze([
  'shared/agents/openClawLocalAdapter.mjs',
  'shared/agents/openClawPolicyHarness.mjs',
  'shared/agents/executionReceiptV1.mjs',
  'shared/agents/sharedAgentWorkspaceStore.mjs',
  'integrations/openclaw/stephanos-ignite-command/index.js',
]);

const FIXED_OPERATIONS = Object.freeze([
  'git-rev-parse-toplevel',
  'git-remote-get-url-origin',
  'git-rev-parse-branch',
  'git-rev-parse-head',
  'git-status-porcelain-v1',
  'read-package-json-script-names',
  'check-fixed-relevant-file-estate',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safeProofId(value) {
  const normalized = String(value || '').replace(/[^a-f0-9]/gi, '').toLowerCase().slice(0, 32);
  return SAFE_OUTPUT_ID.test(normalized) ? normalized : '';
}

function canonicalOrigin(value) {
  const candidate = text(value);
  return CANONICAL_ORIGIN.some((pattern) => pattern.test(candidate));
}

function boundedOutput(value) {
  const output = String(value ?? '').replace(/^\uFEFF/, '');
  if (Buffer.byteLength(output, 'utf8') > MAX_GIT_OUTPUT) throw new Error('OPENCLAW_OC1_GIT_OUTPUT_TOO_LARGE');
  return output.trimEnd();
}

function safeReportedPath(value) {
  const candidate = String(value || '').replace(/\\/g, '/').trim();
  if (!candidate || path.posix.isAbsolute(candidate) || /^[a-z]:\//i.test(candidate)) return '';
  if (candidate.split('/').some((part) => part === '..')) return '';
  if (SENSITIVE_PATH.test(candidate)) return '';
  if (candidate.startsWith('apps/stephanos/dist/')) return '';
  if (candidate.length > 240) return '';
  return candidate;
}

function boundedSafePaths(values) {
  return Object.freeze((Array.isArray(values) ? values : [])
    .map(safeReportedPath)
    .filter(Boolean)
    .slice(0, MAX_SAFE_PATHS));
}

function authenticatedRuntimeId(authenticatedContext, hostPid = process.pid) {
  if (authenticatedContext?.authenticatedByHost !== true
    || authenticatedContext?.commandName !== 'stephanos-builder'
    || authenticatedContext?.command !== OPENCLAW_OC1_COMMAND) {
    throw new Error('OPENCLAW_OC1_AUTHENTICATED_HOST_REQUIRED');
  }
  if (!Number.isSafeInteger(hostPid) || hostPid < 1) throw new Error('OPENCLAW_OC1_HOST_PID_INVALID');
  return `openclaw-plugin-host:${hostPid}`;
}

async function readOpenClawRuntimeIdentity(fetchFn, {
  authenticatedContext,
  hostPid,
  qualificationRequired = false,
} = {}) {
  try {
    const response = await fetchFn('http://127.0.0.1:18789/identity', { signal: AbortSignal.timeout(5_000) });
    if (response?.ok) {
      const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType || contentType.includes('json')) {
        const identity = await response.json();
        const runtimeId = text(identity?.runtimeId);
        if (identity?.product === 'OpenClaw' && SAFE_RUNTIME_ID.test(runtimeId)) {
          return Object.freeze({ runtimeId, source: 'openclaw-gateway-identity' });
        }
      }
    }
  } catch {
    // Qualification fails closed below. Diagnostics may use the authenticated plugin host.
  }
  if (qualificationRequired) throw new Error('OPENCLAW_OC1_LIVE_PROVIDER_IDENTITY_REQUIRED');
  return Object.freeze({
    runtimeId: authenticatedRuntimeId(authenticatedContext, hostPid),
    source: 'authenticated-plugin-host',
  });
}

function runFixedGit(spawnSyncFn, repoRoot, args, env) {
  const result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, args, {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  if (result?.error || result?.status !== 0) throw new Error('OPENCLAW_OC1_FIXED_GIT_READ_FAILED');
  return boundedOutput(result.stdout);
}

function packageScriptNames(packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
    ? Object.keys(packageJson.scripts)
    : [];
  const normalized = scripts.filter((name) => SAFE_SCRIPT_NAME.test(name)).sort();
  if (normalized.length > MAX_PACKAGE_SCRIPTS) throw new Error('OPENCLAW_OC1_PACKAGE_SCRIPT_ESTATE_TOO_LARGE');
  return Object.freeze(normalized);
}

function dirtProof(dirt) {
  return Object.freeze({
    trackedSourceCount: dirt.trackedSource.length,
    untrackedSourceCount: dirt.untrackedSource.length,
    runtimeOnlyCount: dirt.runtimeOnly.length,
    generatedSourceCount: dirt.generatedSource.length,
    unknownCount: dirt.unknown.length,
    trackedSource: boundedSafePaths(dirt.trackedSource),
    untrackedSource: boundedSafePaths(dirt.untrackedSource),
    unknown: Object.freeze(dirt.unknown.slice(0, MAX_SAFE_PATHS).map(() => '[unclassified-status-redacted]')),
    blocksQualification: dirt.blocksSync === true,
  });
}

function diagnosticProofBody({ repositoryRoot, branch, sourceHead, origin, dirt, scripts, relevantFiles, runtimeId }) {
  return JSON.stringify({
    schemaVersion: 'stephanos.openclaw-oc1-repository-scout-proof.v1',
    mode: 'DIAGNOSTIC_NON_QUALIFYING',
    provider: OPENCLAW_OC1_PROVIDER,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    providerRuntimeId: runtimeId,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    repository: CANONICAL_REPOSITORY,
    canonicalRepositoryRoot: repositoryRoot,
    branch,
    sourceHead,
    originCanonical: canonicalOrigin(origin),
    dirt,
    packageScripts: scripts,
    relevantFiles,
    operations: FIXED_OPERATIONS,
    qualificationEligible: false,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    networkMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    selfQualificationAllowed: false,
  });
}

function qualificationBlocker(reason) {
  return Object.freeze({ ok: false, blocker: reason, task: null });
}

export async function validateOpenClawOc1QualificationContext(context = {}, { readFileFn = readFile } = {}) {
  const action = context.action;
  const claim = context.claim;
  const grant = context.actionGrant;
  const missionId = text(grant?.missionId).toLowerCase();
  const taskId = text(grant?.actionId).toLowerCase();
  const expectedGoalId = `#${OPENCLAW_OC1_ISSUE}`;
  const requestedSourceHead = text(context.requestedSourceHead).toLowerCase();

  if (
    grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || grant?.boundedActionCount !== 1
    || grant?.mergeAuthority !== false
    || grant?.leaseSeizureAllowed !== false
    || grant?.issueNumber !== OPENCLAW_OC1_ISSUE
    || text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(grant?.repository) !== CANONICAL_REPOSITORY
    || !missionId
    || !taskId
  ) return qualificationBlocker('OPENCLAW_OC1_QUALIFICATION_GRANT_INVALID');

  if (
    context.taskClass !== OPENCLAW_OC1_TASK_CLASS
    || context.goalId !== expectedGoalId
    || context.taskId !== taskId
    || context.providerVersion !== OPENCLAW_OC1_PROVIDER_VERSION
  ) return qualificationBlocker('OPENCLAW_OC1_QUALIFICATION_BINDING_INVALID');

  if (!FULL_SHA.test(requestedSourceHead) || requestedSourceHead !== text(grant?.sourceRevision).toLowerCase()) {
    return qualificationBlocker('OPENCLAW_OC1_REQUESTED_HEAD_BINDING_INVALID');
  }

  if (
    claim?.adapter !== 'openclaw-readonly'
    || claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
    || text(claim?.item?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(claim?.item?.missionId).toLowerCase() !== missionId
    || text(claim?.item?.actionId).toLowerCase() !== taskId
    || !text(claim?.processingPath)
    || path.resolve(path.dirname(claim.processingPath)) !== path.resolve(text(claim?.paths?.processing))
  ) return qualificationBlocker('OPENCLAW_OC1_CANONICAL_CLAIM_INVALID');

  if (
    action?.schemaVersion !== 'stephanos.mission-worker-action.v1'
    || action?.actionKind !== 'agent-handoff'
    || action?.adapter !== 'openclaw-readonly'
    || action?.executable !== true
    || text(action?.missionId).toLowerCase() !== missionId
    || text(action?.actionId).toLowerCase() !== taskId
    || text(action?.repository) !== CANONICAL_REPOSITORY
    || claim.item.payload !== action
  ) return qualificationBlocker('OPENCLAW_OC1_QUALIFICATION_LINEAGE_INVALID');

  let persistedClaim;
  try {
    persistedClaim = JSON.parse(await readFileFn(claim.processingPath, 'utf8'));
  } catch {
    return qualificationBlocker('OPENCLAW_OC1_CLAIM_PROOF_UNREADABLE');
  }
  if (JSON.stringify(persistedClaim) !== JSON.stringify(claim.item)) {
    return qualificationBlocker('OPENCLAW_OC1_CLAIM_PROOF_MISMATCH');
  }

  const task = Object.freeze({
    schemaVersion: OPENCLAW_OC1_QUALIFICATION_TASK_SCHEMA,
    missionId,
    goalId: expectedGoalId,
    taskId,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    repository: CANONICAL_REPOSITORY,
    requestedSourceHead,
    provider: OPENCLAW_OC1_PROVIDER,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    grantId: text(grant.grantId),
    adapter: 'openclaw-readonly',
    boundedActionCount: 1,
    mergeAuthority: false,
    deploymentAuthority: false,
    sourceMutationAuthority: false,
    selfQualificationAuthority: false,
  });
  return Object.freeze({
    ok: true,
    blocker: '',
    task: Object.freeze({ ...task, exactInputIdentity: sha256(JSON.stringify(task)) }),
  });
}

function providerResult({
  task,
  runtimeIdentity,
  sourceHead,
  dirt,
  scripts,
  relevantFiles,
  proofRef,
  receiptId,
  timestampUtc,
  blocker = '',
} = {}) {
  const completed = !blocker;
  const core = Object.freeze({
    schemaVersion: OPENCLAW_OC1_PROVIDER_RESULT_SCHEMA,
    missionId: task.missionId,
    goalId: task.goalId,
    taskId: task.taskId,
    taskClass: task.taskClass,
    repository: task.repository,
    requestedSourceHead: task.requestedSourceHead,
    observedSourceHead: sourceHead,
    exactInputIdentity: task.exactInputIdentity,
    provider: OPENCLAW_OC1_PROVIDER,
    providerInstance: runtimeIdentity.runtimeId,
    providerIdentitySource: runtimeIdentity.source,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    authorityUsed: Object.freeze({
      grantId: task.grantId,
      adapter: task.adapter,
      canonicalMissionWorkerClaim: true,
      boundedActionCount: 1,
      mergeAuthority: false,
      deploymentAuthority: false,
      sourceMutationAuthority: false,
      selfQualificationAuthority: false,
    }),
    commandsOrTestIds: FIXED_OPERATIONS,
    artifacts: Object.freeze([proofRef, `receipts/${receiptId}.json`]),
    dirt,
    packageScripts: scripts,
    relevantFiles,
    startedAtUtc: timestampUtc,
    completedAtUtc: timestampUtc,
    blockers: Object.freeze(blocker ? [blocker] : []),
    finalVerdict: completed
      ? 'OPENCLAW_OC1_PROVIDER_TASK_COMPLETED'
      : 'OPENCLAW_OC1_PROVIDER_TASK_BLOCKED',
    sourceMutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    networkMutationAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    selfQualificationAllowed: false,
  });
  return Object.freeze({ ...core, exactOutputIdentity: sha256(JSON.stringify(core)) });
}

export function resolveOpenClawBuilderCommand(args = '') {
  const command = text(args).toLowerCase();
  if (!command || command === 'help') {
    return Object.freeze({ ok: true, command: 'help', mutationAllowed: false });
  }
  if (command === OPENCLAW_OC1_COMMAND || command === 'oc1-scout') {
    return Object.freeze({ ok: true, command: OPENCLAW_OC1_COMMAND, mutationAllowed: false });
  }
  return Object.freeze({ ok: false, command: '', blocker: 'OPENCLAW_BUILDER_COMMAND_NOT_ALLOWLISTED', mutationAllowed: false });
}

export function renderOpenClawBuilderHelp() {
  return [
    'STEPHANOS_OPENCLAW_BUILDER_PROVIDER',
    'SUPPORTED=help|scout',
    'OC1=scout is a read-only diagnostic when invoked manually',
    'QUALIFICATION=only an already-claimed canonical openclaw-readonly Mission Worker task may qualify',
    'SOURCE_MUTATION=false',
    'ARBITRARY_SHELL=false',
    'MERGE_AUTHORITY=false',
  ].join('\n');
}

export async function runOpenClawOc1RepositoryScout({
  platform = process.platform,
  env = process.env,
  authenticatedContext = null,
  qualificationContext = null,
  hostPid = process.pid,
  spawnSyncFn = spawnSync,
  readFileFn = readFile,
  existsSyncFn = existsSync,
  fetchFn = fetch,
  now = new Date(),
  randomIdFn = randomUUID,
  writeAtomicJsonFn = writeAtomicJson,
  ensureSharedWorkspaceLayoutFn = ensureSharedWorkspaceLayout,
} = {}) {
  if (platform !== 'win32') return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_WINDOWS_REQUIRED', qualificationEligible: false });
  if (!env.USERPROFILE) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_USERPROFILE_REQUIRED', qualificationEligible: false });

  let qualification = null;
  if (qualificationContext) {
    qualification = await validateOpenClawOc1QualificationContext(qualificationContext, { readFileFn });
    if (!qualification.ok) return Object.freeze({ ...qualification, qualificationEligible: false, mutationPerformed: false });
  }

  let runtimeIdentity;
  try {
    runtimeIdentity = await readOpenClawRuntimeIdentity(fetchFn, {
      authenticatedContext,
      hostPid,
      qualificationRequired: Boolean(qualification),
    });
  } catch (error) {
    return Object.freeze({ ok: false, blocker: error?.message || 'OPENCLAW_OC1_AUTHENTICATION_FAILED', qualificationEligible: false, mutationPerformed: false });
  }

  const repoRoot = path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace');
  if (!existsSyncFn(repoRoot)) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_CANONICAL_REPOSITORY_MISSING', qualificationEligible: false });

  let topLevel;
  let origin;
  let branch;
  let sourceHead;
  let status;
  let scripts;
  try {
    topLevel = path.resolve(runFixedGit(spawnSyncFn, repoRoot, ['rev-parse', '--show-toplevel'], env));
    origin = runFixedGit(spawnSyncFn, repoRoot, ['remote', 'get-url', 'origin'], env);
    branch = runFixedGit(spawnSyncFn, repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], env);
    sourceHead = runFixedGit(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD'], env).toLowerCase();
    status = runFixedGit(spawnSyncFn, repoRoot, ['status', '--porcelain=v1', '--untracked-files=all'], env);
    const packageJson = JSON.parse(await readFileFn(path.join(repoRoot, 'package.json'), 'utf8'));
    scripts = packageScriptNames(packageJson);
  } catch (error) {
    return Object.freeze({ ok: false, blocker: error?.message || 'OPENCLAW_OC1_REPOSITORY_READ_FAILED', qualificationEligible: false });
  }

  if (topLevel.toLowerCase() !== repoRoot.toLowerCase()) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_REPOSITORY_ROOT_MISMATCH', qualificationEligible: false });
  if (!canonicalOrigin(origin)) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_ORIGIN_MISMATCH', qualificationEligible: false });
  if (branch !== CANONICAL_BRANCH) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_NON_MAIN_BRANCH', qualificationEligible: false });
  if (!FULL_SHA.test(sourceHead)) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_SOURCE_HEAD_INVALID', qualificationEligible: false });
  if (qualification && sourceHead !== qualification.task.requestedSourceHead) {
    return Object.freeze({
      ok: false,
      blocker: 'OPENCLAW_OC1_REQUESTED_HEAD_MISMATCH',
      requestedSourceHead: qualification.task.requestedSourceHead,
      sourceHead,
      qualificationEligible: false,
      mutationPerformed: false,
    });
  }

  const statusLines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  const dirt = classifyDirt(statusLines);
  const dirtEvidence = dirtProof(dirt);
  const relevantFiles = Object.freeze(RELEVANT_FILES.filter((relativePath) => existsSyncFn(path.join(repoRoot, ...relativePath.split('/')))));
  const proofId = safeProofId(randomIdFn());
  if (!proofId) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_PROOF_ID_INVALID', qualificationEligible: false });
  const timestampUtc = now.toISOString();

  if (!qualification) {
    const executionId = `oc1-diagnostic-${proofId}`;
    const proofRef = `proofs/openclaw-oc1/${executionId}.json`;
    const proofRecord = createSharedWorkspaceMessageRecord({
      messageId: executionId,
      participantId: 'openclaw',
      timestampUtc,
      correlationId: executionId,
      relatedIssue: String(OPENCLAW_OC1_ISSUE),
      relatedPr: '',
      proofRefs: [proofRef],
      channel: 'openclaw-provider-diagnostics',
      summary: 'OpenClaw OC1 manual repository scout completed as diagnostic-only evidence; it is not qualification evidence.',
      body: diagnosticProofBody({
        repositoryRoot: repoRoot,
        branch,
        sourceHead,
        origin,
        dirt: dirtEvidence,
        scripts,
        relevantFiles,
        runtimeId: runtimeIdentity.runtimeId,
      }),
    });
    const layout = await ensureSharedWorkspaceLayoutFn({ root: workspaceRoot, repoRoot });
    if (!layout?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_SHARED_WORKSPACE_UNAVAILABLE', qualificationEligible: false });
    const proofWrite = await writeAtomicJsonFn(workspaceRoot, ['proofs', 'openclaw-oc1', `${executionId}.json`], proofRecord, { repoRoot });
    if (!proofWrite?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_PROOF_WRITE_FAILED', qualificationEligible: false });
    return Object.freeze({
      ok: true,
      provider: OPENCLAW_OC1_PROVIDER,
      providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
      providerInstance: runtimeIdentity.runtimeId,
      taskClass: OPENCLAW_OC1_TASK_CLASS,
      executionId,
      repository: CANONICAL_REPOSITORY,
      branch,
      sourceHead,
      proofRef,
      relevantFileCount: relevantFiles.length,
      packageScriptCount: scripts.length,
      qualificationEligible: false,
      receiptId: '',
      mutationPerformed: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      finalVerdict: 'OPENCLAW_OC1_DIAGNOSTIC_SCOUT_COMPLETED',
    });
  }

  const taskHash = sha256(`${qualification.task.missionId}\n${qualification.task.taskId}`).slice(0, 32);
  const executionId = `oc1-${taskHash}`;
  const receiptId = `oc1-receipt-${taskHash}`;
  const proofRef = `proofs/openclaw-oc1/${executionId}.json`;
  const blocker = dirt.blocksSync ? 'OPENCLAW_OC1_DIRTY_SOURCE_BLOCKS_QUALIFICATION' : '';
  const resultRecord = providerResult({
    task: qualification.task,
    runtimeIdentity,
    sourceHead,
    dirt: dirtEvidence,
    scripts,
    relevantFiles,
    proofRef,
    receiptId,
    timestampUtc,
    blocker,
  });
  const proofRecord = createSharedWorkspaceMessageRecord({
    messageId: executionId,
    participantId: 'openclaw',
    timestampUtc,
    correlationId: qualification.task.taskId,
    relatedIssue: String(OPENCLAW_OC1_ISSUE),
    relatedPr: '',
    proofRefs: [proofRef],
    channel: 'openclaw-provider-qualification',
    summary: blocker
      ? 'OpenClaw OC1 claimed provider task blocked by canonical source dirt.'
      : 'OpenClaw OC1 claimed provider task completed with provider-neutral mission/task lineage.',
    body: JSON.stringify(resultRecord),
  });

  const layout = await ensureSharedWorkspaceLayoutFn({ root: workspaceRoot, repoRoot });
  if (!layout?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_SHARED_WORKSPACE_UNAVAILABLE', qualificationEligible: false });
  const proofWrite = await writeAtomicJsonFn(workspaceRoot, ['proofs', 'openclaw-oc1', `${executionId}.json`], proofRecord, { repoRoot });
  if (!proofWrite?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_PROOF_WRITE_FAILED', qualificationEligible: false });

  if (blocker) {
    return Object.freeze({
      ok: false,
      blocker,
      taskClass: OPENCLAW_OC1_TASK_CLASS,
      missionId: qualification.task.missionId,
      goalId: qualification.task.goalId,
      taskId: qualification.task.taskId,
      sourceHead,
      proofRef,
      exactInputIdentity: qualification.task.exactInputIdentity,
      exactOutputIdentity: resultRecord.exactOutputIdentity,
      qualificationEligible: false,
      mutationPerformed: false,
    });
  }

  const receiptWorkerId = `openclaw-${sha256(runtimeIdentity.runtimeId).slice(0, 24)}`;
  const executionReceipt = createExecutionReceipt({
    receiptId,
    repository: CANONICAL_REPOSITORY,
    issueNumber: OPENCLAW_OC1_ISSUE,
    prNumber: 0,
    branch,
    sourceHead,
    workerId: receiptWorkerId,
    workerType: 'openclaw',
    executionId,
    leaseKey: `oc1-${taskHash}`,
    state: 'completed',
    phase: OPENCLAW_OC1_TASK_CLASS,
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc,
    heartbeatExpiresAtUtc: new Date(now.getTime() + 120_000).toISOString(),
    blocker: '',
    operatorActionRequired: false,
    proofRefs: [proofRef],
    expectedNextAction: 'Await independent Stephanos task-class qualification adjudication.',
  });
  const workspaceReceipt = toSharedWorkspaceExecutionReceipt(executionReceipt);
  if (!workspaceReceipt.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_EXECUTION_RECEIPT_INVALID', qualificationEligible: false });
  const receiptWrite = await writeAtomicJsonFn(workspaceRoot, ['receipts', `${receiptId}.json`], workspaceReceipt.record, { repoRoot });
  if (!receiptWrite?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_EXECUTION_RECEIPT_WRITE_FAILED', qualificationEligible: false });

  return Object.freeze({
    ok: true,
    provider: OPENCLAW_OC1_PROVIDER,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    providerInstance: runtimeIdentity.runtimeId,
    workerId: receiptWorkerId,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    missionId: qualification.task.missionId,
    goalId: qualification.task.goalId,
    taskId: qualification.task.taskId,
    executionId,
    receiptId,
    repository: CANONICAL_REPOSITORY,
    branch,
    sourceHead,
    proofRef,
    exactInputIdentity: qualification.task.exactInputIdentity,
    exactOutputIdentity: resultRecord.exactOutputIdentity,
    relevantFileCount: relevantFiles.length,
    packageScriptCount: scripts.length,
    qualificationEligible: true,
    mutationPerformed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    completedAtUtc: timestampUtc,
    finalVerdict: 'OPENCLAW_OC1_PROVIDER_TASK_COMPLETED',
  });
}

export async function executeClaimedOpenClawOc1RepositoryScout(action, claim, options = {}) {
  const actionGrant = options.actionGrant;
  const taskId = text(actionGrant?.actionId).toLowerCase();
  const result = await runOpenClawOc1RepositoryScout({
    ...options,
    authenticatedContext: null,
    qualificationContext: {
      action,
      claim,
      actionGrant,
      taskClass: options.taskClass,
      goalId: options.goalId,
      taskId,
      providerVersion: options.providerVersion,
      requestedSourceHead: options.requestedSourceHead,
    },
  });
  const success = result.ok === true && result.qualificationEligible === true;
  return Object.freeze({
    success,
    error: success ? '' : result.blocker || 'OPENCLAW_OC1_PROVIDER_TASK_BLOCKED',
    resultId: success ? result.taskId : taskId || text(action?.actionId),
    changedFiles: Object.freeze([]),
    completedAt: result.completedAtUtc || (options.now instanceof Date ? options.now.toISOString() : new Date().toISOString()),
    receipt: success ? Object.freeze({
      receiptId: `openclaw-oc1-result-${sha256(result.taskId).slice(0, 20)}`,
      requirement: 'provider-neutral OpenClaw OC1 result',
      source: 'openclaw-standalone-oc1',
      evidenceType: 'provider-neutral-task-result',
      verified: true,
      commandOutputHash: result.exactOutputIdentity,
      createdAt: result.completedAtUtc,
    }) : undefined,
    evidenceReceipts: success ? Object.freeze([Object.freeze({
      receiptId: `openclaw-oc1-proof-${sha256(result.proofRef).slice(0, 20)}`,
      requirement: 'OpenClaw OC1 canonical claimed-task proof',
      source: 'openclaw-standalone-oc1',
      evidenceType: 'shared-workspace-proof',
      verified: true,
      sha256: result.exactOutputIdentity,
      receiptPath: result.proofRef,
      createdAt: result.completedAtUtc,
    })]) : Object.freeze([]),
  });
}
