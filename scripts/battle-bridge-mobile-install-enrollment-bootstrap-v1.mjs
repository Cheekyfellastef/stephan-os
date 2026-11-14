// Private offline preparation for the original manually approved Windows route.
// Git integrity, a device assertion and hashes do not grant merge/enrollment.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { prepareMobileInstallEnrollmentReviewV1 } from './battle-bridge-mobile-install-enrollment-review-v1.mjs';
import { inspectFixedRuntimeGitMemberEvidenceV1 } from './sovereign-fixed-runtime-install-source-package-v1.mjs';
import { inspectMobileInstallationEnrollmentDataV1 } from '../shared/agents/battleBridgeMobileInstallationV1.mjs';

export const MOBILE_SETUP_INPUT_V1 = 'stephanos.mobile-installer-setup-review-input.v1';
export const MOBILE_BOOTSTRAP_INPUT_V1 = 'stephanos.mobile-installer-bootstrap-review-input.v1';
const ENTRY = 'scripts/windows/install-battle-bridge-mobile-installer-v1.ps1';
const DECLARATION = 'shared/agents/sovereignMobileInstallerNativeClosureV1.json';
const declarationBytes = readFileSync(new URL('../' + DECLARATION, import.meta.url));
const declaration = JSON.parse(declarationBytes);
const NATIVE_PATHS = declaration.paths;
const paths = [...NATIVE_PATHS, ENTRY, DECLARATION];
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = () => { throw Error('MOBILE_ENROLLMENT_BOOTSTRAP_REVIEW_REFUSED'); };
if (declaration.schemaVersion !== 'stephanos.mobile-installer-native-closure.v1'
    || declaration.maximumUnitBytes !== 32768 || !Array.isArray(NATIVE_PATHS) || NATIVE_PATHS.length !== 16
    || new Set(paths.map(path => path.toLowerCase())).size !== 18
    || hash('stephanos.mobile-installer-native-path-set.v1\0' + [...NATIVE_PATHS].sort().join('\n') + '\n')
      !== '49e2c2d5914cec1987704f2b04c332837078835348114a0a2c262aaab8f27452') fail();
function input(text, keys) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16 * 1024 * 1024) fail();
  let row; try { row = JSON.parse(text); } catch { fail(); }
  if (!row || Array.isArray(row) || Object.keys(row).sort().join(',') !== [...keys].sort().join(',')) fail();
  return row;
}
function freeze(row) {
  if (row && typeof row === 'object') { for (const value of Object.values(row)) freeze(value); Object.freeze(row); }
  return row;
}
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail();
  const ms = Date.parse(value); if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail(); return ms;
}
function prepare(row) {
  if (row.schemaVersion !== MOBILE_SETUP_INPUT_V1 || typeof row.proposedEnrollmentJson !== 'string'
      || Buffer.byteLength(row.proposedEnrollmentJson) > 8192 || typeof row.nonce !== 'string'
      || !/^[a-f0-9]{64}$/.test(row.nonce)) fail();
  const issued = instant(row.issuedAtUtc), expires = instant(row.expiresAtUtc);
  if (expires <= issued || expires - issued > 15 * 60_000) fail();
  let proposed; try { proposed = JSON.parse(row.proposedEnrollmentJson); } catch { fail(); }
  const inspected = inspectMobileInstallationEnrollmentDataV1(proposed);
  if (!inspected.ok || proposed.lastSignCount !== 0) fail();
  const review = prepareMobileInstallEnrollmentReviewV1(JSON.stringify(row.reviewInput));
  const checked = inspectFixedRuntimeGitMemberEvidenceV1(JSON.stringify(row.nativeSourceInput), paths);
  if (checked.sourceHead !== review.source.head || checked.sourceTree !== review.source.tree
      || proposed.machineHash !== row.reviewInput.machineHash || proposed.operatorSid !== row.reviewInput.operatorSid
      || proposed.generation !== row.reviewInput.enrollmentGeneration) fail();
  const records = checked.evidence.records.map(record => {
    const bytes = Buffer.from(record.contentBase64, 'base64');
    if (bytes.length < 1 || bytes.length > 32768) fail();
    const manifest = checked.manifest.find(item => item.path === record.path);
    if (manifest.mode !== '100644' || (record.path === DECLARATION && !bytes.equals(declarationBytes))) fail();
    return { Path: record.path, GitBlobSha: record.blobSha, GitMode: manifest.mode,
      Sha256: manifest.sha256, ContentBase64: record.contentBase64 };
  });
  const descriptor = JSON.stringify({ schemaVersion: 'stephanos.mobile-installer-setup-descriptor.v1',
    repository: review.source.repository, sourceHead: review.source.head, sourceTree: review.source.tree,
    machineHash: proposed.machineHash, operatorSid: proposed.operatorSid, enrollmentGeneration: proposed.generation,
    packageSha256: review.privateFiles.find(file => file.name === 'runtime-package.json').sha256,
    releaseProofSha256: review.privateFiles.find(file => file.name === 'release-evidence.json').sha256,
    proposedEnrollmentSha256: hash(row.proposedEnrollmentJson), nonce: row.nonce,
    issuedAtUtc: row.issuedAtUtc, expiresAtUtc: row.expiresAtUtc });
  const sourceProofWire = 'STEPHANOS_FIXED_RUNTIME_SOURCE_V1 ' + checked.sourceHead + ' '
    + checked.evidence.commit.contentBase64 + ' ' + checked.evidence.trees
      .map(tree => tree.sha + ':' + tree.contentBase64).join(' ');
  return { review, records, descriptor, sourceProofWire, proposed };
}
const setupKeys = ['schemaVersion', 'reviewInput', 'nativeSourceInput', 'proposedEnrollmentJson', 'nonce', 'issuedAtUtc', 'expiresAtUtc'];

/** Descriptor + WebAuthn request for a real separately authenticated setup ceremony. No I/O or authority. */
export function prepareMobileInstallSetupReviewV1(serializedInput) {
  const row = input(serializedInput, setupKeys), prepared = prepare(row);
  return freeze({ schemaVersion: 'stephanos.mobile-installer-setup-review.v1', installability: 'NOT_INSTALLABLE',
    containsPrivateOperatorIdentity: true, source: prepared.review.source, descriptor: prepared.descriptor,
    descriptorSha256: hash(prepared.descriptor), publicKey: {
      challenge: createHash('sha256').update('stephanos.mobile-install-enrollment-proof.v1\0' + prepared.descriptor).digest('base64url'),
      rpId: prepared.proposed.rpId, allowCredentials: [{ type: 'public-key', id: prepared.proposed.credentialId }],
      userVerification: 'required', timeout: Math.min(60000, instant(row.expiresAtUtc) - instant(row.issuedAtUtc)),
    }, requiredGates: prepared.review.requiredGates, authority: prepared.review.authority });
}

/** Capture immutable manual-bootstrap bytes; caller still authenticates review/main and exact approval. */
export function prepareMobileInstallBootstrapReviewV1(serializedInput) {
  const row = input(serializedInput, ['schemaVersion', 'setupInput', 'deviceAssertionJson']);
  if (row.schemaVersion !== MOBILE_BOOTSTRAP_INPUT_V1 || typeof row.deviceAssertionJson !== 'string'
      || Buffer.byteLength(row.deviceAssertionJson) > 16384) fail();
  const setup = input(JSON.stringify(row.setupInput), setupKeys), prepared = prepare(setup);
  let assertion; try { assertion = JSON.parse(row.deviceAssertionJson); } catch { fail(); }
  if (!assertion || Array.isArray(assertion) || assertion.type !== 'public-key'
      || assertion.id !== prepared.proposed.credentialId || !assertion.response) fail();
  const payload = Buffer.from(JSON.stringify({ SourceHead: prepared.review.source.head, SourceTree: prepared.review.source.tree,
    OperatorSid: prepared.proposed.operatorSid, MachineHash: prepared.proposed.machineHash,
    Records: prepared.records, SourceProofWire: prepared.sourceProofWire, ReleaseFiles: prepared.review.privateFiles,
    SetupDescriptor: prepared.descriptor, SetupDescriptorSha256: hash(prepared.descriptor),
    ProposedEnrollmentJson: setup.proposedEnrollmentJson, DeviceAssertionJson: row.deviceAssertionJson }));
  if (payload.length > 16 * 1024 * 1024) fail();
  const payloadSha256 = hash(payload), head = prepared.review.source.head, tree = prepared.review.source.tree;
  const entry = prepared.records.find(record => record.Path === ENTRY);
  const payloadPath = 'C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosMobileInstallerEnrollment-' + head + '.json';
  const script = String.raw`$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
Import-Module 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop
$held=$null
try {
 $path='__PATH__'
 $info=[IO.FileInfo]::new($path)
 if(($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $info.Length -gt 16777216){throw 'MOBILE_SETUP_PAYLOAD_UNSAFE'}
 $held=[IO.FileStream]::new($path,'Open','Read','Read')
 $length=$held.Length;if($length -le 0 -or $length -gt 16777216){throw 'MOBILE_SETUP_PAYLOAD_BOUND'}
 $bytes=[byte[]]::new([int]$length);$at=0
 while($at -lt $bytes.Length){$count=$held.Read($bytes,$at,$bytes.Length-$at);if($count -le 0){throw 'MOBILE_SETUP_PAYLOAD_BOUND'};$at+=$count}
 if($held.ReadByte() -ne -1 -or $held.Length -ne $length){throw 'MOBILE_SETUP_PAYLOAD_BOUND'}
 $hash=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
 if($actual -cne '__PAYLOAD__'){throw 'MOBILE_SETUP_PAYLOAD_CHANGED'}
 $data=([Text.UTF8Encoding]::new($false,$true).GetString($bytes))|ConvertFrom-Json
 if($data.SourceHead -cne '__HEAD__' -or $data.SourceTree -cne '__TREE__'){throw 'MOBILE_SETUP_SOURCE_CHANGED'}
 $entry=@($data.Records|Where-Object{$_.Path -ceq 'scripts/windows/install-battle-bridge-mobile-installer-v1.ps1'})
 if($entry.Count -ne 1 -or $entry[0].Sha256 -cne '__ENTRY__'){throw 'MOBILE_SETUP_ENTRY_UNPROVEN'}
 $source=[Convert]::FromBase64String($entry[0].ContentBase64)
 $hash=[Security.Cryptography.SHA256]::Create()
 try{$actual=([BitConverter]::ToString($hash.ComputeHash($source))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
 if($actual -cne '__ENTRY__'){throw 'MOBILE_SETUP_ENTRY_CHANGED'}
 $script:MobileInstallerEnrollmentPinnedBootstrapV1=$data
 . ([scriptblock]::Create([Text.UTF8Encoding]::new($false,$true).GetString($source))) -OperatorApproved -ExpectedMain '__HEAD__'
}finally {
 $script:MobileInstallerEnrollmentPinnedBootstrapV1=$null
 if($null -ne $held){$held.Dispose()}
}`.replaceAll('__PATH__', payloadPath).replaceAll('__PAYLOAD__', payloadSha256)
    .replaceAll('__HEAD__', head).replaceAll('__TREE__', tree).replaceAll('__ENTRY__', entry.Sha256);
  const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');
  if (encodedCommand.length > 30000) fail();
  return freeze({ schemaVersion: 'stephanos.mobile-installer-bootstrap-review.v1', installability: 'NOT_INSTALLABLE',
    containsPrivateOperatorIdentity: true, source: prepared.review.source,
    privateCandidate: { payloadPath, payloadBase64: payload.toString('base64'), payloadSha256,
      script, scriptSha256: hash(script), encodedCommand,
      powershellExecutable: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
    requiredGates: prepared.review.requiredGates, authority: prepared.review.authority });
}
