import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { types as utilTypes } from 'node:util';
import { readCurrentExecutionReceipt } from './executionReceiptV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
} from './sharedAgentWorkspaceStore.mjs';

export const STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA = 'stephanos.native-staging-request.v1';
export const STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA = 'stephanos.native-model-result.v1';
export const STEPHANOS_NATIVE_STAGING_RECEIPT_SCHEMA = 'stephanos.native-staging-receipt.v1';
export const STEPHANOS_NATIVE_PROMOTION_JOURNAL_SCHEMA = 'stephanos.native-promotion-journal.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_MISSION_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const EXECUTION_SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const EXECUTION_SAFE_BRANCH = /^[a-z0-9][a-z0-9._/-]{0,180}$/i;
const MAX_FILES = 12;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const REQUEST_KEYS = Object.freeze([
  'schemaVersion','missionId','actionId','workerId','repository','branch','baseHead','leaseId',
  'allowedFiles','requiredTestIds','sourceSnapshots',
]);
const RESULT_KEYS = Object.freeze(['schemaVersion','missionId','actionId','baseHead','replacements','summary']);
const TEST_OUTPUT_KEYS = Object.freeze(['testId','outputSha256']);
const PROTECTED_PATH_SEGMENTS = new Set(['.git','node_modules','dist','build','coverage','.next','out']);

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function inspectable(value) {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function') && !utilTypes.isProxy(value);
}
function exactKeys(value, keys) {
  if (!inspectable(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== 'string')) return false;
    if (JSON.stringify([...ownKeys].sort()) !== JSON.stringify([...keys].sort())) return false;
    return ownKeys.every((key) => {
      const descriptor = descriptors[key];
      return Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable === true;
    });
  } catch {
    return false;
  }
}
function plainArray(value) {
  if (!Array.isArray(value) || utilTypes.isProxy(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (ownKeys.some((key) => typeof key !== 'string')) return false;
    if (ownKeys.length !== value.length + 1 || !Object.prototype.hasOwnProperty.call(descriptors, 'length')) return false;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return false;
    }
    return true;
  } catch {
    return false;
  }
}
function unique(values) { return plainArray(values) && values.length === new Set(values).size; }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function frozen(value) { return Object.freeze(value); }
function canonicalBranch(value) {
  const raw = text(value);
  if (!raw) return '';
  const normalized = raw.startsWith('refs/heads/') ? raw.slice('refs/heads/'.length) : raw;
  if (!EXECUTION_SAFE_BRANCH.test(normalized)
    || normalized.toLowerCase() === 'main'
    || normalized.includes('..')
    || normalized.includes('//')
    || normalized.includes('@{')
    || normalized.startsWith('/')
    || normalized.endsWith('/')
    || normalized.endsWith('.')
    || normalized.split('/').some((segment) => !segment || segment.startsWith('.') || segment.endsWith('.lock'))) return '';
  return normalized;
}
function canonicalPath(value) {
  const raw = text(value).replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z]:\//i.test(raw) || raw.includes('\0')) return '';
  const normalized = path.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => PROTECTED_PATH_SEGMENTS.has(segment.toLowerCase()) || segment.toLowerCase().startsWith('.env'))) return '';
  if (segments[0]?.toLowerCase() === 'runtime') return '';
  return normalized;
}

export function buildStephanosNativeTestExecutionId(actionId, testId) {
  const action = text(actionId).toLowerCase();
  const test = text(testId).toLowerCase();
  if (!EXECUTION_SAFE_ID.test(action) || !EXECUTION_SAFE_ID.test(test)) return '';
  return `native-test-${sha256(`${action}\n${test}`).slice(0,24)}`;
}

export function buildStephanosNativeTestProofRef(outputSha256) {
  const digest = text(outputSha256).toLowerCase();
  return SHA256.test(digest) ? `proof/native-test-${digest}.json` : '';
}

export function validateStephanosNativeStagingRequest(request = {}) {
  const errors = [];
  if (!exactKeys(request, REQUEST_KEYS)) {
    return frozen({ valid:false, errors:frozen(['request-shape-invalid']), allowedFiles:frozen([]), requiredTestIds:frozen([]), branch:'', baseHead:'', leaseId:'' });
  }
  if (request.schemaVersion !== STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA) errors.push('request-schema-invalid');
  if (!SAFE_MISSION_ID.test(text(request.missionId))) errors.push('missionId-invalid');
  for (const key of ['actionId','workerId','leaseId']) if (!EXECUTION_SAFE_ID.test(text(request[key]))) errors.push(`${key}-invalid`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text(request.repository))) errors.push('repository-invalid');
  const branch = canonicalBranch(request.branch);
  if (!branch) errors.push('branch-invalid');
  const baseHead = text(request.baseHead).toLowerCase();
  const leaseId = text(request.leaseId).toLowerCase();
  if (!SHA40.test(baseHead)) errors.push('base-head-invalid');

  const allowedInput = plainArray(request.allowedFiles) ? request.allowedFiles : [];
  if (!plainArray(request.allowedFiles) || request.allowedFiles.length < 1 || request.allowedFiles.length > MAX_FILES) errors.push('allowed-files-invalid');
  const allowed = allowedInput.map(canonicalPath);
  if (allowed.some((item) => !item) || new Set(allowed).size !== allowed.length) errors.push('allowed-file-path-invalid');

  const requiredTestsRaw = plainArray(request.requiredTestIds) ? request.requiredTestIds : [];
  const requiredTestIds = requiredTestsRaw.map((item) => text(item).toLowerCase());
  if (!plainArray(request.requiredTestIds)
    || requiredTestIds.length < 1
    || requiredTestIds.length > MAX_FILES
    || requiredTestIds.some((id) => !EXECUTION_SAFE_ID.test(id))
    || new Set(requiredTestIds).size !== requiredTestIds.length) errors.push('required-test-ids-invalid');

  const snapshots = plainArray(request.sourceSnapshots) ? request.sourceSnapshots : [];
  if (!plainArray(request.sourceSnapshots) || snapshots.length !== allowed.length) errors.push('source-snapshots-invalid');
  const byPath = new Map();
  let totalBytes = 0;
  for (const snapshot of snapshots) {
    if (!exactKeys(snapshot, ['path','content','sha256'])) { errors.push('source-snapshot-shape-invalid'); continue; }
    const sourcePath = canonicalPath(snapshot.path);
    const content = typeof snapshot.content === 'string' ? snapshot.content : null;
    const digest = text(snapshot.sha256).toLowerCase();
    if (!sourcePath || !allowed.includes(sourcePath) || byPath.has(sourcePath)) errors.push('source-snapshot-path-invalid');
    if (content === null) errors.push('source-snapshot-content-invalid');
    else {
      const bytes = Buffer.byteLength(content, 'utf8');
      totalBytes += bytes;
      if (bytes > MAX_FILE_BYTES) errors.push('source-snapshot-file-too-large');
      if (!SHA256.test(digest) || sha256(content) !== digest) errors.push('source-snapshot-digest-invalid');
    }
    if (sourcePath) byPath.set(sourcePath, snapshot);
  }
  if (totalBytes > MAX_TOTAL_BYTES) errors.push('source-snapshot-total-too-large');
  for (const sourcePath of allowed.filter(Boolean)) if (!byPath.has(sourcePath)) errors.push('source-snapshot-missing');

  return frozen({
    valid: errors.length === 0,
    errors: frozen([...new Set(errors)]),
    allowedFiles: frozen(allowed.filter(Boolean)),
    requiredTestIds: frozen(requiredTestIds),
    branch,
    baseHead,
    leaseId,
  });
}

export function validateStephanosNativeModelResult(result = {}, request = {}) {
  const requestValidation = validateStephanosNativeStagingRequest(request);
  if (!requestValidation.valid) return frozen({ valid:false, errors:frozen(['request-invalid']), replacements:frozen([]) });
  if (!exactKeys(result, RESULT_KEYS)) return frozen({ valid:false, errors:frozen(['result-shape-invalid']), replacements:frozen([]) });
  const errors = [];
  if (result.schemaVersion !== STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA) errors.push('result-schema-invalid');
  if (text(result.missionId) !== text(request.missionId) || text(result.actionId).toLowerCase() !== text(request.actionId).toLowerCase()) errors.push('result-identity-mismatch');
  if (text(result.baseHead).toLowerCase() !== requestValidation.baseHead) errors.push('result-head-mismatch');
  if (!text(result.summary) || text(result.summary).length > 2000) errors.push('result-summary-invalid');
  const replacements = plainArray(result.replacements) ? result.replacements : [];
  if (!plainArray(result.replacements) || replacements.length < 1 || replacements.length > MAX_FILES) errors.push('replacements-invalid');
  const allowed = new Set(requestValidation.allowedFiles);
  const seen = new Set();
  let totalBytes = 0;
  const normalized = [];
  for (const replacement of replacements) {
    if (!exactKeys(replacement, ['path','beforeSha256','content'])) { errors.push('replacement-shape-invalid'); continue; }
    const sourcePath = canonicalPath(replacement.path);
    const before = text(replacement.beforeSha256).toLowerCase();
    const content = typeof replacement.content === 'string' ? replacement.content : null;
    const source = request.sourceSnapshots.find((item) => exactKeys(item, ['path','content','sha256']) && canonicalPath(item.path) === sourcePath);
    if (!sourcePath || !allowed.has(sourcePath) || seen.has(sourcePath)) errors.push('replacement-path-invalid');
    if (sourcePath) seen.add(sourcePath);
    if (!source || !SHA256.test(before) || before !== text(source?.sha256).toLowerCase()) errors.push('replacement-before-digest-mismatch');
    if (content === null) errors.push('replacement-content-invalid');
    else {
      const bytes = Buffer.byteLength(content, 'utf8');
      totalBytes += bytes;
      if (bytes > MAX_FILE_BYTES) errors.push('replacement-file-too-large');
      if (source && content === source.content) errors.push('replacement-noop');
      if (sourcePath) normalized.push(frozen({ path: sourcePath, beforeSha256: before, afterSha256: sha256(content), content }));
    }
  }
  if (totalBytes > MAX_TOTAL_BYTES) errors.push('replacement-total-too-large');
  return frozen({ valid: errors.length === 0, errors:frozen([...new Set(errors)]), replacements:frozen(normalized) });
}

export function buildStephanosNativeStagingPlan(request, result) {
  const validation = validateStephanosNativeModelResult(result, request);
  if (!validation.valid) return frozen({ ok: false, reason: validation.errors[0], validation });
  const requestValidation = validateStephanosNativeStagingRequest(request);
  const untouched = request.sourceSnapshots
    .filter((source) => !validation.replacements.some((replacement) => replacement.path === canonicalPath(source.path)))
    .map((source) => frozen({ path: canonicalPath(source.path), sha256: text(source.sha256).toLowerCase() }));
  return frozen({
    ok: true,
    schemaVersion: STEPHANOS_NATIVE_PROMOTION_JOURNAL_SCHEMA,
    missionId: text(request.missionId),
    actionId: text(request.actionId).toLowerCase(),
    workerId: text(request.workerId).toLowerCase(),
    repository: text(request.repository),
    branch: requestValidation.branch,
    baseHead: requestValidation.baseHead,
    leaseId: requestValidation.leaseId,
    changedFiles: frozen(validation.replacements.map((item) => item.path)),
    replacements: validation.replacements,
    untouched: frozen(untouched),
    requiredTestIds: requestValidation.requiredTestIds,
    arbitraryCommandAllowed: false,
    modelMayPromote: false,
    leaseSeizureAllowed: false,
    mergeAuthority: false,
  });
}

async function readPersistedNativeTestEvidence(plan, output, options = {}) {
  if (!exactKeys(output, TEST_OUTPUT_KEYS)) return frozen({ valid:false, reason:'test-output-shape-invalid' });
  const testId = text(output.testId).toLowerCase();
  const outputSha256 = text(output.outputSha256).toLowerCase();
  if (!plan.requiredTestIds.includes(testId) || !SHA256.test(outputSha256)) return frozen({ valid:false, reason:'test-output-binding-invalid' });
  if (!text(options.workspaceRoot)) return frozen({ valid:false, reason:'workspace-root-required' });

  const executionId = buildStephanosNativeTestExecutionId(plan.actionId, testId);
  const proofRef = buildStephanosNativeTestProofRef(outputSha256);
  const execution = await readCurrentExecutionReceipt(
    options.workspaceRoot,
    { executionId },
    { repoRoot:options.repoRoot, nowMs:options.nowMs },
  );
  if (!execution.ok || execution.receipt?.state !== 'completed') return frozen({ valid:false, reason:'persisted-execution-receipt-missing' });
  const receipt = execution.receipt;
  if (receipt.repository !== plan.repository
    || receipt.branch !== plan.branch
    || text(receipt.sourceHead).toLowerCase() !== plan.baseHead
    || text(receipt.workerId).toLowerCase() !== plan.workerId
    || text(receipt.leaseKey).toLowerCase() !== plan.leaseId
    || receipt.executionId !== executionId
    || receipt.phase !== `native-test:${testId}`
    || !plainArray(receipt.proofRefs)
    || !receipt.proofRefs.includes(proofRef)) return frozen({ valid:false, reason:'persisted-execution-receipt-binding-invalid' });

  let proofRecord;
  try {
    const proofPath = resolveSharedWorkspacePath({
      root: options.workspaceRoot,
      repoRoot: options.repoRoot,
      segments: ['proof', `native-test-${outputSha256}.json`],
    });
    if (!proofPath.ok) return frozen({ valid:false, reason:'persisted-test-proof-missing' });
    proofRecord = JSON.parse(await readFile(proofPath.path, 'utf8'));
  } catch {
    return frozen({ valid:false, reason:'persisted-test-proof-missing' });
  }
  const proofValidation = validateSharedWorkspaceRecord(proofRecord, { repoRoot:options.repoRoot, nowMs:options.nowMs });
  if (!proofValidation.valid) return frozen({ valid:false, reason:'persisted-test-proof-invalid' });
  const refs = plainArray(proofRecord.refs) ? proofRecord.refs : [];
  if (proofRecord.participantId !== plan.workerId
    || proofRecord.correlationId !== executionId
    || proofRecord.status !== 'passed'
    || !refs.includes(`action:${plan.actionId}`)
    || !refs.includes(`test:${testId}`)
    || !refs.includes(`output-sha256:${outputSha256}`)
    || !refs.includes(`source-head:${plan.baseHead}`)
    || !refs.includes(`lease:${plan.leaseId}`)
    || !plainArray(proofRecord.proofRefs)
    || !proofRecord.proofRefs.includes(proofRef)) return frozen({ valid:false, reason:'persisted-test-proof-binding-invalid' });
  return frozen({ valid:true, testId, outputSha256, executionId, proofRef });
}

export async function verifyStephanosNativeTestAndScopeProof(request, result, proof = {}, options = {}) {
  const plan = buildStephanosNativeStagingPlan(request, result);
  if (!plan.ok) return frozen({ valid:false, errors:frozen([`plan-invalid:${plan.reason}`]) });
  const errors = [];
  if (!exactKeys(proof, ['baseHead','leaseId','changedFiles','testOutputs','sourceAfter'])) return frozen({ valid:false, errors:frozen(['proof-shape-invalid']) });
  if (text(proof.baseHead).toLowerCase() !== plan.baseHead) errors.push('proof-head-mismatch');
  if (text(proof.leaseId).toLowerCase() !== plan.leaseId) errors.push('proof-lease-mismatch');
  const changedFiles = plainArray(proof.changedFiles) ? proof.changedFiles.map(canonicalPath) : [];
  if (!plainArray(proof.changedFiles) || changedFiles.some((item) => !item) || !unique(changedFiles)) errors.push('changed-files-invalid');
  const expectedChanged = plan.changedFiles;
  if (changedFiles.length !== expectedChanged.length || changedFiles.some((item,index) => item !== expectedChanged[index])) errors.push('changed-scope-mismatch');
  const testOutputs = plainArray(proof.testOutputs) ? proof.testOutputs : [];
  if (!plainArray(proof.testOutputs)
    || testOutputs.length !== plan.requiredTestIds.length
    || testOutputs.some((item) => !exactKeys(item, TEST_OUTPUT_KEYS))
    || new Set(testOutputs.map((item)=>text(item.testId).toLowerCase())).size !== testOutputs.length) errors.push('test-output-set-invalid');
  else {
    for (const testId of plan.requiredTestIds) {
      const output = testOutputs.find((item) => text(item.testId).toLowerCase() === testId);
      if (!output) { errors.push(`required-test-missing:${testId}`); continue; }
      const persisted = await readPersistedNativeTestEvidence(plan, output, options);
      if (!persisted.valid) errors.push(`required-test-invalid:${testId}:${persisted.reason}`);
    }
  }
  const after = plainArray(proof.sourceAfter) ? proof.sourceAfter : [];
  if (!plainArray(proof.sourceAfter) || after.length !== request.sourceSnapshots.length || after.some((item) => !exactKeys(item,['path','sha256']))) errors.push('source-after-invalid');
  else {
    const byPath = new Map(after.map((item) => [canonicalPath(item.path), text(item.sha256).toLowerCase()]));
    for (const source of request.sourceSnapshots) {
      const sourcePath = canonicalPath(source.path);
      const replacement = plan.replacements.find((item) => item.path === sourcePath);
      const expectedDigest = replacement?.afterSha256 || text(source.sha256).toLowerCase();
      if (byPath.get(sourcePath) !== expectedDigest) errors.push(`source-after-mismatch:${sourcePath}`);
    }
  }
  return frozen({ valid:errors.length === 0, errors:frozen([...new Set(errors)]), plan });
}

export async function createStephanosNativeStagingReceipt(request, result, proof, options = {}) {
  const verification = await verifyStephanosNativeTestAndScopeProof(request, result, proof, options);
  if (!verification.valid) return null;
  const observedAtUtc = text(options.observedAtUtc);
  if (!observedAtUtc || !Number.isFinite(Date.parse(observedAtUtc))) return null;
  const plan = verification.plan;
  return frozen({
    schemaVersion: STEPHANOS_NATIVE_STAGING_RECEIPT_SCHEMA,
    missionId: plan.missionId,
    actionId: plan.actionId,
    workerId: plan.workerId,
    repository: plan.repository,
    branch: plan.branch,
    baseHead: plan.baseHead,
    leaseId: plan.leaseId,
    changedFiles: plan.changedFiles,
    stagedTreeSha256: sha256(plan.replacements.map((item)=>`${item.path}\0${item.afterSha256}`).join('\n')),
    diffSha256: sha256(plan.replacements.map((item)=>`${item.path}\n${item.beforeSha256}\n${item.afterSha256}`).join('\n---\n')),
    observedAtUtc,
    sourceChanged: true,
    testsPassed: true,
    promotionEligible: true,
    modelMayPromote: false,
    leaseSeizureAllowed: false,
    mergeAuthority: false,
  });
}
