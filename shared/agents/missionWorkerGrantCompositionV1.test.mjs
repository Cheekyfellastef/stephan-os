import assert from 'node:assert/strict';
import test from 'node:test';
import { exactElasticExternalGrant } from '../../stephanos-server/services/criticalBacklogConveyorServiceCore.js';
import { createExactWorkerActionGrant } from './durableFlywheelControllerVNext.mjs';
import { buildMissionWorkerAction, missionWorkerActionGrantsMatchV1 } from './missionOrchestratorWorker.mjs';
import { BUILD_LANE_CAPACITY_RECEIPT_SCHEMA, forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef } from './missionControllerCapacityRouterV1.mjs';
import { createExecutionReceipt, toSharedWorkspaceExecutionReceipt } from './executionReceiptV1.mjs';
import { createSharedWorkspaceReceiptRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
  routeWithQualifiedOpenClawProvider,
  validateOpenClawQualificationAuthorityChain,
} from './openClawProviderPoolQualificationV1.mjs';
import { resolveElasticExternalCapacityCandidates } from '../../stephanos-server/services/elasticOpenClawProviderPoolService.js';

const now = new Date('2026-10-30T14:00:00.000Z');
const head = 'a'.repeat(40);
function producers() {
  const mission = { missionId:'critical-1574-elastic-goal', title:'Bounded source repair',
    revision:5, currentPhase:'AGENT_IMPLEMENTATION', repository:'Cheekyfellastef/stephan-os',
    operatorIntent:'Repair the bounded source contract.', intendedOutcome:'Tested source correction.',
    allowedFiles:['stephanos-server/services/contract.js'],
    requiredTests:['node --test stephanos-server/services/contract.test.js'],
    requiredEvidence:['focused source tests'], providerRouteIntent:'AUTO',
    dispatch:{adapter:'codex',status:'pending'},
    git:{branch:'openclaw/elastic-goal-1574',worktreePath:'/bounded/goal-1574'} };
  const candidate = {route:'FOUNDRY_FORGE',adapter:'foundry-forge',
    workerId:'stephanos-forge-lifeboat-local',receiptId:'forge-capacity-test',
    proofRefs:[forgeLifeboatProofRef(head)]};
  const receipt={schemaVersion:BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    route:candidate.route,workerId:candidate.workerId,receiptId:candidate.receiptId,
    proofRefs:candidate.proofRefs,repository:mission.repository,state:'READY',
    supportedOperations:['SOURCE_CONSTRUCTION','FOCUSED_TESTS'],
    supportedTaskClasses:['FOCUSED_REPAIR','MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc:'2026-10-30T13:59:00.000Z',expiresAtUtc:'2026-10-30T14:14:00.000Z',
    queueDepth:0,p95StartLatencySeconds:3,authorityReceiptIds:[forgeLifeboatAuthorityReceiptId(head)]};
  const grants=[exactElasticExternalGrant(mission,candidate,head,now),
    createExactWorkerActionGrant({observedAtUtc:now.toISOString(),criticalBacklog:{activeMission:mission}},
      head,{nowUtc:now.toISOString(),sourceHead:head,forgeLaneReceipt:receipt},()=>[candidate])];
  assert.ok(grants[0],'actual elastic factory must produce its grant');
  assert.ok(grants[1],'actual durable factory must produce its grant');
  return grants;
}

test('both actual production factories compose the same exact focused-source grant',()=>{
  const [elastic,controller]=producers();
  assert.ok(elastic && controller);
  assert.deepEqual(elastic,controller);
  assert.equal(missionWorkerActionGrantsMatchV1(elastic,controller),true);
});

test('legacy absent optional memory equals null; no authority field gets a default',()=>{
  const [grant]=producers(), legacy={...grant};
  delete legacy.engineeringMemoryPack;delete legacy.engineeringMemoryPackId;
  assert.equal(missionWorkerActionGrantsMatchV1(legacy,grant),true);
  delete legacy.providerRouteIntent;
  assert.equal(missionWorkerActionGrantsMatchV1(legacy,grant),false);
});

for(const key of ['grantId','controllerId','sourceRevision','missionId','missionRevision',
  'currentPhase','actionId','actionKind','adapter','operation','providerRouteIntent',
  'capacityRoute','capacityReceiptId','capacityProofRefs','workerId','laneId','repository',
  'issueNumber','prNumber','branch','headSha','boundedActionCount','mergeAuthority','leaseSeizureAllowed']) {
  test('grant mismatch remains closed for '+key,()=>{
    const [grant]=producers();
    const changed={...grant,[key]:Array.isArray(grant[key])?['proof/foreign.json']
      :typeof grant[key]==='number'?grant[key]+1:typeof grant[key]==='boolean'?!grant[key]:'foreign'};
    assert.equal(missionWorkerActionGrantsMatchV1(grant,changed),false);
  });
}

test('unknown, non-enumerable, symbol, accessor and non-JSON authority cannot match itself',()=>{
  const [grant]=producers();let accessorRead=false;
  const cases=[{...grant,executeAuthority:true},
    Object.defineProperty({...grant},'executeAuthority',{value:true}),
    {...grant,[Symbol('executeAuthority')]:true},
    Object.defineProperty({...grant},'providerRouteIntent',{get(){accessorRead=true;return 'AUTO';},enumerable:true}),
    {...grant,capacityProofRefs:[undefined]}, {...grant,missionRevision:NaN},
    {...grant,sourceRevision:[head]}, {...grant,headSha:[head]}];
  for(const candidate of cases)assert.equal(missionWorkerActionGrantsMatchV1(candidate,candidate),false);
  assert.equal(accessorRead,false);
});

test('self-consistent fake or authority-widening memory cannot become a matching grant',()=>{
  const [grant]=producers();
  for(const pack of [{schemaVersion:'stephanos.engineering-coding-memory-pack.v1',packId:'fake'},
    {schemaVersion:'stephanos.engineering-coding-memory-pack.v1',packId:'fake',authority:{mergeAuthority:true}}]) {
    const candidate={...grant,engineeringMemoryPack:pack,engineeringMemoryPackId:pack.packId};
    assert.equal(missionWorkerActionGrantsMatchV1(candidate,candidate),false);
  }
});

// This is a source-task qualification fixture, not a claim that the native OC2
// deterministic-test producer can qualify source edits. No receipt is published.
function qualifiedOpenClawSource({ taskClass = 'FOCUSED_REPAIR', sourceHead = head, workerId = 'openclaw-original-worker' } = {}) {
  const mission = {
    missionId: 'critical-1725-elastic-goal', title: 'Bounded source repair',
    revision: 5, currentPhase: 'AGENT_IMPLEMENTATION',
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: 'Repair the existing bounded source contract.',
    intendedOutcome: 'Tested source correction.',
    allowedFiles: ['shared/agents/example.mjs'],
    requiredTests: ['node --test shared/agents/example.test.mjs'],
    requiredEvidence: ['focused source tests'], providerRouteIntent: 'AUTO',
    dispatch: { adapter: 'codex', status: 'pending' },
    git: { branch: 'openclaw/elastic-goal-1725', worktreePath: '/bounded/goal-1725' },
  };
  const qualificationReceipt = {
    schemaVersion: OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
    qualificationId: 'openclaw-source-qualification',
    authorityReceiptId: 'openclaw-source-authority',
    provider: 'openclaw-standalone', repository: mission.repository,
    taskClass, state: 'PRODUCTION_ELIGIBLE', providerInstance: workerId,
    providerVersion: 'openclaw-qualified-source-v1', sourceHead,
    realWorkTaskId: 'openclaw-source-real-task', realWorkReceiptId: 'openclaw-source-real-receipt',
    observedAtUtc: '2026-10-30T13:59:00.000Z', expiresAtUtc: '2026-10-30T14:14:00.000Z',
    codexRequired: false, proofRefs: ['receipts/openclaw/source-work.json'],
  };
  const realWorkExecutionReceipt = createExecutionReceipt({
    receiptId: qualificationReceipt.realWorkReceiptId, repository: mission.repository,
    issueNumber: 1725, prNumber: 0, branch: 'agent/openclaw-source-qualification', sourceHead,
    workerId: qualificationReceipt.providerInstance, workerType: 'openclaw',
    executionId: qualificationReceipt.realWorkTaskId, leaseKey: qualificationReceipt.realWorkTaskId,
    state: 'completed', phase: taskClass, sequence: 1, predecessorReceiptId: '',
    timestampUtc: '2026-10-30T13:58:30.000Z', heartbeatExpiresAtUtc: '2026-10-30T14:00:30.000Z',
    blocker: '', operatorActionRequired: false, proofRefs: qualificationReceipt.proofRefs,
    expectedNextAction: '',
  });
  const workspace = toSharedWorkspaceExecutionReceipt(realWorkExecutionReceipt);
  assert.equal(workspace.ok, true);
  const host = {
    schemaVersion: OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA, qualificationReceipt,
    capacityReceipt: {
      schemaVersion: OPENCLAW_PROVIDER_CAPACITY_SCHEMA, receiptId: 'openclaw-source-capacity',
      provider: 'openclaw-standalone', repository: mission.repository,
      workerId: qualificationReceipt.providerInstance, state: 'READY',
      supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'], supportedTaskClasses: [taskClass],
      observedAtUtc: qualificationReceipt.observedAtUtc, expiresAtUtc: qualificationReceipt.expiresAtUtc,
      queueDepth: 0, p95StartLatencySeconds: 5,
      qualificationIds: [qualificationReceipt.qualificationId],
      qualificationAuthorityReceiptId: qualificationReceipt.authorityReceiptId,
      proofRefs: ['receipts/openclaw/source-capacity.json'],
    },
    realWorkExecutionReceipt, realWorkWorkspaceReceipt: workspace.record,
    qualificationAuthorityReceipt: createSharedWorkspaceReceiptRecord({
      receiptId: qualificationReceipt.authorityReceiptId, participantId: 'stephanos',
      timestampUtc: qualificationReceipt.observedAtUtc,
      correlationId: qualificationReceipt.qualificationId, relatedIssue: '1725', relatedPr: '',
      proofRefs: qualificationReceipt.proofRefs, receivedRecordId: realWorkExecutionReceipt.receiptId,
      disposition: OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
      summary: `Stephanos qualifies ${qualificationReceipt.providerInstance} ${qualificationReceipt.providerVersion} for ${taskClass} at ${sourceHead} from OpenClaw execution ${realWorkExecutionReceipt.receiptId}.`,
    }),
  };
  return {
    mission, host,
    capacityRouting: { nowUtc: now.toISOString(), sourceHead: head, openAiBlackout: true, openClawHostContext: host },
  };
}

function durableOpenClawGrant(mission, capacityRouting, sourceRevision = head, resolver) {
  return createExactWorkerActionGrant({
    observedAtUtc: now.toISOString(), criticalBacklog: { activeMission: mission },
  }, sourceRevision, capacityRouting, resolver);
}

test('actual durable and elastic factories compose the same qualified OpenClaw source grant', () => {
  const { mission, host, capacityRouting } = qualifiedOpenClawSource();
  const qualified = routeWithQualifiedOpenClawProvider({ ...capacityRouting, mission }, host);
  assert.equal(qualified.dispatchAllowed, true, 'existing strong source qualification must pass');
  assert.equal(qualified.adapter, 'openclaw-local');
  const candidates = resolveElasticExternalCapacityCandidates(mission, capacityRouting, head, now.toISOString());
  assert.equal(candidates.length, 1, 'existing elastic path already recognizes this source qualification');
  const elastic = exactElasticExternalGrant(mission, candidates[0], head, now);
  assert.ok(elastic, 'existing elastic grant producer must admit its established pre-PR lane');
  const durable = durableOpenClawGrant(mission, capacityRouting);
  assert.ok(durable, 'canonical durable action composition must retain qualified OpenClaw capacity');
  assert.deepEqual(durable, elastic);
  assert.equal(missionWorkerActionGrantsMatchV1(durable, elastic), true);
});

test('ordinary exact-PR source grant retains mission, branch, worktree and bounded authority', () => {
  const { mission, capacityRouting } = qualifiedOpenClawSource();
  mission.missionId = 'goal-1725-pr-1931';
  mission.git.branch = 'agent/openclaw-source-existing-owner';
  mission.pullRequest = { number: 1931, headSha: 'b'.repeat(40) };
  const grant = durableOpenClawGrant(mission, capacityRouting);
  assert.ok(grant);
  assert.equal(grant.missionId, mission.missionId);
  assert.equal(grant.laneId, mission.missionId);
  assert.equal(grant.issueNumber, 1725);
  assert.equal(grant.prNumber, 1931);
  assert.equal(grant.branch, mission.git.branch);
  assert.equal(grant.headSha, mission.pullRequest.headSha);
  assert.equal(grant.sourceRevision, head);
  assert.equal(grant.workerId, 'openclaw-original-worker');
  assert.equal(grant.boundedActionCount, 1);
  assert.equal(grant.mergeAuthority, false);
  assert.equal(grant.leaseSeizureAllowed, false);
  const action = buildMissionWorkerAction(mission, { now, actionGrant: grant });
  assert.equal(action.worktreePath, mission.git.worktreePath);
  assert.deepEqual(action.allowedFiles, mission.allowedFiles);
  assert.deepEqual(action.requiredTests, mission.requiredTests);
  const [candidate] = resolveElasticExternalCapacityCandidates(mission, capacityRouting, head, now.toISOString());
  assert.equal(exactElasticExternalGrant(mission, candidate, head, now), null,
    'the separate elastic pre-PR producer must retain its exact-PR exclusion');
});

test('source class is derived from the actual scope and cannot be narrowed by a caller task hint', () => {
  const narrow = qualifiedOpenClawSource();
  const wide = qualifiedOpenClawSource({ taskClass: 'MULTI_MODULE_IMPLEMENTATION' });
  const allowedFiles = Array.from({ length: 5 }, (_, index) => `shared/agents/source-${index}.mjs`);
  for (const fixture of [narrow, wide]) fixture.mission.allowedFiles = allowedFiles;
  assert.ok(durableOpenClawGrant(wide.mission, wide.capacityRouting));
  assert.equal(durableOpenClawGrant(narrow.mission, narrow.capacityRouting), null);
  assert.equal(durableOpenClawGrant(narrow.mission, {
    ...narrow.capacityRouting, task: { taskClass: 'FOCUSED_REPAIR' },
  }), null, 'caller-shaped task class must not authorize a wider source mission');
});

test('OC2-only real-work promotion cannot qualify source edits', () => {
  const { mission, host, capacityRouting } = qualifiedOpenClawSource({ taskClass: 'OC2_DETERMINISTIC_TEST_BUILD' });
  assert.equal(validateOpenClawQualificationAuthorityChain(host.qualificationReceipt, host, {
    repository: mission.repository, taskClass: 'OC2_DETERMINISTIC_TEST_BUILD', sourceHead: head,
    nowUtc: now.toISOString(),
  }).valid, true, 'the negative fixture is internally valid for its own test-only task class');
  assert.equal(durableOpenClawGrant(mission, capacityRouting), null);
  assert.equal(durableOpenClawGrant(mission, {
    ...capacityRouting, task: { taskClass: 'OC2_DETERMINISTIC_TEST_BUILD' },
  }), null);
});

test('qualified capacity never reopens containment, invalid identity, terminal or unknown custody', () => {
  const { mission, capacityRouting } = qualifiedOpenClawSource();
  assert.equal(durableOpenClawGrant(mission, {
    ...capacityRouting, operatorContainment: { active: true, commandId: 'operator-hold', frozenHead: head },
  }), null);
  const missingIdentity = buildMissionWorkerAction({ ...mission, missionId: '' }, { now, capacityRouting });
  assert.equal(missingIdentity.executable, false);
  assert.ok(missingIdentity.blockers.includes('mission-routing-identity-invalid'));
  for (const status of [undefined, '', 'unknown', 'running', 'complete', 'failed', 'publishing']) {
    assert.equal(durableOpenClawGrant({ ...mission, dispatch: { adapter: 'original-owner', status } }, capacityRouting), null, String(status));
  }
  for (const currentPhase of ['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL', 'UNKNOWN']) {
    assert.equal(durableOpenClawGrant({ ...mission, currentPhase }, capacityRouting), null, currentPhase);
  }
});

test('current controller source binds routing even after empty enumeration or invalid source identity', () => {
  const oldHead = 'b'.repeat(40);
  const { mission, capacityRouting } = qualifiedOpenClawSource({ sourceHead: oldHead });
  mission.sourceHead = oldHead;
  capacityRouting.sourceHead = oldHead;
  assert.equal(durableOpenClawGrant(mission, capacityRouting), null);
  assert.equal(durableOpenClawGrant(mission, capacityRouting, head, () => []), null);
  assert.equal(durableOpenClawGrant(mission, capacityRouting, '', () => []), null);
  assert.equal(durableOpenClawGrant(mission, capacityRouting, 'invalid-source', () => []), null);
});

test('host proof chain, task/source freshness and execution quarantine remain mandatory', () => {
  const mutations = [
    ['expired qualification', (host) => { host.qualificationReceipt.expiresAtUtc = '2026-10-30T13:59:30.000Z'; }],
    ['expired capacity', (host) => { host.capacityReceipt.expiresAtUtc = '2026-10-30T13:59:30.000Z'; }],
    ['foreign source', (host) => { host.qualificationReceipt.sourceHead = 'b'.repeat(40); }],
    ['no canonical execution', (host) => { host.realWorkExecutionReceipt = null; }],
    ['nonterminal execution', (host) => { host.realWorkExecutionReceipt.state = 'running'; }],
    ['foreign source phase', (host) => { host.realWorkExecutionReceipt.phase = 'OC2_DETERMINISTIC_TEST_BUILD'; }],
    ['forged authority', (host) => { host.qualificationAuthorityReceipt.participantId = 'openclaw'; }],
    ['foreign workspace receipt', (host) => { host.realWorkWorkspaceReceipt.receivedRecordId = 'unrelated-receipt'; }],
    ['foreign worker', (host) => { host.capacityReceipt.workerId = 'another-worker'; }],
    ['no source construction', (host) => { host.capacityReceipt.supportedOperations = ['FOCUSED_TESTS']; }],
    ['unknown qualification field', (host) => { host.qualificationReceipt.sourceMutationAllowed = true; }],
  ];
  for (const [reason, mutate] of mutations) {
    const { mission, host, capacityRouting } = qualifiedOpenClawSource();
    const changed = structuredClone(host);
    mutate(changed);
    assert.equal(durableOpenClawGrant(mission, { ...capacityRouting, openClawHostContext: changed }), null, reason);
  }
  const { mission, capacityRouting } = qualifiedOpenClawSource();
  for (const adapter of ['openclaw-local', ' OPENCLAW-LOCAL ']) {
    assert.equal(durableOpenClawGrant(mission, { ...capacityRouting, blockedAdapters: [adapter] }), null, adapter);
  }
  assert.equal(durableOpenClawGrant(mission, {
    ...capacityRouting, blockedAdapters: ['openclaw-standalone'],
  })?.adapter, 'openclaw-local', 'the two existing execution surfaces keep distinct quarantine identities');
  assert.equal(durableOpenClawGrant({ ...mission, requiredEvidence: ['Battle Bridge Windows runtime proof'] }, capacityRouting), null);
});

test('mission/task qualification lookalikes cannot replace trusted host capacity', () => {
  const { mission, host, capacityRouting } = qualifiedOpenClawSource();
  const callerMission = { ...mission, openClawHostContext: host, openClawHostContexts: [host], ...host };
  const callerCapacity = { ...capacityRouting, openClawHostContext: undefined,
    task: { preferredProviderRoute: 'OPENCLAW_LOCAL', openClawHostContext: host, ...host } };
  assert.equal(durableOpenClawGrant(callerMission, callerCapacity), null);
});

test('the real pool can select a matching source context after an unrelated qualified task context', () => {
  const { mission, host, capacityRouting } = qualifiedOpenClawSource();
  const unrelated = qualifiedOpenClawSource({ taskClass: 'OC2_DETERMINISTIC_TEST_BUILD' }).host;
  const grant = durableOpenClawGrant(mission, {
    ...capacityRouting, openClawHostContext: undefined, openClawHostContexts: [unrelated, host],
  });
  assert.equal(grant?.workerId, host.capacityReceipt.workerId);
  assert.equal(grant?.capacityReceiptId, host.capacityReceipt.receiptId);
});

test('pooled and legacy contexts select the same deterministic worker in both actual grant factories', () => {
  const { mission, host: slow, capacityRouting } = qualifiedOpenClawSource({ workerId: 'openclaw-worker-a' });
  const second = qualifiedOpenClawSource({ workerId: 'openclaw-worker-c' }).host;
  const first = qualifiedOpenClawSource({ workerId: 'openclaw-worker-b' }).host;
  slow.capacityReceipt.p95StartLatencySeconds = 10;
  const routing = { ...capacityRouting, openClawHostContexts: [second, first] };
  const [candidate] = resolveElasticExternalCapacityCandidates(mission, routing, head, now.toISOString());
  assert.equal(candidate.workerId, 'openclaw-worker-b');
  const durable = durableOpenClawGrant(mission, routing);
  assert.equal(durable?.workerId, candidate.workerId);
  assert.deepEqual(durable, exactElasticExternalGrant(mission, candidate, head, now));
});

test('metered breaker and optional overflow remain independent of OpenClaw qualification', () => {
  const { mission, capacityRouting } = qualifiedOpenClawSource();
  const codexStatus = {
    schemaVersion: 'shared-agent-workspace-record.v1', statusId: 'codex-capacity-current',
    truthState: 'CURRENT', meterTruthUsable: true, observedAtUtc: '2026-10-30T13:59:00.000Z',
    remainingPercent: 90, availability: 'AVAILABLE', confidence: 'high', naturalResetAtUtc: '',
  };
  assert.equal(durableOpenClawGrant(mission, { ...capacityRouting, codexStatus })?.adapter, 'openclaw-local');
  assert.equal(durableOpenClawGrant(mission, {
    ...capacityRouting, codexStatus, openClawHostContext: undefined,
  }), null, 'blackout must not fall back to healthy metered Codex');
  assert.equal(durableOpenClawGrant(mission, {
    ...capacityRouting, codexStatus, openAiBlackout: false, preferNonOpenAi: false,
  })?.adapter, 'codex', 'explicit ordinary provider policy stays intact');
});

test('validated explicit action grants still select their exact existing route without rerouting', () => {
  const { mission, capacityRouting } = qualifiedOpenClawSource();
  const grant = durableOpenClawGrant(mission, capacityRouting);
  assert.ok(grant);
  const action = buildMissionWorkerAction(mission, {
    now, actionGrant: grant,
    capacityRouting: { nowUtc: now.toISOString(), operatorContainment: { active: true } },
  });
  assert.equal(action.executable, true);
  assert.equal(action.adapter, grant.adapter);
  assert.equal(action.owner, grant.workerId);
  assert.equal(action.capacityReceiptId, grant.capacityReceiptId);
});
