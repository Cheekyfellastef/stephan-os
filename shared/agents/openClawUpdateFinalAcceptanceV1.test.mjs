import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPENCLAW_STAGED_UPDATE_SCHEMA,
  OPENCLAW_STAGED_UPDATE_STATUS,
  OPENCLAW_STAGED_UPDATE_ACTION,
  OPENCLAW_APPROVED_GATEWAY_ENDPOINT,
  OPENCLAW_UPDATE_POST_PROOF_SCHEMA,
  OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA,
  OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA,
} from './openClawStagedUpdateV1.mjs';
import {
  buildOpenClawUpdateCapabilityLedgerV1,
  OPENCLAW_TASK_CLASS,
} from './openClawUpdateCapabilityLedgerV1.mjs';
import {
  OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
  OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
} from './openClawUpdateCapabilityOutcomeV1.mjs';
import {
  OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA,
} from './openClawUpdateCapabilityCandidateGateV1.mjs';
import {
  OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS,
  evaluateOpenClawUpdateFinalAcceptanceV1,
} from './openClawUpdateFinalAcceptanceV1.mjs';

const HEAD = 'a'.repeat(40);

function capability() {
  return {
    capabilityId: 'openclaw.repo-scout',
    purpose: 'Bounded repository scout.',
    currentImplementation: 'plugin.repo-scout.v1',
    candidateImplementation: 'plugin.repo-scout.v2',
    origin: 'stephanos-extension',
    candidateOrigin: 'stephanos-extension',
    protected: true,
    qualificationRefs: ['qualification.oc1.current'],
    tests: ['test.oc1.repo-scout'],
    dependencies: ['shared.workspace'],
    migrationPolicy: 'Preserve the bounded mission contract.',
    replacementCriteria: 'Pass the same acceptance contract without authority widening.',
    lastQualifiedVersion: '1.2.3',
    updateDisposition: 'IMPROVE',
    evidenceRefs: ['proof.oc1.candidate'],
    affectedTaskClasses: [OPENCLAW_TASK_CLASS.OC1],
  };
}

function ledger() {
  return buildOpenClawUpdateCapabilityLedgerV1({
    currentVersion: '1.2.3',
    targetVersion: '1.3.0',
    capabilities: [capability()],
  });
}

function staged(status = OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY) {
  const result = {
    schema: OPENCLAW_STAGED_UPDATE_SCHEMA,
    status,
    blockers: [],
    exactIdentity: {
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      manifestSha256: 'b'.repeat(64),
      packetId: 'openclaw-update-1',
      packetSha256: 'c'.repeat(64),
      currentVersion: '1.2.3',
      targetVersion: '1.3.0',
    },
    safety: {
      sourceHarnessOnly: true,
      mutationAllowed: false,
      arbitraryShellAllowed: false,
      arbitraryPathAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      deploymentAuthority: false,
      battleBridgeAdapterRequired: true,
      operatorApprovalRequired: ![
        OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED,
        OPENCLAW_STAGED_UPDATE_STATUS.ROLLED_BACK_AND_VERIFIED,
      ].includes(status),
      secretsIncluded: false,
      absolutePathsPublished: false,
    },
  };
  if (status === OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED) {
    result.evidence = postUpdateEvidenceFixture(result.exactIdentity);
    result.applyPlan = [
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_PREFLIGHT,OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_APPROVAL,
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_STAGE,OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_BACKUP,
      OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE,OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_HEALTH,
      OPENCLAW_STAGED_UPDATE_ACTION.COMPARE_PRESERVATION,
    ].map((actionId,i)=>({step:i+1,actionId,mutating:i===4,executed:false}));
    result.rollbackPlan = [
      OPENCLAW_STAGED_UPDATE_ACTION.ROLLBACK_PACKAGE,OPENCLAW_STAGED_UPDATE_ACTION.RESTORE_BACKUP,
      OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_ROLLBACK,
    ].map((actionId,i)=>({step:i+1,actionId,mutating:i<2,executed:false}));
  }
  return result;
}
function producerBackupHashForFixture(backup) {
  const canon=(v)=>Array.isArray(v)?`[${v.map(canon).join(',')}]`:
    v && typeof v==='object'? `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`:
    JSON.stringify(v);
  const entries=[...backup.entries].sort((a,b)=>a.pathFingerprintSha256.localeCompare(b.pathFingerprintSha256));
  const body={schema:backup.schema,backupSetId:backup.backupSetId,
    manifestSha256:backup.manifestSha256,storageClass:backup.storageClass,
    createdAtUtc:backup.createdAtUtc,entries};
  return createHash('sha256').update(canon(body)).digest('hex');
}

function postUpdateEvidenceFixture(id) {
  const fp='d'.repeat(64),bytes='e'.repeat(64);
  const fixture = {
    preflight:{...id,gatewayEndpoint:OPENCLAW_APPROVED_GATEWAY_ENDPOINT,
      protectedEntries:[{pathFingerprintSha256:fp,sourceDigestSha256:bytes}]},
    approval:{schema:'stephanos.openclaw-update-approval.v1',approvalId:'approval-1',approvedBy:'Cheekyfellastef',
      repository:id.repository,sourceHead:id.sourceHead,manifestSha256:id.manifestSha256,
      packetId:id.packetId,packetSha256:id.packetSha256,targetVersion:id.targetVersion,
      mutationScope:OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE,singleUse:true,
      approvedAtUtc:new Date(Date.now()-60000).toISOString(),
      expiresAtUtc:new Date(Date.now()+86400000).toISOString()},
    stage:{schema:'stephanos.openclaw-update-stage.v1',stageId:'stage-1',
      packetId:id.packetId,packetSha256:id.packetSha256,targetVersion:id.targetVersion,
      isolationClass:'ISOLATED_EXTERNAL_STAGING',insideRepository:false,insideOpenClawInstall:false,
      packageEntryCount:1,executableEntryCount:1,observedAtUtc:new Date().toISOString()},
    backupSet:{schema:'stephanos.openclaw-update-backup-set.v1',backupSetId:'backup-1',
      manifestSha256:id.manifestSha256,storageClass:'ISOLATED_EXTERNAL_BACKUP',
      insideRepository:false,insideOpenClawInstall:false,createdAtUtc:new Date().toISOString(),
      backupSetSha256:'f'.repeat(64),
      entries:[{pathFingerprintSha256:fp,sourceDigestSha256:bytes,
        backupDigestSha256:bytes,backupObjectId:'backup:oc8'}]},
    applyReceipt:{schema:OPENCLAW_UPDATE_APPLY_RECEIPT_SCHEMA,receiptId:'apply-1',mutationAttempted:true,
      approvalId:'approval-1',stageId:'stage-1',backupSetId:'backup-1',repository:id.repository,
      sourceHead:id.sourceHead,manifestSha256:id.manifestSha256,packetId:id.packetId,
      packetSha256:id.packetSha256,targetVersion:id.targetVersion,
      adapterId:'openclaw-bounded-update-adapter-v1',beforeVersion:id.currentVersion,
      observedAtUtc:new Date().toISOString(),
      steps:[OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_PREFLIGHT,
        OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_APPROVAL,
        OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_STAGE,
        OPENCLAW_STAGED_UPDATE_ACTION.VERIFY_BACKUP,
        OPENCLAW_STAGED_UPDATE_ACTION.APPLY_UPDATE]},
    postUpdateProof:{schema:OPENCLAW_UPDATE_POST_PROOF_SCHEMA,proofId:'health-1',repository:id.repository,
      sourceHead:id.sourceHead,manifestSha256:id.manifestSha256,observedVersion:id.targetVersion,
      gatewayEndpoint:OPENCLAW_APPROVED_GATEWAY_ENDPOINT,
      observedAtUtc:new Date().toISOString(),
      health:{openClawGateway:true,stephanosBackend:true,stephanosUi:true,
        missionWorker:true,sharedWorkspaceWrite:true}},
    preservationComparison:{schema:OPENCLAW_UPDATE_PRESERVATION_COMPARISON_SCHEMA,
      comparisonId:'compare-1',manifestSha256:id.manifestSha256,
      entries:[{pathFingerprintSha256:fp,beforeDigestSha256:bytes,afterDigestSha256:bytes}]},
    rollbackReceipt:null,rollbackProof:null,rollbackComparison:null,
  };
  fixture.backupSet.backupSetSha256 = producerBackupHashForFixture(fixture.backupSet);
  return fixture;
}

function comparisons(candidateVerdict = 'PASS') {
  return [{
    schemaVersion: OPENCLAW_UPDATE_CAPABILITY_COMPARISON_SCHEMA,
    capabilityId: 'openclaw.repo-scout',
    testResults: [{
      schemaVersion: OPENCLAW_UPDATE_CAPABILITY_TEST_RESULT_SCHEMA,
      testId: 'test.oc1.repo-scout',
      baselineVerdict: 'PASS',
      candidateVerdict,
      proofRef: 'proof.oc1.candidate',
    }],
  }];
}

function replay(verdict = 'PRODUCTION_ELIGIBLE') {
  return [{
    schemaVersion: OPENCLAW_UPDATE_QUALIFICATION_REPLAY_SCHEMA,
    taskClass: OPENCLAW_TASK_CLASS.OC1,
    qualificationId: 'qualification:oc1-repository-scout',
    sourceHead: HEAD,
    providerVersion: '1.3.0',
    verdict,
    proofRefs: ['proof:oc1-requalified'],
  }];
}

test('pre-update candidate must already prove equal-or-better capability outcomes', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
    qualificationReplay: [],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.PRE_UPDATE_READY);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
});

test('post-update provider routing resumes only after equal-or-better outcome and requalification', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
    qualificationReplay: replay(),
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.UPDATED_AND_VERIFIED);
  assert.equal(result.updatePromotionAllowed, true);
  assert.equal(result.providerRoutingResumeAllowed, true);
  assert.equal(result.rollbackRequired, false);
  assert.equal(result.authority.providerQualificationAllowed, false);
});

test('candidate capability regression blocks routing even when qualification replay claims success', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons('FAIL'),
    qualificationReplay: replay(),
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_FAILED);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
  assert.equal(result.rollbackRequired, true);
  assert.match(result.blockers.join('\n'), /CANDIDATE_REGRESSION/);
});

test('equal-or-better capability result cannot substitute for missing task-class requalification', () => {
  const result = evaluateOpenClawUpdateFinalAcceptanceV1({
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.UPDATED_AND_VERIFIED),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
    qualificationReplay: [],
  });
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.POST_UPDATE_PROOF_REQUIRED);
  assert.equal(result.updatePromotionAllowed, false);
  assert.equal(result.providerRoutingResumeAllowed, false);
});

test('hostile top-level accessor is rejected without invocation', () => {
  let invoked = false;
  const input = {
    stagedUpdate: staged(OPENCLAW_STAGED_UPDATE_STATUS.READY_TO_APPLY),
    capabilityLedger: ledger(),
    capabilityComparisons: comparisons(),
  };
  Object.defineProperty(input, 'qualificationReplay', {
    enumerable: true,
    get() { invoked = true; return []; },
  });
  const result = evaluateOpenClawUpdateFinalAcceptanceV1(input);
  assert.equal(invoked, false);
  assert.equal(result.status, OPENCLAW_UPDATE_FINAL_ACCEPTANCE_STATUS.BLOCK_UPDATE);
});
