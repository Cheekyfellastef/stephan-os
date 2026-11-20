import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1 = Object.freeze([
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs',
]);

export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1 = Object.freeze({
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1': '8883b76eb04a4857e5627391d612dd09a02a8a97',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs': '6c5f32afbba17c21d72aff7f983622862409c73b',
});

// Continuation of the original #3363 reviewer for the original #2961/#2573
// runtime branch. These are source-review pins, never native qualification.
export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_PATHS_V1 = Object.freeze([
  ...WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1,
  'scripts/windows/SovereignMobileInstallReleaseV1.cs',
]);
export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_BLOBS_V1 = Object.freeze({
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1': '528fe3a5f611a89fb9dd25e215283cc1562b3d60',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs': '5b5e0ba37ad904523945e0dff2a38010bc6a8937',
  'scripts/windows/SovereignMobileInstallReleaseV1.cs': '914940cee363e8eb569d76a43afcd5c88db8eef5',
});
const CLOSURE_3551_PATH_SET_SHA256 = '62dd881fd8f0a25dbc26f73c4750d3be047960acaccc8577e0f7a2c8220973f9';
const CLOSURE_3551_INTEGRATION_MEMBERS = Object.freeze([
  'integrations/openclaw/stephanos-builder-provider/lib/oc1-gateway-provider.mjs',
  'integrations/openclaw/stephanos-builder-provider/lib/oc1-repository-scout.mjs',
  'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs',
  'integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA40 = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const REVIEWED_PR = 3362;
const REVIEWED_BRANCH = 'fix/2961-fixed-runtime-closure-relay-proof-20261031';
const MAX_SOURCE_BYTES = 256 * 1024;

const text = value => typeof value === 'string' ? value.trim() : '';
const finding = (code, summary, path) => Object.freeze({ severity: 'P0', code, summary, path });

function plainDataRecord(value) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Reflect.ownKeys(value).every(key => {
    const d = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && d && Object.hasOwn(d, 'value') && d.enumerable === true;
  });
}

function plainDataArray(value, maximum) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return false;
  return Array.from({ length: value.length }, (_, i) => Object.getOwnPropertyDescriptor(value, String(i)))
    .every(d => d && Object.hasOwn(d, 'value') && d.enumerable === true);
}

function blobSha(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function exactEscalation(analysis, reviewedPaths) {
  if (!plainDataRecord(analysis) || !plainDataArray(analysis.findings, reviewedPaths.length)
      || analysis.findings.length !== reviewedPaths.length
      || !plainDataRecord(analysis.counts)
      || analysis.counts.P0 !== reviewedPaths.length || analysis.counts.P1 !== 0 || analysis.counts.P2 !== 0) return false;
  const paths = [];
  for (const row of analysis.findings) {
    if (!plainDataRecord(row)
        || text(row.severity).toUpperCase() !== 'P0'
        || text(row.code) !== 'unsupported-high-risk-surface'
        || !reviewedPaths.includes(text(row.path))) return false;
    paths.push(text(row.path));
  }
  return new Set(paths).size === reviewedPaths.length;
}

function exactLineage(lineage, sourceHead, baseSha) {
  if (!plainDataRecord(lineage) || lineage.schemaVersion !== LINEAGE_SCHEMA
      || lineage.repository !== REPOSITORY
      || lineage.sourceHead !== sourceHead
      || lineage.sourceCommitSha !== sourceHead
      || lineage.baseSha !== baseSha
      || lineage.liveMainBeforeSha !== baseSha
      || lineage.liveMainAfterSha !== baseSha
      || !plainDataRecord(lineage.comparison)) return false;
  const c = lineage.comparison;
  return c.status === 'ahead'
    && Number.isSafeInteger(c.aheadBy) && c.aheadBy >= 1
    && c.behindBy === 0
    && c.baseCommitSha === baseSha
    && c.mergeBaseCommitSha === baseSha;
}

function exactSource(source, sourceHead, path, reviewedBlobs) {
  if (!plainDataRecord(source)) return false;
  const body = typeof source.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(body, 'utf8');
  return source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && bytes > 0 && bytes <= MAX_SOURCE_BYTES
    && SHA40.test(text(source.blobSha))
    && source.blobSha === blobSha(body)
    && source.blobSha === reviewedBlobs[path];
}

function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}
function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}

function reviewInstaller(source, findings, path) {
  for (const [literal, code, summary] of [
    ["param([switch]$OperatorApproved,[string]$ExpectedMain='')", 'fixed-runtime-installer-operator-gate-missing', 'Installer must retain the explicit operator-approved exact-main gate.'],
    ["$bootstrap.Records.Count -lt 40 -or $bootstrap.Records.Count -gt 258", 'fixed-runtime-installer-closure-bound-changed', 'Installer source estate must remain capped at exactly 258 members.'],
    ["throw 'FIXED_INSTALL_ADMINISTRATOR_REQUIRED'", 'fixed-runtime-installer-admin-gate-missing', 'Installer must require an administrator token only at the attended install boundary.'],
    ["if($identity.User.Value -cne $bootstrap.OperatorSid){throw 'FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED'}", 'fixed-runtime-installer-operator-identity-gate-missing', 'Elevated installer identity must remain bound to the initiating operator SID.'],
    ["$sourceRoot='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os'", 'fixed-runtime-installer-source-root-not-fixed', 'Installer source root must remain canonical and fixed.'],
    ["$protectedRoot='C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1'", 'fixed-runtime-installer-protected-root-not-fixed', 'Installer output root must remain the fixed protected Program Files location.'],
    ["@('.git/HEAD','ref: refs/heads/main'),@('.git/refs/heads/main',$ExpectedMain)", 'fixed-runtime-installer-ref-proof-missing', 'Installer must retain exact main ref proof immediately from physical source.'],
    ["if([DateTime]::Parse($installed) -le [DateTime]::Parse($compileCompleted)){throw 'FIXED_INSTALL_TIME_ORDER_UNPROVEN'}", 'fixed-runtime-installer-time-order-gate-missing', 'Installer must prove compilation completed before installation.'],
    ["# PENDING only: true later full boot + authenticated custody IDLE + exact pins", 'fixed-runtime-installer-pending-only-contract-missing', 'Installer must remain pending-only and require a genuinely later boot.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [pattern, code, summary] of [
    [/\b(?:Invoke-Expression|Invoke-Command|Start-Job|Restart-Computer|Stop-Computer|shutdown\.exe)\b/i,
      'fixed-runtime-installer-authority-widened', 'Installer must not gain dynamic shell or host-restart authority.'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget)\b/i,
      'fixed-runtime-installer-network-authority-forbidden', 'Installer must not gain network download authority.'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i,
      'fixed-runtime-installer-git-mutation-forbidden', 'Installer must not gain Git mutation or publication authority.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

function reviewIdentity(source, findings, path) {
  for (const [literal, code, summary] of [
    ['const string RuntimeSourceRootV1 = @"C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os";', 'fixed-runtime-identity-source-root-not-fixed', 'Runtime source root must remain canonical and fixed.'],
    ['const string RuntimeProtectedRootV1 = @"C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1";', 'fixed-runtime-identity-protected-root-not-fixed', 'Runtime helper root must remain the fixed protected Program Files location.'],
    ['return compiled<installed && installed<boot && boot<now;', 'fixed-runtime-identity-later-boot-order-missing', 'Runtime qualification must retain compile-before-install-before-later-boot ordering.'],
    ['manifest.Files==null || manifest.Files.Length<40 || manifest.Files.Length>258)', 'fixed-runtime-identity-closure-bound-changed', 'Runtime manifest must remain capped at exactly 258 members.'],
    ['pending.SourceHead!=manifest.SourceHead || pending.SourceTree!=manifest.SourceTree ||', 'fixed-runtime-identity-pending-source-binding-missing', 'Pending receipt must remain bound to exact source head and tree.'],
    ['throw new InvalidOperationException("RUNTIME_PENDING_LATER_BOOT_UNPROVEN");', 'fixed-runtime-identity-later-boot-failclose-missing', 'Missing later-boot proof must remain fail closed.'],
    ['new WindowsPrincipal(principal).IsInRole(WindowsBuiltInRole.Administrator)', 'fixed-runtime-identity-normal-operator-gate-missing', 'Runtime execution must reject administrator context after installation.'],
    ['string expected=relative==".git/HEAD"?"ref: refs/heads/main":manifest.SourceHead;', 'fixed-runtime-identity-main-ref-binding-missing', 'Runtime must pin physical Git main identity to the installed source head.'],
    ['throw new InvalidOperationException("RUNTIME_SOURCE_REF_CHANGED");', 'fixed-runtime-identity-source-ref-failclose-missing', 'Source ref drift must remain fail closed.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [pattern, code, summary] of [
    [/\bProcess\.Start\s*\(/, 'fixed-runtime-identity-process-authority-forbidden', 'Identity validator must not start arbitrary processes.'],
    [/\b(?:WebClient|HttpClient|WebRequest|FtpWebRequest)\b/, 'fixed-runtime-identity-network-authority-forbidden', 'Identity validator must not gain network authority.'],
    [/\b(?:RegistryKey\.CreateSubKey|SetValue|DeleteValue|DeleteSubKey)\b/, 'fixed-runtime-identity-registry-mutation-forbidden', 'Identity validator must not mutate the registry.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

function reviewClosure3551Installer(source, findings, path) {
  for (const [literal, code] of [
    ["param([switch]$OperatorApproved,[string]$ExpectedMain='')", 'operator-gate'],
    ["if(-not $OperatorApproved -or $ExpectedMain -cnotmatch '^[a-f0-9]{40}$' -or", 'exact-main-gate'],
    ["$null -eq $bootstrap -or $bootstrap.SourceHead -cne $ExpectedMain -or", 'bootstrap-head-binding'],
    ["$bootstrap.SourceTree -cnotmatch '^[a-f0-9]{40}$' -or", 'bootstrap-tree-binding'],
    ["$bootstrap.Records.Count -lt 40 -or $bootstrap.Records.Count -gt 302){throw 'FIXED_INSTALL_IMMUTABLE_APPROVAL_REQUIRED'}", 'closure-bound'],
    ["throw 'FIXED_INSTALL_ADMINISTRATOR_REQUIRED'", 'attended-admin-gate'],
    ["if($identity.User.Value -cne $bootstrap.OperatorSid){throw 'FIXED_INSTALL_OPERATOR_IDENTITY_CHANGED'}", 'operator-identity'],
    ["$sourceRoot='C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os'", 'fixed-source-root'],
    ["$protectedRoot='C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1'", 'fixed-protected-root'],
    ["$row.Path.Contains('..') -or $row.Path.Contains('//') -or $records.ContainsKey($row.Path)", 'member-alias-denial'],
    ["$row.GitBlobSha -cnotmatch '^[a-f0-9]{40}$' -or $row.GitMode -cne '100644'", 'member-git-identity'],
    ["$bytes.Length -gt 2097152 -or $total -gt 8388608 -or (Get-Digest $bytes) -cne $row.Sha256 -or", 'member-byte-bound'],
    ["(Get-GitBlob $bytes) -cne $row.GitBlobSha", 'member-blob-binding'],
    ["$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($administrators)", 'protected-acl'],
    ["$operator,'ReadAndExecute',$inherit,'None','Allow'", 'operator-read-only'],
    ["throw 'FIXED_INSTALL_REDIRECTION_REFUSED'", 'reparse-denial'],
    ["throw 'FIXED_INSTALL_WRITE_AUTHORITY_UNPROVEN'", 'write-authority-denial'],
    ["if([IO.Directory]::Exists($version) -or [IO.File]::Exists($version)){throw 'FIXED_INSTALL_VERSION_ALREADY_EXISTS_INSPECT_ONLY'}", 'existing-version-denial'],
    ["$actual=Read-FixedInstallerBoundedBytesV1 $file $maximum 'FIXED_INSTALL_CANONICAL_BYTES_CHANGED'", 'opened-stream-bound'],
    ["if((Get-Digest $actual) -cne $row.MaterializedSha256)", 'physical-byte-binding'],
    ["@('.git/HEAD','ref: refs/heads/main'),@('.git/refs/heads/main',$ExpectedMain)", 'physical-main-binding'],
    ["if([DateTime]::Parse($installed) -le [DateTime]::Parse($compileCompleted)){throw 'FIXED_INSTALL_TIME_ORDER_UNPROVEN'}", 'compile-install-order'],
    ["# PENDING only: true later full boot + authenticated custody IDLE + exact pins", 'pending-only'],
    ["[IO.FileStream]::new($pendingPath,'CreateNew','Write','None')", 'pending-create-only'],
  ]) requireLiteral(findings, source, literal, `fixed-runtime-3551-installer-${code}`,
    'The #3551 installer must retain the reviewed operator, membership, physical-source and pending-install guards.', path);

  const rule = source.match(/\$row\.Path -cnotmatch '([^']+)'/);
  const expected = '^(?:(?:scripts|shared|stephanos-server)/[A-Za-z0-9._/-]+|package\\.json|\\.gitattributes|integrations/openclaw/stephanos-builder-provider/lib/(?:oc1-(?:gateway-provider|repository-scout)|oc2-(?:deterministic-test-build|gateway-provider))\\.mjs|src/windows/Stephanos\\.SpatialWindow/SpatialWindow\\.cpp)$';
  if (!rule || rule[1] !== expected) findings.push(finding('fixed-runtime-3551-installer-exact-integration-membership',
    'Only the two existing OC1 and two exact OC2 integration filenames may enter this installer path rule.', path));
  for (const [pattern, code] of [
    [/\b(?:Invoke-Expression|Invoke-Command|Start-Job|Restart-Computer|Stop-Computer|shutdown\.exe)\b/i, 'shell-or-restart-authority'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget)\b/i, 'network-authority'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'git-mutation'],
  ]) forbidPattern(findings, source, pattern, `fixed-runtime-3551-installer-${code}`,
    'The bounded installer must not acquire unrelated execution, network or Git authority.', path);
}

function reviewClosure3551Identity(source, findings, path) {
  for (const [literal, code] of [
    ['const int RuntimeSourceMemberLimitV1 = 302;', 'closure-bound'],
    ['const string RuntimeSourceRootV1 = @"C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os";', 'fixed-source-root'],
    ['const string RuntimeProtectedRootV1 = @"C:\\Program Files\\Stephanos\\SovereignFixedRuntimeV1";', 'fixed-protected-root'],
    ['return compiled<installed && installed<boot && boot<now;', 'later-boot-order'],
    ['manifest.Files==null || manifest.Files.Length<40 || manifest.Files.Length>RuntimeSourceMemberLimitV1)', 'manifest-bound'],
    ['members==null || members.Length<1 || members.Length>RuntimeSourceMemberLimitV1)', 'git-closure-bound'],
    ['pending.SourceHead!=manifest.SourceHead || pending.SourceTree!=manifest.SourceTree ||', 'pending-source-binding'],
    ['pending.ManifestSha256!=manifestDigest || pending.HelperSha256!=RuntimeHashV1(helperBytes) ||', 'pending-byte-binding'],
    ['pending.MachineHash!=machine || !RuntimePendingBootOrderV1(pending,boot,DateTime.UtcNow)', 'machine-and-boot-binding'],
    ['throw new InvalidOperationException("RUNTIME_PENDING_LATER_BOOT_UNPROVEN");', 'later-boot-failclose'],
    ['if(principal.User.Value!=pending.OperatorSid ||', 'normal-operator-binding'],
    ['new WindowsPrincipal(principal).IsInRole(WindowsBuiltInRole.Administrator)', 'administrator-denial'],
    ['RuntimeProtectedAclV1(helper,false); RuntimeProtectedAclV1(pendingPath,false);', 'protected-storage'],
    ['RuntimePinFixedExecutableV1(executablePaths[i],executableHashes[i],executableLinks[i],pins);', 'fixed-tool-pins'],
    ['row.Path.Contains("..") || row.Path.Contains("//") || !RuntimeHexV1(row.Sha256,64) ||', 'member-path-denial'],
    ['!RuntimeHexV1(row.MaterializedSha256,64) || !seen.Add(row.Path)', 'member-alias-denial'],
    ['if(total>8388608 || RuntimeHashV1(bytes)!=row.MaterializedSha256)', 'physical-byte-binding'],
    ['if(RuntimeGitHashV1("commit",commit)!=fields[1])', 'commit-proof-binding'],
    ['RuntimeGitHashV1("tree",bytes)!=id)', 'tree-proof-binding'],
    ['else if(leaf.Mode!=row.GitMode || leaf.Sha!=row.GitBlobSha)', 'git-member-binding'],
    ['pending.GitClosureSha256!=source.Closure)', 'protected-closure-binding'],
    ['string expected=relative==".git/HEAD"?"ref: refs/heads/main":executionHead;', 'physical-main-binding'],
    ['throw new InvalidOperationException("RUNTIME_SOURCE_REF_CHANGED");', 'source-ref-failclose'],
  ]) requireLiteral(findings, source, literal, `fixed-runtime-3551-identity-${code}`,
    'The #3551 identity validator must preserve bounded membership, physical pins, normal-operator and later-boot proof.', path);
  const guard = source.match(/foreach\(var row in manifest\.Files\) \{([\s\S]*?)string path=Path\.Combine/);
  const members = guard ? [...guard[1].matchAll(/row\.Path=="([^"]+)"/g)].map(match => match[1]).sort() : [];
  const expectedMembers = ['package.json', '.gitattributes', ...CLOSURE_3551_INTEGRATION_MEMBERS,
    'src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp'].sort();
  if (JSON.stringify(members) !== JSON.stringify(expectedMembers)
      || !guard?.[1].includes('Regex.IsMatch(row.Path,@"^(scripts|shared|stephanos-server)/[A-Za-z0-9._/-]+$"))')) {
    findings.push(finding('fixed-runtime-3551-identity-exact-integration-membership',
      'Native membership must admit only the existing fixed roots and the exact four OC1/OC2 integration members.', path));
  }
  reviewClosure3551ReadOnlyNative(source, findings, path, 'identity');
}

function reviewClosure3551Mobile(source, findings, path) {
  for (const [literal, code] of [
    ['ExecutionAuthorityGranted=false, EnrollmentQualified=false, ReleaseEligibilityVerified=false;', 'no-qualification-authority'],
    ['internal const string ProtectedRoot=@"C:\\Program Files\\Stephanos\\SovereignMobileInstallerV1";', 'fixed-protected-root'],
    ['internal const int PackageLimit=16777216, EvidenceLimit=1048576, BootstrapLimit=32768;', 'input-bounds'],
    ['internal const int ExpectedPathCount=302;', 'path-count'],
    [`internal const string ExpectedPathSetSha256="${CLOSURE_3551_PATH_SET_SHA256}";`, 'path-set-pin'],
    ['fields["repository"]!="Cheekyfellastef/stephan-os" || fields["action"]!="INSTALL_SOVEREIGN_FIXED_RUNTIME_V1"', 'operation-binding'],
    ['row==null || row.Count!=keys.Length', 'closed-records'],
    ['paths.Sort(StringComparer.Ordinal);', 'path-order'],
    ['"stephanos.mobile-install-release-path-set.v1\\0"+String.Join("\\n",paths.ToArray())+"\\n"', 'path-set-domain'],
    ['Text(package,"SourceHead")!=pin["sourceHead"] || Text(package,"SourceTree")!=pin["sourceTree"] ||', 'package-source-binding'],
    ['Text(package,"OperatorSid")!=pin["operatorSid"])Deny("RELEASE_PACKAGE_BINDING");', 'package-operator-binding'],
    ['if(records.Count!=ExpectedPathCount)Deny("RELEASE_PACKAGE_MEMBERSHIP");', 'exact-membership-count'],
    ['new HashSet<string>(StringComparer.OrdinalIgnoreCase)', 'member-alias-denial'],
    ['Hash(content)!=sha || GitBlob(content)!=blob)Deny("RELEASE_PACKAGE_CONTENT");', 'member-byte-binding'],
    ['if(PathSet(paths)!=ExpectedPathSetSha256 || closure==null)Deny("RELEASE_PACKAGE_MEMBERSHIP");', 'exact-package-path-set'],
    ['declaredPaths.Count!=ExpectedPathCount || PathSet(declaredPaths)!=ExpectedPathSetSha256 ||', 'declared-path-set-binding'],
    ['CoreJobCustodyV1.MobileReleaseGitClosureV1(members.ToArray())!=pin["closureSha256"])Deny("RELEASE_CLOSURE_BINDING");', 'git-closure-binding'],
    ['pin["machineHash"]!=expectedMachine || pin["operatorSid"]!=expectedOperator || expectedGeneration<1 ||', 'target-binding'],
    ['Hash(payload)!=pin["packageSha256"] || Hash(bootstrap)!=pin["bootstrapSha256"] ||', 'captured-byte-binding'],
    ['"RELEASE_PIN_DATA_VERIFIED_ENROLLMENT_UNPROVEN"', 'captured-remains-unqualified'],
    ['"RELEASE_PROTECTED_DATA_VERIFIED_ENROLLMENT_UNPROVEN"', 'protected-remains-unqualified'],
    ['if(row.ContainsKey(key) || row.Count>=8)Deny("RELEASE_JSON_DUPLICATE_OR_BOUND");', 'duplicate-json-denial'],
    ['if(at!=input.Length)Deny("RELEASE_JSON_TRAILING");', 'trailing-json-denial'],
    ['GetSecurityInfo(handle,1,5,out owner,out group,out dacl,out sacl,out descriptor)', 'handle-bound-acl'],
    ['!trusted(common.SecurityIdentifier.Value))throw new IOException("RELEASE_PROTECTED_WRITE_AUTHORITY_UNPROVEN");', 'protected-write-denial'],
    ['string[] names={"release.pin","runtime-package.json","runtime-bootstrap.ps1","release-evidence.json"};', 'fixed-file-estate'],
    ['if(file.ReadByte()!=-1 || file.Length!=size)throw new IOException("RELEASE_PROTECTED_READ_UNPROVEN");', 'retained-handle-read-bound'],
  ]) requireLiteral(findings, source, literal, `fixed-runtime-3551-mobile-${code}`,
    'The #3551 mobile inspector must retain exact package/target/byte membership and remain unqualified for enrollment or execution.', path);
  reviewClosure3551ReadOnlyNative(source, findings, path, 'mobile');
}

function reviewClosure3551ReadOnlyNative(source, findings, path, kind) {
  for (const [pattern, code] of [
    [/\b(?:Process\.Start|CreateProcess\w*|ShellExecute\w*|CompileAssembly\w*)\s*\(/, 'process-authority'],
    [/\b(?:WebClient|HttpClient|WebRequest|FtpWebRequest)\b/, 'network-authority'],
    [/\b(?:RegistryKey\.CreateSubKey|SetValue|DeleteValue|DeleteSubKey)\b/, 'registry-mutation'],
    [/\b(?:File\.(?:Write\w*|Delete|Move|Copy|Create)|Directory\.(?:CreateDirectory|Delete|Move))\s*\(/, 'filesystem-mutation'],
  ]) forbidPattern(findings, source, pattern, `fixed-runtime-3551-${kind}-${code}`,
    'This fixed native source must remain an identity or release-data inspector without new mutation authority.', path);
}

function reviewClosure3551(source, findings, path) {
  if (path.endsWith('.ps1')) reviewClosure3551Installer(source, findings, path);
  else if (path.endsWith('/SovereignFixedRuntimeIdentityV1.cs')) reviewClosure3551Identity(source, findings, path);
  else reviewClosure3551Mobile(source, findings, path);
}

export function analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input = {}) {
  input = plainDataRecord(input) ? input : {};
  const closure3551 = input.prNumber === 3551;
  const reviewedPaths = closure3551 ? WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_PATHS_V1
    : WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1;
  const reviewedBlobs = closure3551 ? WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_3551_BLOBS_V1
    : WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_BLOBS_V1;
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = repository === REPOSITORY
    && (input.prNumber === REVIEWED_PR || closure3551)
    && text(input.branch) === REVIEWED_BRANCH
    && SHA40.test(sourceHead)
    && SHA40.test(baseSha)
    && sourceHead !== baseSha
    && exactEscalation(input.analysis, reviewedPaths)
    && exactLineage(input.lineageEvidence, sourceHead, baseSha);

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_NOT_APPLICABLE',
  });

  const findings = [];
  const proofRefs = [];
  const sources = plainDataArray(input.sources, reviewedPaths.length) ? input.sources : [];
  const byPath = new Map();
  for (const source of sources) {
    const path = plainDataRecord(source) ? text(source.path) : '';
    if (!reviewedPaths.includes(path) || byPath.has(path)) {
      findings.push(finding('fixed-runtime-specialist-source-estate-widened',
        `Specialist source evidence must contain exactly the ${reviewedPaths.length} reviewed fixed-runtime Windows files.`,
        path || reviewedPaths[0]));
      continue;
    }
    byPath.set(path, source);
  }
  if (sources.length !== reviewedPaths.length) findings.push(finding(
    'fixed-runtime-specialist-source-estate-widened',
    `Specialist source evidence must contain exactly ${reviewedPaths.length} reviewed files.`,
    reviewedPaths[0],
  ));

  for (const path of reviewedPaths) {
    const source = byPath.get(path);
    if (!exactSource(source, sourceHead, path, reviewedBlobs)) {
      findings.push(finding('fixed-runtime-specialist-exact-source-not-pinned',
        'High-risk fixed-runtime source must match the exact reviewed Git blob.',
        path));
      // Bounded hostile evidence may also explain which semantic guard changed.
      // It never gains proof refs or clean status without the exact blob pin.
      if (closure3551 && plainDataRecord(source) && typeof source.content === 'string'
          && Buffer.byteLength(source.content, 'utf8') <= MAX_SOURCE_BYTES) {
        reviewClosure3551(source.content, findings, path);
      }
      continue;
    }
    if (closure3551) reviewClosure3551(source.content, findings, path);
    else if (path.endsWith('.ps1')) reviewInstaller(source.content, findings, path);
    else reviewIdentity(source.content, findings, path);
    proofRefs.push('proofs/windows-authority-sovereign-fixed-runtime/'
      + path + '@' + sourceHead + '#' + source.blobSha + ':' + source.size);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_SPECIALIST_FINDINGS',
  });
}
