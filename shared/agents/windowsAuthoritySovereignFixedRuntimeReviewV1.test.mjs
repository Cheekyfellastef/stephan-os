import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1,
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1,
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_PATHS_V1,
  WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_BLOBS_V1,
  analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1,
} from './windowsAuthoritySovereignFixedRuntimeReviewV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = '2f56252825d5bbc9aa0a684808fd141eff74c84c';
const BRANCH = 'fix/2961-fixed-runtime-closure-relay-proof-20261031';

function input(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 3362,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    analysis: {
      findings: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1.map(path => ({
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path,
      })),
      counts: { P0: 2, P1: 0, P2: 0 },
    },
    lineageEvidence: {
      schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      sourceCommitSha: HEAD,
      baseSha: BASE,
      liveMainBeforeSha: BASE,
      liveMainAfterSha: BASE,
      parents: [BASE],
      comparison: {
        status: 'ahead',
        aheadBy: 14,
        behindBy: 0,
        baseCommitSha: BASE,
        mergeBaseCommitSha: BASE,
      },
    },
    sources: [],
    ...overrides,
  };
}

test('exact #3362 two-P0 escalation is eligible but cannot self-certify without exact source evidence', () => {
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1);
  assert.equal(result.findings.filter(item => item.code === 'fixed-runtime-specialist-exact-source-not-pinned').length, 2);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('wrong PR branch base or escalation estate cannot enter the specialist', () => {
  for (const overrides of [
    { prNumber: 3363 },
    { branch: 'other' },
    { baseSha: 'b'.repeat(40) },
    { analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface',
      path: WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1[0] }], counts: { P0: 1, P1: 0, P2: 0 } } },
  ]) {
    assert.equal(analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input(overrides)).eligible, false);
  }
});

test('source estate widening cannot be reviewed favorably', () => {
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input({
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: 'Cheekyfellastef/stephan-os',
      path: 'scripts/windows/unrelated.ps1',
      ref: HEAD,
      exists: true,
      size: 1,
      blobSha: 'b'.repeat(40),
      content: 'x',
    }],
  }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(item => item.code === 'fixed-runtime-specialist-source-estate-widened'));
});

test('review profile pins only the two future #3362 Windows blobs and exact safety literals', async () => {
  assert.deepEqual(Object.keys(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1).sort(),
    [...WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1].sort());
  assert.equal(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1[
    'scripts/windows/install-sovereign-fixed-runtime-v1.ps1'
  ], '8883b76eb04a4857e5627391d612dd09a02a8a97');
  assert.equal(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1[
    'scripts/windows/SovereignFixedRuntimeIdentityV1.cs'
  ], '6c5f32afbba17c21d72aff7f983622862409c73b');

  const source = await readFile(new URL('./windowsAuthoritySovereignFixedRuntimeReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /Records\.Count -lt 40 -or \$bootstrap\.Records\.Count -gt 258/);
  assert.match(source, /manifest\.Files==null \|\| manifest\.Files\.Length<40 \|\| manifest\.Files\.Length>258/);
  assert.match(source, /compiled<installed && installed<boot && boot<now/);
  assert.match(source, /FIXED_INSTALL_ADMINISTRATOR_REQUIRED/);
  assert.match(source, /FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED/);
  assert.match(source, /RUNTIME_PENDING_LATER_BOOT_UNPROVEN/);
  assert.match(source, /RUNTIME_SOURCE_REF_CHANGED/);
  assert.match(source, /sourceMutationAllowed: false/);
  assert.match(source, /mergeAuthority: false/);
  assert.match(source, /runtimeMutationAllowed: false/);
});

const CURRENT_BASE = 'f8a6d1ccafc66cb8038b22f34f916e0b494347be';
const NEW_PATHS = WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_PATHS_V1;
const INSTALLER = NEW_PATHS[0], IDENTITY = NEW_PATHS[1], MOBILE = NEW_PATHS[2];
const AUTHORITY_FIELDS = ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed', 'providerQualificationAuthority'];
function gitBlob(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}
async function fixtureSources(prNumber, paths) {
  return Promise.all(paths.map(async path => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const content = await readFile(new URL(`../../tests/fixtures/windows-authority-sovereign-fixed-runtime/${prNumber}/${name}.txt`, import.meta.url), 'utf8');
    return { schemaVersion: 'stephanos.windows-authority-source.v1', repository: 'Cheekyfellastef/stephan-os',
      path, ref: HEAD, exists: true, size: Buffer.byteLength(content, 'utf8'), blobSha: gitBlob(content), content };
  }));
}
const LEGACY_SOURCES = await fixtureSources(3362, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1);
const CURRENT_SOURCES = await fixtureSources(3551, NEW_PATHS);
function closureInput() {
  const row = input();
  return { ...row, prNumber: 3551, baseSha: CURRENT_BASE,
    analysis: { findings: NEW_PATHS.map(path => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
      counts: { P0: 3, P1: 0, P2: 0 } },
    lineageEvidence: { ...row.lineageEvidence, baseSha: CURRENT_BASE,
      liveMainBeforeSha: CURRENT_BASE, liveMainAfterSha: CURRENT_BASE, parents: [CURRENT_BASE],
      comparison: { status: 'ahead', aheadBy: 1, behindBy: 0,
        baseCommitSha: CURRENT_BASE, mergeBaseCommitSha: CURRENT_BASE } },
    sources: structuredClone(CURRENT_SOURCES) };
}
function noAuthority(result) {
  for (const key of AUTHORITY_FIELDS) assert.equal(result[key], false, key);
}
function rejectInput(row) {
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(row);
  assert.equal(result.eligible, false);
  assert.equal(result.clean, false);
  assert.deepEqual(result.proofRefs, []);
  noAuthority(result);
}

test('original #3362 pinned source qualification remains clean and limited to two files', () => {
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input({ sources: structuredClone(LEGACY_SOURCES) }));
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1);
  assert.equal(result.proofRefs.length, 2);
  assert.equal(Object.keys(WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1).length, 2);
  noAuthority(result);
});

test('exact original-branch #3551 three-file continuation passes semantic review without acquiring authority', () => {
  const row = closureInput();
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(row);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths, NEW_PATHS);
  assert.equal(result.proofRefs.length, 3);
  assert.deepEqual(Object.fromEntries(CURRENT_SOURCES.map(s => [s.path, s.blobSha])),
    WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_BLOBS_V1);
  for (const source of CURRENT_SOURCES) assert.ok(result.proofRefs.some(ref => ref.endsWith(`#${source.blobSha}:${source.size}`)));
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.reviewedPaths));
  noAuthority(result);
  row.analysis.findings.reverse();
  row.sources.reverse();
  assert.equal(analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(row).clean, true);
});

test('#3551 mobile path-set pin commits to the actual 302-member closure including exactly the two OC2 modules', async () => {
  const source = await readFile(new URL('../../tests/fixtures/windows-authority-sovereign-fixed-runtime/3551/runtime-source-closure.json.txt', import.meta.url), 'utf8');
  assert.equal(gitBlob(source), 'b779788bbb00483a819e7aefa059a3523cb44cfa');
  const closure = JSON.parse(source);
  assert.equal(closure.schemaVersion, 'stephanos.fixed-runtime-source-closure.v1');
  assert.equal(closure.paths.length, 302);
  assert.equal(new Set(closure.paths).size, 302);
  assert.deepEqual(closure.paths.filter(path => path.includes('/oc2-')).sort(), [
    'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs',
    'integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs',
  ]);
  const digest = createHash('sha256').update('stephanos.mobile-install-release-path-set.v1\0'
    + [...closure.paths].sort().join('\n') + '\n').digest('hex');
  assert.equal(digest, '62dd881fd8f0a25dbc26f73c4750d3be047960acaccc8577e0f7a2c8220973f9');
  assert.ok(CURRENT_SOURCES.find(row => row.path === MOBILE).content.includes(`ExpectedPathSetSha256="${digest}"`));
});

for (const [name, mutate] of [
  ['another PR', r => { r.prNumber = 3554; }],
  ['reviewer self PR', r => { r.prNumber = 3363; }],
  ['another branch', r => { r.branch = 'fix/unrelated'; }],
  ['another repository', r => { r.repository = 'other/stephan-os'; }],
  ['head equals base', r => { r.sourceHead = r.baseSha; }],
  ['missing lineage', r => { delete r.lineageEvidence; }],
  ['foreign source commit', r => { r.lineageEvidence.sourceCommitSha = 'b'.repeat(40); }],
  ['stale main before', r => { r.lineageEvidence.liveMainBeforeSha = 'b'.repeat(40); }],
  ['main advanced during capture', r => { r.lineageEvidence.liveMainAfterSha = 'b'.repeat(40); }],
  ['behind main', r => { r.lineageEvidence.comparison.behindBy = 1; }],
  ['diverged lineage', r => { r.lineageEvidence.comparison.status = 'diverged'; }],
  ['no ahead commit', r => { r.lineageEvidence.comparison.aheadBy = 0; }],
  ['wrong merge base', r => { r.lineageEvidence.comparison.mergeBaseCommitSha = 'b'.repeat(40); }],
  ['wrong comparison base', r => { r.lineageEvidence.comparison.baseCommitSha = 'b'.repeat(40); }],
  ['two-path escalation', r => { r.analysis.findings.pop(); r.analysis.counts.P0 = 2; }],
  ['extra finding', r => { r.analysis.findings.push({ ...r.analysis.findings[0], path: 'scripts/windows/extra.ps1' }); r.analysis.counts.P0 = 4; }],
  ['duplicate finding', r => { r.analysis.findings[2] = r.analysis.findings[1]; }],
  ['unrelated high-risk path', r => { r.analysis.findings[2].path = 'scripts/windows/other.cs'; }],
  ['additional P1', r => { r.analysis.counts.P1 = 1; }],
  ['additional P2', r => { r.analysis.counts.P2 = 1; }],
  ['incorrect count', r => { r.analysis.counts.P0 = 2; }],
  ['different severity', r => { r.analysis.findings[0].severity = 'P1'; }],
  ['different escalation code', r => { r.analysis.findings[0].code = 'unrelated'; }],
]) test(`#3551 refuses ${name}`, () => {
  const row = closureInput(); mutate(row); rejectInput(row);
});

test('plain-data admission rejects getters, proxies, sparse arrays and array extras without invoking code', () => {
  let invoked = 0;
  const accessor = (object, key) => Object.defineProperty(object, key, {
    enumerable: true, get() { invoked += 1; throw new Error('must not run'); },
  });
  for (const row of [null, [], new Proxy({}, { get() { invoked += 1; throw new Error('must not run'); } }),
    accessor({}, 'repository')]) rejectInput(row);
  for (const mutate of [
    r => { r.analysis = accessor({}, 'findings'); },
    r => { r.analysis.counts = accessor({}, 'P0'); },
    r => { r.analysis.findings = new Proxy(r.analysis.findings, { get() { invoked += 1; throw new Error('must not run'); } }); },
    r => { delete r.analysis.findings[1]; },
    r => { r.analysis.findings.extra = 1; },
    r => { accessor(r.analysis.findings, '0'); },
    r => { r.lineageEvidence = accessor({}, 'comparison'); },
  ]) { const row = closureInput(); mutate(row); rejectInput(row); }
  for (const mutate of [
    r => { r.sources = new Proxy(r.sources, { get() { invoked += 1; throw new Error('must not run'); } }); },
    r => { delete r.sources[0]; },
    r => { r.sources.extra = 1; },
    r => { accessor(r.sources, '0'); },
    r => { r.sources[0] = accessor({}, 'path'); },
    r => { r.sources[0] = new Proxy({}, { get() { invoked += 1; throw new Error('must not run'); } }); },
  ]) {
    const row = closureInput(); mutate(row);
    const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(row);
    assert.equal(result.clean, false); noAuthority(result);
  }
  assert.equal(invoked, 0);
});

for (const [name, mutate] of [
  ['missing source', r => { r.sources.pop(); }],
  ['extra source', r => { r.sources.push({ ...r.sources[0], path: 'scripts/windows/other.ps1' }); }],
  ['duplicate source', r => { r.sources[2] = r.sources[1]; }],
  ['wrong source ref', r => { r.sources[0].ref = 'b'.repeat(40); }],
  ['wrong source repository', r => { r.sources[0].repository = 'other/stephan-os'; }],
  ['wrong source schema', r => { r.sources[0].schemaVersion = 'other'; }],
  ['absent source', r => { r.sources[0].exists = false; }],
  ['false declared size', r => { r.sources[0].size += 1; }],
  ['oversized source', r => { r.sources[0].content = 'x'.repeat(256 * 1024 + 1); r.sources[0].size = r.sources[0].content.length; }],
  ['forged supplied blob', r => { r.sources[0].blobSha = 'b'.repeat(40); }],
  ['changed bytes with old pin', r => { r.sources[0].content += '\n'; r.sources[0].size += 1; }],
  ['legacy blob in current profile', r => { r.sources[0] = structuredClone(LEGACY_SOURCES[0]); }],
]) test(`#3551 refuses ${name} evidence`, () => {
  const row = closureInput(); mutate(row);
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(row);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(f => f.code === 'fixed-runtime-specialist-exact-source-not-pinned'));
  assert.ok(result.proofRefs.length < 3);
  noAuthority(result);
});

test('legacy profile does not accept the new sources or three-path escalation', () => {
  const wrongBytes = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input({ sources: CURRENT_SOURCES.slice(0, 2) }));
  assert.equal(wrongBytes.clean, false);
  assert.equal(wrongBytes.proofRefs.length, 0);
  const wrongEstate = closureInput(); wrongEstate.prNumber = 3362;
  rejectInput(wrongEstate);
});

// Each mutation carries its accurately recomputed Git identity. Both exact-pin
// refusal and the independent semantic reason must fire; no test substitutes a
// different trusted pin or enables a diagnostic-only qualification API.
for (const [name, path, before, after, code] of [
  ['installer unbounded members', INSTALLER, '.Records.Count -gt 302', '.Records.Count -gt 999', 'installer-closure-bound'],
  ['installer arbitrary OC2 filename', INSTALLER, 'oc2-(?:deterministic-test-build|gateway-provider)', 'oc2-[A-Za-z0-9-]+', 'installer-exact-integration-membership'],
  ['installer removing OC2 member', INSTALLER, 'oc2-(?:deterministic-test-build|gateway-provider)', 'oc2-gateway-provider', 'installer-exact-integration-membership'],
  ['installer approval removed', INSTALLER, 'if(-not $OperatorApproved -or', 'if($false -or', 'installer-exact-main-gate'],
  ['installer source head unbound', INSTALLER, '$bootstrap.SourceHead -cne $ExpectedMain', '$false', 'installer-bootstrap-head-binding'],
  ['installer operator unbound', INSTALLER, '$identity.User.Value -cne $bootstrap.OperatorSid', '$false', 'installer-operator-identity'],
  ['installer writable operator', INSTALLER, "$operator,'ReadAndExecute'", "$operator,'FullControl'", 'installer-operator-read-only'],
  ['installer overwrite pending proof', INSTALLER, "[IO.FileStream]::new($pendingPath,'CreateNew'", "[IO.FileStream]::new($pendingPath,'Create'", 'installer-pending-create-only'],
  ['installer network addition', INSTALLER, '', '\nInvoke-WebRequest https://invalid.example/\n', 'installer-network-authority'],
  ['installer restart addition', INSTALLER, '', '\nRestart-Computer\n', 'installer-shell-or-restart-authority'],
  ['identity excessive member bound', IDENTITY, 'RuntimeSourceMemberLimitV1 = 302;', 'RuntimeSourceMemberLimitV1 = 303;', 'identity-closure-bound'],
  ['identity OC2 removal', IDENTITY, 'row.Path=="integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs" ||', '', 'identity-exact-integration-membership'],
  ['identity arbitrary integration root', IDENTITY, '^(scripts|shared|stephanos-server)/', '^(scripts|shared|stephanos-server|integrations)/', 'identity-exact-integration-membership'],
  ['identity removing normal operator', IDENTITY, 'if(principal.User.Value!=pending.OperatorSid ||', 'if(false ||', 'identity-normal-operator-binding'],
  ['identity dropping later boot', IDENTITY, 'return compiled<installed && installed<boot && boot<now;', 'return compiled<installed;', 'identity-later-boot-order'],
  ['identity dropping Git member pin', IDENTITY, 'else if(leaf.Mode!=row.GitMode || leaf.Sha!=row.GitBlobSha)', 'else if(false)', 'identity-git-member-binding'],
  ['identity dropping protected closure', IDENTITY, 'pending.GitClosureSha256!=source.Closure)', 'false)', 'identity-protected-closure-binding'],
  ['identity process launch', IDENTITY, '', '\nProcess.Start("cmd.exe");\n', 'identity-process-authority'],
  ['identity filesystem mutation', IDENTITY, '', '\nFile.WriteAllText("file", "data");\n', 'identity-filesystem-mutation'],
  ['mobile path count changed', MOBILE, 'ExpectedPathCount=302;', 'ExpectedPathCount=303;', 'mobile-path-count'],
  ['mobile fixed path set changed', MOBILE, '62dd881fd8f0a25dbc26f73c4750d3be047960acaccc8577e0f7a2c8220973f9', '0'.repeat(64), 'mobile-path-set-pin'],
  ['mobile execution authority enabled', MOBILE, 'ExecutionAuthorityGranted=false,', 'ExecutionAuthorityGranted=true,', 'mobile-no-qualification-authority'],
  ['mobile enrollment qualification enabled', MOBILE, 'EnrollmentQualified=false,', 'EnrollmentQualified=true,', 'mobile-no-qualification-authority'],
  ['mobile accepting wrong content', MOBILE, 'Hash(content)!=sha || GitBlob(content)!=blob', 'false', 'mobile-member-byte-binding'],
  ['mobile omitting package membership', MOBILE, 'if(PathSet(paths)!=ExpectedPathSetSha256 || closure==null)', 'if(closure==null)', 'mobile-exact-package-path-set'],
  ['mobile omitting target machine', MOBILE, 'pin["machineHash"]!=expectedMachine ||', '', 'mobile-target-binding'],
  ['mobile duplicate JSON accepted', MOBILE, 'if(row.ContainsKey(key) || row.Count>=8)', 'if(row.Count>=8)', 'mobile-duplicate-json-denial'],
  ['mobile lexical ACL substitution', MOBILE, 'GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)', 'GetNamedSecurityInfo(path)', 'mobile-handle-bound-acl'],
  ['mobile changed retained read bound', MOBILE, 'if(file.ReadByte()!=-1 || file.Length!=size)', 'if(false)', 'mobile-retained-handle-read-bound'],
  ['mobile native process launch', MOBILE, '', '\nCreateProcessW();\n', 'mobile-process-authority'],
  ['mobile network addition', MOBILE, '', '\nnew HttpClient();\n', 'mobile-network-authority'],
]) test(`#3551 semantic refusal: ${name}`, () => {
  const row = closureInput();
  const source = row.sources.find(s => s.path === path);
  assert.ok(!before || source.content.includes(before), `fixture mutation not found: ${before}`);
  source.content = before ? source.content.replace(before, after) : source.content + after;
  source.size = Buffer.byteLength(source.content, 'utf8');
  source.blobSha = gitBlob(source.content);
  const result = analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(row);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(f => f.path === path && f.code === 'fixed-runtime-specialist-exact-source-not-pinned'));
  assert.ok(result.findings.some(f => f.path === path && f.code === `fixed-runtime-3551-${code}`), JSON.stringify(result.findings));
  assert.equal(result.proofRefs.length, 2);
  assert.ok(!result.proofRefs.some(ref => ref.includes(path)));
  noAuthority(result);
});
