import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { analyzeWindowsAuthorityStarfieldVrSplashReviewV1, WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1 } from './windowsAuthorityStarfieldVrSplashReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
function blob(content){ const b=Buffer.from(content,'utf8'); return createHash('sha1').update(`blob ${b.length}\0`,'utf8').update(b).digest('hex'); }
function source(path, content){ return { schemaVersion:'stephanos.windows-authority-source.v1', repository, path, ref:sourceHead, exists:true, size:Buffer.byteLength(content), blobSha:blob(content), content }; }
const analysis = { findings: WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.map(path=>({severity:'P0',code:'unsupported-high-risk-surface',path})) };
const install = `[CmdletBinding(SupportsShouldProcess = $true)]\n$repositoryRoot='x'\n$splashLauncherScript = Join-Path $repositoryRoot 'scripts\\windows\\launch-starfield-vr-with-splash.ps1'\n$powershellExecutable = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'\n$shortcutPath = Join-Path $desktopPath 'Starfield VR.lnk'\n$shortcut.TargetPath = $powershellExecutable\n$shortcut.Arguments = $arguments\nif ($PSCmdlet.ShouldProcess($shortcutPath, 'Create or update Starfield VR desktop shortcut')) { $shortcut.Save() }\n`;
const splash = `$launcherScript = Join-Path $repositoryRoot 'scripts\\windows\\launch-starfield-vr.ps1'\n$powershellExecutable = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'\nif ($ReadinessOnly) { $arguments += '-ReadinessOnly' }\n$startInfo.FileName = $powershellExecutable\n$startInfo.UseShellExecute = $false\nif ([string]$readiness.verdict -ne 'STARFIELD_VR_LAUNCH_READY') { 'Flat Starfield was not started.' }\n`;
function input(contents=[install,splash]){ return { repository, sourceHead, analysis, sources: WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.map((path,i)=>source(path,contents[i])) }; }

test('clean exact two-path Starfield splash estate is specialist eligible and clean',()=>{
 const result=analyzeWindowsAuthorityStarfieldVrSplashReviewV1(input());
 assert.equal(result.eligible,true); assert.equal(result.clean,true); assert.equal(result.findings.length,0); assert.deepEqual(result.reviewedPaths,[...WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1]);
});

test('specialist is not eligible for partial or substituted escalation estate',()=>{
 const result=analyzeWindowsAuthorityStarfieldVrSplashReviewV1({repository,sourceHead,analysis:{findings:[analysis.findings[0]]},sources:[]});
 assert.equal(result.eligible,false);
});

test('wrong-head or malformed exact source evidence fails closed',()=>{
 const bad=input(); bad.sources[0]={...bad.sources[0],ref:'b'.repeat(40)};
 const result=analyzeWindowsAuthorityStarfieldVrSplashReviewV1(bad);
 assert.equal(result.eligible,true); assert.equal(result.clean,false); assert.ok(result.findings.some(x=>x.code==='windows-authority-source-evidence-invalid'));
});

test('direct game launch and dynamic execution are rejected',()=>{
 const result=analyzeWindowsAuthorityStarfieldVrSplashReviewV1(input([install,`${splash}\nStart-Process starfield.exe\n`]));
 assert.equal(result.clean,false);
 assert.ok(result.findings.some(x=>x.code==='starfield-splash-dynamic-execution-forbidden'));
 assert.ok(result.findings.some(x=>x.code==='starfield-splash-direct-game-launch-forbidden'));
});
