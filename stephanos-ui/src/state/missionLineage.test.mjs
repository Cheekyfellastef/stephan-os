import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMissionLineageUpdate,
  createDefaultMissionLineageStore,
  deriveMissionResumability,
  normalizeMissionLineageStore,
} from './missionLineage.js';

test('mission lineage store remains null-safe when no missions exist', () => {
  const store = normalizeMissionLineageStore({});
  const resumability = deriveMissionResumability(store);
  assert.equal(store.missions.length, 0);
  assert.equal(resumability.hasResumableMission, false);
  assert.match(resumability.nextRecommendedAction, /Create or accept/i);
});

test('mission lineage persists mission updates and bounded history', () => {
  const now = '2026-04-11T00:00:00.000Z';
  const store = applyMissionLineageUpdate(createDefaultMissionLineageStore(), {
    packetTruth: { moveId: 'mission-1', moveTitle: 'Mission One', rationale: 'First mission summary' },
    selectors: {
      currentMissionState: {
        packetKey: 'self-build::mission-1',
        missionPhase: 'execution-ready',
        codexHandoffStatus: 'generated',
        validationStatus: 'not-run',
        lastHandoffAction: 'prepare-codex-handoff',
      },
      buildAssistanceReadiness: { state: 'execution-ready' },
      continuityLoopState: { strength: 'strong' },
      nextRecommendedAction: 'Start mission',
      missionBlocked: false,
      blockageExplanation: '',
    },
    envelope: { actionRequested: 'prepare-codex-handoff', status: 'action-completed' },
    now,
  });

  assert.equal(store.missions.length, 1);
  assert.equal(store.activeMissionId, 'mission-1');
  assert.equal(store.missions[0].history.length, 1);
  assert.equal(store.missions[0].resumableState, true);
});

test('resumability derivation flags sparse continuity and preserves explicit warning', () => {
  const store = applyMissionLineageUpdate(createDefaultMissionLineageStore(), {
    packetTruth: { moveId: 'mission-2', moveTitle: 'Sparse Mission' },
    selectors: {
      currentMissionState: {
        packetKey: 'self-build::mission-2',
        missionPhase: 'execution-ready',
        codexHandoffStatus: 'generated',
        validationStatus: 'not-run',
      },
      continuityLoopState: { strength: 'sparse' },
      buildAssistanceReadiness: { state: 'execution-ready' },
      nextRecommendedAction: 'Confirm explicit objective',
      missionBlocked: false,
    },
    now: '2026-04-11T00:05:00.000Z',
  });

  const resumability = deriveMissionResumability(store);
  assert.equal(resumability.hasResumableMission, false);
  assert.match(resumability.warnings.join(' '), /sparse-continuity/);
});
