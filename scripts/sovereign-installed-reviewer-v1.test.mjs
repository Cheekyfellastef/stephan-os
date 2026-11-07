import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SOVEREIGN_REVIEWER_PROFILE_FILES_V1 as files, buildInstalledReviewerLaunchPlanV1,
  installedReviewerRequestEnvironmentV1, SOVEREIGN_INSTALLED_REVIEWER_HOST_V1 }
  from '../shared/agents/sovereignInstalledReviewerProfileV1.mjs';
import { buildReviewerInstallationSourceV1 } from './build-sovereign-reviewer-installation-v1.mjs';
import { captureInstalledReviewerDataV1, inspectInstalledReviewerGamingV1,
  inspectInstalledReviewerSourceV1 } from './sovereign-installed-reviewer-v1.mjs';
import { buildHighRiskAdvisoryLaunchPlanV1 } from './sovereign-high-risk-advisory-launcher-v1.mjs';
import { runWindowsSovereignReviewerV1 } from './sovereign-reviewer-wsl-bridge-v1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { classifyPostSyncRefresh } from '../shared/agents/postSyncRuntimeRefreshCoordinator.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const env={STEPHANOS_REVIEW_EXACT_HEAD:'a'.repeat(40),STEPHANOS_REVIEW_EXACT_BASE:'b'.repeat(40),
  STEPHANOS_REVIEW_EXACT_BRANCH:'fixture-review',STEPHANOS_REVIEW_REPOSITORY:'Cheekyfellastef/stephan-os',
  STEPHANOS_REVIEW_ISSUE:'1574',STEPHANOS_REVIEW_PR:'1',STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER:'fixture-implementer',
  STEPHANOS_REVIEW_IMPLEMENTER_SESSION:'fixture-session-a',STEPHANOS_REVIEW_SESSION:'fixture-session-b',
  STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL:'fixture-principal-a',STEPHANOS_REVIEW_REVIEWER_PRINCIPAL:'fixture-principal-b',
  STEPHANOS_SOVEREIGN_REVIEW_MODEL:'qwen:14b'};
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'stephanos-installed-reviewer-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;
}
function command(dir,args) {
  const r=spawnSync(resolveBattleBridgeGitExecution().executable,['-C',dir,...args],
    {encoding:'utf8',shell:false,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',
      GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',
      GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',
      GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'},maxBuffer:2097152});
  assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();
}
function repo(t) {
  const dir=fixture(t);command(dir,['init','-b','main']);
  command(dir,['remote','add','origin','https://github.com/Cheekyfellastef/stephan-os.git']);
  return dir;
}
function put(dir,path,bytes) {mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);}
function commit(dir) {command(dir,['add','.']);command(dir,['commit','-m','isolated fixture']);return command(dir,['rev-parse','HEAD']);}
test('reviewer installation graph contains every reachable relative producer dependency exactly once',()=>{
  assert.equal(files.length,25);assert.equal(new Set(files).size,25);
  const modules=files.filter(p=>p.endsWith('.mjs'));assert.equal(modules.length,21);
  for(const path of modules) {
    const source=readFileSync(join(root,path),'utf8');
    for(const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if(match[1].startsWith('node:'))continue;
      assert.ok(match[1].startsWith('.'),path+': external dependency '+match[1]);
      const dependency=posix.normalize(posix.join(posix.dirname(path),match[1]));
      assert.ok(modules.includes(dependency),path+' -> '+dependency);
    }
  }
  for(const path of files.filter(p=>p.endsWith('.cs')))assert.ok(readFileSync(join(root,path)).length<=32768,path);
});
test('existing Windows custody workflow covers every installed dependency and changed route',()=>{
  const workflow=readFileSync(join(root,'.github/workflows/sovereign-core-repair-custody.yml'),'utf8');
  const triggers=new Set([...workflow.split('\npermissions:')[0].matchAll(/^\s+- '([^']+)'\s*$/gm)].map(m=>m[1]));
  for(const path of [...files,'scripts/sovereign-high-risk-advisory-launcher-v1.mjs',
    'scripts/sovereign-high-risk-advisory-launcher-v1.test.mjs','scripts/sovereign-reviewer-wsl-bridge-v1.mjs',
    'scripts/sovereign-reviewer-wsl-bridge-v1.test.mjs','shared/agents/postSyncRuntimeRefreshCoordinator.mjs'])
    assert.ok(triggers.has(path),'missing exact native-profile workflow trigger: '+path);
  assert.match(workflow,/node --test scripts\/sovereign-installed-reviewer-v1\.test\.mjs scripts\/sovereign-installed-reviewer-native-v1\.test\.mjs/);
});
test('fixed installed launcher discards caller code roots, executables, loader injection and workspace',()=>{
  const p=buildHighRiskAdvisoryLaunchPlanV1({platform:'win32',root:'C:\\attacker',env:{...env,
    NODE_OPTIONS:'--import=attacker',PATH:'C:\\attacker',STEPHANOS_SHARED_AGENT_WORKSPACE:'C:\\attacker',
    STEPHANOS_REVIEWER_INSTALL_HEAD:'c'.repeat(40)}});
  assert.equal(p.executable,SOVEREIGN_INSTALLED_REVIEWER_HOST_V1);
  assert.deepEqual(p.args,['--advisory']);assert.ok(!p.root.includes('attacker'));
  assert.equal(p.env.NODE_OPTIONS,undefined);assert.equal(p.env.STEPHANOS_SHARED_AGENT_WORKSPACE,undefined);
  assert.equal(p.env.STEPHANOS_REVIEWER_INSTALL_HEAD,undefined);
  assert.equal(p.env.STEPHANOS_REVIEW_EXACT_HEAD,env.STEPHANOS_REVIEW_EXACT_HEAD);
  for(const entryPoint of ['windows-calibration','windows-calibration-remote','coverage'])
    assert.deepEqual(buildInstalledReviewerLaunchPlanV1({platform:'win32',env,entryPoint}).args,['--'+entryPoint]);
});
test('unknown native route, non-Windows host, malformed head and colliding logical sessions hold',()=>{
  assert.throws(()=>buildInstalledReviewerLaunchPlanV1({platform:'linux',env}),/NATIVE_PROFILE_REQUIRED/);
  assert.throws(()=>buildInstalledReviewerLaunchPlanV1({platform:'win32',env,entryPoint:'powershell'}),/FIXED_ENTRY/);
  for(const patch of [{STEPHANOS_REVIEW_EXACT_HEAD:'a'.repeat(39)},
    {STEPHANOS_REVIEW_EXACT_BRANCH:'x/../main'},
    {STEPHANOS_REVIEW_SESSION:env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION},
    {STEPHANOS_REVIEW_REVIEWER_PRINCIPAL:env.STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL},
    {STEPHANOS_SOVEREIGN_REVIEW_MODEL:'qwen:14b\r\nNODE_OPTIONS=bad'}])
    assert.throws(()=>installedReviewerRequestEnvironmentV1({...env,...patch}),/REQUEST_INVALID/);
});
test('legacy WSL route holds before any conversion, Git, producer or model child',()=>{
  let spawned=0;
  const r=runWindowsSovereignReviewerV1({...env,STEPHANOS_SHARED_AGENT_WORKSPACE:'C:\\workspace'},
    {platform:'win32',sourceRoot:'C:\\repo',exists:()=>true,spawn:()=>{spawned++;throw Error('must not run');}});
  assert.equal(r.reason,'WSL_INSTALLED_REVIEWER_PROFILE_REQUIRED');assert.equal(spawned,0);
  assert.equal(r.approvalAuthority,false);assert.equal(r.mergeAuthority,false);
});
test('native observations are bounded diagnostics and never accept qualification or caller profile fields',()=>{
  const observation={schemaVersion:'stephanos.reviewer-profile-observation.v1',sourceHead:'c'.repeat(40),
    codeCustodyObserved:true,principalMatchesProfile:true,principalAdministrator:false,
    independentPrincipalObserved:false,qualified:false};
  let called;
  const run=(exe,args,options)=>{called={exe,args,options};return{status:0,
    stdout:'SOVEREIGN_REVIEWER_PROFILE_V1='+JSON.stringify(observation)+'\n'};};
  assert.equal(inspectInstalledReviewerSourceV1('c'.repeat(40),{run,platform:'win32'}),true);
  assert.equal(called.exe,SOVEREIGN_INSTALLED_REVIEWER_HOST_V1);assert.deepEqual(called.args,['--inspect']);
  for(const patch of [{qualified:true},{independentPrincipalObserved:true},{principalAdministrator:true},
    {principalMatchesProfile:false},{codeCustodyObserved:false},{sourceHead:'d'.repeat(40)}]) {
    const fake=()=>({status:0,stdout:'SOVEREIGN_REVIEWER_PROFILE_V1='+JSON.stringify({...observation,...patch})+'\n'});
    assert.equal(inspectInstalledReviewerSourceV1('c'.repeat(40),{run:fake,platform:'win32'}),false);
  }
  assert.equal(inspectInstalledReviewerSourceV1('c'.repeat(40),{run:()=>({status:0,
    stdout:'SOVEREIGN_REVIEWER_PROFILE_V1='+JSON.stringify(observation)+'\nextra'}),platform:'win32'}),false);
});
test('native governor wrapper invokes only the fixed physical read and refuses missing or ambiguous observation',()=>{
  let calls=0;
  const observation={schemaVersion:'stephanos.reviewer-governor-observation.v1',allowed:true,
    independentPrincipalObserved:false,qualified:false};
  const run=(exe,args)=>{calls++;assert.equal(exe,SOVEREIGN_INSTALLED_REVIEWER_HOST_V1);
    assert.deepEqual(args,['--governor']);return{status:0,stdout:'SOVEREIGN_REVIEWER_GOVERNOR_V1='+JSON.stringify(observation)};};
  assert.equal(inspectInstalledReviewerGamingV1({STEPHANOS_SHARED_AGENT_WORKSPACE:'attacker'},{run,platform:'win32'}).ok,true);
  assert.equal(calls,1);
  for(const result of [{status:1,stdout:''},{status:0,stdout:'{}'},
    {status:0,stdout:'SOVEREIGN_REVIEWER_GOVERNOR_V1='+JSON.stringify({...observation,qualified:true})}])
    assert.equal(inspectInstalledReviewerGamingV1({}, {platform:'win32',run:()=>result}).ok,false);
});
test('authenticated PR objects remain review data when the PR changes the producer to malicious code',t=>{
  const data=repo(t),installed=fixture(t),sentinel=join(data,'executed-marker');
  put(data,'scripts/sovereign-high-risk-advisory-v1.mjs','export const candidate="old";\n');
  const base=commit(data);
  const malicious='import {writeFileSync} from "node:fs";writeFileSync('+JSON.stringify(sentinel)+',"BAD");\n';
  put(data,'scripts/sovereign-high-risk-advisory-v1.mjs',malicious);const head=commit(data);
  command(data,['update-ref','refs/remotes/origin/fixture-review',head]);
  const manifest={SchemaVersion:'stephanos.reviewer-profile-manifest.v1',SourceHead:'c'.repeat(40),SourceTree:'d'.repeat(40),Files:[]};
  for(const path of files){const bytes=readFileSync(join(root,path));put(installed,'source/'+path,bytes);
    manifest.Files.push({Path:path,Sha256:hash(bytes)});}
  writeFileSync(join(installed,'manifest.json'),JSON.stringify(manifest));
  const invoke=`const m=await import(${JSON.stringify(pathToFileURL(join(installed,'source/scripts/sovereign-installed-reviewer-v1.mjs')).href)});`
    +`const r=m.captureInstalledReviewerDataV1(${JSON.stringify({...env,STEPHANOS_REVIEW_EXACT_HEAD:head,STEPHANOS_REVIEW_EXACT_BASE:base})}, {root:${JSON.stringify(data)}});`
    +`process.stdout.write(JSON.stringify({head:r.sourceHead,changed:r.changedFiles,diff:r.diff}));`;
  const r=spawnSync(process.execPath,['--no-warnings','--experimental-loader',join(installed,'source/scripts/sovereign-installed-reviewer-loader-v1.mjs'),
    '--input-type=module','--eval',invoke],{encoding:'utf8',timeout:30000,env:{...process.env,NODE_OPTIONS:''}});
  assert.equal(r.status,0,r.stderr);const result=JSON.parse(r.stdout);
  assert.equal(result.head,head);assert.ok(result.diff.includes('executed-marker'));assert.equal(existsSync(sentinel),false);
  // Complete graph capture refuses a changed final dependency before ANY entry.
  put(installed,'source/shared/agents/engineeringIncidentMethodMemoryV1.mjs','throw Error("tampered");\n');
  const denied=spawnSync(process.execPath,['--no-warnings','--experimental-loader',join(installed,'source/scripts/sovereign-installed-reviewer-loader-v1.mjs'),
    '--input-type=module','--eval','process.stdout.write("UNSAFE_ENTRY");'],{encoding:'utf8',timeout:30000});
  assert.notEqual(denied.status,0);assert.equal(denied.stdout,'');assert.match(denied.stderr,/SOURCE_CHANGED/);
});
test('source package authenticates immutable Git bytes and ignores a dirty executable worktree',t=>{
  const dir=repo(t);
  for(const path of files)put(dir,path,readFileSync(join(root,path)));
  const head=commit(dir);command(dir,['update-ref','refs/remotes/origin/main',head]);
  put(dir,'scripts/windows/SovereignReviewerHostV1.cs','MALICIOUS WORKTREE BYTES');
  const result=buildReviewerInstallationSourceV1({expectedMain:head,root:dir});
  assert.equal(result.sourceHead,head);assert.equal(result.sourceFileCount,25);
  assert.equal(result.installationPerformed,false);assert.equal(result.qualified,false);
  assert.ok(!result.script.includes('MALICIOUS WORKTREE BYTES'));assert.equal(hash(result.script),result.artifactSha256);
  assert.throws(()=>buildReviewerInstallationSourceV1({expectedMain:'e'.repeat(40),root:dir}),/MAIN_MISMATCH/);
  command(dir,['config','core.fsmonitor','attacker']);
  assert.throws(()=>buildReviewerInstallationSourceV1({expectedMain:head,root:dir}),/CONFIGURATION_UNSAFE/);
});
test('all new production paths have exact offline installation ownership and no automatic native install',()=>{
  const paths=['scripts/sovereign-installed-reviewer-v1.mjs','scripts/sovereign-installed-reviewer-loader-v1.mjs',
    'scripts/build-sovereign-reviewer-installation-v1.mjs','shared/agents/sovereignInstalledReviewerProfileV1.mjs',
    'scripts/windows/SovereignReviewerProfileV1.cs','scripts/windows/SovereignReviewerHostV1.cs',
    'scripts/windows/install-sovereign-reviewer-profile-v1.ps1'];
  const plan=classifyPostSyncRefresh(paths);assert.equal(plan.unknownPathCount,0);
  assert.equal(plan.noRuntimePathCount,paths.length);assert.deepEqual(plan.targetIds,[]);
  assert.equal(classifyPostSyncRefresh(['scripts/windows/SovereignReviewerHostV2.cs']).unknownPathCount,1);
});
