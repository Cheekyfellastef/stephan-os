import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateForgeShadowM5Acceptance, FORGE_M5_ACCEPTANCE_VERDICT } from './forgeShadowM5AcceptanceV1.mjs';

const head = '1'.repeat(40);
const tree = '2'.repeat(40);
const now = '2026-08-20T16:20:00.000Z';
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function seal(value) {
  const core = { ...value };
  delete core.payloadSha256;
  return { ...core, payloadSha256:createHash('sha256').update(canonicalJson(core)).digest('hex') };
}
const m2 = seal({ schemaVersion:'stephanos.forge-shadow-m2-runtime-receipt.v1', receiptId:'forge-m2-real-001', repository:'Cheekyfellastef/stephan-os', sourceHead:head, sourceTree:tree, mirrorHead:head, mirrorTree:tree, operation:'INSTALL_FORGE_SHADOW_M2', state:'DONE', finalVerdict:'FORGE_SHADOW_M2_READY', completedAt:'2026-08-20T16:10:00.000Z', proofRefs:['proofs/forge/m2'] });
const m3 = seal({ schemaVersion:'stephanos.forge-shadow-m3-runner-runtime-receipt.v1', receiptId:'forge-m3-real-001', repository:'Cheekyfellastef/stephan-os', sourceHead:head, sourceTree:tree, artifactSetDigest:`sha256:${'3'.repeat(64)}`, runnerIdentities:['stephanos-forge-linux-runner-01','stephanos-forge-windows-proof-runner-01'], linuxReviewRunnerConnected:true, windowsProofRunnerConnected:true, teardownComplete:true, zeroResidualRegistration:true, zeroResidualCredential:true, zeroResidualWorkspace:true, canCarryRealWork:true, finalVerdict:'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY', completedAt:'2026-08-20T16:12:00.000Z', proofRefs:['proofs/forge/m3'] });
const sidecar = { goalId:'#1671', repository:'Cheekyfellastef/stephan-os', canonicalMainHead:head, canonicalMainTree:tree, mirrorHead:head, mirrorTree:tree, sourceReady:true, m2Receipt:m2, m3RuntimeReceipt:m3, evidenceRefs:['proofs/forge/m2','proofs/forge/m3'] };
function receipt(route, goalId, suffix) {
  return { receiptId:`${route.toLowerCase()}-${suffix}`, route, goalId, missionId:`mission-${route.toLowerCase()}-${suffix}`, laneId:`lane-${route.toLowerCase()}-${suffix}`, repository:'Cheekyfellastef/stephan-os', baseHead:head, baseTree:tree, intendedTree:'4'.repeat(40), changedFiles:['shared/agents/example.mjs'], focusedTestSuiteId:`suite-${suffix}`, focusedTestsPassed:true, artifactDigests:[`sha256:${'5'.repeat(64)}`], proofRefs:[`proofs/${route.toLowerCase()}/${suffix}`] };
}
function goal(goalId, suffix) {
  const github = receipt('CHATGPT_GITHUB', goalId, suffix);
  const forge = receipt('FOUNDRY_FORGE', goalId, suffix);
  return { goalId, github, forge, protectedIntegration:{ repository:'Cheekyfellastef/stephan-os', goalId, prNumber:Number(suffix)+100, head:'6'.repeat(40), tree:'4'.repeat(40), finalMainHead:'7'.repeat(40), finalMainTree:'4'.repeat(40), protected:true, proofRefs:[`proofs/integration/${suffix}`] } };
}
function packet() { return { repository:'Cheekyfellastef/stephan-os', canonicalMainHead:head, canonicalMainTree:tree, nowUtc:now, forgeSidecar:sidecar, goalRuns:[goal('goal-101','1'), goal('goal-102','2')] }; }

test('passes only two exact dual-path goals with protected GitHub integration', () => {
  const out = evaluateForgeShadowM5Acceptance(packet());
  assert.equal(out.verdict, FORGE_M5_ACCEPTANCE_VERDICT.PASSED);
  assert.equal(out.goalCount, 2);
  assert.equal(out.authority.merge, false);
});
test('requires two real goals', () => {
  const p = packet(); p.goalRuns.pop();
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.REQUIRED);
});
test('blocks without genuine Forge M2/M3 capacity', () => {
  const p = packet(); p.forgeSidecar = { ...sidecar, m3RuntimeReceipt:{ ...m3, canCarryRealWork:false } };
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.CAPACITY_NOT_PROVEN);
});
test('fails tree drift', () => {
  const p = packet(); p.goalRuns[0].forge.intendedTree = '8'.repeat(40);
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.FAILED);
});
test('fails changed-file drift', () => {
  const p = packet(); p.goalRuns[0].forge.changedFiles = ['shared/agents/other.mjs'];
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.FAILED);
});
test('fails test-suite drift', () => {
  const p = packet(); p.goalRuns[0].forge.focusedTestSuiteId = 'other-suite';
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.FAILED);
});
test('fails artifact drift', () => {
  const p = packet(); p.goalRuns[0].forge.artifactDigests = [`sha256:${'9'.repeat(64)}`];
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.FAILED);
});
test('rejects duplicate execution identity', () => {
  const p = packet(); p.goalRuns[0].forge.receiptId = p.goalRuns[0].github.receiptId;
  assert.equal(evaluateForgeShadowM5Acceptance(p).verdict, FORGE_M5_ACCEPTANCE_VERDICT.FAILED);
});
test('rejects hostile widened input and grants no authority', () => {
  const p = packet(); p.command = 'rm -rf /';
  const out = evaluateForgeShadowM5Acceptance(p);
  assert.equal(out.verdict, FORGE_M5_ACCEPTANCE_VERDICT.EVIDENCE_INVALID);
  assert.equal(out.authority.runtimeMutation, false);
  assert.equal(out.authority.arbitraryCommand, false);
});
