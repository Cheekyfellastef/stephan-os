import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STARFIELD_VR_EVIDENCE_FRONTS,
  STARFIELD_VR_OPERATOR_EVIDENCE_BOUNDARY,
  STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA,
  assessStarfieldVrOperatorEvidence,
  buildStarfieldVrOperatorTestPlan,
} from './starfieldVrOperatorEvidenceV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = '2026-08-17T15:30:00Z';
const item = (frontId, evidenceClass, extra = {}) => ({
  frontId, evidenceClass, verdict: 'PASS', proofId: `proof:${frontId}`, headSha: HEAD, observedAt: NOW, ...extra,
});
const sourceEvidence = () => [
  item('source-baseline', 'source'),
  item('launch-policy', 'source'),
];
const runtimeEvidence = () => [
  item('in-game-transition', 'runtime', { runtimeIdentity: 'battle-bridge:starfield-vr' }),
  item('overlay-dashboard', 'runtime', { runtimeIdentity: 'battle-bridge:starfield-vr' }),
  item('save-rollback', 'runtime', { runtimeIdentity: 'battle-bridge:starfield-vr' }),
  item('failure-remediation', 'runtime', { runtimeIdentity: 'battle-bridge:starfield-vr' }),
];
const physicalEvidence = () => [
  item('quest3-headset', 'physical', { deviceId: 'quest-3', operatorReceiptId: 'operator:quest3:headset' }),
  item('controller-anchoring', 'physical', { deviceId: 'quest-3', operatorReceiptId: 'operator:quest3:controller' }),
  item('comfort-responsiveness', 'physical', { deviceId: 'quest-3', operatorReceiptId: 'operator:quest3:comfort' }),
];

function assess(overrides = {}) {
  return assessStarfieldVrOperatorEvidence({
    exactHeadSha: HEAD,
    sourceEvidence: sourceEvidence(),
    runtimeEvidence: runtimeEvidence(),
    physicalEvidence: physicalEvidence(),
    ...overrides,
  });
}

test('front inventory separates source, runtime and physical evidence', () => {
  assert.equal(STARFIELD_VR_EVIDENCE_FRONTS.filter((x) => x.evidenceClass === 'source').length, 2);
  assert.equal(STARFIELD_VR_EVIDENCE_FRONTS.filter((x) => x.evidenceClass === 'runtime').length, 4);
  assert.equal(STARFIELD_VR_EVIDENCE_FRONTS.filter((x) => x.evidenceClass === 'physical').length, 3);
});

test('complete supplied evidence is classified without claiming live authority', () => {
  const verdict = assess();
  assert.equal(verdict.status, 'EVIDENCE_COMPLETE');
  assert.equal(verdict.blockerClass, null);
  assert.equal(verdict.boundary.liveClaimAuthority, false);
  assert.equal(verdict.boundary.launchAuthority, false);
  assert.equal(verdict.boundary.installAuthority, false);
  assert.equal(verdict.boundary.mergeAuthority, false);
  assert.equal(Object.isFrozen(verdict), true);
  assert.equal(Object.isFrozen(verdict.evidenceRefs.runtime), true);
});

test('source gaps fail closed before runtime or physical claims matter', () => {
  const verdict = assess({ sourceEvidence: [item('source-baseline', 'source')] });
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.blockerClass, 'PRODUCT_SOURCE_GAP');
  assert.deepEqual(verdict.missing.source, ['launch-policy']);
});

test('runtime gaps route to construction machinery instead of spawning product execution', () => {
  const verdict = assess({ runtimeEvidence: [] });
  assert.equal(verdict.status, 'RUNTIME_PROOF_REQUIRED');
  assert.equal(verdict.blockerClass, 'CONSTRUCTION_RUNTIME_GAP');
  assert.deepEqual(verdict.missing.runtime, ['in-game-transition', 'overlay-dashboard', 'save-rollback', 'failure-remediation']);
});

test('physical gaps remain explicit operator gates', () => {
  const verdict = assess({ physicalEvidence: [] });
  assert.equal(verdict.status, 'PHYSICAL_HEADSET_REQUIRED');
  assert.equal(verdict.blockerClass, 'OPERATOR_PHYSICAL_TEST_REQUIRED');
  const plan = buildStarfieldVrOperatorTestPlan(verdict);
  assert.equal(plan.status, 'OPERATOR_TEST_REQUIRED');
  assert.equal(plan.steps.length, 3);
  assert.ok(plan.steps.every((step) => step.authority === 'observation-only'));
});

test('test plan disappears when no physical evidence is pending', () => {
  const plan = buildStarfieldVrOperatorTestPlan(assess());
  assert.equal(plan.status, 'NO_PHYSICAL_TEST_PENDING');
  assert.deepEqual(plan.steps, []);
});

test('wrong exact head cannot satisfy any evidence front', () => {
  const bad = sourceEvidence();
  bad[0].headSha = 'b'.repeat(40);
  const verdict = assess({ sourceEvidence: bad });
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(verdict.exactHeadSha, '');
});

test('non-PASS evidence does not become proof', () => {
  const bad = runtimeEvidence();
  bad[0].verdict = 'WARN';
  assert.equal(assess({ runtimeEvidence: bad }).status, 'BLOCKED');
});

test('physical evidence requires Quest 3 and explicit operator receipt identity', () => {
  const badDevice = physicalEvidence();
  badDevice[0].deviceId = 'quest-pro';
  assert.equal(assess({ physicalEvidence: badDevice }).status, 'BLOCKED');
  const badReceipt = physicalEvidence();
  delete badReceipt[0].operatorReceiptId;
  assert.equal(assess({ physicalEvidence: badReceipt }).status, 'BLOCKED');
});

test('duplicate fronts fail closed instead of double-counting', () => {
  const duplicate = sourceEvidence();
  duplicate.push({ ...duplicate[0], proofId: 'proof:duplicate' });
  assert.equal(assess({ sourceEvidence: duplicate }).status, 'BLOCKED');
});

test('unknown fields fail closed', () => {
  const verdict = assessStarfieldVrOperatorEvidence({
    exactHeadSha: HEAD,
    sourceEvidence: sourceEvidence(), runtimeEvidence: [], physicalEvidence: [],
    launchNow: true,
  });
  assert.equal(verdict.status, 'BLOCKED');
});

test('accessor-bearing input is rejected without executing getter', () => {
  let calls = 0;
  const input = {};
  Object.defineProperty(input, 'exactHeadSha', { enumerable: true, get() { calls += 1; throw new Error('must not execute'); } });
  const verdict = assessStarfieldVrOperatorEvidence(input);
  assert.equal(verdict.status, 'BLOCKED');
  assert.equal(calls, 0);
});

test('sparse, accessor-bearing and oversized evidence arrays fail closed', () => {
  const sparse = new Array(2); sparse[1] = sourceEvidence()[0];
  assert.equal(assess({ sourceEvidence: sparse }).status, 'BLOCKED');
  let calls = 0;
  const accessor = [];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { calls += 1; throw new Error('must not execute'); } });
  assert.equal(assess({ sourceEvidence: accessor }).status, 'BLOCKED');
  assert.equal(calls, 0);
  assert.equal(assess({ sourceEvidence: Array.from({ length: 65 }, () => sourceEvidence()[0]) }).status, 'BLOCKED');
});

test('revoked proxies and exotic records fail closed without throwing', () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.doesNotThrow(() => assessStarfieldVrOperatorEvidence(proxy));
  assert.equal(assessStarfieldVrOperatorEvidence(proxy).status, 'BLOCKED');
  const exotic = Object.create(null);
  exotic.exactHeadSha = HEAD;
  assert.equal(assessStarfieldVrOperatorEvidence(exotic).status, 'BLOCKED');
});

test('invalid assessment cannot manufacture an operator test plan', () => {
  const plan = buildStarfieldVrOperatorTestPlan({ schema: STARFIELD_VR_OPERATOR_EVIDENCE_SCHEMA, missing: { physical: 'quest3-headset' } });
  assert.equal(plan.status, 'INVALID_ASSESSMENT');
  assert.deepEqual(plan.steps, []);
});

test('canonical boundaries and front inventory are recursively immutable', () => {
  assert.equal(Object.isFrozen(STARFIELD_VR_OPERATOR_EVIDENCE_BOUNDARY), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_EVIDENCE_FRONTS), true);
  assert.equal(Object.isFrozen(STARFIELD_VR_EVIDENCE_FRONTS[0]), true);
  assert.throws(() => { STARFIELD_VR_EVIDENCE_FRONTS[0].id = 'changed'; }, TypeError);
});
