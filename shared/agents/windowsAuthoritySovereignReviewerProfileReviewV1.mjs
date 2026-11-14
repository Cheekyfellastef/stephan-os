import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_PATHS_V1 = Object.freeze([
  'scripts/windows/SovereignReviewerHostV1.cs',
  'scripts/windows/SovereignReviewerProfileV1.cs',
  'scripts/windows/install-sovereign-reviewer-profile-v1.ps1',
]);

export const WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_BLOBS_V1 = Object.freeze({
  'scripts/windows/SovereignReviewerHostV1.cs': 'bca159a1ea12c2d443ca36ddb5221c0da8083b7e',
  'scripts/windows/SovereignReviewerProfileV1.cs': '28a3e1dea9e97134c49130c7c2217e40ac3ed760',
  'scripts/windows/install-sovereign-reviewer-profile-v1.ps1': '485d60a78fec46691c4d0f8344b1db1e4f083d5e',
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const REVIEWED_PR = 3439;
const REVIEWED_BRANCH = 'fix/sovereign-reviewer-win32-wsl-proof-bridge-20261012';
const SHA40 = /^[a-f0-9]{40}$/;

const text = value => String(value ?? '').trim();
const finding = (code, summary, path) => Object.freeze({ severity: 'P0', code, summary, path });

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function exactEscalation(analysis = {}) {
  const rows = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const expected = new Set(WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_PATHS_V1);
  const observed = rows.map(row => text(row?.path));
  return rows.length === expected.size
    && new Set(observed).size === expected.size
    && observed.every(path => expected.has(path))
    && rows.every(row => text(row?.severity).toUpperCase() === 'P0'
      && text(row?.code) === 'unsupported-high-risk-surface')
    && Number(analysis?.counts?.P0) === 3
    && Number(analysis?.counts?.P1) === 0
    && Number(analysis?.counts?.P2) === 0;
}
function exactLineage(lineage, sourceHead, baseSha) {
  const c = lineage?.comparison;
  return Boolean(lineage && typeof lineage === 'object' && !Array.isArray(lineage)
    && lineage.schemaVersion === LINEAGE_SCHEMA
    && lineage.repository === REPOSITORY
    && lineage.sourceHead === sourceHead
    && lineage.sourceCommitSha === sourceHead
    && lineage.baseSha === baseSha
    && lineage.liveMainBeforeSha === baseSha
    && lineage.liveMainAfterSha === baseSha
    && c?.status === 'ahead'
    && Number.isSafeInteger(c?.aheadBy) && c.aheadBy > 0
    && c?.behindBy === 0
    && c?.baseCommitSha === baseSha
    && c?.mergeBaseCommitSha === baseSha);
}
function exactSource(source, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size) && source.size === size
    && size > 0 && size <= 256 * 1024
    && SHA40.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
    && source.blobSha === WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_BLOBS_V1[path]);
}
function requireLiteral(findings, source, literal, code, path) {
  if (!source.includes(literal)) findings.push(finding(code, code, path));
}
function forbid(findings, source, pattern, code, path) {
  if (pattern.test(source)) findings.push(finding(code, code, path));
}
function activePowerShell(source) {
  return String(source).replace(/<#[\s\S]*?#>/g, '').split(/\r?\n/).map(line => {
    let single=false,double=false;
    for(let i=0;i<line.length;i+=1){
      const ch=line[i], prev=i?line[i-1]:'';
      if(ch==="'"&&!double){ if(single&&line[i+1]==="'"){i+=1;continue;} single=!single;continue; }
      if(ch==='"'&&!single&&prev!=='`'){ double=!double;continue; }
      if(ch==='#'&&!single&&!double) return line.slice(0,i);
    }
    return line;
  }).join('\n');
}
function reviewHost(source, path, findings) {
  for (const [literal, code] of [
    ['public static int Main(string[] args) { return CoreJobCustodyV1.ReviewerMainV1(args); }','reviewer-host-entry-not-fixed'],
    ['limits.basic.activeLimit=8;limits.jobMemory=new UIntPtr(1073741824u);','reviewer-host-job-limits-not-fixed'],
    ['Require(CreateProcessW(executable,new StringBuilder(Quote(executable)+" "+arguments)','reviewer-host-child-launch-not-job-bound'],
    ['if(launched&&job!=IntPtr.Zero&&!result.ZeroActive)','reviewer-host-drain-barrier-missing'],
    ['Environment.FailFast("REVIEWER_JOB_DRAIN_UNPROVEN")','reviewer-host-drain-failclose-missing'],
    ['&&!output.Overflow&&!error.Overflow&&error.Text.Length==0&&result.ExitCode==0&&alive()','reviewer-host-terminal-proof-weakened'],
    ['entry!="--inspect"&&entry!="--governor"&&entry!="--advisory"&&entry!="--coverage"','reviewer-host-entry-allowlist-missing'],
    ['&&entry!="--windows-calibration"&&entry!="--windows-calibration-remote"','reviewer-host-calibration-allowlist-missing'],
    ['SOVEREIGN_REVIEWER_PROFILE_HELD={\\\"reason\\\":\\\"PROTECTED_REVIEWER_PROFILE_UNAVAILABLE\\\",\\\"qualified\\\":false','reviewer-host-failclosed-terminal-missing'],
  ]) requireLiteral(findings, source, literal, code, path);
  for (const [pattern, code] of [
    [/\bProcess\.Start\s*\(/,'reviewer-host-generic-process-authority-forbidden'],
    [/\b(?:WebClient|HttpClient|WebRequest)\b/,'reviewer-host-network-authority-forbidden'],
    [/\b(?:CreateProcessWithLogon|LogonUser)\b/,'reviewer-host-logon-authority-forbidden'],
  ]) forbid(findings, source, pattern, code, path);
}
function reviewProfile(source, path, findings) {
  for (const [literal, code] of [
    ['const string ReviewerRootV1 = @"C:\\Program Files\\Stephanos\\SovereignReviewerV1";','reviewer-profile-root-not-fixed'],
    ['const string ReviewerNodeV1 = @"C:\\Program Files\\nodejs\\node.exe";','reviewer-profile-node-not-fixed'],
    ['const string ReviewerGitV1 = @"C:\\Program Files\\Git\\cmd\\git.exe";','reviewer-profile-git-not-fixed'],
    ['manifest.Files==null||manifest.Files.Length!=25','reviewer-profile-closure-count-not-fixed'],
    ['ReviewerPinToolV1(ReviewerNodeV1,installation.NodeSha256,installation.NodeLinkCount,pins);','reviewer-profile-node-pin-missing'],
    ['ReviewerPinToolV1(ReviewerGitV1,installation.GitSha256,installation.GitLinkCount,pins);','reviewer-profile-git-pin-missing'],
    ['principalDiffersFromInstaller=pins.ActualSid!=pins.Installation.InstallerSid','reviewer-profile-installer-separation-observation-missing'],
    ['independentPrincipalObserved=false,qualified=false,signingAuthority=false,reviewerEnrollmentAuthority=false','reviewer-profile-no-authority-truth-missing'],
    ['return pins.ActualSid==pins.Installation.ReviewerSid&&!pins.Administrator;','reviewer-profile-nonadmin-principal-gate-missing'],
    ['"vr","vr-resource-governor-current.json"','reviewer-profile-governor-path-not-fixed'],
  ]) requireLiteral(findings, source, literal, code, path);
  for (const [pattern, code] of [
    [/\bProcess\.Start\s*\(/,'reviewer-profile-process-authority-forbidden'],
    [/RegistryKey\.(?:CreateSubKey|SetValue|DeleteValue|DeleteSubKey)/,'reviewer-profile-registry-mutation-forbidden'],
    [/\b(?:WebClient|HttpClient|WebRequest)\b/,'reviewer-profile-network-authority-forbidden'],
  ]) forbid(findings, source, pattern, code, path);
}
function reviewInstaller(source, path, findings) {
  const active=activePowerShell(source);
  for (const [literal, code] of [
    ["$source.Records.Count -ne 25",'reviewer-installer-closure-count-not-fixed'],
    ["throw 'REVIEWER_INSTALL_ADMINISTRATOR_REQUIRED'",'reviewer-installer-admin-gate-missing'],
    ['[void]$reviewer.Translate([Security.Principal.NTAccount])','reviewer-installer-existing-principal-proof-missing'],
    ["$root='C:\\Program Files\\Stephanos\\SovereignReviewerV1'",'reviewer-installer-root-not-fixed'],
    ['$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($admins)','reviewer-installer-protected-acl-missing'],
    ["'ReadAndExecute'",'reviewer-installer-users-readonly-missing'],
    ["$native=@('SovereignCoreJobCustodyV1.cs','SovereignReviewerProfileV1.cs','SovereignReviewerHostV1.cs')",'reviewer-installer-native-estate-not-fixed'],
    ["$parameters.CompilerOptions='/target:exe /main:Stephanos.Sovereign.SovereignReviewerHostV1 /optimize+'",'reviewer-installer-entry-not-fixed'],
    ['ReviewerSid=$ReviewerSid;InstallerSid=$installerSid','reviewer-installer-principal-binding-missing'],
    ['independentPrincipalObserved=$false;qualified=$false;signingAuthority=$false;reviewerEnrollmentAuthority=$false','reviewer-installer-no-authority-truth-missing'],
    ["throw 'REVIEWER_INSTALL_VERSION_EXISTS_INSPECT_ONLY'",'reviewer-installer-existing-version-failclose-missing'],
  ]) requireLiteral(findings, source, literal, code, path);
  for (const [pattern, code] of [
    [/\b(?:New-LocalUser|Rename-LocalUser|New-ADUser|Set-LocalUser)\b/i,'reviewer-installer-account-authority-forbidden'],
    [/\b(?:New-Service|Set-Service|Start-Service|Register-ScheduledTask|New-ScheduledTask)\b/i,'reviewer-installer-service-task-authority-forbidden'],
    [/\b(?:Start-Process|Invoke-Command|Invoke-Expression|Restart-Computer|shutdown\.exe|runas\.exe)\b/i,'reviewer-installer-generic-execution-forbidden'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient)\b/i,'reviewer-installer-network-authority-forbidden'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i,'reviewer-installer-git-mutation-forbidden'],
  ]) forbid(findings, active, pattern, code, path);
}

export function analyzeWindowsAuthoritySovereignReviewerProfileReviewV1(input = {}) {
  const sourceHead=text(input.sourceHead).toLowerCase();
  const baseSha=text(input.baseSha).toLowerCase();
  const eligible=input.repository===REPOSITORY
    && Number(input.prNumber)===REVIEWED_PR
    && text(input.branch)===REVIEWED_BRANCH
    && SHA40.test(sourceHead) && SHA40.test(baseSha) && sourceHead!==baseSha
    && exactEscalation(input.analysis)
    && exactLineage(input.lineageEvidence,sourceHead,baseSha);
  if(!eligible) return Object.freeze({schemaVersion:SCHEMA,eligible:false,clean:false,
    reviewedPaths:Object.freeze([]),findings:Object.freeze([]),proofRefs:Object.freeze([]),
    sourceMutationAllowed:false,mergeAuthority:false,runtimeMutationAllowed:false,
    providerQualificationAuthority:false,installerExecutionAuthority:false,
    accountCreationAuthority:false,signingAuthority:false,
    finalVerdict:'WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_NOT_APPLICABLE'});
  const sources=Array.isArray(input.sources)?input.sources:[];
  const findings=[],proofRefs=[];
  if(sources.length!==3) findings.push(finding('reviewer-profile-specialist-source-estate-widened',
    'Specialist source evidence must contain exactly the three reviewed Reviewer bootstrap files.',
    WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_PATHS_V1[0]));
  for(const path of WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_PATHS_V1){
    const rows=sources.filter(row=>text(row?.path)===path);
    if(rows.length!==1||!exactSource(rows[0],sourceHead,path)){
      findings.push(finding('reviewer-profile-specialist-exact-source-not-pinned',
        'Reviewer bootstrap source must match the exact independently reviewed Git blob.',path));
      continue;
    }
    if(path.endsWith('SovereignReviewerHostV1.cs')) reviewHost(rows[0].content,path,findings);
    else if(path.endsWith('SovereignReviewerProfileV1.cs')) reviewProfile(rows[0].content,path,findings);
    else reviewInstaller(rows[0].content,path,findings);
    proofRefs.push('proofs/windows-authority-sovereign-reviewer-profile/'+path+'@'+sourceHead+'#'+rows[0].blobSha+':'+rows[0].size);
  }
  const clean=findings.length===0;
  return Object.freeze({schemaVersion:SCHEMA,eligible:true,clean,
    reviewedPaths:WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_PATHS_V1,
    findings:Object.freeze(findings),proofRefs:Object.freeze(proofRefs),
    sourceMutationAllowed:false,mergeAuthority:false,runtimeMutationAllowed:false,
    providerQualificationAuthority:false,installerExecutionAuthority:false,
    accountCreationAuthority:false,signingAuthority:false,
    finalVerdict:clean?'WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_SPECIALIST_CLEAN':
      'WINDOWS_AUTHORITY_SOVEREIGN_REVIEWER_PROFILE_SPECIALIST_FINDINGS'});
}
