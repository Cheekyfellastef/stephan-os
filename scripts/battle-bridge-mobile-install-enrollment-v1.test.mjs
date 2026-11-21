import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

const PS = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const hash = value => createHash('sha256').update(value).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const runner = String.raw`
namespace Stephanos.Sovereign {
 public static class MobileEnrollmentDataFixtureV1 {
  public static string Run(string raw) {
   var json=new System.Web.Script.Serialization.JavaScriptSerializer {MaxJsonLength=1048576,RecursionLimit=12};
   var input=(System.Collections.Generic.Dictionary<string,object>)json.DeserializeObject(raw);
   var rows=new System.Collections.Generic.List<object>();
   var now=System.DateTime.ParseExact((string)input["now"],"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,
     System.Globalization.DateTimeStyles.AssumeUniversal|System.Globalization.DateTimeStyles.AdjustToUniversal);
   foreach(object item in (object[])input["descriptors"]) {
    var row=(System.Collections.Generic.Dictionary<string,object>)item;bool ok=false;
    try {
     MobileInstallQualifiedEnrollmentV1.ValidateSetupDescriptorDataV1((string)row["raw"],(string)input["enrollment"],
      (string)input["head"],(string)input["tree"],(string)input["package"],(string)input["evidence"],
      (string)input["machine"],(string)input["sid"],now);ok=true;
    }catch(System.InvalidOperationException) { }
    rows.Add(new {name=row["name"],ok});
   }
   var binding=SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1((string)input["enrollment"]);
   var fields=new System.Collections.Generic.Dictionary<string,string> {
    {"machineHash",(string)input["machine"]},{"operatorSid",(string)input["sid"]},{"enrollmentGeneration","1"},
    {"sourceHead",(string)input["head"]},{"sourceTree",(string)input["tree"]},{"packageSha256",(string)input["package"]},
    {"closureSha256",new string('4',64)},{"releaseProofSha256",(string)input["evidence"]},{"bootstrapSha256",new string('6',64)}};
   using(var permit=new MobileInstallReleaseInspectionV1(true,"SYNTHETIC_DATA_ONLY",fields)) {
    foreach(object item in (object[])input["certificates"]) {
     var row=(System.Collections.Generic.Dictionary<string,object>)item;bool ok=false;
     try {MobileInstallQualifiedEnrollmentV1.VerifyCertificateV1((string)row["wire"],binding.ReceiptPublicKeySpki,new string('7',64),binding,permit);ok=true;}
     catch(System.InvalidOperationException) { }
     rows.Add(new {name=row["name"],ok});
    }
   }
   return json.Serialize(rows);
  }
 }
}`;

test('setup descriptor freshness/target/proposal and enrollment certificate signatures fail closed using data-only native fixtures',
  { skip: process.platform !== 'win32', timeout: 40000 }, t => {
    const now = Date.now(), iso = value => new Date(value).toISOString();
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
    const context = { now: iso(now), head: 'a'.repeat(40), tree: 'b'.repeat(40), package: '3'.repeat(64),
      evidence: '5'.repeat(64), machine: '2'.repeat(64), sid: 'S-1-5-21-1-2-3-1001' };
    context.enrollment = JSON.stringify({ schemaVersion: 'stephanos.battle-bridge-mobile-installation-enrollment.v1',
      machineHash: context.machine, operatorSid: context.sid, generation: 1, rpId: 'stephanos.example',
      origin: 'https://bridge.stephanos.example', credentialId: Buffer.alloc(24, 7).toString('base64url'),
      publicKeySpki: spki, userHandle: Buffer.from('operator').toString('base64url'), lastSignCount: 0,
      revoked: false, receiptPublicKeySpki: spki });
    const descriptor = { schemaVersion: 'stephanos.mobile-installer-setup-descriptor.v1', repository: 'Cheekyfellastef/stephan-os',
      sourceHead: context.head, sourceTree: context.tree, machineHash: context.machine, operatorSid: context.sid,
      enrollmentGeneration: 1, packageSha256: context.package, releaseProofSha256: context.evidence,
      proposedEnrollmentSha256: hash(context.enrollment), nonce: '8'.repeat(64), issuedAtUtc: iso(now - 1000), expiresAtUtc: iso(now + 600000) };
    const descriptors = [{ name: 'valid descriptor data', raw: JSON.stringify(descriptor), ok: true }];
    for (const [field, value] of Object.entries({ schemaVersion: 'other', repository: 'other/repo', sourceHead: 'f'.repeat(40),
      sourceTree: 'f'.repeat(40), machineHash: 'f'.repeat(64), operatorSid: 'S-1-5-21-1-2-3-1002', enrollmentGeneration: 2,
      packageSha256: 'f'.repeat(64), releaseProofSha256: 'f'.repeat(64), proposedEnrollmentSha256: 'f'.repeat(64),
      nonce: 'x'.repeat(64), issuedAtUtc: iso(now + 6000), expiresAtUtc: iso(now), extra: true }))
      descriptors.push({ name: 'changed descriptor ' + field, raw: JSON.stringify({ ...descriptor, [field]: value }), ok: false });
    for (const [name, row] of [['too long lifetime', { ...descriptor, expiresAtUtc: iso(now + 900001) }],
      ['fractional generation', { ...descriptor, enrollmentGeneration: 1.5 }], ['string generation', { ...descriptor, enrollmentGeneration: '1' }],
      ['invalid UTC', { ...descriptor, issuedAtUtc: '2026-02-31T00:00:00.000Z' }]])
      descriptors.push({ name, raw: JSON.stringify(row), ok: false });
    descriptors.push({ name: 'duplicate target key', raw: JSON.stringify(descriptor).replace('"sourceHead":', '"sourceHead":"' + context.head + '","sourceHead":'), ok: false });
    const fields = { repository: 'Cheekyfellastef/stephan-os', machineHash: context.machine, operatorSid: context.sid, generation: '1',
      credentialBindingSha256: hash(JSON.stringify(Object.fromEntries([
        ['machineHash', context.machine], ['operatorSid', context.sid], ['rpId', 'stephanos.example'],
        ['origin', 'https://bridge.stephanos.example'], ['credentialId', Buffer.alloc(24, 7).toString('base64url')],
        ['publicKeySpki', spki], ['userHandle', Buffer.from('operator').toString('base64url')], ['receiptPublicKeySpki', spki], ['generation', 1],
      ]))), receiptPublicKeySpki: spki, helperSha256: '7'.repeat(64), sourceHead: context.head, sourceTree: context.tree,
      packageSha256: context.package, closureSha256: '4'.repeat(64), releaseProofSha256: context.evidence,
      bootstrapSha256: '6'.repeat(64), qualificationEvidenceSha256: context.evidence, issuedAtUtc: iso(now - 1000) };
    // Credential digest is obtained from the native canonical parser below;
    // certificates are generated by a native data-only fixture in the same run.
    const certificates = [];
    const root = mkdtempSync(join(tmpdir(), 'stephanos-mobile-enrollment-data-'));
    const source = join(root, 'fixture.cs'), input = join(root, 'input.json');
    try {
      const native = readMobileInstallerNativeSourceV1().map(row => row.bytes.toString('utf8')).join('\n');
      // First obtain the canonical credential digest without reading protected files.
      const digestRunner = String.raw`namespace Stephanos.Sovereign {public static class MobileEnrollmentDigestFixtureV1 {public static string Run(string value){return SovereignMobileInstallAssertionV1.ReadEnrollmentBindingV1(value).CredentialBindingSha256;}}}`;
      writeFileSync(source, native + '\n' + digestRunner + '\n' + runner);
      writeFileSync(input, context.enrollment);
      const prefix = "$ErrorActionPreference='Stop';Add-Type -TypeDefinition ([IO.File]::ReadAllText(" + literal(source)
        + ")) -ReferencedAssemblies 'System.Core','System.Management','System.Web.Extensions' -ErrorAction Stop;";
      const run = script => spawnSync(PS, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { shell: false, windowsHide: true, encoding: 'utf8', timeout: 35000, maxBuffer: 32768 });
      const digestResult = run(prefix + '[Console]::Write([Stephanos.Sovereign.MobileEnrollmentDigestFixtureV1]::Run([IO.File]::ReadAllText(' + literal(input) + ')))');
      assert.equal(digestResult.status, 0, digestResult.stderr);
      assert.match(digestResult.stdout, /^[a-f0-9]{64}$/); fields.credentialBindingSha256 = digestResult.stdout;
      const cert = changes => {
        const body = 'STEPHANOS_MOBILE_INSTALL_ENROLLMENT_V1\n' + Object.entries({ ...fields, ...changes }).map(([name, value]) => name + '=' + value + '\n').join('');
        return body + 'signature=' + sign('sha256', Buffer.from('stephanos.mobile-install-enrollment-certificate.v1\0' + body),
          { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url') + '\n';
      };
      certificates.push({ name: 'valid signed certificate data', wire: cert({}), ok: true });
      for (const field of ['machineHash', 'credentialBindingSha256', 'helperSha256', 'packageSha256', 'releaseProofSha256', 'qualificationEvidenceSha256'])
        certificates.push({ name: 'signed different binding ' + field, wire: cert({ [field]: 'f'.repeat(64) }), ok: false });
      certificates.push({ name: 'signature tampering', wire: cert({}).replace('helperSha256=7', 'helperSha256=8'), ok: false });
      certificates.push({ name: 'certificate duplicate field', wire: cert({}).replace('generation=1\n', 'generation=1\ngeneration=1\n'), ok: false });
      writeFileSync(input, JSON.stringify({ ...context, descriptors, certificates }));
      const result = run(prefix + '[Console]::Write([Stephanos.Sovereign.MobileEnrollmentDataFixtureV1]::Run([IO.File]::ReadAllText(' + literal(input) + ')))');
      assert.equal(result.status, 0, result.stderr);
      const actual = JSON.parse(result.stdout), expected = [...descriptors, ...certificates];
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < expected.length; i++) assert.deepEqual(actual[i], { name: expected[i].name, ok: expected[i].ok });
      t.diagnostic(`${expected.length} native setup descriptor/certificate vectors; no protected root/key/log/task factories invoked`);
    } finally {
      for (const path of [source, input]) { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      rmdirSync(root);
    }
  });

test('initial enrollment adapter parses and unbound captured invocation refuses before privileged effects',
  { skip: process.platform !== 'win32' }, () => {
    const path = fileURLToPath(new URL('./windows/install-battle-bridge-mobile-installer-v1.ps1', import.meta.url));
    const script = '$tokens=$null;$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile(' + literal(path)
      + ',[ref]$tokens,[ref]$errors);if($errors.Count){throw "PARSE_FAILED"};try {& ([scriptblock]::Create([IO.File]::ReadAllText(' + literal(path) + ')))'
      + ';throw "DIRECT_CALL_WAS_ACCEPTED"}catch{if($_.Exception.Message -cne "MOBILE_ENROLLMENT_IMMUTABLE_APPROVAL_REQUIRED"){throw}};[Console]::Write("DIRECT_CALL_REFUSED")';
    const result = spawnSync(PS, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 8192 });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'DIRECT_CALL_REFUSED');
  });
