// Windows source/algorithm proof only; no installed host, production key,
// enrollment, mailbox, original guard or native authority is exercised.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { encodeMailboxNativeEvidenceV2, decodeMailboxNativeEvidenceV2,
  mailboxNativeEvidenceSignatureInputV2, MAILBOX_NATIVE_EVIDENCE_DOMAIN_V2 as domain
} from '../../../../shared/agents/canonicalMailboxNativeEvidenceCodecV2.mjs';
import { verifyMailboxNativeEvidenceOriginV2 as productionVerify } from '../../../../shared/agents/canonicalMailboxNativeEvidenceVerifierV2.mjs';
import { MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2, MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2 } from '../../../../shared/agents/canonicalMailboxNativeEvidenceEnrollmentV2.mjs';

assert.equal(process.platform, 'win32', 'This proof requires real Windows native handle reads; no skipped substitute.');
const here = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'stephanos-mailbox-native-test-'));
after(() => {
  assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
  assert.match(basename(scratch), /^stephanos-mailbox-native-test-[A-Za-z0-9]+$/);
  rmSync(scratch, { recursive: true, force: true });
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const packagePath = process.env.STEPHANOS_MAILBOX_TEST_BC_PACKAGE;
assert(packagePath, 'Set test-only STEPHANOS_MAILBOX_TEST_BC_PACKAGE to official pinned 2.7.0 nupkg; never a production signer option.');
assert.equal(hash(readFileSync(packagePath)), 'f091ffccab4d03993e660bace277659a79dee0972f54d7f1f4bd46d680966241');
const dll = join(scratch, 'BouncyCastle.Cryptography.dll');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const extract = spawnSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.IO.Compression.FileSystem; $a=[IO.Compression.ZipFile]::OpenRead(' + literal(resolve(packagePath))
  + '); try {$e=$a.GetEntry("lib/net461/BouncyCastle.Cryptography.dll"); if($null -eq $e){throw "missing pinned asset"};'
  + '$s=$e.Open(); $f=[IO.File]::Create(' + literal(dll) + '); try {$s.CopyTo($f)} finally {$s.Dispose();$f.Dispose()}} finally {$a.Dispose()}'
], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
assert.equal(extract.status, 0, extract.stderr);
assert.equal(hash(readFileSync(dll)), '4f96977e9c67334742c683410b3a361258219f0d3084a5e0bc10fba96cf23a0d');
const exe = join(scratch, 'MailboxNativeEvidenceInteropFixture.exe');
const compile = spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', [
  '/nologo', '/warnaserror+', '/target:exe', '/r:' + dll, '/r:System.Web.Extensions.dll', '/out:' + exe,
  resolve(here, '../CanonicalMailboxNativeEvidenceProducer.cs'), resolve(here, 'NativeEvidenceInteropFixture.cs')
], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
assert.equal(compile.status, 0, compile.stdout + compile.stderr);

// Public RFC8032 test vector #1, not an operational private key.
const publicSeed = Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex');
const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), publicSeed]), type: 'pkcs8', format: 'der' });
const publicKey = createPublicKey(privateKey);
const spki = publicKey.export({ type: 'spki', format: 'der' });
assert.equal(spki.subarray(12).toString('hex'), 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
const pem = publicKey.export({ type: 'spki', format: 'pem' });
const seedFile = join(scratch, 'PUBLIC-RFC8032-seed.bin'), payloadFile = join(scratch, 'synthetic-payload.json');
const sha = char => char.repeat(64), git = char => char.repeat(40), iso = ms => new Date(ms).toISOString();
function payload() {
  const now = Date.now();
  return { kind: 'DRAIN_OBSERVATION', repository: 'Cheekyfellastef/stephan-os', deviceIdSha256: sha('a'),
    producerId: 'isolated-fixture-producer', producerPrincipalSha256: sha('b'), producerProfileSha256: sha('c'),
    requestId: 'isolated-fixture-request', transitionId: 'isolated-fixture-transition', phase: 'FROZEN', result: 'DONE',
    origin: { kind: 'ACTIVATION_PR_OWNER_CONTROL_V2', prNumber: 3268, commentId: 123, commentBodySha256: sha('f'), createdAtUtc: iso(now - 5000) },
    source: { protectedMainHead: git('a'), protectedMainTreeSha: git('b'), installedHead: git('a'), installedTreeSha: git('b'),
      installedClosureSha256: sha('1'), sourceRole: 'PREPARATION' },
    activation: { prNumber: 3268, headSha: git('c'), baseSha: git('a'), treeSha: git('d'), mergeCommitSha: null },
    epoch: { predecessorIssue: 3149, successorIssue: 3258 },
    barrier: { highestCommandCommentId: 1, inventorySha256: sha('2'), commentCount: 2500 },
    guard: { generationId: 'isolated-fixture-generation', ownerInstanceId: 'isolated-fixture-owner', transactionSha256: sha('3') },
    drain: { acceptedCount: 0, inlinePublicationCount: 0, segmentedPublicationCount: 0, ordinaryReceiptDebtCount: 0,
      historyPendingBeforeCount: 0, historyPendingAfterCount: 0, orphanAcceptedCount: 0,
      actionPendingAggregateCount: 0, actionBlockingCount: 0, outboxInventorySha256: sha('4'),
      actionsInventorySha256: sha('5'), actionsObservedAtUtc: iso(now - 3000) },
    originalTerminalSha256: sha('6'), proofArtifactSha256: sha('7'), observedAtUtc: iso(now - 2000), expiresAtUtc: iso(now + 118000) };
}
function run(p = payload(), mode = 'emit', pins = [hash(spki), hash(pem)], seed = publicSeed) {
  writeFileSync(seedFile, seed); writeFileSync(payloadFile, JSON.stringify(p));
  return spawnSync(exe, [mode, seedFile, payloadFile, ...pins], { windowsHide: true, timeout: 10000 });
}
function held(p, pattern) {
  const result = run(p);
  assert.equal(result.status, 42);
  assert.equal(result.stdout.length, 0, 'refusal must emit no signed artifact');
  assert.match(result.stderr.toString(), pattern);
}
for (const kind of ['CONTROL_TERMINAL', 'DRAIN_OBSERVATION']) {
  test('native ' + kind + ' exactly matches canonical Node framing, envelope and Ed25519', () => {
    const p = payload(); p.kind = kind;
    const result = run(p); assert.equal(result.status, 0, result.stderr.toString());
    const decoded = decodeMailboxNativeEvidenceV2(result.stdout);
    assert.deepEqual(JSON.parse(JSON.stringify(decoded.envelope.payload)), p);
    assert.deepEqual(encodeMailboxNativeEvidenceV2(decoded.envelope), result.stdout);
    assert(verify(null, mailboxNativeEvidenceSignatureInputV2(p), publicKey, Buffer.from(decoded.envelope.signatureBase64, 'base64')));
    const wrongDomain = Buffer.concat([Buffer.from('capacity\0'), mailboxNativeEvidenceSignatureInputV2(p).subarray(Buffer.byteLength(domain) + 1)]);
    assert.equal(verify(null, wrongDomain, publicKey, Buffer.from(decoded.envelope.signatureBase64, 'base64')), false);
    assert.equal(productionVerify(result.stdout).blocker, 'NATIVE_ROTATION_PRODUCER_UNQUALIFIED');
  });
}
test('native output reaches the EXACT existing origin verifier with an isolated public fixture enrollment', async () => {
  const p = payload(), now = Date.now();
  const record = { schemaVersion: 'stephanos.canonical-mailbox-native-enrollment.v2',
    enrollmentId: 'isolated-fixture-enrollment', repository: p.repository, deviceIdSha256: p.deviceIdSha256,
    producerId: p.producerId, producerPrincipalSha256: p.producerPrincipalSha256, producerProfileSha256: p.producerProfileSha256,
    keyId: 'isolated-fixture-key', algorithm: 'Ed25519', verificationKeySpkiSha256: hash(spki), verificationKeyArtifactSha256: hash(pem),
    signatureDomain: domain, allowedEvidenceKinds: ['CONTROL_TERMINAL', 'DRAIN_OBSERVATION'], commissionedAtUtc: iso(now - 86400000),
    notBeforeUtc: iso(now - 86400000), revokedAtUtc: null, commissioningProofSha256: sha('d'), independentReviewArtifactSha256: sha('e'),
    operatorApprovalRef: 'https://github.com/Cheekyfellastef/stephan-os/issues/2315#issuecomment-123' };
  const registry = 'export const MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2=' + JSON.stringify([record])
    + ';export const MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2=' + JSON.stringify({ [record.keyId]: pem }) + ';';
  const verifierUrl = new URL('../../../../shared/agents/canonicalMailboxNativeEvidenceVerifierV2.mjs', import.meta.url);
  const source = readFileSync(verifierUrl, 'utf8')
    .replace("'./canonicalMailboxNativeEvidenceEnrollmentV2.mjs'", JSON.stringify('data:text/javascript;base64,' + Buffer.from(registry).toString('base64')))
    .replace("'./canonicalMailboxNativeEvidenceCodecV2.mjs'", JSON.stringify(new URL('../../../../shared/agents/canonicalMailboxNativeEvidenceCodecV2.mjs', import.meta.url).href));
  const isolated = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const output = run(p); assert.equal(output.status, 0, output.stderr.toString());
  const result = isolated.verifyMailboxNativeEvidenceOriginV2(output.stdout);
  assert.equal(result.signatureVerified, true); assert.equal(result.producerEnrollmentVerified, true);
  assert.equal(result.blocker, 'ORIGINAL_GUARDED_TRANSACTION_PROOF_REQUIRED');
  for (const name of ['nativeAuthorityVerified', 'freezeCertified', 'mergeAuthorized', 'sourceSyncAuthorized']) assert.equal(result[name], false);
  assert.deepEqual(MAILBOX_NATIVE_EVIDENCE_ENROLLMENTS_V2, []);
  assert.deepEqual(MAILBOX_NATIVE_EVIDENCE_PUBLIC_ARTIFACTS_V2, {});
});
const base = payload();
for (const [section, object] of [['root', base], ...Object.entries(base).filter(([, v]) => v && typeof v === 'object')]) {
  for (const field of Object.keys(object)) {
    test('native closed schema rejects missing ' + section + '.' + field, () => {
      const p = payload(); delete (section === 'root' ? p : p[section])[field];
      held(p, /CLOSED_SCHEMA_REQUIRED/);
    });
  }
  test('native closed schema rejects added ' + section + ' authority', () => {
    const p = payload(); (section === 'root' ? p : p[section]).arbitrarySigningAllowed = true;
    held(p, /CLOSED_SCHEMA_REQUIRED/);
  });
}
for (const [name, change, pattern] of [
  ['kind', p => { p.kind = 'SIGN_ANYTHING'; }, /KIND_INVALID/],
  ['repository', p => { p.repository = 'Other/repo'; }, /REPOSITORY_INVALID/],
  ['principal', p => { p.producerPrincipalSha256 = sha('d'); }, /PRODUCER_IDENTITY_MISMATCH/],
  ['profile', p => { p.producerProfileSha256 = sha('d'); }, /PRODUCER_IDENTITY_MISMATCH/],
  ['device', p => { p.deviceIdSha256 = sha('d'); }, /PRODUCER_IDENTITY_MISMATCH/],
  ['producer', p => { p.producerId = 'caller'; }, /PRODUCER_IDENTITY_MISMATCH/],
  ['unsafe integer', p => { p.barrier.commentCount = 9007199254740992; }, /SAFE_INTEGER_REQUIRED/],
  ['float', p => { p.drain.acceptedCount = 0.5; }, /SAFE_INTEGER_REQUIRED/],
  ['negative', p => { p.drain.acceptedCount = -1; }, /SAFE_INTEGER_REQUIRED/],
  ['numeric string', p => { p.drain.acceptedCount = '0'; }, /SAFE_INTEGER_REQUIRED/],
  ['unicode', p => { p.requestId = 'request-é'; }, /ID_INVALID/],
  ['invalid timestamp', p => { p.expiresAtUtc = '2026-02-30T00:00:00.000Z'; }, /TIME_INVALID/],
  ['future observation', p => { p.observedAtUtc = iso(Date.now() + 100000); }, /OBSERVATION_NOT_FRESH/],
  ['expired observation', p => { p.observedAtUtc = iso(Date.now() - 120001); }, /OBSERVATION_NOT_FRESH/],
  ['excess TTL', p => { p.expiresAtUtc = iso(Date.parse(p.observedAtUtc) + 120001); }, /OBSERVATION_NOT_FRESH/],
  ['future actions', p => { p.drain.actionsObservedAtUtc = iso(Date.now() + 1000); }, /OBSERVATION_NOT_FRESH/],
  ['same epoch', p => { p.epoch.successorIssue = p.epoch.predecessorIssue; }, /EPOCH_INVALID/]
]) test('native rejects ' + name + ' before emitting a signature', () => { const p = payload(); change(p); held(p, pattern); });
for (const mode of ['mutate', 'truncate', 'dispose', 'poison']) {
  test('retained native material ' + mode + ' poisons and clears the session permanently', () => {
    const p = payload(); if (mode === 'poison') p.kind = 'SIGN_ANYTHING';
    const result = run(p, mode);
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), 'CLOSED_AND_ZEROED');
  });
}
test('public SPKI and exact public artifact pins are both required', () => {
  for (const pins of [[sha('0'), hash(pem)], [hash(spki), sha('0')]]) {
    const result = run(payload(), 'emit', pins);
    assert.equal(result.status, 42); assert.equal(result.stdout.length, 0);
    assert.match(result.stderr.toString(), /PUBLIC_KEY_DOUBLE_PIN_MISMATCH/);
  }
});
test('wrong retained seed size fails before signing', () => {
  const result = run(payload(), 'emit', undefined, Buffer.alloc(31));
  assert.equal(result.status, 42); assert.equal(result.stdout.length, 0);
  assert.match(result.stderr.toString(), /RETAINED_MATERIAL_SIZE_OR_HANDLE/);
});
