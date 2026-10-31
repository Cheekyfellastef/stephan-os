// Offline preparation for the original fixed-runtime installer. Git object
// integrity is not authenticated remote-main, operator or installation authority.
// This manual CLI is deliberately outside the runtime source closure.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_RUNTIME_SOURCE_PATHS_V1, buildFixedRuntimeInstallerCandidateV1 }
  from './sovereign-fixed-runtime-installer-candidate-v1.mjs';

export const FIXED_RUNTIME_SOURCE_INPUT_SCHEMA_V1 = 'stephanos.fixed-runtime-source-package-input.v1';
export const FIXED_RUNTIME_SOURCE_PACKAGE_SCHEMA_V1 = 'stephanos.fixed-runtime-source-package.v1';
export const FIXED_RUNTIME_BIND_INPUT_SCHEMA_V1 = 'stephanos.fixed-runtime-package-bind-input.v1';
export const FIXED_RUNTIME_PRIVATE_PACKAGE_SCHEMA_V1 = 'stephanos.fixed-runtime-private-review-package.v1';
export const FIXED_RUNTIME_PACKAGE_LIMITS_V1 = Object.freeze({
  serializedBytes: 16 * 1024 * 1024, sourceBytes: 8 * 1024 * 1024,
  sourceFileBytes: 2 * 1024 * 1024, commitBytes: 65536,
  treeBytes: 2 * 1024 * 1024, treeObjects: 128, treeEntries: 32768,
});
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const CLOSURE = 'shared/agents/sovereignFixedRuntimeSourceClosureV1.json';
const BUILDER = 'scripts/sovereign-fixed-runtime-installer-candidate-v1.mjs';
const SHA = /^[a-f0-9]{40}$/;
const SID = /^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/;
const PREFIX = 'FIXED_INSTALL_PACKAGE_';
const CODES = new Set([
  'INPUT_BOUND', 'INPUT_INVALID', 'SCHEMA_INVALID', 'REPOSITORY_INVALID',
  'OBJECT_INVALID', 'OBJECT_HASH_MISMATCH', 'COMMIT_TREE_UNPROVEN',
  'TREE_BOUND', 'TREE_INVALID', 'TREE_PATH_INVALID', 'TREE_ALIAS', 'TREE_ORDER', 'TREE_UNUSED',
  'MEMBERSHIP_UNPROVEN', 'SOURCE_RECORD_INVALID', 'SOURCE_BYTES_BOUND',
  'SOURCE_CLOSURE_MISMATCH', 'SOURCE_UTF8_INVALID', 'PACKAGE_TAMPERED',
  'FINAL_SOURCE_REQUIRED', 'FINAL_SOURCE_MISMATCH', 'OPERATOR_IDENTITY_REQUIRED',
  'LOCAL_BUILDER_MISMATCH', 'CANDIDATE_REFUSED', 'OUTPUT_BOUND',
  'CLI_ARGUMENTS_INVALID', 'CLI_INPUT_UNAVAILABLE', 'CLI_OUTPUT_UNAVAILABLE',
]);
const fail = code => { throw new Error(PREFIX + code); };
const hash = (kind, bytes) => createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const authority = () => ({ sourceAdmissionProven: false, remoteMainProven: false,
  gitSignatureVerified: false, identityObservationProven: false, operatorApprovalProven: false,
  elevationPerformed: false, installed: false, runtimeQualificationProven: false,
  custodyReleased: false, dispatchAllowed: false });
const missingGates = () => ['AUTHENTICATED_FINAL_MAIN', 'PRIVATE_OPERATOR_OBSERVATION',
  'EXACT_ARTIFACT_REVIEW_AND_APPROVAL', 'SAME_OPERATOR_ELEVATED_INSTALLATION',
  'GENUINE_LATER_FULL_BOOT', 'AUTHENTICATED_CURRENT_CUSTODY_IDLE'];

function record(value, keys, code = 'INPUT_INVALID') {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail(code);
  return value;
}
function json(text) {
  if (typeof text !== 'string') fail('INPUT_INVALID');
  if (Buffer.byteLength(text) > FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes) fail('INPUT_BOUND');
  try { return JSON.parse(text); } catch { fail('INPUT_INVALID'); }
}
function stable(value, depth = 0) {
  if (depth > 12) fail('INPUT_INVALID');
  if (Array.isArray(value)) return value.map(row => stable(row, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, stable(value[key], depth + 1)]));
  return value;
}
function canonical(value) { return JSON.stringify(stable(value)); }
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function utf8(bytes, code) {
  // All identity text is byte preserving: no BOM removal, replacement decoding,
  // trimming, case folding or line-ending normalization may establish membership.
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!Buffer.from(text, 'utf8').equals(bytes)) fail(code);
    return text;
  } catch { fail(code); }
}
function decodeBase64(text, maximum, code) {
  // Bound encoded allocation first, then require canonical base64 and decoded size.
  if (typeof text !== 'string' || text.length > 4 * Math.ceil(maximum / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail(code);
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length > maximum || bytes.toString('base64') !== text) fail(code);
  return bytes;
}
function object(row, type, maximum) {
  record(row, ['sha', 'contentBase64'], 'OBJECT_INVALID');
  if (!SHA.test(row.sha ?? '')) fail('OBJECT_INVALID');
  const bytes = decodeBase64(row.contentBase64, maximum, 'OBJECT_INVALID');
  if (hash(type, bytes) !== row.sha) fail('OBJECT_HASH_MISMATCH');
  return bytes;
}
function treeEntries(bytes, budget) {
  const entries = new Map(), folded = new Set();
  let offset = 0, previousSortKey = null;
  while (offset < bytes.length) {
    if (++budget.entries > FIXED_RUNTIME_PACKAGE_LIMITS_V1.treeEntries) fail('TREE_BOUND');
    const space = bytes.indexOf(32, offset), end = bytes.indexOf(0, space + 1);
    if (space < offset + 1 || end <= space + 1 || end + 21 > bytes.length) fail('TREE_INVALID');
    const mode = utf8(bytes.subarray(offset, space), 'TREE_INVALID');
    if (!['40000', '100644', '100755'].includes(mode)) fail('TREE_INVALID');
    const name = utf8(bytes.subarray(space + 1, end), 'TREE_PATH_INVALID');
    if (end - space - 1 > 255 || name === '.' || name === '..' || /[\\/:<>"|?*\u0000-\u001f\u007f]/.test(name)
      || /[. ]$/.test(name)) fail('TREE_PATH_INVALID');
    if (entries.has(name) || folded.has(name.toLowerCase())) fail('TREE_ALIAS');
    const sortKey = Buffer.from(name + (mode === '40000' ? '/' : ''), 'utf8');
    if (previousSortKey && Buffer.compare(previousSortKey, sortKey) >= 0) fail('TREE_ORDER');
    previousSortKey = sortKey;
    entries.set(name, { mode, sha: bytes.subarray(end + 1, end + 21).toString('hex') });
    folded.add(name.toLowerCase());
    offset = end + 21;
  }
  return entries;
}
function validateEvidence(input) {
  record(input, ['schemaVersion', 'repository', 'commit', 'trees', 'records']);
  if (input.schemaVersion !== FIXED_RUNTIME_SOURCE_INPUT_SCHEMA_V1) fail('SCHEMA_INVALID');
  if (input.repository !== REPOSITORY) fail('REPOSITORY_INVALID');
  const commitBytes = object(input.commit, 'commit', FIXED_RUNTIME_PACKAGE_LIMITS_V1.commitBytes);
  const commitText = utf8(commitBytes, 'COMMIT_TREE_UNPROVEN'), separator = commitText.indexOf('\n\n');
  if (separator < 0 || !/^tree [a-f0-9]{40}\n/.test(commitText)
    || commitText.slice(0, separator).split('\n').filter(line => line.startsWith('tree ')).length !== 1)
    fail('COMMIT_TREE_UNPROVEN');
  const sourceTree = commitText.slice(5, 45);
  if (!Array.isArray(input.trees) || !input.trees.length
    || input.trees.length > FIXED_RUNTIME_PACKAGE_LIMITS_V1.treeObjects) fail('TREE_BOUND');
  const trees = new Map(), budget = { bytes: 0, entries: 0 };
  for (const row of input.trees) {
    const bytes = object(row, 'tree', FIXED_RUNTIME_PACKAGE_LIMITS_V1.treeBytes);
    budget.bytes += bytes.length;
    if (budget.bytes > FIXED_RUNTIME_PACKAGE_LIMITS_V1.treeBytes) fail('TREE_BOUND');
    if (trees.has(row.sha)) fail('TREE_ALIAS');
    trees.set(row.sha, treeEntries(bytes, budget));
  }
  if (!trees.has(sourceTree)) fail('COMMIT_TREE_UNPROVEN');
  if (!Array.isArray(input.records) || FIXED_RUNTIME_SOURCE_PATHS_V1.length > 256
    || input.records.length !== FIXED_RUNTIME_SOURCE_PATHS_V1.length) fail('SOURCE_RECORD_INVALID');
  const paths = new Set(FIXED_RUNTIME_SOURCE_PATHS_V1), seen = new Set(), usedTrees = new Set();
  const manifest = [], records = [];
  let sourceBytes = 0;
  for (const row of input.records) {
    record(row, ['path', 'blobSha', 'contentBase64'], 'SOURCE_RECORD_INVALID');
    if (!paths.has(row.path) || seen.has(row.path) || !SHA.test(row.blobSha ?? '')) fail('SOURCE_RECORD_INVALID');
    const bytes = decodeBase64(row.contentBase64, FIXED_RUNTIME_PACKAGE_LIMITS_V1.sourceFileBytes, 'SOURCE_BYTES_BOUND');
    sourceBytes += bytes.length;
    if (sourceBytes > FIXED_RUNTIME_PACKAGE_LIMITS_V1.sourceBytes) fail('SOURCE_BYTES_BOUND');
    if (hash('blob', bytes) !== row.blobSha) fail('OBJECT_HASH_MISMATCH');
    const source = utf8(bytes, 'SOURCE_UTF8_INVALID');
    let treeSha = sourceTree, leaf;
    const parts = row.path.split('/');
    for (let index = 0; index < parts.length; index++) {
      const entries = trees.get(treeSha);
      if (!entries) fail('MEMBERSHIP_UNPROVEN');
      usedTrees.add(treeSha);
      leaf = entries.get(parts[index]);
      if (!leaf) fail('MEMBERSHIP_UNPROVEN');
      if (index < parts.length - 1) {
        if (leaf.mode !== '40000') fail('MEMBERSHIP_UNPROVEN');
        treeSha = leaf.sha;
      } else if (!['100644', '100755'].includes(leaf.mode) || leaf.sha !== row.blobSha) fail('MEMBERSHIP_UNPROVEN');
    }
    if (row.path === CLOSURE) {
      let closure;
      try { closure = JSON.parse(source); } catch { fail('SOURCE_CLOSURE_MISMATCH'); }
      record(closure, ['schemaVersion', 'paths'], 'SOURCE_CLOSURE_MISMATCH');
      if (closure.schemaVersion !== 'stephanos.fixed-runtime-source-closure.v1'
        || JSON.stringify(closure.paths) !== JSON.stringify(FIXED_RUNTIME_SOURCE_PATHS_V1)) fail('SOURCE_CLOSURE_MISMATCH');
    }
    seen.add(row.path);
    records.push({ path: row.path, blobSha: row.blobSha, contentBase64: row.contentBase64 });
    manifest.push({ path: row.path, mode: leaf.mode, gitBlobSha: row.blobSha,
      sha256: digest(bytes), bytes: bytes.length });
  }
  if (usedTrees.size !== trees.size) fail('TREE_UNUSED');
  const comparePath = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  records.sort(comparePath); manifest.sort(comparePath);
  const evidence = { schemaVersion: FIXED_RUNTIME_SOURCE_INPUT_SCHEMA_V1, repository: REPOSITORY,
    commit: { sha: input.commit.sha, contentBase64: input.commit.contentBase64 },
    trees: input.trees.map(row => ({ sha: row.sha, contentBase64: row.contentBase64 }))
      .sort((a, b) => a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0), records };
  return { evidence, sourceTree, sourceBytes, manifest, treeObjectCount: trees.size };
}
function prepare(input) {
  const checked = validateEvidence(input);
  const result = { schemaVersion: FIXED_RUNTIME_SOURCE_PACKAGE_SCHEMA_V1,
    state: 'UNBOUND', installability: 'NOT_INSTALLABLE', containsPrivateOperatorIdentity: false,
    repository: REPOSITORY, sourceHead: checked.evidence.commit.sha, sourceTree: checked.sourceTree,
    integrity: { commitObjectHashVerified: true, treeMembershipVerified: true,
      sourceBlobHashesVerified: true, sourceClosureMatchesLocalDeclaration: true },
    sourceFileCount: checked.manifest.length, sourceBytes: checked.sourceBytes,
    treeObjectCount: checked.treeObjectCount,
    sourceBundleSha256: digest(canonical(checked.evidence)), manifest: checked.manifest,
    evidence: checked.evidence, missingGates: missingGates(), authority: authority() };
  if (Buffer.byteLength(canonical(result)) > FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes) fail('OUTPUT_BOUND');
  return freeze(result);
}

/** Bounded JSON from a separately authenticated source collector; no source is evaluated. */
export function prepareFixedRuntimeSourcePackageV1(serializedInput) {
  return prepare(json(serializedInput));
}

/** Private artifact construction only. A supplied SID/head is not observed or approved authority. */
export function bindFixedRuntimeInstallerPackageV1(serializedInput) {
  const input = record(json(serializedInput), ['schemaVersion', 'sourcePackage', 'expectedMain', 'sourceTree', 'operatorSid']);
  if (input.schemaVersion !== FIXED_RUNTIME_BIND_INPUT_SCHEMA_V1) fail('SCHEMA_INVALID');
  if (!SHA.test(input.expectedMain ?? '') || !SHA.test(input.sourceTree ?? '')) fail('FINAL_SOURCE_REQUIRED');
  if (typeof input.operatorSid !== 'string' || input.operatorSid.length > 180
    || /[\r\n]/.test(input.operatorSid) || !SID.test(input.operatorSid)) fail('OPERATOR_IDENTITY_REQUIRED');
  const supplied = input.sourcePackage;
  if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) fail('PACKAGE_TAMPERED');
  const sourcePackage = prepare(supplied.evidence);
  if (canonical(supplied) !== canonical(sourcePackage)) fail('PACKAGE_TAMPERED');
  if (input.expectedMain !== sourcePackage.sourceHead || input.sourceTree !== sourcePackage.sourceTree) fail('FINAL_SOURCE_MISMATCH');
  const builderRecord = sourcePackage.manifest.find(row => row.path === BUILDER);
  // Use the existing locally reviewed builder, never import fetched/captured source.
  // This byte comparison does not claim runtime-loaded-code or remote-main proof.
  let localBuilder;
  try { localBuilder = readFileSync(new URL('./sovereign-fixed-runtime-installer-candidate-v1.mjs', import.meta.url)); }
  catch { fail('LOCAL_BUILDER_MISMATCH'); }
  if (!builderRecord || hash('blob', localBuilder) !== builderRecord.gitBlobSha) fail('LOCAL_BUILDER_MISMATCH');
  let candidate;
  try { candidate = buildFixedRuntimeInstallerCandidateV1({ expectedMain: input.expectedMain,
    sourceTree: input.sourceTree, operatorSid: input.operatorSid, records: sourcePackage.evidence.records }); }
  catch { fail('CANDIDATE_REFUSED'); }
  const result = { schemaVersion: FIXED_RUNTIME_PRIVATE_PACKAGE_SCHEMA_V1,
    state: 'BOUND_FOR_PRIVATE_REVIEW', installability: 'NOT_INSTALLABLE', containsPrivateOperatorIdentity: true,
    publicReview: { repository: REPOSITORY, expectedMain: candidate.expectedMain,
      sourceTree: candidate.sourceTree, sourceBundleSha256: sourcePackage.sourceBundleSha256,
      sourceFileCount: sourcePackage.sourceFileCount, sourceBytes: sourcePackage.sourceBytes,
      payloadSha256: candidate.payloadSha256, scriptSha256: candidate.scriptSha256,
      payloadBytes: candidate.payloadBytes.length, encodedCommandCharacters: candidate.encodedCommand.length },
    privateCandidate: { payloadPath: candidate.payloadPath, payloadBase64: candidate.payloadBytes.toString('base64'),
      powershellExecutable: candidate.powershellExecutable, script: candidate.script,
      encodedCommand: candidate.encodedCommand },
    missingGates: missingGates(), authority: authority() };
  // Never serialize this off-host process's environment as a Windows launch environment.
  if (Buffer.byteLength(canonical(result)) > FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes) fail('OUTPUT_BOUND');
  return freeze(result);
}

const HELP = `Offline fixed-runtime source preparation (no installation or execution).
Usage:
  node scripts/sovereign-fixed-runtime-install-source-package-v1.mjs prepare
  node scripts/sovereign-fixed-runtime-install-source-package-v1.mjs bind
Only bounded JSON on stdin is read; no path, network or native-action options exist.
prepare expects the versioned repository/commit/trees/records input; bind expects
the versioned sourcePackage/expectedMain/sourceTree/operatorSid input.
Both outputs are NOT_INSTALLABLE. Bind output contains a private operator identity.
Use UTF-8 input/output. Windows PowerShell 5 redirection writes UTF-16; use the
explicit UTF-8 ReadAllText/WriteAllText example in the existing custody document.
`;
async function cli() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(HELP); return; }
  if (args.length !== 1 || !['prepare', 'bind'].includes(args[0])) fail('CLI_ARGUMENTS_INVALID');
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes) fail('INPUT_BOUND');
      chunks.push(chunk);
    }
  } catch (error) {
    if (error.message === PREFIX + 'INPUT_BOUND') throw error;
    fail('CLI_INPUT_UNAVAILABLE');
  }
  const text = utf8(Buffer.concat(chunks), 'INPUT_INVALID');
  const result = args[0] === 'prepare' ? prepareFixedRuntimeSourcePackageV1(text) : bindFixedRuntimeInstallerPackageV1(text);
  const output = canonical(result) + '\n';
  if (Buffer.byteLength(output) > FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes) fail('OUTPUT_BOUND');
  await new Promise((done, reject) => process.stdout.write(output, error => error ? reject(new Error(PREFIX + 'CLI_OUTPUT_UNAVAILABLE')) : done()));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => {
    const suffix = typeof error?.message === 'string' && error.message.startsWith(PREFIX)
      ? error.message.slice(PREFIX.length) : '';
    process.stderr.write(PREFIX + (CODES.has(suffix) ? suffix : 'INPUT_INVALID') + '\n');
    process.exitCode = 2;
  });
}
