import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_OC2_FIXED_PLAN,
  OPENCLAW_OC2_OPERATION,
  OPENCLAW_OC2_TASK_CLASS,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs';
import {
  OPENCLAW_OC2_GATEWAY_METHOD,
  OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
  OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs';

test('OC2 Mission Worker contract is fixed and carries no caller command surface', () => {
  assert.equal(OPENCLAW_OC2_TASK_CLASS, 'OC2_DETERMINISTIC_TEST_BUILD');
  assert.equal(OPENCLAW_OC2_OPERATION, 'oc2-provider-regression-v1');
  assert.equal(OPENCLAW_OC2_GATEWAY_METHOD, 'stephanos-builder-provider.oc2Qualification');
  assert.equal(OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA, 'stephanos.openclaw-oc2-gateway-request.v1');
  assert.equal(OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA, 'stephanos.openclaw-oc2-gateway-result.v1');
  assert.deepEqual(OPENCLAW_OC2_FIXED_PLAN.map((entry) => entry.testId), [
    'OC2_PROVIDER_SOURCE_PARSE_V1',
    'OC2_PROVIDER_REGRESSION_V1',
  ]);
  for (const entry of OPENCLAW_OC2_FIXED_PLAN) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.args));
    assert.ok(entry.args.every((arg) => typeof arg === 'string'));
    assert.ok(entry.args.every((arg) => !/powershell|cmd\.exe|bash|sh\s+-c/i.test(arg)));
  }
});
