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
  {timeout:60000},()=>{
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
    const files=[...HIGH_RISK_ADVISORY_EXECUTION_FILES,'scripts/sovereign-high-risk-advisory-launcher-v1.mjs',
      'scripts/sovereign-windows-review-calibration-v1.mjs','scripts/sovereign-review-coverage-v1.mjs',
      'shared/agents/sovereignExactCommitLoaderV1.mjs'];
    for(const file of files){const p=join(root,file);mkdirSync(dirname(p),{recursive:true});
      writeFileSync(p,readFileSync(join(installed,file),'utf8').replaceAll('\r\n','\n'));}
    invoke(['add','.']);invoke(['commit','-m','reviewer fixture']); const base=invoke(['rev-parse','HEAD']);
    writeFileSync(join(root,'README.md'),'second source head\n');invoke(['add','README.md']);
    invoke(['commit','-m','reviewed source']);const head=invoke(['rev-parse','HEAD']);
    const marker=join(root,'ATTACKER_EVALUATED');
    const fixtureEnv={STEPHANOS_REVIEW_EXACT_HEAD:head,STEPHANOS_REVIEW_EXACT_BASE:base,
      STEPHANOS_REVIEW_EXACT_BRANCH:'main',STEPHANOS_REVIEW_PR:'3191',
      STEPHANOS_REVIEW_REPOSITORY:'Cheekyfellastef/stephan-os'};
    const positive=buildHighRiskAdvisoryLaunchPlanV1({root,gitExecution:trustedGit,
      entryPoint:'coverage',env:fixtureEnv});
    const good=spawnSync(positive.executable,positive.args,{cwd:root,env:positive.env,
      shell:false,windowsHide:true,encoding:'utf8',timeout:12000,maxBuffer:65536});
    assert.equal(good.status,0,String(good.stderr));
    assert.match(good.stdout,/STANDARD_LOCAL_CANDIDATE_SCOPE_ONLY/);
    for(const file of ['scripts/sovereign-high-risk-advisory-v1.mjs',
      'shared/agents/battleBridgeExecutionBoundaryV1.mjs','shared/agents/sharedAgentWorkspace.mjs',
      'shared/agents/sovereignAuthenticatedReviewDiffV1.mjs']){
      for(const entryPoint of ['advisory','windows-calibration','windows-calibration-remote','coverage']) {
      const plan=buildHighRiskAdvisoryLaunchPlanV1({root,gitExecution:trustedGit,entryPoint,env:{
        STEPHANOS_REVIEW_EXACT_HEAD:head,STEPHANOS_REVIEW_EXACT_BASE:base,
        STEPHANOS_SHARED_AGENT_WORKSPACE:join(root,'workspace'),NODE_OPTIONS:'--import=attacker',
      }});
      invoke(['update-index','--skip-worktree','--',file]);
      writeFileSync(join(root,file),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'bad');`
        + (file.endsWith('sovereignAuthenticatedReviewDiffV1.mjs')
          ? `export function captureAuthenticatedReviewDiffV1(){return {}};` : `throw Error('ATTACKER');`));
      const r=spawnSync(plan.executable,plan.args,{cwd:root,env:plan.env,shell:false,
        windowsHide:true,encoding:'utf8',timeout:12000,maxBuffer:65536});
      assert.equal(existsSync(marker),false,file);
      assert.doesNotMatch(r.stdout||'',/ATTACKER/);
      assert.match(r.stdout||'',/SOVEREIGN_HIGH_RISK_REVIEW_HELD|WINDOWS_CALIBRATION_HELD|REVIEW_COVERAGE_HELD/,String(r.stderr));
      if(file==='shared/agents/sovereignAuthenticatedReviewDiffV1.mjs' && entryPoint!=='advisory') {
        const engine=entryPoint==='coverage'?'sovereign-review-coverage-v1-engine.mjs'
          :'sovereign-windows-review-calibration-v1-engine.mjs';
        // Counterfactual old topology: importing the engine directly evaluates
        // this valid substituted transitive module before any source check.
        spawnSync(process.execPath,[join(root,'scripts',engine)],{cwd:root,env:plan.env,
          shell:false,windowsHide:true,encoding:'utf8',timeout:12000,maxBuffer:65536});
        assert.equal(existsSync(marker),true,'unprotected direct import reproduces P2');
        rmSync(marker);
        const wrapper=entryPoint==='coverage'?'sovereign-review-coverage-v1.mjs'
          :'sovereign-windows-review-calibration-v1.mjs';
        const flag=entryPoint==='windows-calibration-remote'?'--commander-once':'--once';
        const direct=spawnSync(process.execPath,[join(root,'scripts',wrapper),flag],
          {cwd:root,env:{...plan.env,...fixtureEnv},shell:false,windowsHide:true,
            encoding:'utf8',timeout:12000,maxBuffer:65536});
        assert.equal(existsSync(marker),false,'public '+wrapper);
        assert.match(direct.stdout||'',/STANDARD_LOCAL_CANDIDATE_SCOPE_ONLY|WINDOWS_CALIBRATION_HELD/,
          String(direct.stderr));
        if(entryPoint==='windows-calibration-remote') {
          const projected=JSON.parse(direct.stdout.trim().split('=')[1]);
          assert.equal(projected.schemaVersion,'stephanos.sovereign-windows-calibration-remote.v1');
          assert.equal(projected.qualifiedWindowsSpecialist,false);
          assert.notEqual(projected.reason,'TRUSTED_PREEXECUTION_CUSTODY_UNPROVEN');
        }
      }
      invoke(['update-index','--no-skip-worktree','--',file]);
      writeFileSync(join(root,file),readFileSync(join(installed,file),'utf8').replaceAll('\r\n','\n'));
      }
    }
  }finally{rmSync(root,{recursive:true,force:true});}
});
