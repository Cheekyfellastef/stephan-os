// Inert exact-key retirement preparation; no elevation or live authority.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspectFixedRuntimeGitMemberEvidenceV1 } from './sovereign-fixed-runtime-install-source-package-v1.mjs';

export const MOBILE_KEY_RETIREMENT_INPUT_V1 = 'stephanos.mobile-key-retirement-review-input.v1';
const ENTRY = 'scripts/windows/retire-battle-bridge-mobile-key-v1.ps1';
const PRESERVE = 'scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1';
const DECLARATION = 'shared/agents/sovereignMobileInstallerNativeClosureV1.json';
const declaration = JSON.parse(readFileSync(new URL('../' + DECLARATION, import.meta.url)));
const PATHS = [...declaration.paths, DECLARATION, PRESERVE, ENTRY];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('MOBILE_RETIRE_REVIEW_REFUSED'); };
if (declaration.schemaVersion !== 'stephanos.mobile-installer-native-closure.v1'
    || declaration.maximumUnitBytes !== 32768 || declaration.paths.length !== 17
    || new Set(PATHS.map(path => path.toLowerCase())).size !== 20
    || hash('stephanos.mobile-installer-native-path-set.v1\0' + [...declaration.paths].sort().join('\n') + '\n')
      !== '46d8a59b69ee6f93f8080ffcb735230e88057499b7654639011b8824cc6863e9') fail();

export function prepareMobileKeyRetirementReviewV1(serialized) {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 4 * 1024 * 1024) fail();
  let row; try { row = JSON.parse(serialized); } catch { fail(); }
  const keys = ['schemaVersion', 'sourceInput', 'expectedMain', 'sourceTree', 'operatorSid', 'machineHash', 'mode', 'fingerprint', 'keySha256'];
  if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== keys.sort().join(',')
      || row.schemaVersion !== MOBILE_KEY_RETIREMENT_INPUT_V1
      || !/^S-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}$/.test(row.operatorSid)
      || !/^[a-f0-9]{64}$/.test(row.machineHash)
      || !/^[a-f0-9]{64}$/.test(row.keySha256)
      || (row.mode !== 'Observe' && row.mode !== 'Retire')
      || (row.mode === 'Observe' ? row.fingerprint !== null : !/^[a-f0-9]{64}$/.test(row.fingerprint))) fail();
  const checked = inspectFixedRuntimeGitMemberEvidenceV1(JSON.stringify(row.sourceInput), PATHS);
  if (checked.sourceHead !== row.expectedMain || checked.sourceTree !== row.sourceTree) fail();
  const records = checked.evidence.records.map(record => {
    const member = checked.manifest.find(row => row.path === record.path), bytes = Buffer.from(record.contentBase64, 'base64');
    if (!member || member.mode !== '100644' || bytes.length < 1 || bytes.length > 32768 || member.sha256 !== hash(bytes)) fail();
    return { Path: record.path, Sha256: member.sha256, ContentBase64: record.contentBase64 };
  });
  const record = checked.evidence.records.find(row => row.path === ENTRY), member = checked.manifest.find(row => row.path === ENTRY);
  const bytes = Buffer.from(record.contentBase64, 'base64');
  if (member.mode !== '100644' || bytes.length < 1 || bytes.length > 32768 || member.sha256 !== hash(bytes)) fail();
  const payload = Buffer.from(JSON.stringify({ SourceHead: checked.sourceHead, SourceTree: checked.sourceTree,
    OperatorSid: row.operatorSid, MachineHash: row.machineHash, Mode: row.mode, Fingerprint: row.fingerprint,
    Records: records, KeySha256: row.keySha256, EntryBase64: record.contentBase64, EntrySha256: member.sha256 }));
  const payloadSha256 = hash(payload);
  const path = 'C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosMobileKeyRetirement-'
    + checked.sourceHead + '-' + row.mode + '-' + (row.fingerprint ?? 'observation') + '.json';
  const script = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$held=$null
try {
 $path='__PATH__';$info=[IO.FileInfo]::new($path)
 if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $info.Length -gt 1048576){throw 'MOBILE_RETIRE_PAYLOAD_UNSAFE'}
 $held=[IO.FileStream]::new($path,'Open','Read','Read');$length=$held.Length
 if($length -le 0 -or $length -gt 1048576){throw 'MOBILE_RETIRE_PAYLOAD_BOUND'}
 $bytes=[byte[]]::new([int]$length);$at=0
 while($at -lt $bytes.Length){$n=$held.Read($bytes,$at,$bytes.Length-$at);if($n -le 0){throw 'MOBILE_RETIRE_PAYLOAD_BOUND'};$at+=$n}
 if($held.ReadByte() -ne -1 -or $held.Length -ne $length){throw 'MOBILE_RETIRE_PAYLOAD_BOUND'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '__PAYLOAD__'){throw 'MOBILE_RETIRE_PAYLOAD_CHANGED'}
 $data=([Text.UTF8Encoding]::new($false,$true).GetString($bytes))|ConvertFrom-Json
 if($data.SourceHead -cne '__HEAD__' -or $data.SourceTree -cne '__TREE__' -or $data.EntrySha256 -cne '__ENTRY__'){throw 'MOBILE_RETIRE_SOURCE_CHANGED'}
 $source=[Convert]::FromBase64String($data.EntryBase64);$sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($source))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '__ENTRY__'){throw 'MOBILE_RETIRE_ENTRY_CHANGED'}
 $script:MobileInstallerKeyRetirementPinnedV1=$data
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($source))) -Mode '__MODE__' __APPROVAL__ -ExpectedMain '__HEAD__' -ExpectedFingerprint '__FINGERPRINT__' -ExpectedKeySha256 '__KEY__'
}finally {
 $script:MobileInstallerKeyRetirementPinnedV1=$null
 if($null -ne $held){$held.Dispose()}
}`.replaceAll('__PATH__', path).replaceAll('__PAYLOAD__', payloadSha256)
    .replaceAll('__HEAD__', checked.sourceHead).replaceAll('__TREE__', checked.sourceTree).replaceAll('__ENTRY__', member.sha256)
    .replaceAll('__MODE__', row.mode).replaceAll('__APPROVAL__', row.mode === 'Retire' ? '-OperatorApproved' : '')
    .replaceAll('__FINGERPRINT__', row.fingerprint ?? '').replaceAll('__KEY__', row.keySha256);
  const candidate = Object.freeze({ payloadPath: path, payloadBase64: payload.toString('base64'), payloadSha256,
    script, scriptSha256: hash(script), encodedCommand: Buffer.from(script, 'utf16le').toString('base64'),
    powershellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' });
  if (candidate.encodedCommand.length > 30000) fail();
  return Object.freeze({ schemaVersion: 'stephanos.mobile-key-retirement-review.v1', installability: 'NOT_INSTALLABLE',
    containsPrivateOperatorIdentity: true, source: Object.freeze({ head: checked.sourceHead, tree: checked.sourceTree }),
    mode: row.mode, fingerprint: row.fingerprint, privateCandidate: candidate,
    operation: 'RETIRE_UNQUALIFIED_MOBILE_RECEIPT_KEY_V1', keySha256: row.keySha256,
    requiredGates: Object.freeze(['AUTHENTICATED_CURRENT_MERGED_SOURCE', 'INDEPENDENT_WINDOWS_SECURITY_SPECIALIST_REVIEW',
      'ACTUAL_SAME_OPERATOR_ADMINISTRATOR', ...(row.mode === 'Retire' ? ['EXACT_UNQUALIFIED_KEY_RETIREMENT_APPROVAL'] : [])]),
    authority: Object.freeze({ administrator: false, keyRetirement: false, preservation: false, enrollment: false, installation: false, reboot: false }) });
}
