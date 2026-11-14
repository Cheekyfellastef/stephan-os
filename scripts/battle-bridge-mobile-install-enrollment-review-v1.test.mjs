import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prepareMobileInstallEnrollmentReviewV1, MOBILE_ENROLLMENT_REVIEW_INPUT_V1 }
  from './battle-bridge-mobile-install-enrollment-review-v1.mjs';
import { FIXED_RUNTIME_SOURCE_PATHS_V1 } from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import { makeFixedRuntimeSourceProofFixtureV1 } from './fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = FIXED_RUNTIME_SOURCE_PATHS_V1.map(path => ({ path,
  content: readFileSync(new URL('../' + path, import.meta.url)) }));
const fixture = makeFixedRuntimeSourceProofFixtureV1({ files });
const sourceInput = { schemaVersion: 'stephanos.fixed-runtime-source-package-input.v1',
  repository: 'Cheekyfellastef/stephan-os',
  commit: { sha: fixture.head, contentBase64: fixture.commit.bytes.toString('base64') },
  trees: [...fixture.trees].map(([sha, bytes]) => ({ sha, contentBase64: bytes.toString('base64') })),
  records: files.map(row => ({ path: row.path,
    blobSha: createHash('sha1').update('blob ' + row.content.length + '\0').update(row.content).digest('hex'),
    contentBase64: row.content.toString('base64') })),
};
const input = { schemaVersion: MOBILE_ENROLLMENT_REVIEW_INPUT_V1, sourceInput,
  expectedMain: fixture.head, sourceTree: fixture.tree, operatorSid: 'S-1-5-21-1-2-3-1001',
  machineHash: 'a'.repeat(64), enrollmentGeneration: 1,
  releaseEvidenceBase64: Buffer.from('{"synthetic":true,"qualified":true}').toString('base64') };
const prepare = value => prepareMobileInstallEnrollmentReviewV1(JSON.stringify(value));

test('exact immutable package becomes fixed protected-location review data, never enrollment authority', () => {
  const result = prepare(input);
  assert.equal(result.installability, 'NOT_INSTALLABLE');
  assert.deepEqual(Object.values(result.authority), Array(10).fill(false));
  assert.equal(result.containsPrivateOperatorIdentity, true);
  assert.deepEqual(result.privateFiles.map(row => row.name),
    ['release.pin', 'runtime-package.json', 'runtime-bootstrap.ps1', 'release-evidence.json']);
  for (const row of result.privateFiles) {
    const data = Buffer.from(row.contentBase64, 'base64');
    assert.equal(data.length, row.bytes); assert.equal(sha(data), row.sha256);
  }
  const permit = Buffer.from(result.privateFiles[0].contentBase64, 'base64').toString('ascii');
  const script = Buffer.from(result.privateFiles[2].contentBase64, 'base64').toString('utf8');
  assert.ok(script.includes("$path='C:\\Program Files\\Stephanos\\SovereignMobileInstallerV1\\runtime-package.json'"));
  assert.equal(script.includes('AppData\\Local\\Temp\\StephanosFixedRuntimeInstall-'), false);
  assert.ok(script.includes('FIXED_BOOTSTRAP_SOURCE_IDENTITY_CHANGED'));
  assert.ok(script.includes('FIXED_BOOTSTRAP_ENTRY_CHANGED'));
  assert.ok(script.includes('-OperatorApproved -ExpectedMain'));
  assert.ok(permit.includes('packageSha256=' + result.privateFiles[1].sha256));
  assert.ok(permit.includes('bootstrapSha256=' + result.privateFiles[2].sha256));
  assert.ok(permit.includes('releaseProofSha256=' + result.privateFiles[3].sha256));
  assert.ok(result.requiredGates.includes('AUTHENTICATED_PROTECTED_REVIEW_MERGE_EVIDENCE'));
  assert.ok(Object.isFrozen(result.privateFiles[0]));
});

test('caller paths, approval fields, invalid binding and malformed evidence cannot widen the review surface', () => {
  for (const change of [{ path: 'C:\\other' }, { operatorApproved: true }, { machineHash: ['a'.repeat(64)] },
    { enrollmentGeneration: 0 }, { enrollmentGeneration: 1.5 }, { releaseEvidenceBase64: '' },
    { releaseEvidenceBase64: 'YQ===' }, { releaseEvidenceBase64: Buffer.from([0xff]).toString('base64') },
    { expectedMain: 'f'.repeat(40) }, { sourceTree: 'f'.repeat(40) }, { operatorSid: 'S-1-5-18' }]) {
    assert.throws(() => prepare({ ...input, ...change }));
  }
  assert.throws(() => prepareMobileInstallEnrollmentReviewV1({ approved: true }));
  assert.throws(() => prepareMobileInstallEnrollmentReviewV1('x'.repeat(16 * 1024 * 1024 + 1)));
});

test('source payload and review-evidence movement change exact permit identity independently', () => {
  const before = prepare(input);
  const after = prepare({ ...input, releaseEvidenceBase64: Buffer.from('{"synthetic":2}').toString('base64') });
  assert.equal(before.privateFiles[1].sha256, after.privateFiles[1].sha256);
  assert.equal(before.privateFiles[2].sha256, after.privateFiles[2].sha256);
  assert.notEqual(before.privateFiles[0].sha256, after.privateFiles[0].sha256);
  assert.notEqual(before.privateFiles[3].sha256, after.privateFiles[3].sha256);
  assert.deepEqual(before.authority, after.authority);
});
