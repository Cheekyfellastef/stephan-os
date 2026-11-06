import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, sep, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { FIXED_RUNTIME_SOURCE_PATHS_V1, buildFixedRuntimeInstallerCandidateV1 }
  from './sovereign-fixed-runtime-installer-candidate-v1.mjs';

const directoryPaths = [
  'shared/agents/sovereignDirectoryCreateV1.mjs',
  'scripts/windows/sovereign-create-directory.ps1',
  'scripts/windows/SovereignDirectoryCreateV1.cs',
];
const repo = fileURLToPath(new URL('../', import.meta.url));
const closureFixture = fileURLToPath(new URL('./fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs', import.meta.url));
const executionFixture = fileURLToPath(new URL('./fixtures/sovereign-directory-package-fixture-v1.mjs', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function candidateRecords() {
  return FIXED_RUNTIME_SOURCE_PATHS_V1.map(path => {
    const bytes = readFileSync(join(repo, path));
    return { path, contentBase64: bytes.toString('base64'),
      blobSha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') };
  });
}
function candidate(records) {
  return buildFixedRuntimeInstallerCandidateV1({ expectedMain: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40), operatorSid: 'S-1-5-21-1-2-3-1001', records });
}
function packagedCandidate() {
  const artifact = candidate(candidateRecords());
  const root = mkdtempSync(join(tmpdir(), 'sovereign-directory-package-'));
  for (const row of JSON.parse(artifact.payloadBytes.toString('utf8')).Records) {
    const path = resolve(root, row.Path);
    assert.ok(path.startsWith(root + sep));
    mkdirSync(dirname(path), { recursive: true });
    const bytes = Buffer.from(row.ContentBase64, 'base64');
    assert.equal(digest(bytes), row.Sha256);
    writeFileSync(path, bytes);
  }
  return root;
}
function dispose(root) {
  assert.ok(root.startsWith(resolve(tmpdir()) + sep));
  assert.ok(root.split(sep).at(-1).startsWith('sovereign-directory-package-'));
  rmSync(root, { recursive: true, force: true });
}
function closure(root, omitted) {
  const args = ['--experimental-vm-modules', closureFixture, '--fixture-root=' + root];
  if (omitted) args.push('--omit=' + omitted);
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('directory package captures exactly three dependencies and rejects incomplete or extra records', () => {
  assert.equal(FIXED_RUNTIME_SOURCE_PATHS_V1.length, 266);
  for (const path of directoryPaths) assert.ok(FIXED_RUNTIME_SOURCE_PATHS_V1.includes(path), path);
  const records = candidateRecords();
  assert.throws(() => candidate(records.filter(row => !directoryPaths.includes(row.path))), /EXACT_SOURCE_REQUIRED/);
  for (const path of directoryPaths)
    assert.throws(() => candidate(records.filter(row => row.path !== path)), /EXACT_SOURCE_REQUIRED/);
  assert.throws(() => candidate([...records, records[0]]), /EXACT_SOURCE_REQUIRED/);
  for (const path of ['scripts/windows/unreviewed.ps1', '../outside.ps1', 'Scripts/windows/sovereign-create-directory.ps1']) {
    const changed = records.map(row => row.path === directoryPaths[1] ? { ...row, path } : row);
    assert.throws(() => candidate(changed), /SOURCE_RECORD_INVALID/);
  }
  const artifact = candidate(records);
  assert.ok(artifact.encodedCommand.length < 30000);
  assert.ok(records.reduce((n, row) => n + Buffer.from(row.contentBase64, 'base64').length, 0) < 8388608);
  assert.equal(artifact.installed, false);
  assert.equal(artifact.operatorApprovalProven, false);
});

test('isolated captured package proves imports and both source-owned runtime-read edges', () => {
  const root = packagedCandidate();
  try {
    const complete = closure(root);
    assert.equal(complete.memberCount, 266);
    assert.deepEqual(complete.missing, []);
    assert.deepEqual(complete.bare, []);
    assert.equal(complete.repositoryModulesEvaluated, false);
    assert.ok(complete.parsedPaths.includes('scripts/sovereign-commander-mcp.mjs'));
    for (const path of directoryPaths) {
      const missing = closure(root, path);
      assert.ok(missing.missing.some(row => row.target === path || row.runtimeRead === path), path);
    }
    const modulePath = join(root, directoryPaths[0]);
    const original = readFileSync(modulePath, 'utf8');
    for (const replacement of ["new URL('../../../outside.ps1', import.meta.url)", "new URL(helperPath, import.meta.url)"]) {
      const changed = original.replace("new URL('../../scripts/windows/sovereign-create-directory.ps1', import.meta.url)", replacement);
      assert.notEqual(changed, original);
      writeFileSync(modulePath, changed);
      const unknown = closure(root);
      assert.ok(unknown.missing.some(row => row.outsideRepository || row.runtimeReadBinding === 'SCRIPT'));
    }
  } finally { dispose(root); }
});

test('packaged directory adapter uses captured helper bytes and cannot fall back to the checkout', () => {
  const root = packagedCandidate();
  try {
    const result = spawnSync(process.execPath, [executionFixture, root],
      { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { realNativeSpawn: false, capturedBuffersVerified: true,
      missingAndTamperedRefused: true, canonicalFallback: false });
  } finally { dispose(root); }
});

test('complete packaged-module graph catches future dependency omissions without evaluating source', () => {
  const root = packagedCandidate();
  const modulePath = join(root, 'shared/agents/missionOrchestrator.mjs');
  const original = readFileSync(modulePath, 'utf8');
  // Explicitly omit each dependency from this synthetic graph, including
  // dependencies now present after another producer's source integration.
  const additionalDependencies = [
    './knownMalformedPatchRetryV1.mjs', './knownMalformedPatchOwnerPlanV1.mjs',
    '../../stephanos-server/services/knownMalformedPatchRetryService.js',
    './externalMergeObservationV1.mjs',
    '../../stephanos-server/services/completionGuardianMergeObservationService.js',
  ];
  try {
    const before = closure(root);
    assert.deepEqual(before.missing, []);
    const jsMembers = FIXED_RUNTIME_SOURCE_PATHS_V1.filter(path => /\.(mjs|js)$/.test(path));
    assert.deepEqual(before.parsedPaths, jsMembers.slice().sort());
    for (const spec of additionalDependencies) {
      writeFileSync(modulePath, "import '" + spec + "';\n" + original);
      const omitted = posix.normalize(posix.join('shared/agents', spec));
      const result = closure(root, omitted);
      assert.ok(result.missing.some(row => row.file === 'shared/agents/missionOrchestrator.mjs'
        && row.role === 'import' && row.target === omitted));
      assert.equal(result.repositoryModulesEvaluated, false);
    }
    writeFileSync(modulePath, original);
    const manifestPath = join(root, 'shared/agents/sovereignFixedRuntimeSourceClosureV1.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, paths: [...manifest.paths].reverse() }));
    assert.deepEqual(closure(root).edges, before.edges);
    const duplicate = "import './sharedAgentWorkspaceStore.mjs';\n";
    writeFileSync(modulePath, duplicate + duplicate + original);
    const repeated = closure(root);
    assert.deepEqual(repeated.missing, []);
    assert.equal(repeated.edges.filter(row => row.file === 'shared/agents/missionOrchestrator.mjs'
      && row.target === 'shared/agents/sharedAgentWorkspaceStore.mjs').length, 1);
  } finally { dispose(root); }
});

test('unknown, outside-package and unsupported dependency edges remain held', () => {
  const root = packagedCandidate();
  const modulePath = join(root, 'shared/agents/missionOrchestrator.mjs');
  const original = readFileSync(modulePath, 'utf8');
  try {
    for (const prefix of [
      "const external = './unknown.mjs'; await import(external);\n",
      "await import /* comment cannot hide a call */ (external);\n",
      "import '../../../outside.mjs';\n",
      "import './unknown%2e.mjs';\n",
      "import './sovereignFixedRuntimeSourceClosureV1.json';\n",
      "import 'unapproved-external-package';\n",
    ]) {
      writeFileSync(modulePath, prefix + original);
      const result = closure(root);
      assert.ok(result.missing.length + result.bare.length > 0, prefix);
      assert.equal(result.repositoryModulesEvaluated, false);
    }
  } finally { dispose(root); }
});

test('runtime-read graph binds helper bytes and refuses a changed adapter declaration', () => {
  const root = packagedCandidate();
  try {
    for (const helper of directoryPaths.slice(1)) {
      const full = join(root, helper), bytes = readFileSync(full);
      writeFileSync(full, Buffer.concat([bytes, Buffer.from('\n// changed')]));
      assert.ok(closure(root).missing.some(row => row.target === helper && row.runtimeReadPinMismatch));
      writeFileSync(full, bytes);
    }
    const adapter = join(root, directoryPaths[0]);
    writeFileSync(adapter, readFileSync(adapter, 'utf8') + '\n// changed read-edge source needs review\n');
    assert.ok(closure(root).missing.some(row => row.runtimeReadSourceUnproven));
  } finally { dispose(root); }
});

test('optional HTTP fallback is excluded only for the reviewed Windows profile gates', () => {
  const root = packagedCandidate();
  try {
    const result = closure(root);
    assert.deepEqual(result.missing, []);
    assert.equal(result.coverage[0].state, 'EXCLUDED_BY_REVIEWED_PROFILE_GATES');
    assert.equal(result.coverage[0].targetPackaged, false);
    assert.equal(result.coverage[0].nonWindowsOrInjectedFallbackQualified, false);
    const file = join(root, 'scripts/sovereign-commander-http.mjs');
    const source = readFileSync(file, 'utf8');
    assert.ok(source.includes('SOVEREIGN_CONTINUOUS_NATIVE_FALLBACK_FORBIDDEN'));
    writeFileSync(file, source.replace('SOVEREIGN_CONTINUOUS_NATIVE_FALLBACK_FORBIDDEN', 'CHANGED_FALLBACK_BOUNDARY'));
    const changed = closure(root);
    assert.ok(changed.missing.some(row => row.fixedProfileApplicabilityUnproven));
    assert.equal(changed.coverage[0].state, 'SCOPE_UNPROVEN');
  } finally { dispose(root); }
});
