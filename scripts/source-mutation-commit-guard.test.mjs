import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateSourceMutationCommitGuard,
  SOURCE_MUTATION_LEASE_SCHEMA,
  SOURCE_MUTATION_REPOSITORY,
} from './source-mutation-commit-guard.mjs';

const NOW=Date.parse('2026-10-07T04:20:00.000Z');
const HEAD='3af70a289d8c40470a4dc291d8a12f32fc7d0431';

function lease(overrides={}){
  const acquiredAtUtc='2026-10-07T04:00:00.000Z';
  return {
    schemaVersion:'shared-agent-workspace-record.v1',
    kind:'stephanos.shared_workspace.status',
    statusId:'source-mutation-lease-current',
    participantId:'source-mutation-lease-authority',
    timestampUtc:acquiredAtUtc,
    status:'ACTIVE',
    summary:'test source mutation lease',
    proofRefs:[],
    schema:SOURCE_MUTATION_LEASE_SCHEMA,
    leaseId:'lease-goal-2862-openclaw-local',
    laneId:'goal-2862-source-repair',
    repository:SOURCE_MUTATION_REPOSITORY,
    issueNumber:2862,
    prNumber:2862,
    branch:'repair/goal-2862',
    headSha:HEAD,
    ownerId:'openclaw-local',
    acquiredAtUtc,
    renewedAtUtc:'2026-10-07T04:15:00.000Z',
    expiresAtUtc:'2026-10-07T05:15:00.000Z',
    executionReceiptLeaseKeyIsCorrelationOnly:true,
    mergeAuthority:false,
    leaseSeizureAllowed:false,
    ...overrides,
  };
}

test('local main blocks source commits but preserves the generated-dist-only publication path',()=>{
  const blocked=evaluateSourceMutationCommitGuard({
    branch:'main',
    headSha:HEAD,
    stagedPaths:['scripts/source-change.mjs'],
    nowMs:NOW,
  });
  assert.equal(blocked.ok,false);
  assert.equal(blocked.blocker,'SOURCE_MUTATION_ON_LOCAL_MAIN_FORBIDDEN');

  const mixed=evaluateSourceMutationCommitGuard({
    branch:'main',
    headSha:HEAD,
    stagedPaths:['apps/stephanos/dist/index.html','scripts/source-change.mjs'],
    nowMs:NOW,
  });
  assert.equal(mixed.ok,false);
  assert.equal(mixed.blocker,'SOURCE_MUTATION_ON_LOCAL_MAIN_FORBIDDEN');

  const generated=evaluateSourceMutationCommitGuard({
    branch:'main',
    headSha:HEAD,
    stagedPaths:['apps/stephanos/dist/index.html','apps/stephanos/dist/assets/app.js'],
    nowMs:NOW,
  });
  assert.equal(generated.ok,true);
  assert.equal(generated.generatedDistOnly,true);
  assert.equal(generated.finalVerdict,'SOURCE_MUTATION_GENERATED_DIST_COMMIT_ALLOWED');
});

test('fresh branch-bound canonical lease admits its descendant head',()=>{
  const r=evaluateSourceMutationCommitGuard({
    branch:'repair/goal-2862',
    headSha:HEAD,
    lease:lease(),
    nowMs:NOW,
    leaseHeadIsAncestor:true,
  });
  assert.equal(r.ok,true);
});

test('missing expired mismatched and unrelated leases fail closed',()=>{
  assert.equal(
    evaluateSourceMutationCommitGuard({branch:'repair/goal-2862',headSha:HEAD,lease:null,nowMs:NOW}).blocker,
    'SOURCE_MUTATION_LEASE_MISSING',
  );
  assert.equal(
    evaluateSourceMutationCommitGuard({
      branch:'repair/goal-2862',
      headSha:HEAD,
      lease:lease({expiresAtUtc:'2026-10-07T04:19:59.000Z'}),
      nowMs:NOW,
      leaseHeadIsAncestor:true,
    }).blocker,
    'SOURCE_MUTATION_LEASE_EXPIRED',
  );
  assert.equal(
    evaluateSourceMutationCommitGuard({
      branch:'repair/other',
      headSha:HEAD,
      lease:lease(),
      nowMs:NOW,
      leaseHeadIsAncestor:true,
    }).blocker,
    'SOURCE_MUTATION_LEASE_INVALID',
  );
  assert.equal(
    evaluateSourceMutationCommitGuard({
      branch:'repair/goal-2862',
      headSha:HEAD,
      lease:lease(),
      nowMs:NOW,
      leaseHeadIsAncestor:false,
    }).blocker,
    'SOURCE_MUTATION_LEASE_HEAD_NOT_ANCESTOR',
  );
});

test('canonical validator rejects a lease whose lifetime exceeds twenty-four hours',()=>{
  const r=evaluateSourceMutationCommitGuard({
    branch:'repair/goal-2862',
    headSha:HEAD,
    lease:lease({expiresAtUtc:'2026-10-08T04:00:00.001Z'}),
    nowMs:NOW,
    leaseHeadIsAncestor:true,
  });
  assert.equal(r.ok,false);
  assert.equal(r.blocker,'SOURCE_MUTATION_LEASE_INVALID');
  assert.ok(r.leaseErrors.includes('lease-lifetime-exceeds-maximum'));
});

test('lease cannot widen merge or seizure authority',()=>{
  for(const widened of [{mergeAuthority:true},{leaseSeizureAllowed:true}]){
    const r=evaluateSourceMutationCommitGuard({
      branch:'repair/goal-2862',
      headSha:HEAD,
      lease:lease(widened),
      nowMs:NOW,
      leaseHeadIsAncestor:true,
    });
    assert.equal(r.ok,false);
    assert.equal(r.blocker,'SOURCE_MUTATION_LEASE_INVALID');
  }
});
