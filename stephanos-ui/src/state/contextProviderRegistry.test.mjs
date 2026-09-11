import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextProviderSnapshot,
  getRegisteredContextProviders,
  inferContextProviderIds,
  registerContextProvider,
} from './contextProviderRegistry.js';

function vrProjection() {
  return {
    schemaVersion: 'stephanos.vr-research.workspace.v1',
    domainId: 'vr-research',
    projectionId: 'vr-research-context-registry-test',
    updatedAt: '2026-08-03T15:30:00Z',
    staleAfterMs: 24 * 60 * 60 * 1000,
    freshness: 'FRESH',
    currentTarget: 'Starfield VR',
    desiredExperience: 'Skyrim VR-quality Starfield',
    programmeStage: 'context-provider-integration',
    nextAuthorisedAction: 'Prove the provider in the live AI Console.',
    sourceRegistry: { sourceCount: 18, sourceHealth: {}, licenceHealth: {} },
    facts: [],
    hypotheses: [],
    decisions: [],
    researchQueue: [],
    runtimeEvidenceRequests: [],
    battleBridgeEvidence: [],
    blockers: [],
    proofRefs: [],
    capabilityGraphCandidates: [],
    evidencePlanes: [],
    writePolicy: {
      validatedEventsOnly: true,
      agentMaySelfPromoteClaims: false,
      privateAgentStateForbidden: true,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
    },
  };
}

test('registers deterministic providers and ignores invalid shapes', () => {
  const baseCount = getRegisteredContextProviders().length;
  assert.equal(registerContextProvider({ id: 'bad' }), false);
  const ok = registerContextProvider({
    id: 'test-provider', label: 'Test', priority: 999,
    getSummary: () => ({ ok: true }), getWarnings: () => [], getNextAction: () => [], getProofState: () => 'ready', getCanonLinks: () => [], getSourceRefs: () => [],
  });
  assert.equal(ok, true);
  assert.equal(registerContextProvider({ id: 'test-provider', label: 'Dup', priority: 1000, getSummary: () => ({}), getWarnings: () => [], getNextAction: () => [], getProofState: () => 'ready', getCanonLinks: () => [], getSourceRefs: () => [] }), false);
  assert.equal(getRegisteredContextProviders().length, baseCount + 1);
});

test('returns compact default summaries and keeps conditional VR provider out of unrelated requests', () => {
  const snapshot = buildContextProviderSnapshot();
  assert.equal(snapshot.contextProviderRegistryStatus, 'active');
  assert.ok(Array.isArray(snapshot.contextProviderIdsRegistered));
  assert.ok(snapshot.contextProviderIdsRegistered.includes('uiReality'));
  assert.ok(snapshot.contextProviderIdsRegistered.includes('vrResearch'));
  assert.ok(Array.isArray(snapshot.contextProviderIdsUsed));
  assert.ok(snapshot.contextProviderIdsUsed.includes('uiReality'));
  assert.equal(snapshot.contextProviderIdsUsed.includes('vrResearch'), false);
  assert.equal(typeof snapshot.providerSummaries.uiReality, 'object');
  assert.equal(typeof snapshot.contextProviderWarningCount, 'number');
});

test('requested provider ids constrain used providers safely', () => {
  const snapshot = buildContextProviderSnapshot({ contextProviderIdsRequested: ['uiReality', 'missing-provider'] });
  assert.deepEqual(snapshot.contextProviderIdsUsed, ['uiReality']);
});

test('VR, Starfield and Headset-VR intent infers vrResearch and consumes canonical Shared Workspace projection', () => {
  assert.deepEqual(inferContextProviderIds({ operatorMessage: 'What have we learned about Starfield VR and Air Link?' }), ['vrResearch']);
  assert.deepEqual(inferContextProviderIds({ operatorMessage: 'What did Headset-VR configure for this flat-to-VR profile?' }), ['vrResearch']);
  const snapshot = buildContextProviderSnapshot({
    operatorMessage: 'What have we learned about Starfield VR and Air Link?',
    now: new Date('2026-08-03T15:45:00Z'),
    contextProviderIdsRequested: ['conversationContinuity'],
    sharedWorkspace: { domains: { 'vr-research': vrProjection() } },
  });
  assert.deepEqual(snapshot.contextProviderIdsInferred, ['vrResearch']);
  assert.ok(snapshot.contextProviderIdsUsed.includes('vrResearch'));
  assert.equal(snapshot.providerSummaries.vrResearch.status, 'READY');
  assert.equal(snapshot.providerSummaries.vrResearch.currentTarget, 'Starfield VR');
  assert.equal(snapshot.contextProviderProofState.vrResearch, 'ready');
});

test('research-scouting response mode requests VR provider even when the prompt is compact', () => {
  const snapshot = buildContextProviderSnapshot({
    responseMode: 'research-scouting',
    operatorMessage: 'status please',
    now: new Date('2026-08-03T15:45:00Z'),
    vrResearchProjection: vrProjection(),
  });
  assert.ok(snapshot.contextProviderIdsUsed.includes('vrResearch'));
  assert.equal(snapshot.providerSummaries.vrResearch.sourceCount, 18);
});

test('missing canonical VR projection stays explicit instead of inventing research truth', () => {
  const snapshot = buildContextProviderSnapshot({ operatorMessage: 'Tell me about OpenXR for Starfield VR.' });
  assert.ok(snapshot.contextProviderIdsUsed.includes('vrResearch'));
  assert.equal(snapshot.providerSummaries.vrResearch.status, 'MISSING');
  assert.equal(snapshot.contextProviderProofState.vrResearch, 'missing');
  assert.ok(snapshot.providerWarnings.some((warning) => warning.includes('Canonical vr-research Shared Workspace projection is unavailable')));
});

test('prEvidence summary preserves parsed identity from base evidence when live GitHub evidence is unavailable', () => {
  const snapshot = buildContextProviderSnapshot({
    contextProviderIdsRequested: ['prEvidence'],
    prEvidence: { prNumber: 123, parsedPrNumber: 123 },
    githubPrEvidence: { status: 'needs-connector', mergeReadiness: 'wait' },
  });
  assert.equal(snapshot.providerSummaries.prEvidence.prNumber, '123');
  assert.equal(snapshot.providerSummaries.prEvidence.parsedPrNumber, '123');
});

test('prEvidence summary carries canonical build/verify projection from fetched github evidence', () => {
  const snapshot = buildContextProviderSnapshot({
    contextProviderIdsRequested: ['prEvidence'],
    githubPrEvidence: {
      status: 'fetched',
      parsedPrNumber: 970,
      checksStatus: 'passed',
      buildStatus: 'passed',
      verifyStatus: 'passed',
      changedFileCount: 4,
      merged: true,
      mergeReadiness: 'already-merged',
    },
  });
  assert.equal(snapshot.providerSummaries.prEvidence.status, 'merged');
  assert.equal(snapshot.providerSummaries.prEvidence.buildStatus, 'passed');
  assert.equal(snapshot.providerSummaries.prEvidence.verifyStatus, 'passed');
  assert.equal(snapshot.providerSummaries.prEvidence.changedFileCount, 4);
  assert.equal(snapshot.providerSummaries.prEvidence.merged, true);
});
