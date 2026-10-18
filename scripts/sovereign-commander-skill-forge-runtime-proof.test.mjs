import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSkillForgeBrowserObservation, SKILL_FORGE_RUNTIME_PROOF_PROFILE } from './sovereign-commander-skill-forge-runtime-proof.mjs';
import { SOVEREIGN_COMMANDER_REMOTE_ACTIONS, validateSovereignCommanderRemoteCommandShape } from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';
import { readFile } from 'node:fs/promises';
const head='a'.repeat(40);
const baseline=Object.freeze({
  exactHeadProofOk:true,sourceHead:head,servedBuildHead:head,servedAssetFingerprint:'b'.repeat(64),expectedAssetFingerprint:'b'.repeat(64),currentSourceFingerprint:'c'.repeat(64),servedSourceFingerprint:'c'.repeat(64),forgeHttpStatus:200,commandHttpStatus:200,
  forgeUrl:'http://127.0.0.1:4173/apps/stephanos/dist/index.html?surface=skill-forge',
  commandUrl:'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
  forgeTitleVisible:true,forgeConstructionLineVisible:true,forgeLearningViewVisible:true,
  forgeTransferGateVisible:true,commandObservatoryVisible:true,commandNavigationVisible:true,
  forgeFeedTruth:'REPORTED',backendState:'ready',backendHttpStatus:200,
  consoleErrorCount:0,pageErrorCount:0,
});
test('fixed Skill Forge proof only passes actual two-surface render and current ready feed',()=>{
 assert.equal(SKILL_FORGE_RUNTIME_PROOF_PROFILE,'skill-forge-and-command-observatory');
 assert.equal(evaluateSkillForgeBrowserObservation(baseline).accepted,true);
 for(const [field,bad] of [
  ['exactHeadProofOk',false],['servedBuildHead','c'.repeat(40)],['servedAssetFingerprint',''],['expectedAssetFingerprint','d'.repeat(64)],['servedSourceFingerprint','e'.repeat(64)],
  ['forgeHttpStatus',404],['forgeUrl','http://example.org'],
  ['forgeTitleVisible',false],['forgeConstructionLineVisible',false],['forgeLearningViewVisible',false],
  ['forgeTransferGateVisible',false],['commandObservatoryVisible',false],
  ['commandNavigationVisible',false],['forgeFeedTruth','STALE'],['backendState','stale'],
  ['backendHttpStatus',500],['consoleErrorCount',1],['pageErrorCount',1]
 ]) {
  const evaluation=evaluateSkillForgeBrowserObservation({...baseline,[field]:bad});
  assert.equal(evaluation.accepted,false,field);
  assert.ok(evaluation.blockers.length,field);
 }
});
test('Sovereign remote shape grants no unapproved action fields',()=>{
 assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('prove-skill-forge-runtime'));
 const envelope={schemaVersion:'stephanos.battle-bridge-github-command.v1',
 requestId:'skillforge-proof-test-001',operation:'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
 repository:'Cheekyfellastef/stephan-os',issueNumber:2808,branch:'main',
 operatorApproval:'operator-approved',expectedHead:head,expiresAt:'2026-10-12T15:00:00.000Z',
 remoteAction:'prove-skill-forge-runtime'};
 assert.equal(validateSovereignCommanderRemoteCommandShape(envelope).ok,true);
 assert.equal(validateSovereignCommanderRemoteCommandShape({...envelope,script:'powershell'}).ok,false);
});
test('fixed maintenance process does not accept caller-supplied URLs',async()=>{
 const s=await readFile(new URL('../shared/agents/sovereignCommanderV1.mjs',import.meta.url),'utf8');
 assert.match(s,/'prove-skill-forge-runtime': frozen\(/);
 assert.match(s,/nodeFile\('sovereign-commander-skill-forge-runtime-proof.mjs'\)/);
 const browser=await readFile(new URL('./sovereign-commander-skill-forge-runtime-proof.mjs',import.meta.url),'utf8');
 assert.match(browser,/\?surface=skill-forge/);
 assert.match(browser,/remoteHead !== sourceHead/); // source is bound by the runtime observation route
 assert.match(browser,/servedAssets\.fingerprint !== expectedAssets\.fingerprint/);
 assert.match(browser,/computeStephanosSourceFingerprint/);
 assert.match(browser,/createStephanosDistManifest/);
 assert.match(browser,/String\(refresh\?\.textContent \|\| ''\)\.trim\(\) === 'RECEIVED'/);
 assert.doesNotMatch(browser,/\['REPORTED','STALE','UNAVAILABLE'\]\.includes/);
 assert.doesNotMatch(browser,/process\.argv\[2\]/);
});
