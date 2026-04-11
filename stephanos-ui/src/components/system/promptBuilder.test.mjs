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

test('buildStephanosPrompt includes orchestration truth when provided', () => {
  const prompt = buildStephanosPrompt({
    mission: 'Continue mission',
    includeTelemetry: false,
    includeActionHints: false,
    includeConstraints: false,
    orchestrationTruth: {
      canonicalMemoryContext: {
        activeMissionContinuity: { continuityLoopState: 'live', recentEvents: ['packet accepted'] },
        sparseData: false,
      },
      canonicalCurrentIntent: {
        operatorIntent: { label: 'build-runtime', source: 'explicit' },
        executionState: { status: 'not-executing' },
      },
      canonicalMissionPacket: {
        currentPhase: 'awaiting-approval',
        recommendedNextAction: 'Await explicit operator approval',
      },
      selectors: {
        currentMissionState: { missionPhase: 'awaiting-approval', intentSource: 'explicit' },
        missionBlocked: false,
        nextRecommendedAction: 'Review mission packet and choose accept/reject/defer explicitly.',
        buildAssistanceReadiness: { state: 'analysis-ready', approvalRequired: true },
      },
    },
  });
  assert.match(prompt, /## ORCHESTRATION TRUTH/);
  assert.match(prompt, /memory\.continuityLoopState: live/);
  assert.match(prompt, /intent\.operatorIntentSource: explicit/);
  assert.match(prompt, /missionPacket\.currentPhase: awaiting-approval/);
  assert.match(prompt, /mission\.phase: awaiting-approval/);
  assert.match(prompt, /buildAssistance\.state: analysis-ready/);
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
