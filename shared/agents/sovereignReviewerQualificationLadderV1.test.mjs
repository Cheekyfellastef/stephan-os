import test from 'node:test';
import assert from 'node:assert/strict';
import { assessSovereignReviewerQualificationLadderV1 as assess,
  assessSovereignIndependentBuilderCommissioningV1 as assessBuilders,
  SOVEREIGN_INDEPENDENT_BUILDER_COMMISSIONING_SCHEMA,
} from './sovereignReviewerQualificationLadderV1.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40), digest = 'c'.repeat(64);
const source = { repository:'Cheekyfellastef/stephan-os', prNumber: 3200,
  branch: 'repair/1574-reviewer-native-preexecution-hold-20261022', sourceHead:head, baseSha:base };
const flags = Object.fromEntries([
  'qualifiedWindowsSpecialist','independentSecurityReviewSatisfied','independentHostAttestation',
  'signatureVerified','protectedMergeAuthority','serviceInstallationAuthority',
  'sourceMutationAuthority','leaseReleaseAuthority','signedWindowsCustodyProven',
  'physicalPickupProven',
].map(k=>[k,false]));
const host = { expectedHeadMatch:true, sourceHead:head, observation:{
  ollama:{reachable:true,loadedModelCount:1}, gpu:{available:true} } };
const windows = { schemaVersion:'stephanos.sovereign-windows-calibration-remote.v1',
  status:'WINDOWS_CALIBRATION_CANDIDATE_PASSED_UNATTESTED',reason:'',sourceHead:head,
  baseSha:base,manifestSha256:digest,observationsSha256:digest,
  modelDigestSha256:digest,completedCases:13,passedCases:13,
  qualification:'PENDING_INDEPENDENT_WINDOWS_SPECIALIST_ATTESTATION',...flags };
const exam = {schemaVersion:'stephanos.local-review-capability-exam.v1',
  status:'QUALIFICATION_EVIDENCE_READY_FOR_INDEPENDENT_ADMISSION', sourceHead:head,
  baseSha:base,challengeCount:15,baselineChallengeCount:10,baselineEvidenceComplete:true,
  windowsEvidenceComplete:true,blockers:[],missingBaseline:[],missingPrivileged:[],
  qualifiedWindowsSpecialist:false,protectedMergeAuthority:false,leaseReleaseAuthority:false};
const packet = { source,hostObservation:host,windowsCalibration:windows,signedCapabilityExam:exam };

test('no evidence starts at exact source identity and every authority remains denied',()=>{
  const result=assess({});
  assert.equal(result.nextGate,'EXACT_SOURCE_PAIR');
  assert.equal(result.sourceHead,'');
  assert.equal(result.status,'SOVEREIGN_REVIEWER_QUALIFICATION_HELD');
  assert.deepEqual(Object.keys(result).filter(k=>k.endsWith('Authority') && result[k]!==false),[]);
  assert.equal(result.qualifiedSpecialist,false);
  assert.equal(result.independentlyCommissioned,undefined);
  assert.equal(result.evidenceProvenance,'UNTRUSTED_INPUT_CANDIDATE_ONLY');
});

test('exact identity alone moves missing work to physical model observation',()=>{
  const result=assess({source});
  assert.equal(result.nextGate,'PHYSICAL_MODEL_OBSERVATION');
  assert.equal(result.rungs[0].state,'IDENTITY_REPORTED_UNATTESTED');
  assert.equal(result.rungs[1].state,'HELD');
});

test('real-looking host telemetry is observation not signed model or gaming proof',()=>{
  const result=assess({source,hostObservation:host});
  assert.equal(result.nextGate,'WINDOWS_13_CASE_CANDIDATE');
  assert.equal(result.rungs[1].state,'OBSERVED_UNATTESTED');
  assert.equal(result.qualifiedSpecialist,false);
});

test('13/13 and 10+5 can never self-enroll the reviewer',()=>{
  const result=assess(packet);
  assert.equal(result.rungs[2].state,'CANDIDATE_UNATTESTED');
  assert.equal(result.rungs[3].state,'EXAM_REPORTED_UNATTESTED');
  assert.equal(result.rungs[4].state,'HELD');
  assert.equal(result.nextGate,'PROTECTED_AUDITOR_AND_POLICY_ADMISSION');
  assert.equal(result.qualifiedSpecialist,false);
  assert.equal(result.reviewerEnrolled,false);
  assert.equal(result.originalR7LeaseReleaseAuthority,false);
  assert.equal(result.status,'SOVEREIGN_REVIEWER_QUALIFICATION_HELD');
});

test('stale source, model substitution, missing authority denials and incomplete scores hold',()=>{
  const variants=[
    {source:{...source,baseSha:head}},
    {windowsCalibration:{...windows,sourceHead:'d'.repeat(40)}},
    {windowsCalibration:{...windows,modelDigestSha256:''}},
    {windowsCalibration:{...windows,passedCases:12}},
    {windowsCalibration:{...windows,qualifiedWindowsSpecialist:true}},
    {windowsCalibration:{...windows,leaseReleaseAuthority:true}},
    {signedCapabilityExam:{...exam,missingPrivileged:['original-writer-negative-write']}},
    {signedCapabilityExam:{...exam,sourceHead:'e'.repeat(40)}},
    {hostObservation:{...host,sourceHead:'e'.repeat(40)}},
    {hostObservation:{...host,observation:{ollama:{reachable:true,loadedModelCount:0},gpu:{available:true}}}},
  ];
  for(const changed of variants){
    const result=assess({...packet,...changed});
    assert.equal(result.qualifiedSpecialist,false);
    assert.ok(result.rungs.slice(0,4).some(x=>x.state==='HELD'));
  }
});

test('caller-supplied authority, signer and provider labels cannot alter no-authority projection',()=>{
  const hostile={...packet,qualifiedSpecialist:true,sourceMutationAuthority:true,
    reviewPolicyAdmitted:true,independentAuditorCommissioned:true,originalR7LeaseReleased:true,
    windowsCalibration:{...windows,signerCreationAuthority:true},
    signedCapabilityExam:{...exam,protectedMergeAuthority:true}};
  const result=assess(hostile);
  assert.equal(result.diagnostics.reviewerPolicyAdmitted,false);
  assert.equal(result.independentAuditorCommissioned,false);
  assert.equal(result.windowsServiceInstallationAuthority,false);
  assert.equal(result.originalR7LeaseReleaseAuthority,false);
  assert.equal(result.rungs[3].state,'HELD');
});

test('accessor, proxy, cyclic and hostile oversized packets fail without executing getters',()=>{
  let accessed = 0;
  const getter = Object.defineProperty({},'source',{enumerable:true,get(){accessed++;throw Error('do not call');}});
  const cycle = {};cycle.self=cycle;
  const proxy = new Proxy({}, { ownKeys(){throw Error('trapped');} });
  for(const input of [getter,cycle,proxy,{source,extra:Array(65).fill('x')},
      Object.create({ source }),{source,hostObservation:{observation:{gpu:{get available(){accessed++;return true;}}}}}]){
    const result=assess(input);
    assert.equal(result.nextGate,'EXACT_SOURCE_PAIR');
    assert.equal(result.rungs[0].reason,'UNTRUSTED_INPUT_INVALID');
    assert.equal(result.qualifiedSpecialist,false);
  }
  assert.equal(accessed,0);
});


const originalIsland = {
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 3109,
  issueTitle: 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)',
  prNumber: 3195,
  prTitle: 'Rescue Island #3109: add native host bootstrap and process-token observation',
  branch: 'repair/3109-island-host-principal-20261021',
  head: '1'.repeat(40),
  base: '2'.repeat(40),
};
const originalSeed = {
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 3096,
  issueTitle: 'Goal: Independent Seed Canopy Parallel Forge, isolated local-model build route',
  prNumber: 3205,
  prTitle: 'Seed #3096: retain deterministic inventory input and output custody',
  branch: 'seed-parallel/forge-v1-3096',
  head: '3'.repeat(40),
  base: '4'.repeat(40),
};
const originalMain = '5'.repeat(40);
const islandBoundary = {
  sourceHead: originalMain,
  remoteAction: 'rescue-island-readonly-boundary',
  finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_ISLAND_SCOPE_OBSERVED',
  sourceMutationAllowed: false,
  originalSourceLeaseReleaseAllowed: false,
  mergeAuthority: false,
  publicReceiptSafe: true,
  secretMaterialReturned: false,
  rescueIslandBoundary: {
    schemaVersion: 'stephanos.rescue-island-boundary-probe.v1',
    ok: true,
    readOnly: true,
    observedPathCount: 3,
    physicalScopeReadback: 'LOCAL_OS_SCOPE_OBSERVED',
    sourceMutationAllowed: false,
    workerStartAllowed: false,
    independentOwnershipAuthenticated: false,
    gamingBudgetAuthenticated: false,
    originalSourceLeaseReleaseAllowed: false,
    seedForgeQueueAccessAllowed: false,
    mergeAllowed: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  },
};
const builderPacket = { mainHead: originalMain, island: originalIsland,
  seed: originalSeed, islandCommanderBoundary: islandBoundary };

test('island physical scope cannot become OS execution authority, even during r7 SAFE_HOLD', () => {
  const result = assessBuilders({...builderPacket, originalR7LeaseState:'SAFE_HOLD'});
  assert.equal(result.schemaVersion, SOVEREIGN_INDEPENDENT_BUILDER_COMMISSIONING_SCHEMA);
  assert.equal(result.status, 'INDEPENDENT_WINDOWS_COMMISSIONING_REQUIRED');
  assert.equal(result.island.originalPrNumber, 3195);
  assert.equal(result.island.sourceIdentityReportedUnattested, true);
  assert.equal(result.seed.sourceIdentityReportedUnattested, true);
  assert.equal(result.island.commanderPhysicalScopeReportedUnattested, true);
  assert.equal(result.island.physicalScopeAllowsExecution, false);
  assert.equal(result.island.osWorkerCommissioned, false);
  assert.equal(result.island.physicalBuilderPickupVerified, false);
  assert.equal(result.seed.osWorkerCommissioned, false);
  assert.equal(result.seed.modelBackedForgeHeldForRouterEviction, true);
  assert.equal(result.originalR7LeaseAccessAllowed, false);
  assert.equal(result.originalR7LeaseReleased, false);
  assert.equal(result.reviewerQualifiedWindowsSpecialist, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.physicalBuilderPickupProven, false);
  assert.equal(result.noNewControllerOrQueue, true);
});

test('Commander source match, three observed paths and every source denial are mandatory', () => {
  const mutations = [
    {sourceHead:'6'.repeat(40)},
    {remoteAction:'repair-goal-builder-flow'},
    {sourceMutationAllowed:true},
    {mergeAuthority:true},
    {rescueIslandBoundary:{...islandBoundary.rescueIslandBoundary,observedPathCount:0}},
    {rescueIslandBoundary:{...islandBoundary.rescueIslandBoundary,workerStartAllowed:true}},
    {rescueIslandBoundary:{...islandBoundary.rescueIslandBoundary,independentOwnershipAuthenticated:true}},
    {rescueIslandBoundary:{...islandBoundary.rescueIslandBoundary, gamingBudgetAuthenticated:true}},
    {rescueIslandBoundary:{...islandBoundary.rescueIslandBoundary, secretMaterialReturned:true}},
  ];
  for (const change of mutations) {
    const value = assessBuilders({...builderPacket,
      islandCommanderBoundary:{...islandBoundary,...change}});
    assert.equal(value.island.commanderPhysicalScopeReportedUnattested,false,JSON.stringify(change));
    assert.equal(value.island.physicalScopeAllowsExecution,false);
    assert.equal(value.sourceMutationAllowed,false);
  }
});

test('wrong issue title, PR or branch denies Island and Seed author identity', () => {
  const packets=[
    {island:{...originalIsland,prTitle:'unverified'}},
    {island:{...originalIsland,prNumber:3205}},
    {island:{...originalIsland,branch:'../stolen'}},
    {seed:{...originalSeed,issueTitle:'unverified'}},
    {seed:{...originalSeed,base:'not-sha'}},
    {seed:{...originalSeed,head:originalSeed.base,base:originalSeed.base}},
  ];
  for(const patch of packets){
    const v=assessBuilders({...builderPacket,...patch});
    const touched=Object.hasOwn(patch,'island')?'island':'seed';
    assert.equal(v[touched].sourceIdentityReportedUnattested,false);
    assert.equal(v[touched].sourceHead,'');
    assert.equal(v.sourceMutationAllowed,false);
  }
});

test('missing current main cannot qualify Commander receipt or spawn a worker', () => {
  const value=assessBuilders({...builderPacket,mainHead:''});
  assert.equal(value.island.nextGate,'VERIFY_CURRENT_PROTECTED_MAIN');
  assert.equal(value.seed.nextGate,'VERIFY_CURRENT_PROTECTED_MAIN');
  assert.equal(value.island.commanderPhysicalScopeReportedUnattested,false);
  assert.equal(value.physicalBuilderPickupProven,false);
});

test('forged success, OS signer and reviewer labels never grant authority', () => {
  const forged=assessBuilders({...builderPacket,
    originalR7LeaseReleased:true,
    sourceMutationAllowed:true,
    signedWindowsCustodyProven:true,
    island:{...originalIsland,hostCommissioned:true,physicalPickupProven:true,mergeAllowed:true},
    seed:{...originalSeed,approved:true,modelResident:true,signerCommissioned:true},
    reviewer:{qualifiedWindowsSpecialist:true,independentAuditorCommissioned:true},
  });
  assert.equal(forged.authenticatedIndependentWindowsSigner,false);
  assert.equal(forged.reviewerQualifiedWindowsSpecialist,false);
  assert.equal(forged.sourceWriterOwnerAuthenticated,false);
  assert.equal(forged.protectedMergeAuthority,false);
  assert.equal(forged.originalR7LeaseReleased,false);
  assert.equal(forged.physicalBuilderPickupProven,false);
  assert.equal(forged.reviewer.selfReviewAllowed,false);
});

test('malicious packet coercion, getters, proxies and cycles fail without running code', () => {
  let accessed=0;
  const dangerous=Object.defineProperty({},'mainHead',{enumerable:true,get(){accessed++;throw Error('getter');}});
  const cycle={};cycle.self=cycle;
  const proxy=new Proxy({}, {ownKeys(){throw Error('accessed');}});
  for(const value of [dangerous,cycle,proxy,{
    ...builderPacket,seed:{...originalSeed,prNumber:{toString(){accessed++;return 3205;}}}
  }]){
    const result=assessBuilders(value);
    assert.equal(result.sourceMutationAllowed,false);
    assert.equal(result.physicalBuilderPickupProven,false);
    assert.equal(result.island.commanderPhysicalScopeReportedUnattested,false);
  }
  assert.equal(accessed,0);
});


test('array accessors and proxy arrays are rejected without executing their traps', () => {
  let invoked = 0;
  const getterArray = [];
  Object.defineProperty(getterArray, '0', {
    configurable: true, enumerable: true,
    get() { invoked++; throw new Error('array access not permitted'); },
  });
  const silentGetterArray = [];
  Object.defineProperty(silentGetterArray, '0', {
    configurable: true, enumerable: true,
    get() { invoked++; return 'pretend-evidence'; },
  });
  const proxyArray = new Proxy(['pretend-evidence'], {
    get() { invoked++; throw new Error('proxy array access'); },
    ownKeys() { invoked++; throw new Error('proxy enumerated'); },
  });
  const proxyObject = new Proxy({ fixed: true }, {
    ownKeys() { invoked++; throw new Error('proxy enumerated'); },
  });
  const sparse = new Array(1);
  const extra = ['ok'];
  extra.extraProperty = true;
  const inherited = Object.assign(Object.create(Array.prototype), {0: 'entry',length:1});
  for (const poison of [getterArray, silentGetterArray, proxyArray, proxyObject,
    sparse, extra, inherited]) {
    const candidate = assess({ ...packet, signedCapabilityExam: {
      ...exam, blockers: poison,
    } });
    assert.equal(candidate.qualifiedSpecialist, false);
    assert.equal(candidate.nextGate, 'EXACT_SOURCE_PAIR');
    assert.equal(candidate.rungs[0].reason, 'UNTRUSTED_INPUT_INVALID');
    const builder = assessBuilders({ ...builderPacket, extra: poison });
    assert.equal(builder.sourceMutationAllowed, false);
    assert.equal(builder.island.commanderPhysicalScopeReportedUnattested, false);
  }
  assert.equal(invoked, 0, 'no poisoned getter or proxy trap may run');
});

test('ordinary dense arrays still permit candidate evidence while preventing authority', () => {
  const result = assess(packet);
  assert.equal(result.rungs[3].state, 'EXAM_REPORTED_UNATTESTED');
  assert.equal(result.rungs[4].state, 'HELD');
  assert.equal(result.qualifiedSpecialist, false);
  const builder = assessBuilders(builderPacket);
  assert.equal(builder.island.commanderPhysicalScopeReportedUnattested, true);
  assert.equal(builder.originalR7LeaseReleased, false);
  assert.equal(builder.physicalBuilderPickupProven, false);
});
