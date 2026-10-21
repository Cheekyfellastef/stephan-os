import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildHighRiskAdvisoryLaunchPlanV1, HIGH_RISK_ADVISORY_EXECUTION_FILES }
  from './sovereign-high-risk-advisory-launcher-v1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

test('trusted launcher rejects missing exact source pair and strips preload injection', () => {
  assert.throws(()=>buildHighRiskAdvisoryLaunchPlanV1({env:{}}),/EXACT_PAIR/);
  const p=buildHighRiskAdvisoryLaunchPlanV1({env:{STEPHANOS_REVIEW_EXACT_HEAD:'a'.repeat(40),
    STEPHANOS_REVIEW_EXACT_BASE:'b'.repeat(40),NODE_OPTIONS:'--import=attacker',NODE_PATH:'attacker'}});
  assert.equal(p.env.NODE_OPTIONS,undefined); assert.equal(p.env.NODE_PATH,undefined);
  assert.equal(p.args[0],'--experimental-loader'); assert.match(p.args[1],/^data:text\/javascript;base64,/);
});

test('real pre-launch entry/verifier/transitive substitutions never evaluate before immutable graph authentication',
  {timeout:30000},()=>{
  const root=mkdtempSync(join(tmpdir(),'high-risk-preexec-'));
  const installed=resolve(import.meta.dirname,'..');
  const git=resolveBattleBridgeGitExecution();
  const trustedGit={...git,fixedConfigArgs:[...git.fixedConfigArgs,'-c','safe.directory='+root]};
  const invoke=args=>{
    const r=spawnSync(git.executable,[...trustedGit.fixedConfigArgs,'-C',root,...args],{
      env:git.environment,shell:false,windowsHide:true,encoding:'utf8'});
    assert.equal(r.status,0,String(r.stderr)); return r.stdout.trim();
  };
  try {
    invoke(['init','-b','main']);invoke(['config','user.name','Fixture']);
    invoke(['config','user.email','fixture@example.invalid']);invoke(['config','core.autocrlf','false']);
    const files=[...HIGH_RISK_ADVISORY_EXECUTION_FILES,'scripts/sovereign-high-risk-advisory-launcher-v1.mjs'];
    for(const file of files){const p=join(root,file);mkdirSync(dirname(p),{recursive:true});
      writeFileSync(p,readFileSync(join(installed,file),'utf8').replaceAll('\r\n','\n'));}
    invoke(['add','.']);invoke(['commit','-m','reviewer fixture']); const base=invoke(['rev-parse','HEAD']);
    writeFileSync(join(root,'README.md'),'second source head\n');invoke(['add','README.md']);
    invoke(['commit','-m','reviewed source']);const head=invoke(['rev-parse','HEAD']);
    const marker=join(root,'ATTACKER_EVALUATED');
    for(const file of ['scripts/sovereign-high-risk-advisory-v1.mjs',
      'shared/agents/battleBridgeExecutionBoundaryV1.mjs','shared/agents/sharedAgentWorkspace.mjs']){
      const plan=buildHighRiskAdvisoryLaunchPlanV1({root,gitExecution:trustedGit,env:{
        STEPHANOS_REVIEW_EXACT_HEAD:head,STEPHANOS_REVIEW_EXACT_BASE:base,
        STEPHANOS_SHARED_AGENT_WORKSPACE:join(root,'workspace'),NODE_OPTIONS:'--import=attacker',
      }});
      invoke(['update-index','--skip-worktree','--',file]);
      writeFileSync(join(root,file),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'bad');throw Error('ATTACKER');`);
      const r=spawnSync(plan.executable,plan.args,{cwd:root,env:plan.env,shell:false,
        windowsHide:true,encoding:'utf8',timeout:12000,maxBuffer:65536});
      assert.equal(existsSync(marker),false,file);
      assert.doesNotMatch(r.stdout||'',/ATTACKER/);
      assert.match(r.stdout||'',/SOVEREIGN_HIGH_RISK_REVIEW_HELD/,String(r.stderr));
      invoke(['update-index','--no-skip-worktree','--',file]);
      writeFileSync(join(root,file),readFileSync(join(installed,file),'utf8').replaceAll('\r\n','\n'));
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
