import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSovereignReviewCoverageV1 as assess,
  SOVEREIGN_REVIEW_DOMAINS as domains,
} from './sovereignReviewCoverageV1.mjs';

const target = {
  repository:'Cheekyfellastef/stephan-os',prNumber:3168,
  branch:'goal-1574-sovereign-windows-calibration-20261018',
  sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
};
const result = changedFiles => assess({...target,changedFiles});
const denies = r => {
  for (const key of ['meteredReviewReplacementQualified','qualifiedIndependentReview',
    'qualifiedWindowsSpecialist','specialistAuthority','reviewAcceptanceAuthority',
    'reviewerEnrollmentAuthority','protectedMergeAuthority','operatorApprovalAuthority',
    'sourceMutationAuthority','privilegedWindowsAuthority','originalLeaseReleaseAuthority',
    'runtimeDeploymentAuthority','physicalPickupProven']) assert.equal(r[key],false,key);
};

test('ordinary product changes use existing standard reviewer only as candidate',()=>{
  const r=result(['stephanos-ui/src/components/MusicCard.tsx']);
  assert.equal(r.status,'STANDARD_LOCAL_CANDIDATE_SCOPE_ONLY');
  assert.deepEqual(r.domains,['standard-source']);
  assert.equal(r.reviewPackets[0].riskTier,'standard');
  assert.equal(r.reviewPackets[0].localCandidateRunner,'scripts/sovereign-reviewer-v1.mjs');
  denies(r);
});

test('original R7 lease with native service requires specialist, custody and physical proof',()=>{
  const r=result([
    'src/windows/Stephanos.OriginalR7CustodyWitness/Program.cs',
    'shared/agents/legacyOriginalSourceOrphanQuarantineV1.mjs',
  ]);
  assert.equal(r.status,'HIGH_RISK_LOCAL_CANDIDATE_SCOPE_ONLY');
  assert.ok(r.domains.includes('windows-os-and-services'));
  assert.ok(r.domains.includes('original-source-lease'));
  const win=r.reviewPackets.find(x=>x.domain==='windows-os-and-services');
  assert.equal(win.riskTier,'high');
  assert.equal(win.localCandidateRunner,'scripts/sovereign-high-risk-advisory-launcher-v1.mjs');
  assert.equal(win.supplementalWindowsExam,'scripts/sovereign-windows-review-calibration-v1.mjs');
  assert.ok(win.requiredEvidence.includes('NATIVE_WINDOWS_TOKEN_ACL_REENTRY_AND_HANDLE_EVIDENCE'));
  assert.ok(r.reviewPackets.some(p=>p.requiredEvidence
    .includes('HISTORIC_R7_CUSTODY_SIGNED_WITNESS_AND_SEPARATE_OPERATOR_CAS')));
  assert.ok(r.blockers.includes('LIVE_PHYSICAL_PROOF_NOT_PROVEN'));
  denies(r);
});

test('all metered-review domains are represented and none acquires authority',()=>{
  const paths=[
    'src/components/Song.tsx',
    'scripts/windows/repair-stephanos-battle-bridge.ps1',
    'plugins/openclaw-local/SKILL.md',
    'shared/runtime/goalConveyorLeaseV1.mjs',
    'stephanos-server/services/credentialVaultV1.js',
    '.github/workflows/protected-merge.yml',
    'shared/agents/qualifiedSpecialistReviewV1.mjs',
    'scripts/browser-proof-runner.mjs',
    'scripts/battle-bridge-recovery-mesh.mjs',
    'scripts/unclassified-runtime-control.mjs',
  ];
  const r=result(paths);
  for (const domain of domains) assert.ok(r.domains.includes(domain),domain);
  assert.equal(r.reviewPackets.length,domains.length);
  assert.equal(r.reviewedPathCount,paths.length);
  assert.ok(r.reviewPackets.every(p=>p.candidateOnly
    && !p.independentQualificationVerified && !p.acceptedProtectedReview
    && !p.physicalRuntimeProven));
  const bootstrap = r.reviewPackets.find(x=>x.domain==='reviewer-trust-and-approval');
  assert.ok(bootstrap.requiredEvidence.includes('OUT_OF_BAND_TRUST_ROOT_AND_PROTECTED_SELF_CHANGE_REVIEW'));
  denies(r);
});

test('partial, unsafe and duplicate changed-path estates hold rather than guess',()=>{
  for (const changedFiles of [[],null,['../secret'],['C:\\temp\\secret'],
    ['src/A.js','src/A.js'],Array(161).fill('src/A.js'),Array(2)]) {
    const r=result(changedFiles);
    assert.equal(r.status,'REVIEW_COVERAGE_HELD');
    denies(r);
  }
});
test('moved head, missing base, malformed identity, and forged evidence never grant review',()=>{
  for (const patch of [
    {sourceHead:'broken'}, {baseSha:'a'.repeat(40)}, {prNumber:-1},
    {branch:'../unsafe'}, {repository:'no slash'},
  ]) {
    const r=assess({...target,...patch,changedFiles:['src/main.ts']});
    assert.equal(r.status,'REVIEW_COVERAGE_HELD');denies(r);
  }
  const forged=assess({...target,changedFiles:['scripts/windows/witness.ps1'],
    qualifiedWindowsSpecialist:true,acceptedProtectedReview:true,
    signatureVerified:true,attestationVerified:true});
  assert.equal(forged.meteredReviewReplacementQualified,false);denies(forged);
});
test('multi-domain paths do not silently collapse review obligations',()=>{
  const r=result(['scripts/windows/original-source-lease-witness.ps1',
    'shared/agents/sovereignReviewerV1.mjs']);
  assert.ok(r.reviewPackets.length>=3);
  for(const p of r.reviewPackets) assert.ok(p.requiredEvidence.length>=3);
  denies(r);
});

test('unknown executable or policy files escalate instead of silently becoming standard code',()=>{
  const r=result(['shared/runtime/novelCoordinator.mjs']);
  assert.equal(r.status,'HIGH_RISK_LOCAL_CANDIDATE_SCOPE_ONLY');
  assert.ok(r.domains.includes('other-execution-or-policy'));
  assert.ok(r.reviewPackets[0].requiredEvidence.includes('QUALIFIED_SPECIALIST_SECURITY_REVIEW'));
  denies(r);
});
