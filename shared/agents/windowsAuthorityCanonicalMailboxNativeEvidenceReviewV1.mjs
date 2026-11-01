import { createHash } from 'node:crypto';
import { types } from 'node:util';

// Trusted-main source-only specialist for the EXISTING #2315 / PR #3302.
// This does not create/enrol a key, certify a native host, freeze a mailbox,
// permit a merge or grant a phase/epoch transition.
export const WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1 = Object.freeze([
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/CanonicalMailboxNativeEvidenceProducer.cs',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/README.md',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/Stephanos.CanonicalMailboxNativeEvidence.csproj',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/THIRD_PARTY_NOTICES.txt',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/packages.lock.json',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/tests/NativeEvidenceInteropFixture.cs',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/tests/native-producer.test.mjs',
]);

export const WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_BLOBS_V1 = Object.freeze({
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/CanonicalMailboxNativeEvidenceProducer.cs': 'ceb159cf56226908f927f2a0439b9bec3f27dadf',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/README.md': '256bfedc12d3205dfcbabc49f5f3d452070009d7',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/Stephanos.CanonicalMailboxNativeEvidence.csproj': 'f5aab4893a854cd4c5c6cd47e9f6550072978eee',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/THIRD_PARTY_NOTICES.txt': '1f0172c5b42e09e809d0c43f4c8393fdd1ade4f5',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/packages.lock.json': 'f683c8a7261f5af62ae99eb0641ad6eb10a6a3da',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/tests/NativeEvidenceInteropFixture.cs': '03fbdce86067869f5e0e99abd11f8672de7f8574',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/tests/native-producer.test.mjs': '15b63c82c87970effd535320228939f253f3ad15',
});

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const TARGET_PR = 3302;
const BRANCH = 'codex/2315-saturated-rotation-control-v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA40 = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const count = WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1.length;
const denial = Object.freeze({
  sourceMutationAllowed: false,
  mergeAuthority: false,
  runtimeMutationAllowed: false,
  providerQualificationAuthority: false,
  nativeProducerQualified: false,
  nativeEvidenceAuthenticated: false,
  freezeCertified: false,
  epochAdoptionAuthorized: false,
  arbitraryExecutionAllowed: false,
});

const text = v => typeof v === 'string' ? v.trim() : '';
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });
const pinned = (v, expected) => typeof v === 'string' && v.includes(expected);

function plain(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || types.isProxy(o)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(o))) return false;
  return Reflect.ownKeys(o).every(k => {
    const d = Object.getOwnPropertyDescriptor(o, k);
    return typeof k === 'string' && d && Object.hasOwn(d, 'value') && d.enumerable;
  });
}

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function exactEscalation(a) {
  if (!plain(a) || !plain(a.counts) || !Array.isArray(a.findings)
      || a.findings.length !== count || a.counts.P0 !== count
      || a.counts.P1 !== 0 || a.counts.P2 !== 0) return false;
  const expected = new Set(WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1);
  const paths = [];
  for (const f of a.findings) {
    if (!plain(f) || text(f.severity).toUpperCase() !== 'P0'
        || f.code !== 'unsupported-high-risk-surface'
        || !expected.has(text(f.path))) return false;
    paths.push(f.path);
  }
  return new Set(paths).size === count;
}

function exactLineage(l, head, base) {
  if (!plain(l) || !plain(l.comparison) || !Array.isArray(l.parents)
      || l.schemaVersion !== LINEAGE_SCHEMA || l.repository !== REPOSITORY
      || l.sourceHead !== head || l.sourceCommitSha !== head
      || l.baseSha !== base || l.liveMainBeforeSha !== base
      || l.liveMainAfterSha !== base) return false;
  const c = l.comparison;
  return c.status === 'ahead' && Number.isSafeInteger(c.aheadBy)
    && c.aheadBy >= 1 && c.behindBy === 0 && c.baseCommitSha === base
    && c.mergeBaseCommitSha === base && l.parents.every(p => SHA40.test(p));
}

function exactSource(source, head, path) {
  if (!plain(source) || source.schemaVersion !== SOURCE_SCHEMA
      || source.repository !== REPOSITORY || source.path !== path
      || source.ref !== head || source.exists !== true) return false;
  const body = source.content;
  const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : 0;
  return size > 0 && size <= MAX_SOURCE_BYTES
    && Number.isSafeInteger(source.size) && source.size === size
    && SHA40.test(source.blobSha) && source.blobSha === blobSha(body)
    && source.blobSha === WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_BLOBS_V1[path];
}

function sourceOnlySafeguards(path, source) {
  const checks = new Map([
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[0], [
      'internal sealed class NativeEvidenceSigningSession : IDisposable',
      'internal const string Domain = "stephanos.canonical-mailbox-native-evidence.v2";',
      'private byte[] FreshRead()', 'private void EnsureUnchanged()',
      'Ed.Sign(owned, 0, message', 'Ed.Verify(signature, 0, pub',
      'if (material == null || !material.CanRead || material.CanWrite || !material.CanSeek)',
    ]],
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[1], [
      'No production import factory, host registration, installer or enrollment writer',
      'Production enrollment remains empty',
      'a Framework fixture build',
      'does not claim a .NET 8 build',
    ]],
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[2], [
      '<TargetFramework>net8.0-windows</TargetFramework>',
      '<EnableDefaultCompileItems>false</EnableDefaultCompileItems>',
      '<RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>',
      '<TreatWarningsAsErrors>true</TreatWarningsAsErrors>',
      '<Compile Include="CanonicalMailboxNativeEvidenceProducer.cs" />',
      '<PackageReference Include="BouncyCastle.Cryptography" Version="[2.7.0]" />',
    ]],
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[3], [
      'MIT License', 'Bouncy Castle',
    ]],
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[4], [
      '"BouncyCastle.Cryptography"', '"resolved": "2.7.0"',
    ]],
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[5], [
      'TEST EXECUTABLE ONLY', 'isolated-fixture-enrollment',
      'TEST_PROVIDER_PIN', 'TEST_OWNED_BYTES_NOT_ZERO',
    ]],
    [WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[6], [
      "assert.equal(process.platform, 'win32'",
      'STEPHANOS_MAILBOX_TEST_BC_PACKAGE',
      'MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2',
      'f091ffccab4d03993e660bace277659a79dee0972f54d7f1f4bd46d680966241',
    ]],
  ]);
  const required = checks.get(path) || [];
  return required.every(snippet => pinned(source, snippet));
}

export function analyzeWindowsAuthorityCanonicalMailboxNativeEvidenceReviewV1(input = {}) {
  const head = text(input.sourceHead).toLowerCase();
  const base = text(input.baseSha).toLowerCase();
  const eligible = plain(input) && input.repository === REPOSITORY
    && input.prNumber === TARGET_PR && input.branch === BRANCH
    && SHA40.test(head) && SHA40.test(base) && head !== base
    && exactEscalation(input.analysis) && exactLineage(input.lineageEvidence, head, base);
  if (!eligible) return Object.freeze({
    eligible: false, clean: false, reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]), proofRefs: Object.freeze([]), ...denial,
    finalVerdict: 'WINDOWS_AUTHORITY_MAILBOX_NATIVE_SPECIALIST_NOT_APPLICABLE',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [], proofRefs = [], byPath = new Map();
  for (const source of sources) {
    const path = plain(source) ? text(source.path) : '';
    if (!Object.hasOwn(WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_BLOBS_V1, path)
        || byPath.has(path)) {
      findings.push(finding('mailbox-native-source-estate-widened', path));
      continue;
    }
    byPath.set(path, source);
  }
  if (sources.length !== count) findings.push(finding('mailbox-native-source-estate-widened', WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1[0]));

  for (const path of WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1) {
    const src = byPath.get(path);
    if (!exactSource(src, head, path)) {
      findings.push(finding('mailbox-native-source-blob-mismatch', path));
      continue;
    }
    if (!sourceOnlySafeguards(path, src.content))
      findings.push(finding('mailbox-native-source-only-safety-invariant-missing', path));
    else proofRefs.push('source-only/windows-mailbox-native/' + path + '@' + head + '#' + src.blobSha + ':' + src.size);
  }
  const clean = findings.length === 0 && proofRefs.length === count;
  return Object.freeze({
    eligible: true, clean,
    reviewedPaths: WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    ...denial,
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_MAILBOX_NATIVE_SOURCE_ONLY_CLEAN'
      : 'WINDOWS_AUTHORITY_MAILBOX_NATIVE_SOURCE_ONLY_FINDINGS',
  });
}
