import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const native = ['SovereignCoreJobCustodyV1.cs', 'SovereignFixedRuntimeJobV1.cs',
  'SovereignFixedRuntimeIdentityV1.cs', 'SovereignFixedRuntimeAuthorityV1.cs',
  'SovereignFixedRuntimeHostV1.cs', 'SovereignFixedRuntimeSourceV1.cs', 'SovereignMobileInstallReleaseV1.cs'];
const source = readFileSync(new URL('./windows/SovereignMobileInstallReleaseV1.cs', import.meta.url), 'utf8');
const closureBytes = readFileSync(new URL('../shared/agents/sovereignFixedRuntimeSourceClosureV1.json', import.meta.url));
const paths = JSON.parse(closureBytes).paths.toSorted();
const head = 'a'.repeat(40), tree = 'b'.repeat(40), machine = 'c'.repeat(64), sid = 'S-1-5-21-1-2-3-1001';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const blob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const clone = value => structuredClone(value);
const record = (path, bytes) => ({ Path: path, GitBlobSha: blob(bytes), GitMode: '100644',
  Sha256: digest(bytes), MaterializedSha256: digest(bytes), ContentBase64: bytes.toString('base64') });
const payload = { SchemaVersion: 'stephanos.fixed-runtime-install-input.v1', SourceHead: head,
  SourceTree: tree, OperatorSid: sid, Records: paths.map(path => record(path,
    path === 'shared/agents/sovereignFixedRuntimeSourceClosureV1.json' ? closureBytes
      : Buffer.from(`synthetic fixture bytes only: ${path}\n`))) };
const gitClosure = rows => digest(Buffer.from('stephanos.fixed-runtime-git-closure.v1\0' + rows.toSorted((a, b) =>
  a.Path < b.Path ? -1 : a.Path > b.Path ? 1 : 0).map(row => `${row.Path}\0${row.GitMode}\0${row.GitBlobSha}\n`).join('')));
const bootstrap = Buffer.from('# synthetic captured bootstrap; never executed\n');
const evidence = Buffer.from('{"syntheticFixture":true,"authority":false}\n');
const pinFields = () => ({ repository: 'Cheekyfellastef/stephan-os', action: 'INSTALL_SOVEREIGN_FIXED_RUNTIME_V1',
  machineHash: machine, operatorSid: sid, enrollmentGeneration: '1', sourceHead: head, sourceTree: tree,
  packageSha256: digest(Buffer.from(JSON.stringify(payload))), closureSha256: gitClosure(payload.Records),
  releaseProofSha256: digest(evidence), bootstrapSha256: digest(bootstrap) });
const wire = fields => 'STEPHANOS_MOBILE_INSTALL_RELEASE_PIN_V1\n' + Object.entries(fields).map(([k, v]) => `${k}=${v}\n`).join('');

test('release verifier remains bounded, exact-membership pinned and inspection-only', () => {
  assert.ok(Buffer.byteLength(source) <= 32768);
  const pathSet = digest(Buffer.from(`stephanos.mobile-install-release-path-set.v1\0${paths.join('\n')}\n`));
  assert.match(source, new RegExp(`ExpectedPathCount=${paths.length};`));
  assert.ok(source.includes(`ExpectedPathSetSha256="${pathSet}"`));
  assert.match(source, /OpenProtected\(\)/);
  assert.match(source, /ExecutionAuthorityGranted=false, EnrollmentQualified=false, ReleaseEligibilityVerified=false/);
  assert.doesNotMatch(source, /Process\.Start|CreateProcess|WebClient|HttpClient|File\.Write|Directory\.Create|File\.Exists|Directory\.Exists/);
  assert.match(source, /GetSecurityInfo\(handle,1,5/);
  assert.doesNotMatch(source, /enrollment-generation\.pin/);
});

function vectors() {
  const rows = [];
  const add = (name, mutate = () => {}, valid = false) => {
    const row = { name, package: clone(payload), bootstrap: Buffer.from(bootstrap), evidence: Buffer.from(evidence),
      fields: pinFields(), expectedMachine: machine, expectedOperator: sid, expectedGeneration: 1, valid };
    mutate(row);
    const bytes = row.rawPayload ?? Buffer.from(JSON.stringify(row.package));
    if (row.rebindPayload) row.fields.packageSha256 = digest(bytes);
    if (row.rebindClosure) row.fields.closureSha256 = gitClosure(row.package.Records);
    if (row.rebindBootstrap) row.fields.bootstrapSha256 = digest(row.bootstrap);
    if (row.rebindEvidence) row.fields.releaseProofSha256 = digest(row.evidence);
    rows.push({ name, valid, pin: row.rawPin ?? wire(row.fields), payload: bytes.toString('base64'),
      bootstrap: row.bootstrap.toString('base64'), evidence: row.evidence.toString('base64'),
      expectedMachine: row.expectedMachine, expectedOperator: row.expectedOperator, expectedGeneration: row.expectedGeneration });
  };
  const packageAttack = (name, mutate) => add(name, row => { mutate(row); row.rebindPayload = true; });
  add('complete exact synthetic package remains unqualified', () => {}, true);
  add('record order does not replace exact membership', row => {
    row.package.Records.reverse(); row.rebindPayload = true;
  }, true);
  add('payload changed after permit', row => { row.package.SourceHead = 'd'.repeat(40); });
  add('bootstrap changed after permit', row => { row.bootstrap = Buffer.from('different bootstrap'); });
  add('release evidence changed after permit', row => { row.evidence = Buffer.from('different evidence'); });
  for (const field of ['machineHash', 'operatorSid', 'enrollmentGeneration', 'sourceHead', 'sourceTree',
    'packageSha256', 'closureSha256', 'releaseProofSha256', 'bootstrapSha256']) add(`permit ${field} movement`, row => {
      row.fields[field] = field === 'operatorSid' ? 'S-1-5-21-1-2-3-1002' : field === 'enrollmentGeneration' ? '2'
        : 'd'.repeat(row.fields[field].length);
    });
  add('different actual machine', row => { row.expectedMachine = 'd'.repeat(64); });
  add('different actual operator', row => { row.expectedOperator = 'S-1-5-21-1-2-3-1002'; });
  add('different protected enrollment generation', row => { row.expectedGeneration = 2; });
  add('absent protected enrollment generation', row => { row.expectedGeneration = 0; });
  add('caller-qualified field is not a permit member', row => { row.rawPin = wire(row.fields) + 'qualified=true\n'; });
  add('caller path is not a permit member', row => { row.rawPin = wire(row.fields) + 'payloadPath=C:\\untrusted.json\n'; });
  add('pin order is canonical', row => { row.rawPin = wire(Object.fromEntries(Object.entries(row.fields).reverse())); });
  add('pin duplicate field', row => { row.rawPin = wire(row.fields) + `sourceHead=${head}\n`; });
  add('pin CRLF substitution', row => { row.rawPin = wire(row.fields).replaceAll('\n', '\r\n'); });
  add('pin BOM substitution', row => { row.rawPin = '\ufeff' + wire(row.fields); });
  add('pin missing final newline', row => { row.rawPin = wire(row.fields).slice(0, -1); });
  add('pin noncanonical integer', row => { row.fields.enrollmentGeneration = '01'; });
  add('pin unsafe generation', row => { row.fields.enrollmentGeneration = '9007199254740992'; });
  add('foreign repository', row => { row.fields.repository = 'other/repository'; });
  add('arbitrary operation', row => { row.fields.action = 'RUN_ARBITRARY_SCRIPT'; });
  packageAttack('package unknown field', row => { row.package.Command = 'do not execute'; });
  packageAttack('package schema movement', row => { row.package.SchemaVersion += '.other'; });
  for (const key of ['SourceHead', 'SourceTree', 'OperatorSid']) packageAttack(`package ${key} mismatch`, row => {
    row.package[key] = key === 'OperatorSid' ? 'S-1-5-21-1-2-3-1002' : 'd'.repeat(40);
  });
  packageAttack('duplicate package key', row => { row.rawPayload = Buffer.from(JSON.stringify(row.package)
    .replace('"SourceHead":', `"SourceHead":"${head}","SourceHead":`)); });
  packageAttack('escaped duplicate package key', row => { row.rawPayload = Buffer.from(JSON.stringify(row.package)
    .replace('"SourceHead":', `"Source\\u0048ead":"${head}","SourceHead":`)); });
  packageAttack('unknown record field', row => { row.package.Records[0].Executable = 'arbitrary.exe'; });
  packageAttack('wrong record primitive', row => { row.package.Records[0].Path = true; });
  packageAttack('missing required member', row => { row.package.Records.pop(); });
  packageAttack('extra member beyond exact count', row => { row.package.Records.push(clone(row.package.Records[0])); });
  packageAttack('duplicate case-folded member', row => { row.package.Records[1].Path = row.package.Records[0].Path.toUpperCase(); });
  for (const path of ['../outside.ps1', 'scripts/../outside.ps1', '/scripts/outside.ps1', 'C:/outside.ps1',
    'scripts\\outside.ps1', 'scripts//outside.ps1', 'scripts/outside.ps1:alternate', 'scripts/new-member.ps1'])
    packageAttack(`path refused: ${path}`, row => { row.package.Records[1].Path = path; row.rebindClosure = true; });
  packageAttack('record content bytes changed', row => { row.package.Records[0].ContentBase64 = Buffer.from('different').toString('base64'); });
  packageAttack('record Git blob changed', row => { row.package.Records[0].GitBlobSha = 'f'.repeat(40); row.rebindClosure = true; });
  packageAttack('record mode changed', row => { row.package.Records[0].GitMode = '100755'; row.rebindClosure = true; });
  packageAttack('noncanonical base64 whitespace', row => { row.package.Records[0].ContentBase64 += '\n'; });
  packageAttack('record SHA string-shaped coercion refused', row => { row.package.Records[0].Sha256 = [row.package.Records[0].Sha256]; });
  for (const attack of ['missing declared member', 'declared foreign path', 'closure unknown field', 'closure duplicate key'])
    packageAttack(attack, row => {
      const index = row.package.Records.findIndex(r => r.Path === 'shared/agents/sovereignFixedRuntimeSourceClosureV1.json');
      const declared = JSON.parse(closureBytes);
      if (attack === 'missing declared member') declared.paths.pop();
      if (attack === 'declared foreign path') declared.paths[0] = 'arbitrary/path.ps1';
      if (attack === 'closure unknown field') declared.qualified = true;
      let raw = JSON.stringify(declared);
      if (attack === 'closure duplicate key') raw = raw.replace('"schemaVersion":', '"schemaVersion":"other","schemaVersion":');
      row.package.Records[index] = record(row.package.Records[index].Path, Buffer.from(raw)); row.rebindClosure = true;
    });
  add('empty bootstrap refused even with matching pin', row => { row.bootstrap = Buffer.alloc(0); row.rebindBootstrap = true; });
  add('invalid UTF8 bootstrap refused even with matching pin', row => { row.bootstrap = Buffer.from([0xc3]); row.rebindBootstrap = true; });
  add('empty evidence refused even with matching pin', row => { row.evidence = Buffer.alloc(0); row.rebindEvidence = true; });
  add('invalid UTF8 evidence refused even with matching pin', row => { row.evidence = Buffer.from([0xc3]); row.rebindEvidence = true; });
  return rows;
}

function runNativeFixture(mode) {
  const rows = mode === 'data' ? vectors() : [];
  const directory = mkdtempSync(join(tmpdir(), 'mobile-release-fixture-'));
  const vectorPath = join(directory, 'vectors.json');
  writeFileSync(vectorPath, JSON.stringify(rows));
  const driver = String.raw`
namespace Stephanos.Sovereign {
  public static partial class CoreJobCustodyV1 {
    public static string MobileReleaseFixtureInspect(string pin,byte[] payload,byte[] bootstrap,byte[] evidence,
        string machine,string sid,long generation) {
      using(var result=SovereignMobileInstallReleaseV1.InspectCaptured(pin,payload,bootstrap,evidence,machine,sid,generation)) {
        return (result.PermitDataVerified?"PASS":"REFUSE")+"|"+result.ReasonCode+"|"+
          result.ExecutionAuthorityGranted+"|"+result.EnrollmentQualified+"|"+result.ReleaseEligibilityVerified+"|"+result.ProtectedStorageObserved;
      }
    }
    public static string MobileReleaseFixtureOpen() {
      using(var result=SovereignMobileInstallReleaseV1.OpenProtected()) {
        if(result.ExecutionAuthorityGranted || result.EnrollmentQualified || result.ReleaseEligibilityVerified)
          throw new System.Exception("PRODUCTION_OBSERVATION_GRANTED_AUTHORITY");
        return result.ReasonCode;
      }
    }
    public static void MobileReleaseFixtureBounds() {
      var result=SovereignMobileInstallReleaseV1.InspectCaptured(new string('a',4097),null,null,null,"","",0);
      if(result.PermitDataVerified || result.ReasonCode!="RELEASE_PIN_BOUND")throw new System.Exception("PIN_BOUND_BYPASSED");
    }
    [System.Runtime.InteropServices.DllImport("kernel32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode,SetLastError=true)]
    static extern bool CreateHardLinkW(string link,string existing,System.IntPtr reserved);
    public static string MobileReleaseFixtureFiles(string directory) {
      string owned=System.IO.Path.Combine(directory,"owned.txt"),renamed=System.IO.Path.Combine(directory,"renamed.txt");
      string link=System.IO.Path.Combine(directory,"linked.txt");
      System.IO.File.WriteAllText(owned,"synthetic retained native file");
      var pins=new FixedRuntimeIdentityPinsV1();
      try {
        RuntimePinParentsV1(owned,pins);
        var file=RuntimePinFileV1(owned,4096,pins);
        bool write=false,move=false,directoryMove=false,writableRoot=false;
        try {using(var stream=System.IO.File.Open(owned,System.IO.FileMode.Open,System.IO.FileAccess.Write,System.IO.FileShare.ReadWrite)) {}}
        catch(System.IO.IOException) {write=true;}
        try {System.IO.File.Move(owned,renamed);}catch(System.IO.IOException) {move=true;}
        try {System.IO.Directory.Move(directory,directory+"-moved");}catch(System.IO.IOException) {directoryMove=true;}
        var acl=System.IO.Directory.GetAccessControl(directory);
        acl.AddAccessRule(new System.Security.AccessControl.FileSystemAccessRule(
          new System.Security.Principal.SecurityIdentifier("S-1-1-0"),System.Security.AccessControl.FileSystemRights.Write,
          System.Security.AccessControl.AccessControlType.Allow));System.IO.Directory.SetAccessControl(directory,acl);
        try {MobileReleaseProtectedAclV1(pins.Directories[pins.Directories.Count-1],false);}
        catch(System.IO.IOException error) {if(error.Message=="RELEASE_PROTECTED_OWNER_UNPROVEN" ||
          error.Message=="RELEASE_PROTECTED_WRITE_AUTHORITY_UNPROVEN")writableRoot=true;else throw;}
        if(!write || !move || !directoryMove || !writableRoot)throw new System.Exception("NATIVE_PIN_OR_ACL_REFUSAL_MISSING");
      } finally {pins.Dispose();}
      try {
        using(var stream=System.IO.File.Open(owned,System.IO.FileMode.Open,System.IO.FileAccess.Write,System.IO.FileShare.Read)) {}
        if(!CreateHardLinkW(link,owned,System.IntPtr.Zero))throw new System.Exception("FIXTURE_HARDLINK_CREATION_FAILED");
        pins=new FixedRuntimeIdentityPinsV1();bool refused=false;
        try {RuntimePinParentsV1(owned,pins);RuntimePinFileV1(owned,4096,pins);}
        catch(System.IO.IOException error) {if(error.Message=="RUNTIME_SOURCE_PIN_IDENTITY_UNPROVEN")refused=true;else throw;}
        finally {pins.Dispose();}
        if(!refused)throw new System.Exception("NATIVE_HARDLINK_ACCEPTED");
      } finally {if(System.IO.File.Exists(link))System.IO.File.Delete(link);System.IO.File.Delete(owned);}
      return "PIN_WRITE_MOVE_DIRECTORY_ACL_AND_HARDLINK_REFUSED";
    }
  }
}`;
  const files = native.map(name => literal(fileURLToPath(new URL('./windows/' + name, import.meta.url))));
  const powershell = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$source=(@(__FILES__) | ForEach-Object { [IO.File]::ReadAllText($_) }) -join [Environment]::NewLine
$source+=[Environment]::NewLine+@'
__DRIVER__
'@
Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management' -ErrorAction Stop
if('__MODE__' -ceq 'data') {
$rows=[IO.File]::ReadAllText(__VECTORS__) | ConvertFrom-Json
$results=@($rows | ForEach-Object {
  [Stephanos.Sovereign.CoreJobCustodyV1]::MobileReleaseFixtureInspect([string]$_.pin,[Convert]::FromBase64String($_.payload),
    [Convert]::FromBase64String($_.bootstrap),[Convert]::FromBase64String($_.evidence),[string]$_.expectedMachine,
    [string]$_.expectedOperator,[long]$_.expectedGeneration)
})
[Stephanos.Sovereign.CoreJobCustodyV1]::MobileReleaseFixtureBounds()
@{vectors=$results} | ConvertTo-Json -Compress
} else {
$fileResult=[Stephanos.Sovereign.CoreJobCustodyV1]::MobileReleaseFixtureFiles(__DIRECTORY__)
$open=[Stephanos.Sovereign.CoreJobCustodyV1]::MobileReleaseFixtureOpen()
@{files=$fileResult;open=$open} | ConvertTo-Json -Compress
}
`.replace('__FILES__', files.join(',')).replace('__DRIVER__', driver)
    .replace('__VECTORS__', literal(vectorPath)).replace('__DIRECTORY__', literal(directory)).replace('__MODE__', mode);
  try {
    return JSON.parse(execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershell],
      { encoding: 'utf8', windowsHide: true, timeout: 55000, maxBuffer: 4 * 1024 * 1024 }));
  } finally {
    for (const target of [directory, directory + '-moved']) {
      assert.ok(resolve(target).startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith('mobile-release-fixture-'));
      if (!existsSync(target)) continue;
      for (const name of ['vectors.json', 'owned.txt', 'renamed.txt', 'linked.txt']) {
        const file = join(target, name); if (existsSync(file)) unlinkSync(file);
      }
      rmdirSync(target);
    }
  }
}

test('Windows compiled native release pin checks complete data and adversarial bindings without granting authority',
  { skip: process.platform !== 'win32', timeout: 60000 }, t => {
  const rows = vectors(), result = runNativeFixture('data');
  assert.equal(result.vectors.length, rows.length);
  for (let i = 0; i < rows.length; i++) {
    const [state, reason, ...flags] = result.vectors[i].split('|');
    assert.equal(state, rows[i].valid ? 'PASS' : 'REFUSE', `${rows[i].name}: ${reason}`);
    assert.deepEqual(flags, ['False', 'False', 'False', 'False'], `${rows[i].name}: authority/qualified storage`);
    if (rows[i].valid) assert.equal(reason, 'RELEASE_PIN_DATA_VERIFIED_ENROLLMENT_UNPROVEN');
  }
  t.diagnostic(`${rows.length} compiled native data vectors; every authority and enrollment flag remained false`);
});

test('Windows native protected files retain handles and reject movement, writable roots and hard links',
  { skip: process.platform !== 'win32', timeout: 60000 }, () => {
  const result = runNativeFixture('files');
  assert.equal(result.files, 'PIN_WRITE_MOVE_DIRECTORY_ACL_AND_HARDLINK_REFUSED');
  if (!existsSync('C:\\Program Files\\Stephanos\\SovereignMobileInstallerV1'))
    assert.equal(result.open, 'RELEASE_PROTECTED_STORAGE_UNPROVEN');
});
