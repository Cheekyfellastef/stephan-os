import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContextProviderSnapshot, getRegisteredContextProviders, registerContextProvider } from './contextProviderRegistry.js';

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

test('returns compact summaries and handles missing input safely', () => {
  const snapshot = buildContextProviderSnapshot();
  assert.equal(snapshot.contextProviderRegistryStatus, 'active');
  assert.ok(Array.isArray(snapshot.contextProviderIdsRegistered));
  assert.ok(snapshot.contextProviderIdsRegistered.includes('uiReality'));
  assert.ok(Array.isArray(snapshot.contextProviderIdsUsed));
  assert.ok(snapshot.contextProviderIdsUsed.includes('uiReality'));
  assert.equal(typeof snapshot.providerSummaries.uiReality, 'object');
  assert.equal(typeof snapshot.contextProviderWarningCount, 'number');
});

test('requested provider ids constrain used providers safely', () => {
  const snapshot = buildContextProviderSnapshot({ contextProviderIdsRequested: ['uiReality', 'missing-provider'] });
  assert.deepEqual(snapshot.contextProviderIdsUsed, ['uiReality']);
});


test('prEvidence summary falls back to parsedPrNumber when prNumber is missing', () => {
  const snapshot = buildContextProviderSnapshot({
    contextProviderIdsRequested: ['prEvidence'],
    githubPrEvidence: { status: 'needs-connector', parsedPrNumber: 123, mergeReadiness: 'wait' },
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
  assert.equal(snapshot.providerSummaries.prEvidence.status, 'fetched');
  assert.equal(snapshot.providerSummaries.prEvidence.buildStatus, 'passed');
  assert.equal(snapshot.providerSummaries.prEvidence.verifyStatus, 'passed');
  assert.equal(snapshot.providerSummaries.prEvidence.changedFileCount, 4);
  assert.equal(snapshot.providerSummaries.prEvidence.merged, true);
});
