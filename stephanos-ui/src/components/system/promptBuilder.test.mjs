import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyResult, buildStephanosPrompt } from './promptBuilder.js';

test('buildStephanosPrompt mission-only omits optional sections when toggles disabled', () => {
  const prompt = buildStephanosPrompt({
    mission: 'Fix routing drift',
    includeTruth: false,
    includeTelemetry: false,
    includeActionHints: false,
    includeConstraints: false,
  });

  assert.match(prompt, /## CURRENT MISSION\nFix routing drift/);
  assert.doesNotMatch(prompt, /## CURRENT TRUTH SNAPSHOT/);
  assert.doesNotMatch(prompt, /## RECENT TELEMETRY/);
  assert.doesNotMatch(prompt, /## ACTION HINTS/);
  assert.doesNotMatch(prompt, /## CONSTRAINTS/);
});

test('buildStephanosPrompt includes only populated truth fields', () => {
  const prompt = buildStephanosPrompt({
    mission: 'Check truth fields',
    finalRouteTruth: {
      routeKind: 'cloud',
      fallbackActive: true,
      providerExecution: { executableProvider: 'openai' },
    },
    includeTelemetry: false,
    includeActionHints: false,
    includeConstraints: false,
  });

  assert.match(prompt, /routeKind: cloud/);
  assert.match(prompt, /fallbackActive: true/);
  assert.match(prompt, /providerExecution\.executableProvider: openai/);
  assert.doesNotMatch(prompt, /backendReachable:/);
  assert.doesNotMatch(prompt, /memoryMode:/);
});

test('buildStephanosPrompt telemetry section respects maxTelemetryEntries and compact formatting', () => {
  const prompt = buildStephanosPrompt({
    mission: 'Inspect transitions',
    includeTruth: false,
    includeActionHints: false,
    includeConstraints: false,
    maxTelemetryEntries: 3,
    telemetryEntries: [
      { timestamp: 't1', subsystem: 'ROUTE', change: 'local → cloud', reason: 'winner changed', impact: 'route swapped' },
      { timestamp: 't2', subsystem: 'BACKEND', change: 'reachable → unreachable' },
      { timestamp: 't3', subsystem: 'FALLBACK', change: 'inactive → active' },
      { timestamp: 't4', subsystem: 'PROVIDER', change: 'executable a → b' },
    ],
  });

  assert.match(prompt, /t1 \| ROUTE \| local → cloud \| reason=winner changed \| impact=route swapped/);
  assert.match(prompt, /t3 \| FALLBACK \| inactive → active/);
  assert.doesNotMatch(prompt, /t4 \| PROVIDER/);
});

test('buildStephanosPrompt action hints include severity/subsystem/text formatting', () => {
  const prompt = buildStephanosPrompt({
    mission: 'Use hints',
    includeTruth: false,
    includeTelemetry: false,
    includeConstraints: false,
    actionHints: [{ severity: 'high', subsystem: 'BACKEND', text: 'Run health check.' }],
  });

  assert.match(prompt, /high \| BACKEND \| Run health check\./);
});

test('buildCopyResult returns success message when clipboard write succeeds', async () => {
  const result = await buildCopyResult({
    promptText: 'hello',
    clipboard: { writeText: async () => {} },
  });
  assert.deepEqual(result, { ok: true, message: 'Prompt copied.' });
});

test('buildCopyResult returns fallback message when clipboard is unavailable or fails', async () => {
  const unavailable = await buildCopyResult({ promptText: 'hello', clipboard: null });
  assert.deepEqual(unavailable, { ok: false, message: 'Copy failed. Select and copy manually.' });

  const failed = await buildCopyResult({
    promptText: 'hello',
    clipboard: { writeText: async () => { throw new Error('no'); } },
  });
  assert.deepEqual(failed, { ok: false, message: 'Copy failed. Select and copy manually.' });
});
