import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
export const OPENCLAW_OC1_COMMAND = 'scout';
export const OPENCLAW_OC1_ISSUE = 1725;

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

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
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

async function readOpenClawRuntimeId(fetchFn, authenticatedContext, hostPid) {
  const fallback = authenticatedRuntimeId(authenticatedContext, hostPid);
  try {
    const response = await fetchFn('http://127.0.0.1:18789/identity', { signal: AbortSignal.timeout(5_000) });
    if (response?.ok) {
      const contentType = String(response?.headers?.get?.('content-type') || '').toLowerCase();
      if (!contentType || contentType.includes('json')) {
        const identity = await response.json();
        const runtimeId = text(identity?.runtimeId);
        if (identity?.product === 'OpenClaw' && SAFE_RUNTIME_ID.test(runtimeId)) return runtimeId;
      }
    }
  } catch {
    // The authenticated plugin-host process is the bounded fallback identity.
  }
  return fallback;
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

function proofBody({ repositoryRoot, branch, sourceHead, origin, dirt, scripts, relevantFiles, runtimeId }) {
  return JSON.stringify({
    schemaVersion: 'stephanos.openclaw-oc1-repository-scout-proof.v1',
    provider: OPENCLAW_OC1_PROVIDER,
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
    operations: [
      'git-rev-parse-toplevel',
      'git-remote-get-url-origin',
      'git-rev-parse-branch',
      'git-rev-parse-head',
      'git-status-porcelain-v1',
      'read-package-json-script-names',
      'check-fixed-relevant-file-estate',
    ],
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    networkMutationAllowed: false,
    mergeAllowed: false,
  });
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
    'OC1=scout reads canonical repo truth and writes bounded Shared Workspace evidence',
    'SOURCE_MUTATION=false',
    'ARBITRARY_SHELL=false',
    'MERGE_AUTHORITY=false',
  ].join('\n');
}

export async function runOpenClawOc1RepositoryScout({
  platform = process.platform,
  env = process.env,
  authenticatedContext = null,
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
  if (platform !== 'win32') return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_WINDOWS_REQUIRED' });
  if (!env.USERPROFILE) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_USERPROFILE_REQUIRED' });

  let runtimeId;
  try {
    runtimeId = await readOpenClawRuntimeId(fetchFn, authenticatedContext, hostPid);
  } catch (error) {
    return Object.freeze({ ok: false, blocker: error?.message || 'OPENCLAW_OC1_AUTHENTICATION_FAILED' });
  }

  const repoRoot = path.resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace');
  if (!existsSyncFn(repoRoot)) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_CANONICAL_REPOSITORY_MISSING' });

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
    return Object.freeze({ ok: false, blocker: error?.message || 'OPENCLAW_OC1_REPOSITORY_READ_FAILED' });
  }

  if (topLevel.toLowerCase() !== repoRoot.toLowerCase()) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_REPOSITORY_ROOT_MISMATCH' });
  if (!canonicalOrigin(origin)) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_ORIGIN_MISMATCH' });
  if (branch !== CANONICAL_BRANCH) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_NON_MAIN_BRANCH' });
  if (!FULL_SHA.test(sourceHead)) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_SOURCE_HEAD_INVALID' });

  const statusLines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  const dirt = classifyDirt(statusLines);
  const dirtEvidence = dirtProof(dirt);
  const relevantFiles = Object.freeze(RELEVANT_FILES.filter((relativePath) => existsSyncFn(path.join(repoRoot, ...relativePath.split('/')))));
  const proofId = safeProofId(randomIdFn());
  if (!proofId) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_PROOF_ID_INVALID' });
  const executionId = `oc1-scout-${proofId}`;
  const proofRef = `proofs/openclaw-oc1/${executionId}.json`;
  const timestampUtc = now.toISOString();

  const proofRecord = createSharedWorkspaceMessageRecord({
    messageId: executionId,
    participantId: 'openclaw',
    timestampUtc,
    correlationId: executionId,
    relatedIssue: String(OPENCLAW_OC1_ISSUE),
    relatedPr: '',
    proofRefs: [proofRef],
    channel: 'openclaw-provider-qualification',
    summary: dirt.blocksSync
      ? 'OpenClaw OC1 repository scout blocked because source identity is not clean enough for qualification.'
      : 'OpenClaw OC1 repository scout completed against canonical main with read-only evidence.',
    body: proofBody({ repositoryRoot: repoRoot, branch, sourceHead, origin, dirt: dirtEvidence, scripts, relevantFiles, runtimeId }),
  });

  const layout = await ensureSharedWorkspaceLayoutFn({ root: workspaceRoot, repoRoot });
  if (!layout?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_SHARED_WORKSPACE_UNAVAILABLE' });
  const proofWrite = await writeAtomicJsonFn(workspaceRoot, ['proofs', 'openclaw-oc1', `${executionId}.json`], proofRecord, { repoRoot });
  if (!proofWrite?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_PROOF_WRITE_FAILED' });

  if (dirt.blocksSync) {
    return Object.freeze({
      ok: false,
      blocker: 'OPENCLAW_OC1_DIRTY_SOURCE_BLOCKS_QUALIFICATION',
      taskClass: OPENCLAW_OC1_TASK_CLASS,
      sourceHead,
      proofRef,
      mutationPerformed: false,
    });
  }

  const receiptId = `oc1-receipt-${proofId}`;
  const executionReceipt = createExecutionReceipt({
    receiptId,
    repository: CANONICAL_REPOSITORY,
    issueNumber: OPENCLAW_OC1_ISSUE,
    prNumber: 0,
    branch,
    sourceHead,
    workerId: runtimeId,
    workerType: 'openclaw',
    executionId,
    leaseKey: `oc1-readonly-${proofId}`,
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
  if (!workspaceReceipt.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_EXECUTION_RECEIPT_INVALID' });
  const receiptWrite = await writeAtomicJsonFn(workspaceRoot, ['receipts', `${receiptId}.json`], workspaceReceipt.record, { repoRoot });
  if (!receiptWrite?.ok) return Object.freeze({ ok: false, blocker: 'OPENCLAW_OC1_EXECUTION_RECEIPT_WRITE_FAILED' });

  return Object.freeze({
    ok: true,
    provider: OPENCLAW_OC1_PROVIDER,
    workerId: runtimeId,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    executionId,
    receiptId,
    repository: CANONICAL_REPOSITORY,
    branch,
    sourceHead,
    proofRef,
    relevantFileCount: relevantFiles.length,
    packageScriptCount: scripts.length,
    mutationPerformed: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    finalVerdict: 'OPENCLAW_OC1_REPOSITORY_SCOUT_COMPLETED',
  });
}
