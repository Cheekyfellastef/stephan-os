import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  MUTAR_PIN, NATIVE_BUILD_READINESS_SCHEMA, inspectPinnedSourceCheckout,
  inspectStarfieldAerNativeBuildContract, createStarfieldAerNativeBuildReadiness,
  classifyStarfieldNativeR7Isolation, STARFIELD_NATIVE_R7_ISOLATION_SCHEMA,
} from './starfield-vr-aer-native-build-readiness.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = {sources: [{
  source_id: 'mutar-starfield2vr', repository: 'mutars/starfield2vr',
  commit: MUTAR_PIN, licence: 'MIT', code_reuse_allowed: true, local_cache_allowed: true,
}]};
const p1 = [
  'Subject: [PATCH] Add observable AER frame-pair stabilizer',
  'diff --git a/CMakeLists.txt b/CMakeLists.txt',
  'diff --git a/src/CreationEngine/CreationEngineRendererModule.cpp b/src/CreationEngine/CreationEngineRendererModule.cpp',
  '+AER-STABILIZER',
  'This patch has verifiable nontrivial metadata and only the two expected filenames',
].join('\n');
const p2 = [
  'Subject: [PATCH] Isolate temporal camera history by stereo eye',
  'Apply on top of stabilizer source b25bb9f9bf7f02ec87660a34ce3a2ef129d2fd3d',
  'diff --git a/src/CreationEngine/CreationEngineRendererModule.cpp b/src/CreationEngine/CreationEngineRendererModule.cpp',
  '+struct StereoCameraHistory',
  '+stereoHistory.eye[eye]',
  'This stereo patch has more than 100 bytes of independently reviewable history identity',
].join('\n');
const cmakePreset = {
  cmakeMinimumRequired: {major: 3, minor: 27},
  configurePresets: [{name: 'build-release-msvc'}],
  buildPresets: [{name: 'release-msvc', configurePreset: 'build-release-msvc'}],
};
const sourceState = {ok: true, commit: MUTAR_PIN, clean: true, submodulesVerified: true, reason: 'PINNED_CHECKOUT_VERIFIED'};
const inspect = (changes={}) => inspectStarfieldAerNativeBuildContract({
  sourceLock: lock, patchV1: p1, patchV2: p2, cmakePreset, sourceState, ...changes,
});

test('source lock, patch scope and MSVC CMake metadata qualify only isolated preparation', () => {
  const result=inspect();
  assert.equal(result.schemaVersion,NATIVE_BUILD_READINESS_SCHEMA);
  assert.equal(result.status,'SOURCE_READY_FOR_SEPARATE_QUALIFIED_NATIVE_BUILD');
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.patches.length,2);
  assert.match(result.patches[0].sha256,/^[0-9a-f]{64}$/);
  assert.equal(result.verifiedNativeCompiler,false);
  assert.equal(result.verifiedNativeDll,false);
  assert.equal(result.deploymentAllowed,false);
  assert.equal(result.gameMutationAllowed,false);
  assert.equal(result.windowsMutationAllowed,false);
});

test('missing, dirty or drifted source must hold', () => {
  for (const state of [null, {...sourceState,ok:false,clean:false}, {...sourceState,ok:false,commit:'f'.repeat(40)}]) {
    const result=inspect({sourceState:state});
    assert.equal(result.status,'BLOCKED');
    assert.ok(result.blockers.some((x)=>/CHECKOUT|CLEANLINESS/.test(x)));
  }
});

test('license, patch path and compiler preset substitution fails closed', () => {
  const cases=[
    {sourceLock:{sources:[{...lock.sources[0],licence:'NOASSERTION'}]},reason:'PINNED_MIT_SOURCE_IDENTITY_INVALID'},
    {patchV1:p1.replace('b/CMakeLists.txt','b/Starfield.exe'),reason:'STABILIZER_PATCH_SCOPE_INVALID'},
    {patchV2:p2.replace('struct StereoCameraHistory','struct StereoMonoHistory'),reason:'STEREO_PATCH_SCOPE_OR_PARENT_INVALID'},
    {cmakePreset:{configurePresets:[],buildPresets:[]},reason:'PINNED_MSVC_CMAKE_PRESET_INVALID'},
  ];
  for(const {reason,...inputs} of cases)assert.ok(inspect(inputs).blockers.includes(reason),reason);
});

test('checkout authority reads only git head and status; no source write is requested', () => {
  const run=(cmd,args)=>{
    assert.match(cmd, /git(?:\.exe)?$/i);
    if(args.at(-1)==='--show-toplevel')return {status:0,stdout:'/source\n'};
    if(args.at(-1)==='HEAD')return {status:0,stdout:MUTAR_PIN+'\n'};
    if(args.includes('--get-regexp')) return {status:1,stdout:''};
    if(args.at(-1)==='--ignore-submodules=none')return {status:0,stdout:''};
    if(args.at(-1)==='--recurse-submodules')return {status:0,stdout:'H CMakePresets.json\0H src/CreationEngine/CreationEngineRendererModule.cpp\0H extern/vrframework/mod.cpp\0H extern/CommonLibSF/include.cpp\0'};
    if(args.at(-1)==='--recursive')return {status:0,stdout:' 1111111111111111111111111111111111111111 extern/vrframework (pinned)\n 2222222222222222222222222222222222222222 extern/CommonLibSF (pinned)\n'};
    throw new Error('unexpected git command');
  };
  assert.equal(inspectPinnedSourceCheckout('/source',{run}).reason,'PINNED_CHECKOUT_VERIFIED');
  const dirty=inspectPinnedSourceCheckout('/source',{run:(cmd,args)=>args.at(-1)==='--ignore-submodules=none'?{status:0,stdout:' M src/hook.cpp\n'}:run(cmd,args)});
  assert.equal(dirty.reason,'SOURCE_DIR_DIRTY');
  assert.equal(inspectPinnedSourceCheckout('',{run}).reason,'SOURCE_DIR_REQUIRED');
  const missing = inspectPinnedSourceCheckout('/source',{run:(cmd,args)=>args.at(-1)==='--recursive'?{status:0,stdout:'-1111111111111111111111111111111111111111 extern/vrframework\n'}:run(cmd,args)});
  assert.equal(missing.reason,'SOURCE_SUBMODULES_UNVERIFIED');
  assert.equal(missing.ok,false);
});

test('actual committed cleanroom source-lock and patch bytes preserve provenance', async () => {
  const [lockText,v1,v2]=await Promise.all([
    readFile(join(repoRoot,'VR-Research-Lab/reference-source-lock.json'),'utf8'),
    readFile(join(repoRoot,'VR-Research-Lab/patches/starfield2vr-aer-stabilizer-v1.patch'),'utf8'),
    readFile(join(repoRoot,'VR-Research-Lab/patches/starfield2vr-aer-v2-stereo-history-v1.patch'),'utf8'),
  ]);
  const result=inspect({sourceLock:JSON.parse(lockText),patchV1:v1,patchV2:v2});
  assert.equal(result.status,'SOURCE_READY_FOR_SEPARATE_QUALIFIED_NATIVE_BUILD');
  assert.ok(result.patches[1].paths.every((p)=>p==='src/CreationEngine/CreationEngineRendererModule.cpp'));
  const noCheckout=await createStarfieldAerNativeBuildReadiness({repoRoot});
  assert.equal(noCheckout.status,'BLOCKED');
  assert.ok(noCheckout.blockers.includes('ISOLATED_PINNED_CHECKOUT_NOT_PROVEN'));
});

test('native C++23 stereo-history fixture really compiles and executes in a scratch directory',async(t)=>{
  const source=join(repoRoot,'tests/native/starfield-aer-stereo-history-probe.cpp');
  assert.match(await readFile(source,'utf8'),/std::optional<unsigned int> presentedEye/);
  if(process.platform==='win32'){
    t.skip('Windows compiler and runtime identity require a separately qualified native MSVC build');
    return;
  }
  const compiler=spawnSync('c++',['--version'],{encoding:'utf8',timeout:2500});
  if(compiler.status!==0){
    t.skip('No native C++ compiler on runner; do not claim toolchain proof');
    return;
  }
  const dir=await mkdtemp(join(tmpdir(),'starfield-aer-native-probe-'));
  try{
    const output=join(dir,'stereo-history-probe');
    const built=spawnSync('c++',['-std=c++23','-O0','-Wall','-Wextra','-Werror',source,'-o',output],{
      encoding:'utf8',timeout:30000,
    });
    assert.equal(built.status,0,'C++23 compile failed: '+built.stderr);
    const executed=spawnSync(output,[],{encoding:'utf8',timeout:5000});
    assert.equal(executed.status,0,'Compiled stereo-history probe failed: '+executed.stderr);
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});


test('hosted VR source tests remain disjoint from the R7 SAFE_HOLD and active gaming', () => {
  const result = classifyStarfieldNativeR7Isolation({
    action: 'HOSTED_SOURCE_TEST', surface: 'GITHUB_HOSTED',
    originalR7LeaseState: 'SAFE_HOLD', gamingActive: true,
  });
  assert.equal(result.schemaVersion, STARFIELD_NATIVE_R7_ISOLATION_SCHEMA);
  assert.equal(result.classification, 'HOSTED_SOURCE_TEST_R7_DISJOINT');
  assert.equal(result.sourceTestCandidateEligible, true);
  assert.equal(result.existingGoal, 2707);
  assert.equal(result.existingControllerPreserved, true);
  assert.equal(result.originalR7LeaseReleaseAllowed, false);
  assert.equal(result.originalR7WriterMutationAllowed, false);
  assert.equal(result.battleBridgeMutationAllowed, false);
  assert.equal(result.nativeBuildAllowed, false);
  assert.equal(result.sourceWriterPickupVerified, false);
  assert.equal(result.authority.sourceMutationAllowed, false);
});

test('nonhosted, native build, competing writers and forged R7 work remain parked', () => {
  const options = [
    {action:'ISOLATED_NATIVE_BUILD'},
    {action:'RELEASE_R7_LEASE'},
    {action:'HOSTED_SOURCE_TEST',surface:'BATTLE_BRIDGE'},
    {action:'HOSTED_SOURCE_TEST', requestedResourceIds:['r7/original-writer']},
    {action:'HOSTED_SOURCE_TEST', requestedResourceIds:['vr/2707/hosted-cpp23-test-scratch', 'vr/2707/hosted-cpp23-test-scratch']},
    {action:'HOSTED_SOURCE_TEST', activeResourceIds:['vr/2707/pinned-source-read']},
    {action:'HOSTED_SOURCE_TEST', requestedResourceIds:['vr/2707/pinned-source-read', 'battle-bridge/starfield-game-dll']},
    {action:'HOSTED_SOURCE_TEST', requestedResourceIds:null},
  ];
  for(const input of options) {
    const result=classifyStarfieldNativeR7Isolation({
      originalR7LeaseState:'SAFE_HOLD', gamingActive:false, ...input,
    });
    assert.equal(result.classification,'NATIVE_VR_WORK_PARKED',JSON.stringify(input));
    assert.equal(result.sourceTestCandidateEligible,false);
    assert.equal(result.originalR7LeaseReleaseAllowed,false);
    assert.equal(result.nativeBuildAllowed,false);
    assert.ok(result.blockers.length>0);
  }
});

test('checkout inspector forces dirty submodule visibility regardless of ignore=all configuration', () => {
  const calls=[];
  const run=(command,args)=>{
    calls.push([command,...args]);
    if(args.at(-1)==='--show-toplevel') return {status:0,stdout:'/isolated/pinned\n'};
    if(args.at(-1)==='HEAD') return {status:0,stdout:MUTAR_PIN+'\n'};
    if(args.includes('--get-regexp')) return {status:1,stdout:''};
    if(args.at(-1)==='--ignore-submodules=none') return {status:0,stdout:' m extern/vrframework\n'};
    if(args.at(-1)==='--recurse-submodules') return {status:0,stdout:'H CMakePresets.json\0H src/CreationEngine/CreationEngineRendererModule.cpp\0'};
    if(args.at(-1)==='--recursive') return {status:0,stdout:' 1111111111111111111111111111111111111111 extern/vrframework\n 2222222222222222222222222222222222222222 extern/CommonLibSF\n'};
    throw new Error('unexpected Git argument');
  };
  const result=inspectPinnedSourceCheckout('/isolated/pinned',{run});
  assert.equal(result.clean,false);
  assert.equal(result.reason,'SOURCE_DIR_DIRTY');
  assert.ok(calls.some((args)=>args.includes('--ignore-submodules=none')));
  assert.ok(calls.every((args)=>/git(?:\.exe)?$/i.test(args[0])));
});

test('real Git checkout with submodule.ignore=all cannot hide dirty nested native code', async(t) => {
  const version=spawnSync('git',['--version'],{encoding:'utf8',timeout:3000});
  if(version.status!==0){t.skip('Git unavailable on this test host');return;}
  const root=await mkdtemp(join(tmpdir(),'vr-r7-submodule-proof-'));
  const dep=join(root,'dep');
  const parent=join(root,'parent');
  const git=(dir,args)=>{
    const command=spawnSync('git',['-C',dir,...args],{encoding:'utf8',timeout:9000});
    assert.equal(command.status,0,'git '+args.join(' ')+': '+command.stderr);
    return command.stdout.trim();
  };
  try {
    await mkdir(dep);
    await mkdir(parent);
    git(dep,['init','-q']);
    git(dep,['config','user.email','test@example.invalid']);
    git(dep,['config','user.name','Native Test']);
    await writeFile(join(dep,'source.cpp'),'int safe() { return 1; }\n');
    git(dep,['add','source.cpp']);
    git(dep,['commit','-q','-m','pinned dependency']);
    git(parent,['init','-q']);
    git(parent,['config','user.email','test@example.invalid']);
    git(parent,['config','user.name','Native Test']);
    git(parent,['-c','protocol.file.allow=always','submodule','add','-q',dep,'extern/vrframework']);
    git(parent,['add','.']);
    git(parent,['commit','-q','-m','parent with pinned submodule']);
    git(parent,['config','submodule.extern/vrframework.ignore','all']);
    await writeFile(join(parent,'extern/vrframework/source.cpp'),'int changed() { return 0; }\n');
    const hidden=git(parent,['status','--porcelain','--untracked-files=normal']);
    assert.equal(hidden,'','expected ignore=all to hide edited submodule');
    const inspected=inspectPinnedSourceCheckout(parent);
    assert.equal(inspected.clean,false);
    assert.equal(inspected.ok,false);
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});


test('Starfield source checkout rejects ignored child directories even if parent is pinned', () => {
  const run=(cmd,args)=>{
    if(args.at(-1)==='--show-toplevel')return {status:0,stdout:'/pinned-checkout\n'};
    throw new Error('must refuse nonroot before reading HEAD or source');
  };
  const result=inspectPinnedSourceCheckout('/pinned-checkout/ignored/child',{run});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'SOURCE_GIT_ROOT_MISMATCH');
});

test('Starfield source checkout refuses hidden Git assume-unchanged and skip-worktree flags', () => {
  const index='H CMakePresets.json\0H src/CreationEngine/CreationEngineRendererModule.cpp\0';
  for(const prefix of ['h CMakePresets.json\0','S src/CreationEngine/CreationEngineRendererModule.cpp\0']) {
    const run=(cmd,args)=>{
      if(args.at(-1)==='--show-toplevel') return {status:0,stdout:'/source\n'};
      if(args.at(-1)==='HEAD')return {status:0,stdout:MUTAR_PIN+'\n'};
      if(args.includes('--get-regexp')) return {status:1,stdout:''};
      if(args.at(-1)==='--ignore-submodules=none')return {status:0,stdout:''};
      if(args.at(-1)==='--recurse-submodules')return {status:0,stdout:index+prefix};
      if(args.at(-1)==='--recursive')return {status:0,stdout:' 1111111111111111111111111111111111111111 extern/vrframework\n 2222222222222222222222222222222222222222 extern/CommonLibSF\n'};
      throw new Error('unexpected git command');
    };
    const result=inspectPinnedSourceCheckout('/source',{run});
    assert.equal(result.ok,false);
    assert.equal(result.indexVerified,false);
    assert.equal(result.reason,'SOURCE_GIT_INDEX_FLAGS_OR_CONTENT_UNVERIFIED');
  }
});

test('Starfield hosted resource classification always requires BOTH pinned source and scratch', () => {
  for(const requestedResourceIds of [
    ['vr/2707/pinned-source-read'],
    ['vr/2707/hosted-cpp23-test-scratch'],
    ['vr/2707/pinned-source-read','vr/2707/pinned-source-read'],
  ]) {
    const result=classifyStarfieldNativeR7Isolation({
      action:'HOSTED_SOURCE_TEST',surface:'GITHUB_HOSTED',originalR7LeaseState:'SAFE_HOLD',
      requestedResourceIds,activeResourceIds:['vr/2707/hosted-cpp23-test-scratch'],
    });
    assert.equal(result.classification,'NATIVE_VR_WORK_PARKED');
    assert.equal(result.sourceTestCandidateEligible,false);
    assert.equal(result.nativeBuildAllowed,false);
  }
});

test('real Git index flag and nested-child regressions hold even when status is empty', async(t) => {
  const gitVersion=spawnSync('git',['--version'],{encoding:'utf8'});
  if(gitVersion.status!==0){t.skip('Git unavailable');return;}
  const root=await mkdtemp(join(tmpdir(),'vr-native-index-bits-'));
  const git=(args)=>{
    const cmd=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:8000});
    assert.equal(cmd.status,0,'git '+args.join(' ')+': '+cmd.stderr);
    return cmd.stdout.trim();
  };
  try {
    git(['init','-q']);
    git(['config','user.name','Fixture']);
    git(['config','user.email','fixture@example.invalid']);
    await mkdir(join(root,'src/CreationEngine'),{recursive:true});
    await writeFile(join(root,'CMakePresets.json'),'{}\n');
    await writeFile(join(root,'src/CreationEngine/CreationEngineRendererModule.cpp'),'int before = 1;\n');
    git(['add','.']);
    git(['commit','-qm','pinned files']);
    const source=join(root,'src/CreationEngine/CreationEngineRendererModule.cpp');
    git(['update-index','--assume-unchanged','src/CreationEngine/CreationEngineRendererModule.cpp']);
    await writeFile(source,'int hidden_edit = 2;\n');
    assert.equal(git(['status','--porcelain']), '', 'baseline Git status unexpectedly spotted assumed edit');
    let observed=inspectPinnedSourceCheckout(root);
    assert.equal(observed.ok,false);
    assert.equal(observed.indexVerified,false);
    git(['update-index','--no-assume-unchanged','src/CreationEngine/CreationEngineRendererModule.cpp']);
    git(['update-index','--skip-worktree','src/CreationEngine/CreationEngineRendererModule.cpp']);
    observed=inspectPinnedSourceCheckout(root);
    assert.equal(observed.ok,false);
    assert.equal(observed.indexVerified,false);
    await mkdir(join(root,'ignored-child'));
    observed=inspectPinnedSourceCheckout(join(root,'ignored-child'));
    assert.equal(observed.reason,'SOURCE_GIT_ROOT_MISMATCH');
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});


test('native source inspector inherits the canonical hardened Git environment for all subprocesses', () => {
  const calls=[];
  const run=(cmd,args,options)=>{
    calls.push({cmd,args,options});
    if(args.at(-1)==='--show-toplevel')return {status:0,stdout:'/source\n'};
    if(args.at(-1)==='HEAD')return {status:0,stdout:MUTAR_PIN+'\n'};
    if(args.includes('--get-regexp')) return {status:1,stdout:''};
    if(args.at(-1)==='--ignore-submodules=none')return {status:0,stdout:''};
    if(args.at(-1)==='--recurse-submodules')return {status:0,stdout:'H CMakePresets.json\0H src/CreationEngine/CreationEngineRendererModule.cpp\0'};
    if(args.at(-1)==='--recursive')return {status:0,stdout:' 1111111111111111111111111111111111111111 extern/vrframework\n 2222222222222222222222222222222222222222 extern/CommonLibSF\n'};
    throw new Error('unexpected Git command');
  };
  const observed=inspectPinnedSourceCheckout('/source',{run});
  assert.equal(observed.reason,'PINNED_CHECKOUT_VERIFIED');
  assert.equal(calls.length,8);
  for(const call of calls){
    assert.match(call.cmd,/git(?:\.exe)?$/i);
    assert.equal(call.options.shell,false);
    assert.equal(call.options.env.GIT_CONFIG_NOSYSTEM,'1');
    assert.equal(call.options.env.GIT_OPTIONAL_LOCKS,'0');
    assert.equal(call.options.env.GIT_CONFIG_GLOBAL,process.platform==='win32'?'NUL':'/dev/null');
    assert.ok(call.args.includes('core.fsmonitor=false'));
    assert.ok(call.args.includes('core.hooksPath='+(process.platform==='win32'?'NUL':'/dev/null')));
    const entries=Number(call.options.env.GIT_CONFIG_COUNT);
    assert.ok(Number.isInteger(entries)&&entries>0);
    const exported=Array.from({length:entries},(_,i)=>[call.options.env['GIT_CONFIG_KEY_'+i],call.options.env['GIT_CONFIG_VALUE_'+i]]);
    assert.ok(exported.some(([key,value])=>key==='core.fsmonitor'&&value==='false'));
    assert.ok(exported.some(([key,value])=>key==='core.hooksPath'&&(value==='NUL'||value==='/dev/null')));
  }
});


test('nested executable Git content filters fail closed before status can run', () => {
  for(const kind of ['present','unreadable']){
    let statusCalled=false;
    const run=(cmd,args)=>{
      if(args.at(-1)==='--show-toplevel')return {status:0,stdout:'/source\n'};
      if(args.at(-1)==='HEAD')return {status:0,stdout:MUTAR_PIN+'\n'};
      if(args.includes('--get-regexp')){
        const inspected=args[args.indexOf('-C')+1];
        if(inspected.endsWith('extern/vrframework')){
          return kind==='present'
            ? {status:0,stdout:'filter.evil.clean\n'}
            : {status:128,stdout:'',stderr:'configuration unavailable'};
        }
        return {status:1,stdout:''};
      }
      if(args.at(-1)==='--ignore-submodules=none')statusCalled=true;
      throw new Error('Git status must not run before filter qualification');
    };
    const result=inspectPinnedSourceCheckout('/source',{run});
    assert.equal(result.ok,false);
    assert.equal(result.reason,'SOURCE_GIT_FILTER_DRIVER_OR_CONFIG_UNVERIFIED');
    assert.equal(statusCalled,false);
  }
});

test('real local clean filter cannot execute during pinned-source preflight',async(t)=>{
  if(process.platform==='win32'){t.skip('POSIX executable fixture; shared source guard is platform neutral');return;}
  if(spawnSync('git',['--version'],{encoding:'utf8'}).status!==0){t.skip('Git unavailable');return;}
  const base=await mkdtemp(join(tmpdir(),'vr-native-clean-filter-'));
  const root=join(base,'repo'), sentinel=join(base,'filter-executed'), helper=join(base,'filter.sh');
  const git=(args)=>{
    const outcome=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:8000});
    assert.equal(outcome.status,0,outcome.stderr||'fixture git failed');
    return outcome.stdout;
  };
  try{
    await mkdir(root);
    git(['init','-q']);
    git(['config','user.name','Fixture']);
    git(['config','user.email','fixture@example.invalid']);
    await mkdir(join(root,'src/CreationEngine'),{recursive:true});
    await writeFile(join(root,'CMakePresets.json'),'{}\n');
    const source=join(root,'src/CreationEngine/CreationEngineRendererModule.cpp');
    await writeFile(source,'int original=1;\n');
    git(['add','.']);git(['commit','-qm','fixture']);
    await writeFile(helper,'#!/bin/sh\nprintf invoked > '+JSON.stringify(sentinel)+'\ncat\n',{mode:0o700});
    git(['config','filter.evil.clean',helper]);
    await writeFile(join(root,'.git/info/attributes'),'src/CreationEngine/*.cpp filter=evil\n');
    await writeFile(source,'int modified=2;\n');
    const result=inspectPinnedSourceCheckout(root);
    assert.equal(result.ok,false);
    assert.equal(result.reason,'SOURCE_GIT_FILTER_DRIVER_OR_CONFIG_UNVERIFIED');
    await assert.rejects(readFile(sentinel,'utf8'),{code:'ENOENT'});
  }finally{await rm(base,{recursive:true,force:true});}
});

test('real repository-configured fsmonitor hook never executes during native source readback',async(t)=>{
  if(process.platform==='win32'){t.skip('POSIX test hook execution requires /bin/sh; Windows custody is separate');return;}
  if(spawnSync('git',['--version'],{encoding:'utf8'}).status!==0){t.skip('Git unavailable');return;}
  const base=await mkdtemp(join(tmpdir(),'vr-native-fsmonitor-proof-'));
  const root=join(base,'repo'),sentinel=join(base,'hook-executed'),hook=join(base,'fsmonitor.sh');
  const git=(args)=>{
    const r=spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:8000});
    assert.equal(r.status,0,r.stderr);
    return r.stdout;
  };
  try{
    await mkdir(root);
    git(['init','-q']);
    git(['config','user.name','Fixture']);
    git(['config','user.email','fixture@example.invalid']);
    await writeFile(join(root,'CMakePresets.json'),'{}\n');
    await mkdir(join(root,'src/CreationEngine'),{recursive:true});
    await writeFile(join(root,'src/CreationEngine/CreationEngineRendererModule.cpp'),'int baseline = 1;\n');
    git(['add','.']);git(['commit','-qm','source']);
    // An attacker-controlled fsmonitor from local .git/config would launch
    // on an ordinary status command and can lie about changed tracked paths.
    await writeFile(hook,'#!/bin/sh\nprintf touched > '+JSON.stringify(sentinel)+'\nprintf "/\\n"\n',{mode:0o700});
    git(['config','core.fsmonitor',hook]);
    // The inspected parent HEAD is intentionally not the canonical MutaR SHA;
    // proof here concerns *no hook execution*, not build admission.
    const observation=inspectPinnedSourceCheckout(root);
    assert.equal(observation.ok,false);
    await assert.rejects(readFile(sentinel,'utf8'),{code:'ENOENT'});
  }finally{
    await rm(base,{recursive:true,force:true});
  }
});
