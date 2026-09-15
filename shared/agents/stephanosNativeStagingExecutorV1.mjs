import { createHash } from 'node:crypto';
import { posix as path } from 'node:path';

export const STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA = 'stephanos.native-staging-request.v1';
export const STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA = 'stephanos.native-model-result.v1';
export const STEPHANOS_NATIVE_STAGING_RECEIPT_SCHEMA = 'stephanos.native-staging-receipt.v1';
export const STEPHANOS_NATIVE_PROMOTION_JOURNAL_SCHEMA = 'stephanos.native-promotion-journal.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const MAX_FILES = 12;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const REQUEST_KEYS = Object.freeze([
  'schemaVersion','missionId','actionId','workerId','repository','branch','baseHead','leaseId',
  'allowedFiles','requiredTestIds','sourceSnapshots',
]);
const RESULT_KEYS = Object.freeze(['schemaVersion','missionId','actionId','baseHead','replacements','summary']);
const PROTECTED_PATH_SEGMENTS = new Set(['.git','node_modules','dist','build','coverage','.next','out']);

function text(v) { return typeof v === 'string' ? v.trim() : ''; }
function exactKeys(v, keys) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(v);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== 'string')) return false;
  if (JSON.stringify([...ownKeys].sort()) !== JSON.stringify([...keys].sort())) return false;
  return ownKeys.every((key) => {
    const descriptor = descriptors[key];
    return Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable === true;
  });
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function canonicalBranch(value) {
  const raw = text(value);
  if (!raw) return '';
  const normalized = raw.startsWith('refs/heads/') ? raw.slice('refs/heads/'.length) : raw;
  if (!SAFE_BRANCH.test(normalized)
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
function plainArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key !== 'string')) return false;
  if (ownKeys.length !== value.length + 1 || !Object.prototype.hasOwnProperty.call(descriptors, 'length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || descriptor.enumerable !== true) return false;
  }
  return true;
}
function unique(values) { return plainArray(values) && values.length === new Set(values).size; }
function frozen(value) { return Object.freeze(value); }

export function validateStephanosNativeStagingRequest(request = {}) {
  const errors = [];
  if (!exactKeys(request, REQUEST_KEYS)) {
    return frozen({ valid:false, errors:frozen(['request-shape-invalid']), allowedFiles:frozen([]) });
  }
  if (request.schemaVersion !== STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA) errors.push('request-schema-invalid');
  for (const key of ['missionId','actionId','workerId','leaseId']) if (!SAFE_ID.test(text(request[key]))) errors.push(`${key}-invalid`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text(request.repository))) errors.push('repository-invalid');
  const branch = canonicalBranch(request.branch);
  if (!branch) errors.push('branch-invalid');
  if (!SHA40.test(text(request.baseHead).toLowerCase())) errors.push('base-head-invalid');
  const allowedInput = plainArray(request.allowedFiles) ? request.allowedFiles : [];
  if (!plainArray(request.allowedFiles) || request.allowedFiles.length < 1 || request.allowedFiles.length > MAX_FILES || !unique(request.allowedFiles)) errors.push('allowed-files-invalid');
  const allowed = allowedInput.map(canonicalPath);
  if (allowed.some((p) => !p)) errors.push('allowed-file-path-invalid');
  const requiredTests = plainArray(request.requiredTestIds) ? request.requiredTestIds : [];
  if (!plainArray(request.requiredTestIds) || !requiredTests.length || !unique(requiredTests) || requiredTests.some((id) => !SAFE_ID.test(text(id)))) errors.push('required-test-ids-invalid');
  const snapshots = plainArray(request.sourceSnapshots) ? request.sourceSnapshots : [];
  if (!plainArray(request.sourceSnapshots) || snapshots.length !== allowed.length) errors.push('source-snapshots-invalid');
  const byPath = new Map();
  let totalBytes = 0;
  for (const snapshot of snapshots) {
    if (!exactKeys(snapshot, ['path','content','sha256'])) { errors.push('source-snapshot-shape-invalid'); continue; }
    const p = canonicalPath(snapshot.path);
    const content = typeof snapshot.content === 'string' ? snapshot.content : null;
    const digest = text(snapshot.sha256).toLowerCase();
    if (!p || !allowed.includes(p) || byPath.has(p)) errors.push('source-snapshot-path-invalid');
    if (content === null) errors.push('source-snapshot-content-invalid');
    else {
      const bytes = Buffer.byteLength(content, 'utf8');
      totalBytes += bytes;
      if (bytes > MAX_FILE_BYTES) errors.push('source-snapshot-file-too-large');
      if (!SHA256.test(digest) || sha256(content) !== digest) errors.push('source-snapshot-digest-invalid');
    }
    if (p) byPath.set(p, snapshot);
  }
  if (totalBytes > MAX_TOTAL_BYTES) errors.push('source-snapshot-total-too-large');
  for (const p of allowed.filter(Boolean)) if (!byPath.has(p)) errors.push('source-snapshot-missing');
  return frozen({ valid: errors.length === 0, errors: frozen([...new Set(errors)]), allowedFiles: frozen(allowed.filter(Boolean)), branch });
}

export function validateStephanosNativeModelResult(result = {}, request = {}) {
  const requestValidation = validateStephanosNativeStagingRequest(request);
  if (!requestValidation.valid) return frozen({ valid:false, errors:frozen(['request-invalid']), replacements:frozen([]) });
  if (!exactKeys(result, RESULT_KEYS)) return frozen({ valid:false, errors:frozen(['result-shape-invalid']), replacements:frozen([]) });
  const errors = [];
  if (result.schemaVersion !== STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA) errors.push('result-schema-invalid');
  if (text(result.missionId) !== text(request.missionId) || text(result.actionId) !== text(request.actionId)) errors.push('result-identity-mismatch');
  if (text(result.baseHead).toLowerCase() !== text(request.baseHead).toLowerCase()) errors.push('result-head-mismatch');
  if (!text(result.summary) || text(result.summary).length > 2000) errors.push('result-summary-invalid');
  const replacements = plainArray(result.replacements) ? result.replacements : [];
  if (!plainArray(result.replacements) || replacements.length < 1 || replacements.length > MAX_FILES) errors.push('replacements-invalid');
  const allowed = new Set(requestValidation.allowedFiles || []);
  const seen = new Set();
  let totalBytes = 0;
  const normalized = [];
  for (const replacement of replacements) {
    if (!exactKeys(replacement, ['path','beforeSha256','content'])) { errors.push('replacement-shape-invalid'); continue; }
    const p = canonicalPath(replacement.path);
    const before = text(replacement.beforeSha256).toLowerCase();
    const content = typeof replacement.content === 'string' ? replacement.content : null;
    const source = request.sourceSnapshots.find((item) => exactKeys(item, ['path','content','sha256']) && canonicalPath(item.path) === p);
    if (!p || !allowed.has(p) || seen.has(p)) errors.push('replacement-path-invalid');
    if (p) seen.add(p);
    if (!source || !SHA256.test(before) || before !== text(source?.sha256).toLowerCase()) errors.push('replacement-before-digest-mismatch');
    if (content === null) errors.push('replacement-content-invalid');
    else {
      const bytes = Buffer.byteLength(content, 'utf8');
      totalBytes += bytes;
      if (bytes > MAX_FILE_BYTES) errors.push('replacement-file-too-large');
      if (source && content === source.content) errors.push('replacement-noop');
      if (p) normalized.push(frozen({ path: p, beforeSha256: before, afterSha256: sha256(content), content }));
    }
  }
  if (totalBytes > MAX_TOTAL_BYTES) errors.push('replacement-total-too-large');
  return frozen({ valid: errors.length === 0, errors: frozen([...new Set(errors)]), replacements: frozen(normalized) });
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
    missionId: request.missionId,
    actionId: request.actionId,
    workerId: request.workerId,
    repository: request.repository,
    branch: requestValidation.branch,
    baseHead: request.baseHead.toLowerCase(),
    leaseId: request.leaseId,
    changedFiles: frozen(validation.replacements.map((r) => r.path)),
    replacements: validation.replacements,
    untouched: frozen(untouched),
    requiredTestIds: frozen([...request.requiredTestIds]),
    arbitraryCommandAllowed: false,
    modelMayPromote: false,
    leaseSeizureAllowed: false,
    mergeAuthority: false,
  });
}

export function verifyStephanosNativeTestAndScopeProof(plan, proof = {}) {
  if (!plan?.ok) return frozen({ valid: false, errors: frozen(['plan-invalid']) });
  if (!exactKeys(proof, ['baseHead','leaseId','changedFiles','testReceipts','sourceAfter'])) return frozen({ valid:false, errors:frozen(['proof-shape-invalid']) });
  const errors = [];
  if (text(proof.baseHead).toLowerCase() !== plan.baseHead) errors.push('proof-head-mismatch');
  if (text(proof.leaseId) !== plan.leaseId) errors.push('proof-lease-mismatch');
  const changed = plainArray(proof.changedFiles) ? proof.changedFiles.map(canonicalPath) : [];
  if (!plainArray(proof.changedFiles) || !unique(changed) || JSON.stringify([...changed].sort()) !== JSON.stringify([...plan.changedFiles].sort())) errors.push('changed-scope-mismatch');
  const receipts = plainArray(proof.testReceipts) ? proof.testReceipts : [];
  for (const testId of plan.requiredTestIds) {
    if (!receipts.some((receipt) => exactKeys(receipt, ['testId','passed','outputSha256']) && receipt.testId === testId && receipt.passed === true && SHA256.test(text(receipt.outputSha256)))) errors.push(`required-test-missing:${testId}`);
  }
  const after = plainArray(proof.sourceAfter) ? proof.sourceAfter : [];
  for (const replacement of plan.replacements) {
    const record = after.find((item) => exactKeys(item, ['path','sha256']) && canonicalPath(item.path) === replacement.path);
    if (!record || text(record.sha256).toLowerCase() !== replacement.afterSha256) errors.push(`after-digest-mismatch:${replacement.path}`);
  }
  for (const untouched of plan.untouched) {
    const record = after.find((item) => exactKeys(item, ['path','sha256']) && canonicalPath(item.path) === untouched.path);
    if (!record || text(record.sha256).toLowerCase() !== untouched.sha256) errors.push(`untouched-drift:${untouched.path}`);
  }
  return frozen({ valid: errors.length === 0, errors: frozen([...new Set(errors)]) });
}

export function createStephanosNativeStagingReceipt(plan, proof = {}, options = {}) {
  const validation = verifyStephanosNativeTestAndScopeProof(plan, proof);
  if (!validation.valid) return null;
  const observedAtUtc = text(options.observedAtUtc);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(observedAtUtc) || !Number.isFinite(Date.parse(observedAtUtc))) return null;
  const treeMaterial = plan.replacements.map((item) => `${item.path}\0${item.afterSha256}`).sort().join('\n');
  const diffMaterial = plan.replacements.map((item) => `${item.path}\0${item.beforeSha256}\0${item.afterSha256}`).sort().join('\n');
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
    testIds: plan.requiredTestIds,
    stagedTreeSha256: sha256(treeMaterial),
    diffSha256: sha256(diffMaterial),
    observedAtUtc,
    sourceChanged: true,
    testsPassed: true,
    promotionEligible: true,
    arbitraryCommandAllowed: false,
    modelMayPromote: false,
    mergeAuthority: false,
  });
}
