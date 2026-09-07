import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1 = Object.freeze([
  'scripts/windows/install-starfield-vr-desktop-shortcut.ps1',
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const MAX_BYTES = 256 * 1024;
function text(v){ return String(v ?? '').trim(); }
function finding(code, summary, path){ return Object.freeze({ severity:'P0', code, summary, path }); }
function gitBlobSha(content){ const b=Buffer.from(content,'utf8'); return createHash('sha1').update(`blob ${b.length}\0`,'utf8').update(b).digest('hex'); }
function exactSource(s, repository, head, path){ const c=typeof s?.content==='string'?s.content:''; const n=Buffer.byteLength(c,'utf8'); return Boolean(s&&typeof s==='object'&&!Array.isArray(s)&&s.schemaVersion===SOURCE_SCHEMA&&s.repository===repository&&s.path===path&&s.ref===head&&s.exists===true&&Number.isSafeInteger(s.size)&&s.size===n&&n>0&&n<=MAX_BYTES&&GIT_BLOB.test(text(s.blobSha))&&s.blobSha===gitBlobSha(c)); }
function escalationPaths(analysis={}){ const fs=Array.isArray(analysis?.findings)?analysis.findings:[]; if(fs.length!==2)return []; const got=fs.map(x=>({severity:text(x?.severity).toUpperCase(),code:text(x?.code),path:text(x?.path)})); return WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.every(path=>got.some(x=>x.severity==='P0'&&x.code==='unsupported-high-risk-surface'&&x.path===path)) ? [...WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1] : []; }
function requireLiteral(findings, source, literal, code, summary, path){ if(!source.includes(literal)) findings.push(finding(code,summary,path)); }
function forbid(findings, source, pattern, code, summary, path){ if(pattern.test(source)) findings.push(finding(code,summary,path)); }
function reviewInstall(source,path,findings){
  for(const [literal,code,summary] of [
    ["[CmdletBinding(SupportsShouldProcess = $true)]",'starfield-shortcut-shouldprocess-missing','Shortcut installation must remain ShouldProcess-gated.'],
    ["'Starfield VR.lnk'",'starfield-shortcut-name-not-fixed','Shortcut name must remain the single fixed Starfield VR shortcut.'],
    ["'scripts\\windows\\launch-starfield-vr-with-splash.ps1'",'starfield-shortcut-splash-route-missing','Shortcut must target the reviewed splash wrapper.'],
    ["'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",'starfield-shortcut-powershell-not-fixed','Shortcut host must remain fixed Windows PowerShell.'],
    ["$shortcut.TargetPath = $powershellExecutable",'starfield-shortcut-target-not-fixed','Shortcut target must remain the fixed PowerShell host.'],
    ["$shortcut.Arguments = $arguments",'starfield-shortcut-arguments-not-bounded','Shortcut arguments must remain the source-built bounded argument set.'],
    ["$PSCmdlet.ShouldProcess($shortcutPath, 'Create or update Starfield VR desktop shortcut')",'starfield-shortcut-mutation-not-gated','Shortcut mutation must remain behind ShouldProcess.'],
  ]) requireLiteral(findings,source,literal,code,summary,path);
  forbid(findings,source,/Invoke-Expression|Invoke-Command|Start-Process|Start-Job|ScriptBlock::Create/i,'starfield-shortcut-dynamic-execution-forbidden','Dynamic execution is forbidden in the shortcut installer.',path);
  forbid(findings,source,/Restart-Computer|shutdown\.exe|schtasks(?:\.exe)?|Register-ScheduledTask/i,'starfield-shortcut-runtime-authority-forbidden','Restart or scheduled-task authority is outside this installer.',path);
  forbid(findings,source,/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i,'starfield-shortcut-git-mutation-forbidden','Git mutation is forbidden.',path);
}
function reviewSplash(source,path,findings){
  for(const [literal,code,summary] of [
    ["'scripts\\windows\\launch-starfield-vr.ps1'",'starfield-splash-canonical-launcher-missing','Splash must delegate to the canonical Starfield VR launcher.'],
    ["'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",'starfield-splash-powershell-not-fixed','Splash launcher host must remain fixed Windows PowerShell.'],
    ["if ($ReadinessOnly) { $arguments += '-ReadinessOnly' }",'starfield-splash-readiness-delegation-missing','Readiness must be delegated through the canonical launcher switch.'],
    ["$startInfo.UseShellExecute = $false",'starfield-splash-shell-execution-enabled','Process execution must remain shell-disabled.'],
    ["$startInfo.FileName = $powershellExecutable",'starfield-splash-executable-not-fixed','Process executable must remain the fixed PowerShell host.'],
    ["[string]$readiness.verdict -ne 'STARFIELD_VR_LAUNCH_READY'",'starfield-splash-ready-gate-missing','Only the canonical ready verdict may advance to launch.'],
    ["Flat Starfield was not started.",'starfield-splash-flat-fallback-boundary-missing','Fail-closed flat-game wording must remain explicit.'],
  ]) requireLiteral(findings,source,literal,code,summary,path);
  forbid(findings,source,/Invoke-Expression|Invoke-Command|Start-Process|Start-Job|ScriptBlock::Create/i,'starfield-splash-dynamic-execution-forbidden','Dynamic PowerShell execution is forbidden.',path);
  forbid(findings,source,/Restart-Computer|shutdown\.exe|schtasks(?:\.exe)?|Register-ScheduledTask/i,'starfield-splash-runtime-authority-forbidden','Restart or scheduled-task authority is outside the splash.',path);
  forbid(findings,source,/starfield\.exe/i,'starfield-splash-direct-game-launch-forbidden','The splash must not gain direct Starfield executable authority.',path);
}
export function analyzeWindowsAuthorityStarfieldVrSplashReviewV1(input={}){
 const repository=text(input.repository); const sourceHead=text(input.sourceHead).toLowerCase(); const paths=escalationPaths(input.analysis);
 if(repository!=='Cheekyfellastef/stephan-os'||!EXACT_HEAD.test(sourceHead)||paths.length!==2) return Object.freeze({eligible:false,clean:false,findings:Object.freeze([]),reviewedPaths:Object.freeze([]),proofRefs:Object.freeze([]),finalVerdict:'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_NOT_ELIGIBLE'});
 const sources=Array.isArray(input.sources)?input.sources:[]; const findings=[]; const proofRefs=[];
 for(const path of paths){ const candidates=sources.filter(s=>s?.path===path); if(candidates.length!==1||!exactSource(candidates[0],repository,sourceHead,path)){ findings.push(finding('windows-authority-source-evidence-invalid','Exactly one immutable exact-head source record is required for each Starfield VR splash path.',path)); continue; } const s=candidates[0]; if(path.endsWith('install-starfield-vr-desktop-shortcut.ps1')) reviewInstall(s.content,path,findings); else reviewSplash(s.content,path,findings); proofRefs.push(`proofs/windows-authority-starfield-vr-splash/${path}@${sourceHead}#${s.blobSha}:${s.size}`); }
 const clean=findings.length===0; return Object.freeze({eligible:true,clean,findings:Object.freeze(findings),reviewedPaths:Object.freeze(paths),proofRefs:Object.freeze(proofRefs),finalVerdict:clean?'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_CLEAN':'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_FINDINGS'});
}
