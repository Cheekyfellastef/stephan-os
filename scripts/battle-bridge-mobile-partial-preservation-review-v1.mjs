// Inert manual preservation preparation; no filesystem, elevation or authority.
import { createHash } from 'node:crypto';
import { inspectFixedRuntimeGitMemberEvidenceV1 } from './sovereign-fixed-runtime-install-source-package-v1.mjs';

export const MOBILE_PARTIAL_PRESERVATION_INPUT_V1 = 'stephanos.mobile-partial-preservation-review-input.v1';
const ENTRY = 'scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = () => { throw Error('MOBILE_PARTIAL_REVIEW_REFUSED'); };

export function prepareMobilePartialPreservationReviewV1(serialized) {
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 4 * 1024 * 1024) fail();
  let row; try { row = JSON.parse(serialized); } catch { fail(); }
  const keys = ['schemaVersion', 'sourceInput', 'expectedMain', 'sourceTree', 'operatorSid', 'machineHash', 'mode', 'fingerprint'];
  if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== keys.sort().join(',')
      || row.schemaVersion !== MOBILE_PARTIAL_PRESERVATION_INPUT_V1
      || !/^S-1-5-21-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}-[0-9]{1,10}$/.test(row.operatorSid)
      || !/^[a-f0-9]{64}$/.test(row.machineHash)
      || (row.mode !== 'Observe' && row.mode !== 'Preserve')
      || (row.mode === 'Observe' ? row.fingerprint !== null : !/^[a-f0-9]{64}$/.test(row.fingerprint))) fail();
  const checked = inspectFixedRuntimeGitMemberEvidenceV1(JSON.stringify(row.sourceInput), [ENTRY]);
  if (checked.sourceHead !== row.expectedMain || checked.sourceTree !== row.sourceTree) fail();
  const record = checked.evidence.records[0], member = checked.manifest[0];
  const bytes = Buffer.from(record.contentBase64, 'base64');
  if (member.mode !== '100644' || bytes.length < 1 || bytes.length > 32768 || member.sha256 !== hash(bytes)) fail();
  const payload = Buffer.from(JSON.stringify({ SourceHead: checked.sourceHead, SourceTree: checked.sourceTree,
    OperatorSid: row.operatorSid, MachineHash: row.machineHash, Mode: row.mode, Fingerprint: row.fingerprint,
    EntryBase64: record.contentBase64, EntrySha256: member.sha256 }));
  const payloadSha256 = hash(payload);
  const path = 'C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosMobilePartialPreservation-'
    + checked.sourceHead + '-' + row.mode + '-' + (row.fingerprint ?? 'observation') + '.json';
  const script = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$held=$null
try {
 $path='__PATH__';$info=[IO.FileInfo]::new($path)
 if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $info.Length -gt 65536){throw 'MOBILE_PARTIAL_PAYLOAD_UNSAFE'}
 $held=[IO.FileStream]::new($path,'Open','Read','Read');$length=$held.Length
 if($length -le 0 -or $length -gt 65536){throw 'MOBILE_PARTIAL_PAYLOAD_BOUND'}
 $bytes=[byte[]]::new([int]$length);$at=0
 while($at -lt $bytes.Length){$n=$held.Read($bytes,$at,$bytes.Length-$at);if($n -le 0){throw 'MOBILE_PARTIAL_PAYLOAD_BOUND'};$at+=$n}
 if($held.ReadByte() -ne -1 -or $held.Length -ne $length){throw 'MOBILE_PARTIAL_PAYLOAD_BOUND'}
 $sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '__PAYLOAD__'){throw 'MOBILE_PARTIAL_PAYLOAD_CHANGED'}
 $data=([Text.UTF8Encoding]::new($false,$true).GetString($bytes))|ConvertFrom-Json
 if($data.SourceHead -cne '__HEAD__' -or $data.SourceTree -cne '__TREE__' -or $data.EntrySha256 -cne '__ENTRY__'){throw 'MOBILE_PARTIAL_SOURCE_CHANGED'}
 $source=[Convert]::FromBase64String($data.EntryBase64);$sha=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($sha.ComputeHash($source))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
 if($actual -cne '__ENTRY__'){throw 'MOBILE_PARTIAL_ENTRY_CHANGED'}
 $script:MobileInstallerPartialPreservationPinnedV1=$data
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($source))) -Mode '__MODE__' __APPROVAL__ -ExpectedMain '__HEAD__' -ExpectedFingerprint '__FINGERPRINT__'
}finally {
 $script:MobileInstallerPartialPreservationPinnedV1=$null
 if($null -ne $held){$held.Dispose()}
}`.replaceAll('__PATH__', path).replaceAll('__PAYLOAD__', payloadSha256)
    .replaceAll('__HEAD__', checked.sourceHead).replaceAll('__TREE__', checked.sourceTree).replaceAll('__ENTRY__', member.sha256)
    .replaceAll('__MODE__', row.mode).replaceAll('__APPROVAL__', row.mode === 'Preserve' ? '-OperatorApproved' : '')
    .replaceAll('__FINGERPRINT__', row.fingerprint ?? '');
  const candidate = Object.freeze({ payloadPath: path, payloadBase64: payload.toString('base64'), payloadSha256,
    script, scriptSha256: hash(script), encodedCommand: Buffer.from(script, 'utf16le').toString('base64'),
    powershellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' });
  if (candidate.encodedCommand.length > 30000) fail();
  return Object.freeze({ schemaVersion: 'stephanos.mobile-partial-preservation-review.v1', installability: 'NOT_INSTALLABLE',
    containsPrivateOperatorIdentity: true, source: Object.freeze({ head: checked.sourceHead, tree: checked.sourceTree }),
    mode: row.mode, fingerprint: row.fingerprint, privateCandidate: candidate,
    operation: 'QUARANTINE_EXACT_DIRECTORY_OBJECT_ALL_CONTENTS_OPAQUE',
    requiredGates: Object.freeze(['AUTHENTICATED_CURRENT_MERGED_SOURCE', 'INDEPENDENT_WINDOWS_SECURITY_SPECIALIST_REVIEW',
      'ACTUAL_SAME_OPERATOR_ADMINISTRATOR', ...(row.mode === 'Preserve' ? ['EXACT_DIRECTORY_OBJECT_ALL_CONTENTS_QUARANTINE_APPROVAL'] : [])]),
    authority: Object.freeze({ administrator: false, preservation: false, enrollment: false, installation: false, reboot: false }) });
}
