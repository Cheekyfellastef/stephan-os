import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA,
  STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA,
  buildStephanosNativeStagingPlan,
  createStephanosNativeStagingReceipt,
  validateStephanosNativeModelResult,
  validateStephanosNativeStagingRequest,
  verifyStephanosNativeTestAndScopeProof,
} from './stephanosNativeStagingExecutorV1.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const HEAD = 'a'.repeat(40);
function fixture() {
  const one = 'export const one = 1;\n';
  const two = 'export const two = 2;\n';
  const request = {
    schemaVersion: STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA,
    missionId: 'critical-2007-elastic-goal', actionId: 'native-action-1', workerId: 'stephanos-native-battle-bridge',
    repository: 'Cheekyfellastef/stephan-os', branch: 'stephanos/native-canary-2007', baseHead: HEAD,
    leaseId: 'lease-native-2007', allowedFiles: ['shared/agents/a.mjs','shared/agents/b.mjs'], requiredTestIds: ['native-focused-test'],
    sourceSnapshots: [
      { path:'shared/agents/a.mjs', content:one, sha256:hash(one) },
      { path:'shared/agents/b.mjs', content:two, sha256:hash(two) },
    ],
  };
  const result = {
    schemaVersion: STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA, missionId: request.missionId, actionId: request.actionId, baseHead: HEAD,
    replacements: [{ path:'shared/agents/a.mjs', beforeSha256:hash(one), content:'export const one = 3;\n' }], summary:'bounded source repair',
  };
  return { request, result, one, two };
}

test('valid bounded request and model result produce promotion-eligible exact receipt', () => {
  const { request, result, two } = fixture();
  assert.equal(validateStephanosNativeStagingRequest(request).valid, true);
  assert.equal(validateStephanosNativeModelResult(result, request).valid, true);
  const plan = buildStephanosNativeStagingPlan(request, result);
  assert.equal(plan.ok, true);
  assert.equal(plan.modelMayPromote, false);
  const proof = {
    baseHead: HEAD, leaseId: request.leaseId, changedFiles:['shared/agents/a.mjs'],
    testReceipts:[{ testId:'native-focused-test', passed:true, outputSha256:hash('pass') }],
    sourceAfter:[
      { path:'shared/agents/a.mjs', sha256:hash('export const one = 3;\n') },
      { path:'shared/agents/b.mjs', sha256:hash(two) },
    ],
  };
  assert.equal(verifyStephanosNativeTestAndScopeProof(plan, proof).valid, true);
  const receipt = createStephanosNativeStagingReceipt(plan, proof, { observedAtUtc:'2026-09-15T14:40:00Z' });
  assert.equal(receipt.sourceChanged, true);
  assert.equal(receipt.testsPassed, true);
  assert.equal(receipt.promotionEligible, true);
  assert.equal(receipt.mergeAuthority, false);
});

test('forged validation flags, traversal, out-of-scope writes and before-digest drift fail closed', () => {
  const { request, result } = fixture();
  const forged = { ...result, valid:true };
  assert.equal(validateStephanosNativeModelResult(forged, request).valid, false);
  const traversal = { ...result, replacements:[{ ...result.replacements[0], path:'../AGENTS.md' }] };
  assert.equal(validateStephanosNativeModelResult(traversal, request).valid, false);
  const outside = { ...result, replacements:[{ ...result.replacements[0], path:'package.json' }] };
  assert.equal(validateStephanosNativeModelResult(outside, request).valid, false);
  const stale = { ...result, replacements:[{ ...result.replacements[0], beforeSha256:'b'.repeat(64) }] };
  assert.equal(validateStephanosNativeModelResult(stale, request).valid, false);
});

test('test omission, unexpected changed scope and untouched-file drift block promotion', () => {
  const { request, result } = fixture();
  const plan = buildStephanosNativeStagingPlan(request, result);
  const base = { baseHead:HEAD, leaseId:request.leaseId, changedFiles:['shared/agents/a.mjs'], testReceipts:[], sourceAfter:[] };
  assert.equal(verifyStephanosNativeTestAndScopeProof(plan, base).valid, false);
  const widened = { ...base, changedFiles:['shared/agents/a.mjs','package.json'] };
  assert.equal(verifyStephanosNativeTestAndScopeProof(plan, widened).valid, false);
});

test('accessor-bearing request is rejected without invoking accessors', () => {
  let invoked = 0;
  const request = fixture().request;
  const hostile = Object.create(Object.prototype, {
    ...Object.fromEntries(Object.entries(request).map(([key,value]) => [key,{ value, enumerable:true, writable:true, configurable:true }])),
    extra: { get(){ invoked += 1; return 'x'; }, enumerable:true, configurable:true },
  });
  const validation = validateStephanosNativeStagingRequest(hostile);
  assert.equal(validation.valid, false);
  assert.equal(invoked, 0);
});
