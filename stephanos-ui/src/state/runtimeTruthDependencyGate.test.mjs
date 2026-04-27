import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRuntimeTruthDependencyGate } from './runtimeTruthDependencyGate.js';

test('local-desktop healthy runtime truth passes dependency gate even with indeterminate build certainty or memory hydration', () => {
  const result = evaluateRuntimeTruthDependencyGate({
    routeTruthView: {
      routeLayerStatus: 'healthy',
      backendExecutionContractStatus: 'validated',
      providerExecutionGateStatus: 'open',
      routeUsableState: 'yes',
      effectiveLaunchState: 'degraded',
    },
    runtimeStatus: {
      appLaunchState: 'degraded',
      runtimeTruth: {
        sourceDistAlignment: { certainty: 'indeterminate' },
        memory: { hydrationState: 'in-progress' },
      },
    },
  });

  assert.equal(result.passed, true);
  assert.match(result.rationale, /satisfied/i);
});

test('runtime truth dependency blocks when provider execution gate is closed', () => {
  const result = evaluateRuntimeTruthDependencyGate({
    routeTruthView: {
      routeLayerStatus: 'healthy',
      backendExecutionContractStatus: 'validated',
      providerExecutionGateStatus: 'blocked',
      routeUsableState: 'yes',
    },
  });

  assert.equal(result.passed, false);
  assert.match(result.rationale, /waiting/i);
});
