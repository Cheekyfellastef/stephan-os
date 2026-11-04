import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FIXED_RUNTIME_SOURCE_PATHS_V1, buildFixedRuntimeInstallerCandidateV1 }
  from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import { FIXED_RUNTIME_SOURCE_INPUT_SCHEMA_V1, FIXED_RUNTIME_BIND_INPUT_SCHEMA_V1,
  FIXED_RUNTIME_PACKAGE_LIMITS_V1, prepareFixedRuntimeSourcePackageV1,
  bindFixedRuntimeInstallerPackageV1 } from './sovereign-fixed-runtime-install-source-package-v1.mjs';

const gitHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const TEST_SID = 'S-1-5-21-1-2-3-1001'; // Test data only; never a native identity observation.
const closurePath = 'shared/agents/sovereignFixedRuntimeSourceClosureV1.json';
const builderPath = 'scripts/sovereign-fixed-runtime-installer-candidate-v1.mjs';
const cliPath = fileURLToPath(new URL('./sovereign-fixed-runtime-install-source-package-v1.mjs', import.meta.url));
const rawRecords = FIXED_RUNTIME_SOURCE_PATHS_V1.map(path => {
  const bytes = readFileSync(new URL('../' + path, import.meta.url));
  return { path, blobSha: gitHash('blob', bytes), contentBase64: bytes.toString('base64') };
});
const treeRow = (mode, name, sha) => Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(sha, 'hex')]);
function fixture({ records = rawRecords, leafMode = '100644', rootExtra = [], rootRename = {} } = {}) {
  const root = new Map(), trees = [];
  for (const row of records) {
    const parts = row.path.split('/'); let cursor = root;
    for (const part of parts.slice(0, -1)) {
      if (!cursor.has(part)) cursor.set(part, new Map());
      cursor = cursor.get(part);
    }
    cursor.set(parts.at(-1), row.blobSha);
  }
  function emit(directory, isRoot = false) {
    const entries = [...directory].map(([name, value]) => ({ name,
      mode: value instanceof Map ? '40000' : leafMode,
      sha: value instanceof Map ? emit(value) : value }));
    if (isRoot) {
      for (const row of entries) row.name = rootRename[row.name] ?? row.name;
      entries.push(...rootExtra);
    }
    entries.sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.mode === '40000' ? '/' : '')),
      Buffer.from(b.name + (b.mode === '40000' ? '/' : ''))));
    const bytes = Buffer.concat(entries.map(row => treeRow(row.mode, row.name, row.sha)));
    const sha = gitHash('tree', bytes); trees.push({ sha, contentBase64: bytes.toString('base64') });
    return sha;
  }
  const tree = emit(root, true);
  const commit = Buffer.from(`tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nOffline fixture only.\n`);
  return { schemaVersion: FIXED_RUNTIME_SOURCE_INPUT_SCHEMA_V1, repository: 'Cheekyfellastef/stephan-os',
    commit: { sha: gitHash('commit', commit), contentBase64: commit.toString('base64') }, trees, records: clone(records) };
}
const input = fixture();
const sourcePackage = prepareFixedRuntimeSourcePackageV1(JSON.stringify(input));
function prepare(value) { return prepareFixedRuntimeSourcePackageV1(JSON.stringify(value)); }
function binding(pkg = sourcePackage) {
  return { schemaVersion: FIXED_RUNTIME_BIND_INPUT_SCHEMA_V1, sourcePackage: pkg,
    expectedMain: pkg.sourceHead, sourceTree: pkg.sourceTree, operatorSid: TEST_SID };
}
function bind(value) { return bindFixedRuntimeInstallerPackageV1(JSON.stringify(value)); }
function rejects(fn, code) { assert.throws(fn, error => error.message === 'FIXED_INSTALL_PACKAGE_' + code); }
function changedRecord(path, bytes) {
  return rawRecords.map(row => row.path === path ? { path, blobSha: gitHash('blob', bytes), contentBase64: bytes.toString('base64') } : row);
}
function replaceRoot(value, bytes) {
  const copy = clone(value), oldTree = Buffer.from(copy.commit.contentBase64, 'base64').toString('utf8').slice(5, 45);
  const root = copy.trees.find(row => row.sha === oldTree), next = gitHash('tree', bytes);
  root.sha = next; root.contentBase64 = bytes.toString('base64');
  const commit = Buffer.from(Buffer.from(copy.commit.contentBase64, 'base64').toString('utf8').replace(oldTree, next));
  copy.commit = { sha: gitHash('commit', commit), contentBase64: commit.toString('base64') };
  return copy;
}
function runCli(args, data = '') {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, [cliPath, ...args], { input: data, encoding: 'utf8',
    maxBuffer: 17 * 1024 * 1024, timeout: 20000, env });
}

test('complete exact closure becomes deterministic UNBOUND source evidence, never admission', () => {
  assert.equal(sourcePackage.sourceFileCount, 258);
  assert.equal(sourcePackage.sourceFileCount, FIXED_RUNTIME_SOURCE_PATHS_V1.length);
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-ignition-diagnosis.mjs'));
  assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-commander-persistent-runtime-repair.mjs'));
  assert.equal(sourcePackage.state, 'UNBOUND'); assert.equal(sourcePackage.installability, 'NOT_INSTALLABLE');
  assert.equal(sourcePackage.containsPrivateOperatorIdentity, false);
  assert.equal(sourcePackage.integrity.commitObjectHashVerified, true);
  assert.equal(sourcePackage.integrity.treeMembershipVerified, true);
  assert.ok(Object.values(sourcePackage.authority).every(value => value === false));
  assert.ok(Object.isFrozen(sourcePackage.evidence.records[0]));
  assert.ok(!FIXED_RUNTIME_SOURCE_PATHS_V1.includes('scripts/sovereign-fixed-runtime-install-source-package-v1.mjs'));
  for (const row of sourcePackage.manifest) {
    const actual = rawRecords.find(record => record.path === row.path);
    const bytes = Buffer.from(actual.contentBase64, 'base64');
    assert.equal(row.gitBlobSha, actual.blobSha); assert.equal(row.sha256, sha256(bytes));
    assert.equal(row.bytes, bytes.length);
  }
});
test('record and proof order do not change the normalized package or its digest', () => {
  const reordered = clone(input); reordered.records.reverse(); reordered.trees.reverse();
  assert.deepEqual(prepare(reordered), sourcePackage);
});
test('preparation never accepts a serialized trust or approval flag', () => {
  rejects(() => prepare({ ...input, authenticated: true }), 'INPUT_INVALID');
  rejects(() => prepare({ ...input, operatorApproved: true }), 'INPUT_INVALID');
});
test('only bounded serialized input is accepted; caller getters are never read', () => {
  let called = false; const hostile = { get schemaVersion() { called = true; throw new Error('secret'); } };
  rejects(() => prepareFixedRuntimeSourcePackageV1(hostile), 'INPUT_INVALID'); assert.equal(called, false);
  rejects(() => prepareFixedRuntimeSourcePackageV1('{bad-json'), 'INPUT_INVALID');
  rejects(() => prepareFixedRuntimeSourcePackageV1(' '.repeat(FIXED_RUNTIME_PACKAGE_LIMITS_V1.serializedBytes + 1)), 'INPUT_BOUND');
});
test('foreign schema and repository refuse', () => {
  rejects(() => prepare({ ...input, schemaVersion: 'foreign' }), 'SCHEMA_INVALID');
  rejects(() => prepare({ ...input, repository: 'foreign/repository' }), 'REPOSITORY_INVALID');
});
test('a changed commit cannot borrow the old immutable object identity', () => {
  const value = clone(input); value.commit.contentBase64 = Buffer.from('tree ' + 'a'.repeat(40) + '\n\nchanged').toString('base64');
  rejects(() => prepare(value), 'OBJECT_HASH_MISMATCH');
});
test('commit tree is a single exact header, not a caller tree field or message', () => {
  const value = clone(input), bytes = Buffer.from('author Fixture\n\ntree ' + sourcePackage.sourceTree + '\n');
  value.commit = { sha: gitHash('commit', bytes), contentBase64: bytes.toString('base64') };
  rejects(() => prepare(value), 'COMMIT_TREE_UNPROVEN');
  const two = Buffer.from(`tree ${sourcePackage.sourceTree}\ntree ${sourcePackage.sourceTree}\n\nmessage`);
  value.commit = { sha: gitHash('commit', two), contentBase64: two.toString('base64') };
  rejects(() => prepare(value), 'COMMIT_TREE_UNPROVEN');
});
test('object types are included in Git identity validation', () => {
  const value = clone(input), row = value.trees[0];
  row.sha = gitHash('blob', Buffer.from(row.contentBase64, 'base64'));
  rejects(() => prepare(value), 'OBJECT_HASH_MISMATCH');
});
for (const mode of ['120000', '160000', '040000', '100664']) {
  test(`noncanonical or redirected source mode ${mode} refuses`, () => {
    rejects(() => prepare(fixture({ leafMode: mode })), 'TREE_INVALID');
  });
}
test('duplicate tree objects cannot alias proof inventory', () => {
  const value = clone(input); value.trees.push(value.trees[0]);
  rejects(() => prepare(value), 'TREE_ALIAS');
});
for (const name of ['scripts', 'Scripts']) {
  test(`duplicate or Windows-case-aliased tree entry ${name} refuses`, () => {
    rejects(() => prepare(fixture({ rootExtra: [{ name, mode: '40000', sha: 'a'.repeat(40) }] })), 'TREE_ALIAS');
  });
}
for (const name of ['..', 'a/b', 'a\\b', 'trailing.', 'trailing ', 'alternate:stream']) {
  test(`unsafe Git tree component ${JSON.stringify(name)} refuses`, () => {
    rejects(() => prepare(fixture({ rootExtra: [{ name, mode: '100644', sha: 'a'.repeat(40) }] })), 'TREE_PATH_INVALID');
  });
}
test('truncated binary tree object refuses even when its hash is self-consistent', () => {
  rejects(() => prepare(replaceRoot(input, Buffer.from('100644 incomplete\0abc'))), 'TREE_INVALID');
});
test('high-bit mode bytes cannot be folded into an accepted ASCII Git mode', () => {
  const bytes = Buffer.from(input.trees.find(row => row.sha === sourcePackage.sourceTree).contentBase64, 'base64');
  for (let index = 0; index < bytes.indexOf(32); index++) bytes[index] |= 128;
  rejects(() => prepare(replaceRoot(input, bytes)), 'TREE_INVALID');
});
test('a BOM-prefixed tree name is a different exact path, not a canonical closure member', () => {
  rejects(() => prepare(fixture({ rootRename: { scripts: '\uFEFFscripts' } })), 'MEMBERSHIP_UNPROVEN');
});
test('a BOM-prefixed commit cannot borrow the canonical tree header', () => {
  const value = clone(input), bytes = Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(value.commit.contentBase64, 'base64')]);
  value.commit = { sha: gitHash('commit', bytes), contentBase64: bytes.toString('base64') };
  rejects(() => prepare(value), 'COMMIT_TREE_UNPROVEN');
});
test('self-consistent but noncanonical tree ordering cannot claim valid membership', () => {
  const bytes = Buffer.from(input.trees.find(row => row.sha === sourcePackage.sourceTree).contentBase64, 'base64');
  const firstEnd = bytes.indexOf(0) + 21;
  rejects(() => prepare(replaceRoot(input, Buffer.concat([bytes.subarray(firstEnd), bytes.subarray(0, firstEnd)]))), 'TREE_ORDER');
});
test('canonical executable file mode remains valid source membership', () => {
  const value = prepare(fixture({ leafMode: '100755' }));
  assert.equal(value.integrity.treeMembershipVerified, true);
  assert.ok(value.manifest.every(row => row.mode === '100755'));
  assert.equal(value.authority.sourceAdmissionProven, false);
});
test('complete root and every intermediate proof object are required', () => {
  const rootMissing = clone(input); rootMissing.trees = rootMissing.trees.filter(row => row.sha !== sourcePackage.sourceTree);
  rejects(() => prepare(rootMissing), 'COMMIT_TREE_UNPROVEN');
  const intermediate = clone(input); intermediate.trees = intermediate.trees.filter((_, index) => index !== 0);
  rejects(() => prepare(intermediate), 'MEMBERSHIP_UNPROVEN');
});
test('unrelated proof objects and excessive tree counts refuse', () => {
  const unrelated = clone(input), empty = Buffer.alloc(0);
  unrelated.trees.push({ sha: gitHash('tree', empty), contentBase64: '' });
  rejects(() => prepare(unrelated), 'TREE_UNUSED');
  const many = clone(input); many.trees = Array.from({ length: FIXED_RUNTIME_PACKAGE_LIMITS_V1.treeObjects + 1 }, () => input.trees[0]);
  rejects(() => prepare(many), 'TREE_BOUND');
});
test('a blob with a valid self hash still needs exact membership in the anchored tree', () => {
  const value = clone(input), bytes = Buffer.from('replacement source');
  value.records[0] = { ...value.records[0], blobSha: gitHash('blob', bytes), contentBase64: bytes.toString('base64') };
  rejects(() => prepare(value), 'MEMBERSHIP_UNPROVEN');
});
test('only the existing complete closed source path set is accepted', () => {
  const arbitrary = clone(input); arbitrary.records[0].path = '../../outside';
  rejects(() => prepare(arbitrary), 'SOURCE_RECORD_INVALID');
  const missing = clone(input); missing.records.pop(); rejects(() => prepare(missing), 'SOURCE_RECORD_INVALID');
  const extra = clone(input); extra.records.push(extra.records[0]); rejects(() => prepare(extra), 'SOURCE_RECORD_INVALID');
  const duplicate = clone(input); duplicate.records[0] = duplicate.records[1]; rejects(() => prepare(duplicate), 'SOURCE_RECORD_INVALID');
});
test('source must remain strict UTF8 and canonical base64', () => {
  rejects(() => prepare(fixture({ records: changedRecord(rawRecords[0].path, Buffer.from([255, 254, 0])) })), 'SOURCE_UTF8_INVALID');
  const value = clone(input); value.records[0].contentBase64 += '\n';
  rejects(() => prepare(value), 'SOURCE_BYTES_BOUND');
});
test('CRLF materialization never silently normalizes source into its claimed Git blob', () => {
  const value = clone(input), row = value.records.find(row => row.path === builderPath);
  const bytes = Buffer.from(Buffer.from(row.contentBase64, 'base64').toString('utf8').replaceAll('\n', '\r\n'));
  row.contentBase64 = bytes.toString('base64');
  rejects(() => prepare(value), 'OBJECT_HASH_MISMATCH');
});
test('the captured closure declaration cannot redefine the locally reviewed path set', () => {
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 'stephanos.fixed-runtime-source-closure.v1', paths: FIXED_RUNTIME_SOURCE_PATHS_V1.slice(1) }));
  rejects(() => prepare(fixture({ records: changedRecord(closurePath, bytes) })), 'SOURCE_CLOSURE_MISMATCH');
});
test('individual and aggregate source limits remain the existing installer limits', () => {
  const big = Buffer.alloc(FIXED_RUNTIME_PACKAGE_LIMITS_V1.sourceFileBytes + 1, 32);
  rejects(() => prepare(fixture({ records: changedRecord(rawRecords[0].path, big) })), 'SOURCE_BYTES_BOUND');
  const large = Buffer.alloc(FIXED_RUNTIME_PACKAGE_LIMITS_V1.sourceFileBytes, 32);
  const selected = new Set(rawRecords.slice(0, 3).map(row => row.path));
  const records = rawRecords.map(row => selected.has(row.path)
    ? { ...row, blobSha: gitHash('blob', large), contentBase64: large.toString('base64') } : row);
  rejects(() => prepare(fixture({ records })), 'SOURCE_BYTES_BOUND');
});
test('private binding delegates exactly to the existing builder and grants nothing', () => {
  const result = bind(binding()), original = buildFixedRuntimeInstallerCandidateV1({ expectedMain: sourcePackage.sourceHead,
    sourceTree: sourcePackage.sourceTree, operatorSid: TEST_SID, records: sourcePackage.evidence.records });
  assert.equal(result.state, 'BOUND_FOR_PRIVATE_REVIEW'); assert.equal(result.installability, 'NOT_INSTALLABLE');
  assert.equal(result.privateCandidate.payloadBase64, original.payloadBytes.toString('base64'));
  assert.equal(result.privateCandidate.script, original.script);
  assert.equal(result.privateCandidate.encodedCommand, original.encodedCommand);
  assert.equal(result.publicReview.payloadSha256, original.payloadSha256);
  assert.equal(result.publicReview.scriptSha256, original.scriptSha256);
  assert.ok(Object.values(result.authority).every(value => value === false));
  assert.ok(!JSON.stringify(result.publicReview).includes(TEST_SID));
  assert.ok(!Object.hasOwn(result.privateCandidate, 'environment'));
  const payload = JSON.parse(Buffer.from(result.privateCandidate.payloadBase64, 'base64'));
  assert.equal(payload.OperatorSid, TEST_SID); assert.equal(payload.SourceHead, sourcePackage.sourceHead);
  assert.ok(Object.isFrozen(result.privateCandidate));
});
test('missing or invalid operator value cannot create even a bound review artifact', () => {
  for (const operatorSid of ['', null, 'Administrator', 'S-1-5-18', TEST_SID + '\n', 'S-1-5-21-' + '1'.repeat(180)]) {
    rejects(() => bind({ ...binding(), operatorSid }), 'OPERATOR_IDENTITY_REQUIRED');
  }
});
test('final expected head and tree must be supplied and exactly match the source object proof', () => {
  rejects(() => bind({ ...binding(), expectedMain: '' }), 'FINAL_SOURCE_REQUIRED');
  rejects(() => bind({ ...binding(), expectedMain: 'a'.repeat(40) }), 'FINAL_SOURCE_MISMATCH');
  rejects(() => bind({ ...binding(), sourceTree: 'b'.repeat(40) }), 'FINAL_SOURCE_MISMATCH');
});
test('serialized flags, summaries, missing gates and source hashes cannot be laundered through binding', () => {
  for (const change of [value => { value.authority.remoteMainProven = true; },
    value => { value.authority.operatorApprovalProven = true; },
    value => { value.state = 'INSTALLABLE'; }, value => { value.missingGates = []; },
    value => { value.sourceFileCount = 0; }, value => { value.sourceBundleSha256 = 'a'.repeat(64); }]) {
    const value = clone(sourcePackage); change(value);
    rejects(() => bind(binding(value)), 'PACKAGE_TAMPERED');
  }
});
test('captured builder source is never evaluated and cannot replace the locally reviewed implementation', () => {
  const malicious = Buffer.from('throw new Error("FETCHED_SOURCE_MUST_NEVER_EXECUTE");\n');
  const value = prepare(fixture({ records: changedRecord(builderPath, malicious) }));
  rejects(() => bind(binding(value)), 'LOCAL_BUILDER_MISMATCH');
});
test('prepare then bind then source movement remains non-admitting and refuses stale identity', () => {
  const first = prepare(input), second = bind(binding(first));
  assert.equal(first.installability, 'NOT_INSTALLABLE'); assert.equal(second.installability, 'NOT_INSTALLABLE');
  rejects(() => bind({ ...binding(first), expectedMain: 'f'.repeat(40) }), 'FINAL_SOURCE_MISMATCH');
  assert.equal(second.authority.installed, false); assert.equal(second.authority.identityObservationProven, false);
  assert.equal(second.authority.sourceAdmissionProven, false);
});
test('actual stdin/stdout prepare and private bind CLIs produce the same reviewable artifacts', () => {
  const prepared = runCli(['prepare'], JSON.stringify(input));
  assert.equal(prepared.error, undefined); assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual(JSON.parse(prepared.stdout), sourcePackage);
  const bound = runCli(['bind'], JSON.stringify(binding(JSON.parse(prepared.stdout))));
  assert.equal(bound.error, undefined); assert.equal(bound.status, 0, bound.stderr);
  assert.deepEqual(JSON.parse(bound.stdout), bind(binding()));
});
test('CLI supports fixed help and refuses path, execute and extra arguments', () => {
  const help = runCli(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /NOT_INSTALLABLE/);
  for (const args of [['install'], ['prepare', '--path', '/private'], ['bind', '--execute']]) {
    const result = runCli(args); assert.equal(result.status, 2); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'FIXED_INSTALL_PACKAGE_CLI_ARGUMENTS_INVALID\n');
  }
});
test('CLI emits only a closed failure code, never source or caller data', () => {
  const result = runCli(['prepare'], 'PRIVATE_CALLER_OR_TOKEN_MUST_NOT_APPEAR');
  assert.equal(result.status, 2); assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'FIXED_INSTALL_PACKAGE_INPUT_INVALID\n');
});
