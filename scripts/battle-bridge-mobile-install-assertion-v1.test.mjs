import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';
import { mobileInstallationCandidateDigestV1, mobileInstallationChallengeV1,
  verifyMobileInstallationAssertionV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';

const NOW = '2026-11-14T15:00:00.000Z';
const nowMs = Date.parse(NOW);
const pair = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const device = pair(), receipt = pair(), wrongDevice = pair();
const spki = key => key.export({ type: 'spki', format: 'der' }).toString('base64url');
const hash = input => createHash('sha256').update(input).digest();
const clone = value => structuredClone(value);
const candidate = {
  schemaVersion: 'stephanos.battle-bridge-mobile-installation-candidate.v1',
  repository: 'Cheekyfellastef/stephan-os', issueNumber: 1814,
  action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1', requestId: 'mobile-install-native-fixture-1234',
  nonce: '1'.repeat(64), machineHash: '2'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1001',
  sourceHead: 'a'.repeat(40), sourceTree: 'b'.repeat(40), packageSha256: '3'.repeat(64),
  closureSha256: '4'.repeat(64), releaseProofSha256: '5'.repeat(64), enrollmentGeneration: 1,
  requestedAtUtc: '2026-11-14T14:59:00.000Z', expiresAtUtc: '2026-11-14T15:04:00.000Z',
};
const enrollment = {
  schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1',
  machineHash: candidate.machineHash, operatorSid: candidate.operatorSid, generation: 1,
  rpId: 'stephanos.example', origin: 'https://bridge.stephanos.example',
  credentialId: Buffer.alloc(24, 7).toString('base64url'), publicKeySpki: spki(device.publicKey),
  userHandle: Buffer.from('synthetic-fixture-operator').toString('base64url'),
  lastSignCount: 0, revoked: false, receiptPublicKeySpki: spki(receipt.publicKey),
};
function assertion(c = candidate, e = enrollment, { count = 1, flags = 5, client, auth,
  key = device.privateKey, userHandle = null } = {}) {
  const clientBytes = Buffer.isBuffer(client) ? client : Buffer.from(client ?? JSON.stringify({
    type: 'webauthn.get', challenge: mobileInstallationChallengeV1(c), origin: e.origin, crossOrigin: false,
  }));
  const authenticator = auth ?? Buffer.concat([hash(e.rpId), Buffer.from([flags]), Buffer.alloc(4)]);
  if (!auth) authenticator.writeUInt32BE(count, 33);
  return { type: 'public-key', id: e.credentialId, rawId: e.credentialId,
    response: { clientDataJSON: clientBytes.toString('base64url'),
      authenticatorData: authenticator.toString('base64url'),
      signature: sign('sha256', Buffer.concat([authenticator, hash(clientBytes)]), key).toString('base64url'), userHandle } };
}
function fixtures() {
  const rows = [];
  const add = (name, mutate = () => {}, valid = false, checkReference = true) => {
    const row = { name, candidate: clone(candidate), enrollment: clone(enrollment), assertion: assertion(),
      nowUtc: NOW, utcClock: true, valid, checkReference };
    mutate(row);
    const serialize = (key, rawKey) => row[rawKey] ?? JSON.stringify(row[key]);
    row.candidateJson = serialize('candidate', 'rawCandidate');
    row.enrollmentJson = serialize('enrollment', 'rawEnrollment');
    row.assertionJson = serialize('assertion', 'rawAssertion');
    if (checkReference && !row.rawCandidate && !row.rawEnrollment && !row.rawAssertion) {
      const reference = verifyMobileInstallationAssertionV1(row, { nowMs: Date.parse(row.nowUtc) });
      assert.equal(reference.ok, valid, `reference contract: ${name}`);
    }
    rows.push(row);
  };
  add('real Node signature', () => {}, true);
  add('nonzero advanced counter', r => { r.enrollment.lastSignCount = 8; r.assertion = assertion(r.candidate, r.enrollment, { count: 9 }); }, true);
  add('zero counter authenticator', r => { r.assertion = assertion(r.candidate, r.enrollment, { count: 0 }); }, true);
  add('maximum uint counter', r => { r.assertion = assertion(r.candidate, r.enrollment, { count: 0xffffffff }); }, true);
  add('bound user handle', r => { r.assertion.response.userHandle = r.enrollment.userHandle; }, true);
  add('omitted crossOrigin', r => { r.assertion = assertion(r.candidate, r.enrollment, { client: JSON.stringify({
    type: 'webauthn.get', challenge: mobileInstallationChallengeV1(r.candidate), origin: r.enrollment.origin }) }); }, true);
  for (const flags of [13, 29]) add(`backup flags ${flags}`, r => { r.assertion = assertion(r.candidate, r.enrollment, { flags }); }, true);
  add('maximum safe generation', r => { r.candidate.enrollmentGeneration = r.enrollment.generation = Number.MAX_SAFE_INTEGER;
    r.assertion = assertion(r.candidate, r.enrollment); }, true);
  add('canonical digest ignores input key order', r => { r.rawCandidate = JSON.stringify(Object.fromEntries(Object.entries(r.candidate).reverse())); }, true, false);
  add('JSON integer exponent preserves canonical digest', r => {
    r.rawCandidate = JSON.stringify(r.candidate).replace('"issueNumber":1814', '"issueNumber":1.814e3');
  }, true, false);
  add('wrong device signature', r => { r.assertion = assertion(r.candidate, r.enrollment, { key: wrongDevice.privateKey }); });
  for (const key of ['sourceHead', 'sourceTree', 'packageSha256', 'closureSha256', 'releaseProofSha256', 'nonce'])
    add(`candidate ${key} movement`, r => { r.candidate[key] = 'f'.repeat(r.candidate[key].length); });
  for (const key of ['machineHash', 'operatorSid', 'generation']) add(`enrollment ${key} mismatch`, r => {
    r.enrollment[key] = key === 'generation' ? 2 : key === 'operatorSid' ? 'S-1-5-21-1-2-3-1002' : '8'.repeat(64);
  });
  add('revoked enrollment', r => { r.enrollment.revoked = true; });
  add('expired candidate', r => { r.nowUtc = '2026-11-14T15:04:00.000Z'; });
  add('not yet issued candidate', r => { r.nowUtc = '2026-11-14T14:58:59.999Z'; });
  add('candidate lifetime over five minutes', r => { r.candidate.expiresAtUtc = '2026-11-14T15:04:00.001Z'; });
  add('equal candidate issue and expiry', r => { r.candidate.expiresAtUtc = r.candidate.requestedAtUtc; });
  add('different goal', r => { r.candidate.issueNumber = 1815; });
  add('different action', r => { r.candidate.action = 'RUN_ARBITRARY_COMMAND'; });
  add('fractional generation', r => { r.candidate.enrollmentGeneration = r.enrollment.generation = 1.5; });
  add('unsafe generation', r => { r.candidate.enrollmentGeneration = r.enrollment.generation = 2 ** 53; });
  add('noncanonical timestamp', r => { r.candidate.requestedAtUtc = '2026-11-14T14:59:00Z'; });
  add('duplicate candidate key', r => { r.rawCandidate = JSON.stringify(r.candidate).replace('"issueNumber":1814', '"issueNumber":1814,"issueNumber":1814'); }, false, false);
  add('escaped duplicate key', r => { r.rawCandidate = JSON.stringify(r.candidate).replace('"issueNumber":1814', '"issueNumber":1814,"issue\\u004eumber":1814'); }, false, false);
  add('unknown candidate key', r => { r.candidate.executable = 'cmd.exe'; });
  add('unknown enrollment key', r => { r.enrollment.installationAuthority = true; });
  add('duplicate enrollment key', r => { r.rawEnrollment = JSON.stringify(r.enrollment).replace('"revoked":false', '"revoked":false,"revoked":false'); }, false, false);
  add('duplicate nested assertion key', r => { r.rawAssertion = JSON.stringify(r.assertion).replace('"userHandle":null', '"userHandle":null,"userHandle":null'); }, false, false);
  add('unknown assertion key', r => { r.assertion.approved = true; });
  add('unknown response key', r => { r.assertion.response.execute = true; });
  add('string boolean revoked', r => { r.enrollment.revoked = 'false'; });
  add('string integer generation', r => { r.enrollment.generation = '1'; });
  add('duplicate client key', r => { r.assertion = assertion(r.candidate, r.enrollment, {
    client: JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(r.candidate), origin: r.enrollment.origin })
      .replace('"type":"webauthn.get"', '"type":"webauthn.get","type":"webauthn.get"') }); });
  add('unknown client key', r => { r.assertion = assertion(r.candidate, r.enrollment, {
    client: JSON.stringify({ type: 'webauthn.get', challenge: mobileInstallationChallengeV1(r.candidate), origin: r.enrollment.origin, topOrigin: r.enrollment.origin }) }); });
  for (const [name, value] of [['cross origin', true], ['string cross origin', 'false']]) add(name, r => {
    r.assertion = assertion(r.candidate, r.enrollment, { client: JSON.stringify({ type: 'webauthn.get',
      challenge: mobileInstallationChallengeV1(r.candidate), origin: r.enrollment.origin, crossOrigin: value }) });
  });
  add('different origin', r => { r.assertion = assertion(r.candidate, r.enrollment, { client: JSON.stringify({ type: 'webauthn.get',
    challenge: mobileInstallationChallengeV1(r.candidate), origin: 'https://attacker.example' }) }); });
  add('client BOM', r => { r.assertion = assertion(r.candidate, r.enrollment, { client: '\ufeff' + JSON.stringify({ type: 'webauthn.get',
    challenge: mobileInstallationChallengeV1(r.candidate), origin: r.enrollment.origin }) }); });
  add('invalid UTF8 client', r => { r.assertion = assertion(r.candidate, r.enrollment, { client: Buffer.from([0xc0, 0xaf, ...Buffer.alloc(40, 32)]) }); });
  add('padded base64url', r => { r.assertion.response.signature += '='; });
  add('noncanonical base64url spare bits', r => { r.assertion.response.authenticatorData = r.assertion.response.authenticatorData.slice(0, -1) + 'B'; });
  add('trailing DER bytes', r => { r.assertion.response.signature = Buffer.concat([Buffer.from(r.assertion.response.signature, 'base64url'), Buffer.from([0])]).toString('base64url'); });
  add('long form DER sequence', r => { const der = Buffer.from(r.assertion.response.signature, 'base64url');
    r.assertion.response.signature = Buffer.concat([Buffer.from([0x30, 0x81, der[1]]), der.subarray(2)]).toString('base64url'); });
  add('negative DER integer', r => { r.assertion.response.signature = Buffer.from([0x30, 6, 2, 1, 0x80, 2, 1, 1]).toString('base64url'); });
  add('redundant DER integer zero', r => { r.assertion.response.signature = Buffer.from([0x30, 7, 2, 2, 0, 1, 2, 1, 1]).toString('base64url'); });
  add('zero DER signature', r => { r.assertion.response.signature = Buffer.from([0x30, 6, 2, 1, 0, 2, 1, 0]).toString('base64url'); });
  add('different EC curve', r => { r.enrollment.publicKeySpki = spki(generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey); });
  add('changed SPKI OID', r => { const key = Buffer.from(r.enrollment.publicKeySpki, 'base64url');key[22] ^= 1;
    r.enrollment.publicKeySpki = key.toString('base64url'); });
  add('bad receipt verification key', r => { r.enrollment.receiptPublicKeySpki = 'A'.repeat(122); });
  add('bad enrollment RP', r => { r.enrollment.rpId = 'other.example'; });
  add('http enrollment origin', r => { r.enrollment.origin = 'http://bridge.stephanos.example'; });
  add('origin path not origin', r => { r.enrollment.origin += '/'; });
  add('default port origin noncanonical', r => { r.enrollment.origin += ':443'; });
  add('wrong credential id', r => { r.assertion.id = Buffer.alloc(24, 8).toString('base64url'); });
  add('wrong raw credential id', r => { r.assertion.rawId = Buffer.alloc(24, 8).toString('base64url'); });
  add('wrong user handle', r => { r.assertion.response.userHandle = Buffer.from('different-user').toString('base64url'); });
  for (const flags of [0, 1, 4, 7, 21, 37, 69, 133]) add(`invalid auth flags ${flags}`, r => { r.assertion = assertion(r.candidate, r.enrollment, { flags }); });
  add('authenticator extensions not requested', r => { const auth = Buffer.concat([hash(r.enrollment.rpId), Buffer.from([5]), Buffer.alloc(5)]);
    r.assertion = assertion(r.candidate, r.enrollment, { auth }); });
  add('wrong RP hash', r => { const auth = Buffer.concat([hash('attacker.example'), Buffer.from([5]), Buffer.from([0, 0, 0, 1])]);
    r.assertion = assertion(r.candidate, r.enrollment, { auth }); });
  add('same signature counter', r => { r.enrollment.lastSignCount = 1; });
  add('lower signature counter', r => { r.enrollment.lastSignCount = 2; });
  add('zero counter after nonzero', r => { r.enrollment.lastSignCount = 1;r.assertion = assertion(r.candidate, r.enrollment, { count: 0 }); });
  add('candidate byte bound', r => { r.rawCandidate = ' '.repeat(4096) + JSON.stringify(r.candidate); }, false, false);
  add('enrollment byte bound', r => { r.rawEnrollment = ' '.repeat(8192) + JSON.stringify(r.enrollment); }, false, false);
  add('assertion byte bound', r => { r.rawAssertion = ' '.repeat(16384) + JSON.stringify(r.assertion); }, false, false);
  add('escaped lone surrogate', r => { r.rawCandidate = JSON.stringify(r.candidate).replace('"nonce":"' + r.candidate.nonce + '"', '"nonce":"\\ud800"'); }, false, false);
  add('leading JSON number zero', r => { r.rawCandidate = JSON.stringify(r.candidate).replace('"issueNumber":1814', '"issueNumber":01814'); }, false, false);
  add('trailing JSON data', r => { r.rawCandidate = JSON.stringify(r.candidate) + '{}'; }, false, false);
  add('non UTC native clock', r => { r.utcClock = false; }, false, false);
  return rows;
}

const runner = String.raw`
namespace Stephanos.Sovereign {
  public static class MobileInstallAssertionFixtureRunnerV1 {
    public static string Run(string input) {
      var parser=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=2097152,RecursionLimit=32};
      var rows=(object[])parser.DeserializeObject(input);
      var output=new System.Collections.Generic.List<object>();
      foreach(object value in rows) {
        var row=(System.Collections.Generic.Dictionary<string,object>)value;
        var now=System.DateTime.Parse((string)row["nowUtc"],System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind);
        if(!(bool)row["utcClock"]) now=System.DateTime.SpecifyKind(now,System.DateTimeKind.Unspecified);
        var result=SovereignMobileInstallAssertionV1.Verify((string)row["candidateJson"],(string)row["enrollmentJson"],(string)row["assertionJson"],now);
        output.Add(new {name=(string)row["name"],approvalVerified=result.ApprovalVerified,
          executionAuthorityGranted=result.ExecutionAuthorityGranted,releaseEligibilityVerified=result.ReleaseEligibilityVerified,
          reasonCode=result.ReasonCode,requestId=result.RequestId,candidateSha256=result.CandidateSha256,signCount=result.SignCount,
          enrollmentGeneration=result.EnrollmentGeneration,credentialBindingSha256=result.CredentialBindingSha256,intact=result.IsIntact()});
      }
      var resultType=typeof(SovereignMobileInstallAssertionV1.MobileInstallAssertionResultV1);
      if(!typeof(SovereignMobileInstallAssertionV1).IsNotPublic || !resultType.IsNestedAssembly ||
         resultType.GetConstructors(System.Reflection.BindingFlags.Public|System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).Length!=1 ||
         !resultType.GetConstructors(System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance)[0].IsPrivate)
        throw new System.InvalidOperationException("ASSERTION_RESULT_CONSTRUCTION_EXPOSED");
      return parser.Serialize(output);
    }
  }
}`;

test('independent Windows CNG verifier checks real Node ES256 assertions and attack matrix without execution authority',
  { skip: process.platform !== 'win32', timeout: 45_000 }, t => {
    const rows = fixtures();
    const root = mkdtempSync(join(tmpdir(), 'stephanos-mobile-assertion-fixture-'));
    const inputPath = join(root, 'fixtures.json'), sourcePath = join(root, 'native-fixture.cs');
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    try {
      writeFileSync(inputPath, JSON.stringify(rows));
      writeFileSync(sourcePath, readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n') + '\n' + runner);
      const script = `$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';` +
        `Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop;` +
        `$source=[IO.File]::ReadAllText(${literal(sourcePath)});` +
        `Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;` +
        `[Console]::Write([Stephanos.Sovereign.MobileInstallAssertionFixtureRunnerV1]::Run([IO.File]::ReadAllText(${literal(inputPath)})))`;
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 35_000, maxBuffer: 512 * 1024 });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      const observations = JSON.parse(result.stdout);
      assert.equal(observations.length, rows.length);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], observed = observations[i];
        assert.equal(observed.name, row.name);
        assert.equal(observed.approvalVerified, row.valid, `${row.name}: ${observed.reasonCode}`);
        assert.equal(observed.executionAuthorityGranted, false, row.name);
        assert.equal(observed.releaseEligibilityVerified, false, row.name);
        assert.equal(observed.intact, true, row.name);
        if (row.valid) {
          assert.equal(observed.requestId, row.candidate.requestId, row.name);
          assert.equal(observed.candidateSha256, mobileInstallationCandidateDigestV1(row.candidate), row.name);
          assert.equal(observed.signCount, Buffer.from(row.assertion.response.authenticatorData, 'base64url').readUInt32BE(33), row.name);
          assert.equal(observed.reasonCode, 'ASSERTION_VERIFIED_REQUIRES_PROTECTED_ADMISSION');
          assert.equal(observed.enrollmentGeneration, row.enrollment.generation, row.name);
          const binding = 'stephanos.mobile-install-credential-binding.v1\0' +
            ['machineHash', 'operatorSid', 'rpId', 'origin', 'credentialId', 'publicKeySpki', 'userHandle', 'receiptPublicKeySpki']
              .map(key => row.enrollment[key] + '\0').join('') + row.enrollment.generation;
          assert.equal(observed.credentialBindingSha256, hash(binding).toString('hex'), row.name);
        } else {
          assert.equal(observed.requestId, null, row.name);
          assert.equal(observed.candidateSha256, null, row.name);
          assert.equal(observed.signCount, 0, row.name);
          assert.equal(observed.enrollmentGeneration, 0, row.name);
          assert.equal(observed.credentialBindingSha256, null, row.name);
          assert.match(observed.reasonCode, /^[A-Z][A-Z0-9_]+$/);
        }
      }
      t.diagnostic(`${rows.length} native cases; ${rows.filter(row => row.valid).length} valid cross-language signatures; ` +
        `${rows.filter(row => !row.valid).length} rejected attacks/invalid inputs; no source/runtime installation`);
    } finally {
      for (const path of [inputPath, sourcePath]) { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      rmdirSync(root);
    }
  });

test('initial enrollment device proof has a distinct challenge domain and cannot become installation approval',
  { skip: process.platform !== 'win32', timeout: 30_000 }, t => {
    const descriptor = JSON.stringify({ schemaVersion: 'stephanos.mobile-install-enrollment-descriptor.v1',
      machineHash: candidate.machineHash, operatorSid: candidate.operatorSid, enrollmentGeneration: 1,
      nonce: 'f'.repeat(64), requestedAtUtc: candidate.requestedAtUtc, expiresAtUtc: candidate.expiresAtUtc });
    const challenge = hash('stephanos.mobile-install-enrollment-proof.v1\0' + descriptor).toString('base64url');
    const setupAssertion = (e = enrollment, overrides = {}) => assertion(candidate, e, {
      client: JSON.stringify({ type: 'webauthn.get', challenge, origin: e.origin, crossOrigin: false }), ...overrides,
    });
    const rows = [];
    const add = (name, mutate = () => {}, valid = false, install = false) => {
      const row = { name, descriptor, enrollment: clone(enrollment), assertion: setupAssertion(), valid, install };
      mutate(row); rows.push(row);
    };
    add('real enrollment challenge signature', () => {}, true);
    add('install approval does not enroll a device', r => { r.assertion = assertion(); }, false, true);
    add('changed descriptor cannot borrow proof', r => { r.descriptor = descriptor.replace('f'.repeat(64), 'e'.repeat(64)); });
    add('setup proof rejects wrong device signature', r => { r.assertion = setupAssertion(r.enrollment, { key: wrongDevice.privateKey }); });
    add('setup proof requires user verification', r => { r.assertion = setupAssertion(r.enrollment, { flags: 1 }); });
    add('setup proof rejects revoked device', r => { r.enrollment.revoked = true; });
    add('setup proof rejects sign counter rollback', r => { r.enrollment.lastSignCount = 1; });
    add('setup proof rejects cross origin', r => { r.assertion = setupAssertion(r.enrollment, { client: JSON.stringify({
      type: 'webauthn.get', challenge, origin: r.enrollment.origin, crossOrigin: true }) }); });
    add('setup proof rejects client duplicate keys', r => { r.assertion = setupAssertion(r.enrollment, { client: JSON.stringify({
      type: 'webauthn.get', challenge, origin: r.enrollment.origin }).replace('"type":"webauthn.get"', '"type":"webauthn.get","type":"webauthn.get"') }); });
    add('setup descriptor is bounded', r => { r.descriptor = 'x'.repeat(8193); });
    add('empty setup descriptor is not a challenge', r => { r.descriptor = ''; });
    const setupRunner = String.raw`
namespace Stephanos.Sovereign {
  public static class MobileInstallEnrollmentProofFixtureV1 {
    public static string Run(string wire) {
      var json=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=1048576,RecursionLimit=16};
      var rows=(object[])json.DeserializeObject(wire);var output=new System.Collections.Generic.List<object>();
      foreach(object value in rows) {
        var row=(System.Collections.Generic.Dictionary<string,object>)value;
        string enrolled=json.Serialize(row["enrollment"]),assertion=json.Serialize(row["assertion"]);
        var now=System.DateTime.Parse("2026-11-14T15:00:00.000Z",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind);
        var setup=SovereignMobileInstallAssertionV1.VerifyEnrollmentProofV1(enrolled,assertion,(string)row["descriptor"],now);
        var install=SovereignMobileInstallAssertionV1.Verify("__CANDIDATE__",enrolled,assertion,now);
        if(typeof(SovereignMobileInstallAssertionV1.MobileInstallAssertionResultV1).IsAssignableFrom(setup.GetType()))
          throw new System.Exception("ENROLLMENT_PROOF_IS_INSTALL_APPROVAL");
        foreach(var field in setup.GetType().GetFields(System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic))
          if(!field.IsInitOnly)throw new System.Exception("MUTABLE_ENROLLMENT_PROOF");
        output.Add(new{name=(string)row["name"],verified=setup.DevicePossessionVerified,install=install.ApprovalVerified,
          installationApprovalGranted=setup.InstallationApprovalGranted,executionAuthorityGranted=setup.ExecutionAuthorityGranted,
          releaseEligibilityVerified=setup.ReleaseEligibilityVerified,descriptorSha256=setup.SetupDescriptorSha256,reason=setup.ReasonCode});
      }
      return json.Serialize(output);
    }
  }
}`.replace('__CANDIDATE__', JSON.stringify(candidate).replaceAll('"', '\\"'));
    const root = mkdtempSync(join(tmpdir(), 'stephanos-enrollment-proof-fixture-'));
    const source = join(root, 'setup-proof.cs'), input = join(root, 'setup-proof.json');
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    try {
      writeFileSync(source, readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n') + '\n' + setupRunner);
      writeFileSync(input, JSON.stringify(rows));
      const script = `$ErrorActionPreference='Stop';Import-Module 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules\\Microsoft.PowerShell.Utility\\Microsoft.PowerShell.Utility.psd1';` +
        `Add-Type -TypeDefinition ([IO.File]::ReadAllText(${literal(source)})) -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;` +
        `[Console]::Write([Stephanos.Sovereign.MobileInstallEnrollmentProofFixtureV1]::Run([IO.File]::ReadAllText(${literal(input)})))`;
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 25000, maxBuffer: 128 * 1024 });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const observations = JSON.parse(result.stdout); assert.equal(observations.length, rows.length);
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index], observed = observations[index];
        assert.equal(observed.name, row.name);
        assert.equal(observed.verified, row.valid, `${row.name}: ${observed.reason}`);
        assert.equal(observed.install, row.install, row.name);
        assert.equal(observed.installationApprovalGranted, false, row.name);
        assert.equal(observed.executionAuthorityGranted, false, row.name);
        assert.equal(observed.releaseEligibilityVerified, false, row.name);
        if (row.valid) assert.equal(observed.descriptorSha256, hash(row.descriptor).toString('hex'));
      }
      t.diagnostic(`${rows.length} distinct-domain native enrollment-proof cases; no enrollment or installation performed`);
    } finally {
      for (const path of [source, input]) { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      rmdirSync(root);
    }
  });
