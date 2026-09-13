import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVrResearchContextSummary,
  inspectVrResearchProjection,
  vrResearchContextProvider,
} from './vrResearchContextProvider.js';

const NOW = new Date('2026-08-03T15:45:00Z');

function projection(overrides = {}) {
  return {
    schemaVersion: 'stephanos.vr-research.workspace.v1',
    domainId: 'vr-research',
    projectionId: 'vr-research-test-projection',
    updatedAt: '2026-08-03T15:30:00Z',
    staleAfterMs: 24 * 60 * 60 * 1000,
    freshness: 'FRESH',
    currentTarget: 'Starfield VR',
    desiredExperience: 'Skyrim VR-quality Starfield',
    programmeStage: 'context-provider-integration',
    nextAuthorisedAction: 'Prove the provider in the live AI Console.',
    sourceRegistry: {
      sourceCount: 18,
      sourceHealth: { REGISTERED: 12, REGISTERED_WITH_BOUNDARY: 6 },
      licenceHealth: { PERMISSIVE: 8, RESTRICTED_OR_ANALYSIS_ONLY: 5, MIXED_OR_UNKNOWN: 5 },
    },
    facts: ['Meta Air Link over Wi-Fi is the primary Quest 3 transport.'],
    hypotheses: ['A room-fixed theatre will preserve comfort during forced cinematic cameras.'],
    decisions: ['Wired Meta Link is unavailable and must not be requested.'],
    researchQueue: [{ id: 'vr-exp-001', title: 'Prove Starfield dialogue presentation', status: 'queued' }],
    runtimeEvidenceRequests: ['Exact Battle Bridge runtime and Quest 3 proof'],
    battleBridgeEvidence: ['source head verified'],
    blockers: [{ id: 'runtime-proof', summary: 'Quest 3 proof pending' }],
    proofRefs: ['evidence/vr/context-provider'],
    capabilityGraphCandidates: ['cutscene-theatre'],
    evidencePlanes: ['NORMATIVE_OR_OFFICIAL_SPECIFICATION', 'OBSERVED_RUNTIME_OR_HEADSET_PROOF'],
    writePolicy: {
      validatedEventsOnly: true,
      agentMaySelfPromoteClaims: false,
      privateAgentStateForbidden: true,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
    },
    ...overrides,
  };
}

test('fails honestly when canonical VR projection is missing', () => {
  const inspection = inspectVrResearchProjection({ now: NOW });
  assert.equal(inspection.status, 'MISSING');
  assert.equal(inspection.proofState, 'missing');
  assert.match(inspection.warning, /unavailable/i);
  assert.deepEqual(vrResearchContextProvider.getNextAction({ now: NOW }), [
    'Refresh and validate the canonical vr-research Shared Workspace projection before answering from it.',
  ]);
});

test('projects fresh canonical VR truth into known observed inferred proposed and blocked sections', () => {
  const summary = buildVrResearchContextSummary({
    now: NOW,
    sharedWorkspace: { domains: { 'vr-research': projection() } },
  });

  assert.equal(summary.status, 'READY');
  assert.equal(summary.proofState, 'ready');
  assert.equal(summary.currentTarget, 'Starfield VR');
  assert.equal(summary.sourceCount, 18);
  assert.equal(summary.known.factCount, 1);
  assert.equal(summary.observed.battleBridgeEvidenceCount, 1);
  assert.equal(summary.inferred.hypothesisCount, 1);
  assert.equal(summary.proposed.researchQueueCount, 1);
  assert.equal(summary.blocked.blockerCount, 1);
  assert.equal(summary.writePolicy.validatedEventsOnly, true);
  assert.equal(summary.writePolicy.agentMaySelfPromoteClaims, false);
  assert.equal(summary.writePolicy.arbitraryShellAllowed, false);
  assert.equal(summary.writePolicy.mergeAuthority, false);
});

test('marks stale VR truth as non-ready and requests refresh', () => {
  const staleProjection = projection({
    updatedAt: '2026-07-30T00:00:00Z',
    staleAfterMs: 60 * 60 * 1000,
  });
  const inspection = inspectVrResearchProjection({ now: NOW, vrResearchProjection: staleProjection });
  assert.equal(inspection.status, 'STALE');
  assert.equal(inspection.proofState, 'stale');
  assert.match(inspection.warning, /stale/i);
});

test('rejects a conflicting projection identity', () => {
  const inspection = inspectVrResearchProjection({
    now: NOW,
    vrResearchProjection: projection({ domainId: 'private-vr-agent-memory' }),
  });
  assert.equal(inspection.status, 'INVALID');
  assert.equal(inspection.proofState, 'invalid');
  assert.match(inspection.warning, /identity is invalid/i);
});
