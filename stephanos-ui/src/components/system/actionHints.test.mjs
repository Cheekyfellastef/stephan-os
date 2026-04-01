import test from 'node:test';
import assert from 'node:assert/strict';
import { getActionHints } from './actionHints.js';

test('getActionHints returns empty array when finalRouteTruth is missing', () => {
  assert.deepEqual(getActionHints(null), []);
});

test('getActionHints returns empty array for healthy truth', () => {
  const hints = getActionHints({
    routeKind: 'local-desktop',
    backendReachable: true,
    fallbackActive: false,
    memoryMode: 'shared',
    providerExecution: {
      requestedProvider: 'ollama',
      executableProvider: 'ollama',
      providerHealthState: 'HEALTHY',
    },
  });

  assert.equal(hints.length, 0);
});

test('getActionHints emits backend and fallback hints for degraded route', () => {
  const hints = getActionHints({
    routeKind: 'dist',
    backendReachable: false,
    fallbackActive: true,
    providerExecution: {
      requestedProvider: 'ollama',
      executableProvider: 'mock',
      providerHealthState: 'DISCONNECTED',
    },
  });

  assert.ok(hints.some((hint) => hint.subsystem === 'BACKEND'));
  assert.ok(hints.some((hint) => hint.subsystem === 'FALLBACK'));
  assert.ok(hints.some((hint) => hint.text.includes('dist fallback mode')));
});

test('getActionHints emits provider mismatch warning when requested and executable providers differ', () => {
  const hints = getActionHints({
    backendReachable: true,
    providerExecution: {
      requestedProvider: 'openai',
      executableProvider: 'ollama',
      providerHealthState: 'HEALTHY',
    },
  });

  assert.ok(hints.some((hint) => hint.text.includes('Requested provider is not executing')));
});

test('getActionHints emits mock provider warning', () => {
  const hints = getActionHints({
    providerExecution: {
      executableProvider: 'mock',
    },
  });

  assert.ok(hints.some((hint) => hint.text.includes('System is using mock provider')));
});

test('getActionHints emits memory hint for local/degraded memory modes', () => {
  const localHints = getActionHints({ memoryMode: 'local' });
  const degradedHints = getActionHints({ memoryMode: 'degraded' });

  assert.ok(localHints.some((hint) => hint.subsystem === 'MEMORY'));
  assert.ok(degradedHints.some((hint) => hint.subsystem === 'MEMORY'));
});

test('getActionHints passes through operator guidance fields once with dedupe', () => {
  const hints = getActionHints({
    operatorGuidance: 'Review fallback cause in telemetry feed',
    operatorAction: 'Review fallback cause in telemetry feed',
    actionText: 'Review fallback cause in telemetry feed',
  });

  const duplicates = hints.filter((hint) => hint.text === 'Review fallback cause in telemetry feed');
  assert.equal(duplicates.length, 1);
});
