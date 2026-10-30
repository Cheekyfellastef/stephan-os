import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, posix as path } from 'node:path';
import { types as utilTypes } from 'node:util';
import { readCurrentExecutionReceipt } from './executionReceiptV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  createSharedWorkspaceProofRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
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
const WINDOWS_RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_FILES = 12;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const REQUEST_KEYS = Object.freeze([
  'schemaVersion','missionId','actionId','workerId','repository','branch','baseHead','leaseId',
  'allowedFiles','requiredTestIds','sourceSnapshots',
]);
const RESULT_KEYS = Object.freeze(['schemaVersion','missionId','actionId','baseHead','replacements','summary']);
const TEST_OUTPUT_KEYS = Object.freeze(['testId','outputSha256']);
const PROOF_RECORD_KEYS = Object.freeze([
  'schemaVersion','kind','proofId','participantId','timestampUtc','correlationId',
  'relatedIssue','relatedPr','proofRefs','status','summary','refs',
]);
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
function stagedTreeSha256(sourceAfter) {
  return sha256(sourceAfter.map((item)=>`${item.path}\0${item.sha256}`).join('\n'));
}
function stagedDiffSha256(replacements) {
  return sha256(replacements.map((item)=>`${item.path}\n${item.beforeSha256}\n${item.afterSha256}`).join('\n---\n'));
}
function stagedTreeProofRef(digest) { return `proof/native-staged-tree-${digest}.sha256`; }
function stagedDiffProofRef(digest) { return `proof/native-staged-diff-${digest}.sha256`; }
function missionProofRef(missionId) { return `proof/native-mission-${sha256(missionId)}.sha256`; }
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
  if (typeof value !== 'string' || value !== value.trim()) return '';
  const raw = value.replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z]:\//i.test(raw) || raw.includes('\0')) return '';
  const normalized = path.normalize(raw).replace(/^\.\//, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => {
    if (!segment || segment !== segment.trim() || /[. ]$/.test(segment) || segment.includes(':') || WINDOWS_RESERVED_SEGMENT.test(segment)) return true;
    const lowered = segment.toLowerCase();
    return PROTECTED_PATH_SEGMENTS.has(lowered) || lowered.startsWith('.env');
  })) return '';
  if (segments[0]?.toLowerCase() === 'runtime') return '';
  return normalized;
}
function expectedSourceAfter(request, replacements) {
  return request.sourceSnapshots.map((source) => {
    const sourcePath = canonicalPath(source.path);
    const replacement = replacements.find((item) => item.path === sourcePath);
    return frozen({ path: sourcePath, sha256: replacement?.afterSha256 || text(source.sha256).toLowerCase() });
  });
}
function buildNativeStageId(plan) {
  return `native-stage-${sha256(`${plan.missionId}\n${plan.actionId}\n${plan.baseHead}\n${plan.stagedTreeSha256}\n${plan.diffSha256}`).slice(0,32)}`;
}
function stageFileName(sourcePath) { return `${sha256(sourcePath)}.stage`; }
function stageFileRef(stageId, sourcePath) { return `evidence/receipts/${stageId}/files/${stageFileName(sourcePath)}`; }
function stageProofRef(stageId) { return `proof/${stageId}.json`; }

async function readJsonProof(root, segments, options = {}) {
  try {
    const resolved = resolveSharedWorkspacePath({ root, repoRoot:options.repoRoot, segments });
    if (!resolved.ok) return { ok:false, reason:resolved.reason, record:null };
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    return { ok:true, reason:'PROOF_READ', record, path:resolved.path };
  } catch {
    return { ok:false, reason:'PROOF_MISSING', record:null };
  }
}

async function persistImmutableText(root, segments, content, expectedDigest, options = {}) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot:options.repoRoot, segments });
  if (!resolved.ok) return { ok:false, reason:resolved.reason, path:'' };
  try {
    const existing = await readFile(resolved.path, 'utf8');
    return sha256(existing) === expectedDigest
      ? { ok:true, reason:'IMMUTABLE_STAGE_ALREADY_PRESENT', path:resolved.path }
      : { ok:false, reason:'IMMUTABLE_STAGE_CONFLICT', path:resolved.path };
  } catch {}
  await mkdir(dirname(resolved.path), { recursive:true });
  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, { flag:'wx', mode:0o600 });
    if (sha256(await readFile(tempPath, 'utf8')) !== expectedDigest) {
      await unlink(tempPath).catch(()=>{});
      return { ok:false, reason:'IMMUTABLE_STAGE_DIGEST_MISMATCH', path:resolved.path };
    }
    await rename(tempPath, resolved.path);
    return { ok:true, reason:'IMMUTABLE_STAGE_WRITTEN', path:resolved.path };
  } catch (error) {
    await unlink(tempPath).catch(()=>{});
    try {
      const existing = await readFile(resolved.path, 'utf8');
      if (sha256(existing) === expectedDigest) return { ok:true, reason:'IMMUTABLE_STAGE_ALREADY_PRESENT', path:resolved.path };
    } catch {}
    throw error;
  }
}

export function buildStephanosNativeTestExecutionId(missionId, actionId, testId) {
  const mission = text(missionId);
  const action = text(actionId).toLowerCase();
  const test = text(testId).toLowerCase();
  if (!SAFE_MISSION_ID.test(mission) || !EXECUTION_SAFE_ID.test(action) || !EXECUTION_SAFE_ID.test(test)) return '';
  return `native-test-${sha256(`${mission}\n${action}\n${test}`).slice(0,24)}`;
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
  if (!validation.valid) return frozen({ ok:false, reason:validation.errors[0], validation });
  const requestValidation = validateStephanosNativeStagingRequest(request);
  const untouched = request.sourceSnapshots
    .filter((source) => !validation.replacements.some((replacement) => replacement.path === canonicalPath(source.path)))
    .map((source) => frozen({ path:canonicalPath(source.path), sha256:text(source.sha256).toLowerCase() }));
  const sourceAfter = expectedSourceAfter(request, validation.replacements);
  const stagedTreeDigest = stagedTreeSha256(sourceAfter);
  const diffDigest = stagedDiffSha256(validation.replacements);
  return frozen({
    ok:true,
    schemaVersion:STEPHANOS_NATIVE_PROMOTION_JOURNAL_SCHEMA,
    missionId:text(request.missionId),
    actionId:text(request.actionId).toLowerCase(),
    workerId:text(request.workerId).toLowerCase(),
    repository:text(request.repository),
    branch:requestValidation.branch,
    baseHead:requestValidation.baseHead,
    leaseId:requestValidation.leaseId,
    changedFiles:frozen(validation.replacements.map((item)=>item.path)),
    replacements:validation.replacements,
    untouched:frozen(untouched),
    sourceAfter:frozen(sourceAfter),
    requiredTestIds:requestValidation.requiredTestIds,
    stagedTreeSha256:stagedTreeDigest,
    diffSha256:diffDigest,
    arbitraryCommandAllowed:false,
    modelMayPromote:false,
    leaseSeizureAllowed:false,
    mergeAuthority:false,
  });
}

export async function stageStephanosNativeModelResult(request, result, options = {}) {
  const plan = buildStephanosNativeStagingPlan(request, result);
  if (!plan.ok) return frozen({ ok:false, reason:`plan-invalid:${plan.reason}`, plan:null, stageId:'', proofRef:'', sourceAfter:frozen([]) });
  if (!text(options.workspaceRoot)) return frozen({ ok:false, reason:'workspace-root-required', plan, stageId:'', proofRef:'', sourceAfter:frozen([]) });
  const observedAtUtc = text(options.observedAtUtc);
  if (!observedAtUtc || !Number.isFinite(Date.parse(observedAtUtc))) return frozen({ ok:false, reason:'observed-at-required', plan, stageId:'', proofRef:'', sourceAfter:frozen([]) });
  if (!text(options.relatedIssue) && !text(options.relatedPr)) return frozen({ ok:false, reason:'related-identity-required', plan, stageId:'', proofRef:'', sourceAfter:frozen([]) });

  const stageId = buildNativeStageId(plan);
  const persisted = [];
  for (const source of request.sourceSnapshots) {
    const sourcePath = canonicalPath(source.path);
    const replacement = plan.replacements.find((item)=>item.path === sourcePath);
    const content = replacement?.content ?? source.content;
    const expectedDigest = replacement?.afterSha256 || text(source.sha256).toLowerCase();
    const fileName = stageFileName(sourcePath);
    const write = await persistImmutableText(
      options.workspaceRoot,
      ['evidence','receipts',stageId,'files',fileName],
      content,
      expectedDigest,
      options,
    );
    if (!write.ok) return frozen({ ok:false, reason:`staging-file:${sourcePath}:${write.reason}`, plan, stageId, proofRef:'', sourceAfter:frozen([]) });
    const confirmed = sha256(await readFile(write.path, 'utf8'));
    if (confirmed !== expectedDigest) return frozen({ ok:false, reason:`staging-file:${sourcePath}:digest-drift`, plan, stageId, proofRef:'', sourceAfter:frozen([]) });
    persisted.push(frozen({ path:sourcePath, sha256:confirmed, proofRef:stageFileRef(stageId, sourcePath) }));
  }

  const refs = [
    `mission:${plan.missionId}`,
    `action:${plan.actionId}`,
    `source-head:${plan.baseHead}`,
    `lease:${plan.leaseId}`,
    `staged-tree-sha256:${plan.stagedTreeSha256}`,
    `diff-sha256:${plan.diffSha256}`,
    ...persisted.map((item)=>`source-after-sha256:${item.path}:${item.sha256}`),
  ];
  const proofRecord = createSharedWorkspaceProofRecord({
    proofId:stageId,
    participantId:plan.workerId,
    timestampUtc:observedAtUtc,
    correlationId:stageId,
    relatedIssue:text(options.relatedIssue),
    relatedPr:text(options.relatedPr),
    status:'staged',
    summary:`Persisted Stephanos-native staged source for ${plan.actionId}.`,
    refs,
    proofRefs:persisted.map((item)=>item.proofRef),
  });
  const proofSegments = ['proof', `${stageId}.json`];
  const existing = await readJsonProof(options.workspaceRoot, proofSegments, options);
  if (existing.ok) {
    if (JSON.stringify(existing.record) !== JSON.stringify(proofRecord)) {
      return frozen({ ok:false, reason:'staging-proof-conflict', plan, stageId, proofRef:stageProofRef(stageId), sourceAfter:frozen([]) });
    }
  } else {
    const written = await writeAtomicJson(options.workspaceRoot, proofSegments, proofRecord, { repoRoot:options.repoRoot, nowMs:options.nowMs });
    if (!written.ok) return frozen({ ok:false, reason:`staging-proof:${written.reason}`, plan, stageId, proofRef:stageProofRef(stageId), sourceAfter:frozen([]) });
  }
  return frozen({
    ok:true,
    reason:'STEPHANOS_NATIVE_STAGE_PERSISTED',
    plan,
    stageId,
    proofRef:stageProofRef(stageId),
    sourceAfter:frozen(persisted.map((item)=>frozen({ path:item.path, sha256:item.sha256 }))),
  });
}

async function readPersistedNativeStagingEvidence(plan, request, options = {}) {
  if (!text(options.workspaceRoot)) return frozen({ valid:false, reason:'workspace-root-required', sourceAfter:frozen([]) });
  const stageId = buildNativeStageId(plan);
  const loaded = await readJsonProof(options.workspaceRoot, ['proof', `${stageId}.json`], options);
  if (!loaded.ok) return frozen({ valid:false, reason:'persisted-staging-evidence-missing', sourceAfter:frozen([]) });
  const proofRecord = loaded.record;
  if (!exactKeys(proofRecord, PROOF_RECORD_KEYS)) return frozen({ valid:false, reason:'persisted-staging-proof-shape-invalid', sourceAfter:frozen([]) });
  const proofValidation = validateSharedWorkspaceRecord(proofRecord, { repoRoot:options.repoRoot, nowMs:options.nowMs });
  if (!proofValidation.valid || proofRecord.kind !== SHARED_WORKSPACE_RECORD_KINDS.PROOF) {
    return frozen({ valid:false, reason:'persisted-staging-proof-invalid', sourceAfter:frozen([]) });
  }
  const refs = plainArray(proofRecord.refs) ? proofRecord.refs : [];
  if (proofRecord.proofId !== stageId
    || proofRecord.participantId !== plan.workerId
    || proofRecord.correlationId !== stageId
    || proofRecord.status !== 'staged'
    || !refs.includes(`mission:${plan.missionId}`)
    || !refs.includes(`action:${plan.actionId}`)
    || !refs.includes(`source-head:${plan.baseHead}`)
    || !refs.includes(`lease:${plan.leaseId}`)
    || !refs.includes(`staged-tree-sha256:${plan.stagedTreeSha256}`)
    || !refs.includes(`diff-sha256:${plan.diffSha256}`)
    || !plainArray(proofRecord.proofRefs)) return frozen({ valid:false, reason:'persisted-staging-proof-binding-invalid', sourceAfter:frozen([]) });

  const sourceAfter = [];
  for (const expected of plan.sourceAfter) {
    const proofRef = stageFileRef(stageId, expected.path);
    if (!proofRecord.proofRefs.includes(proofRef)
      || !refs.includes(`source-after-sha256:${expected.path}:${expected.sha256}`)) {
      return frozen({ valid:false, reason:`persisted-staging-source-binding-invalid:${expected.path}`, sourceAfter:frozen([]) });
    }
    const resolved = resolveSharedWorkspacePath({
      root:options.workspaceRoot,
      repoRoot:options.repoRoot,
      segments:['evidence','receipts',stageId,'files',stageFileName(expected.path)],
    });
    if (!resolved.ok) return frozen({ valid:false, reason:`persisted-staging-source-path-invalid:${expected.path}`, sourceAfter:frozen([]) });
    let digest = '';
    try { digest = sha256(await readFile(resolved.path, 'utf8')); } catch {
      return frozen({ valid:false, reason:`persisted-staging-source-missing:${expected.path}`, sourceAfter:frozen([]) });
    }
    if (digest !== expected.sha256) return frozen({ valid:false, reason:`persisted-staging-source-drift:${expected.path}`, sourceAfter:frozen([]) });
    sourceAfter.push(frozen({ path:expected.path, sha256:digest }));
  }
  if (stagedTreeSha256(sourceAfter) !== plan.stagedTreeSha256) return frozen({ valid:false, reason:'persisted-staging-tree-mismatch', sourceAfter:frozen([]) });
  return frozen({ valid:true, reason:'PERSISTED_STAGING_EVIDENCE_VALID', stageId, sourceAfter:frozen(sourceAfter), proofRecord });
}

async function readPersistedNativeTestEvidence(plan, output, options = {}) {
  if (!exactKeys(output, TEST_OUTPUT_KEYS)) return frozen({ valid:false, reason:'test-output-shape-invalid' });
  const testId = text(output.testId).toLowerCase();
  const outputSha256 = text(output.outputSha256).toLowerCase();
  if (!plan.requiredTestIds.includes(testId) || !SHA256.test(outputSha256)) return frozen({ valid:false, reason:'test-output-binding-invalid' });
  if (!text(options.workspaceRoot)) return frozen({ valid:false, reason:'workspace-root-required' });

  const executionId = buildStephanosNativeTestExecutionId(plan.missionId, plan.actionId, testId);
  const proofRef = buildStephanosNativeTestProofRef(outputSha256);
  const treeProofRef = stagedTreeProofRef(plan.stagedTreeSha256);
  const diffProofRef = stagedDiffProofRef(plan.diffSha256);
  const missionRef = missionProofRef(plan.missionId);
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
    || !receipt.proofRefs.includes(proofRef)
    || !receipt.proofRefs.includes(missionRef)
    || !receipt.proofRefs.includes(treeProofRef)
    || !receipt.proofRefs.includes(diffProofRef)) return frozen({ valid:false, reason:'persisted-execution-receipt-binding-invalid' });

  const loaded = await readJsonProof(options.workspaceRoot, ['proof', `native-test-${outputSha256}.json`], options);
  if (!loaded.ok) return frozen({ valid:false, reason:'persisted-test-proof-missing' });
  const proofRecord = loaded.record;
  if (!exactKeys(proofRecord, PROOF_RECORD_KEYS)) return frozen({ valid:false, reason:'persisted-test-proof-shape-invalid' });
  const proofValidation = validateSharedWorkspaceRecord(proofRecord, { repoRoot:options.repoRoot, nowMs:options.nowMs });
  if (!proofValidation.valid || proofRecord.kind !== SHARED_WORKSPACE_RECORD_KINDS.PROOF) return frozen({ valid:false, reason:'persisted-test-proof-invalid' });
  const refs = plainArray(proofRecord.refs) ? proofRecord.refs : [];
  if (proofRecord.participantId !== plan.workerId
    || proofRecord.correlationId !== executionId
    || proofRecord.status !== 'passed'
    || !refs.includes(`mission:${plan.missionId}`)
    || !refs.includes(`action:${plan.actionId}`)
    || !refs.includes(`test:${testId}`)
    || !refs.includes(`output-sha256:${outputSha256}`)
    || !refs.includes(`source-head:${plan.baseHead}`)
    || !refs.includes(`lease:${plan.leaseId}`)
    || !refs.includes(`staged-tree-sha256:${plan.stagedTreeSha256}`)
    || !refs.includes(`diff-sha256:${plan.diffSha256}`)
    || !plainArray(proofRecord.proofRefs)
    || !proofRecord.proofRefs.includes(proofRef)
    || !proofRecord.proofRefs.includes(missionRef)
    || !proofRecord.proofRefs.includes(treeProofRef)
    || !proofRecord.proofRefs.includes(diffProofRef)) return frozen({ valid:false, reason:'persisted-test-proof-binding-invalid' });
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
  if (!plainArray(proof.changedFiles) || changedFiles.some((item)=>!item) || !unique(changedFiles)) errors.push('changed-files-invalid');
  const expectedChanged = plan.changedFiles;
  if (changedFiles.length !== expectedChanged.length || changedFiles.some((item,index)=>item !== expectedChanged[index])) errors.push('changed-scope-mismatch');

  const staged = await readPersistedNativeStagingEvidence(plan, request, options);
  if (!staged.valid) errors.push(staged.reason);

  const testOutputs = plainArray(proof.testOutputs) ? proof.testOutputs : [];
  if (!plainArray(proof.testOutputs)
    || testOutputs.length !== plan.requiredTestIds.length
    || testOutputs.some((item)=>!exactKeys(item, TEST_OUTPUT_KEYS))
    || new Set(testOutputs.map((item)=>text(item.testId).toLowerCase())).size !== testOutputs.length) errors.push('test-output-set-invalid');
  else {
    for (const testId of plan.requiredTestIds) {
      const output = testOutputs.find((item)=>text(item.testId).toLowerCase() === testId);
      if (!output) { errors.push(`required-test-missing:${testId}`); continue; }
      const persisted = await readPersistedNativeTestEvidence(plan, output, options);
      if (!persisted.valid) errors.push(`required-test-invalid:${testId}:${persisted.reason}`);
    }
  }

  const after = plainArray(proof.sourceAfter) ? proof.sourceAfter : [];
  if (!plainArray(proof.sourceAfter) || after.length !== plan.sourceAfter.length || after.some((item)=>!exactKeys(item,['path','sha256']))) errors.push('source-after-invalid');
  else if (staged.valid) {
    const byPath = new Map(after.map((item)=>[canonicalPath(item.path), text(item.sha256).toLowerCase()]));
    for (const persisted of staged.sourceAfter) {
      if (byPath.get(persisted.path) !== persisted.sha256) errors.push(`source-after-mismatch:${persisted.path}`);
    }
  }
  return frozen({ valid:errors.length === 0, errors:frozen([...new Set(errors)]), plan, staged });
}

export async function createStephanosNativeStagingReceipt(request, result, proof, options = {}) {
  const verification = await verifyStephanosNativeTestAndScopeProof(request, result, proof, options);
  if (!verification.valid) return null;
  const observedAtUtc = text(options.observedAtUtc);
  if (!observedAtUtc || !Number.isFinite(Date.parse(observedAtUtc))) return null;
  const plan = verification.plan;
  return frozen({
    schemaVersion:STEPHANOS_NATIVE_STAGING_RECEIPT_SCHEMA,
    missionId:plan.missionId,
    actionId:plan.actionId,
    workerId:plan.workerId,
    repository:plan.repository,
    branch:plan.branch,
    baseHead:plan.baseHead,
    leaseId:plan.leaseId,
    changedFiles:plan.changedFiles,
    stagedTreeSha256:plan.stagedTreeSha256,
    diffSha256:plan.diffSha256,
    observedAtUtc,
    sourceChanged:true,
    testsPassed:true,
    promotionEligible:true,
    modelMayPromote:false,
    leaseSeizureAllowed:false,
    mergeAuthority:false,
  });
}
