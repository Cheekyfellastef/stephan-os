import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAIMindRegistry, normalizeMindRecord } from './aiMindRegistry.mjs';

test('tool access defaults to none and discovered minds are not route eligible automatically', () => {
  const mind = normalizeMindRecord({ mindId: 'x', displayName: 'X', providerId: 'ollama', modelId: 'm' });
  assert.equal(mind.toolAccessLevel, 'none');
  assert.equal(mind.routeEligibility, false);
});

test('blocked minds are never route eligible', () => {
  const registry = buildAIMindRegistry({ registry: [{ mindId: 'a', displayName: 'A', providerId: 'ollama', modelId: 'a', approvalState: 'blocked', routeEligibility: true }] });
  assert.equal(registry.routeEligibleMindIds.includes('a'), false);
});

test('cloud minds are excluded for local-private missions', () => {
  const registry = buildAIMindRegistry({
    runtimeContext: { providerExecutionIntent: { answerMode: 'local-private' } },
    registry: [{ mindId: 'c', displayName: 'Cloud', providerId: 'groq', modelId: 'x', privacyClass: 'cloud', location: 'cloud', approvalState: 'approved', routeEligibility: true }],
  });
  assert.equal(registry.routeEligibleMindIds.includes('c'), false);
});

test('OpenClaw cannot use unapproved mind set', () => {
  const registry = buildAIMindRegistry({ registry: [{ mindId: 'd', displayName: 'Disc', providerId: 'ollama', modelId: 'm', approvalState: 'discovered' }] });
  assert.equal(registry.openClawApprovalGate, 'unapproved');
});

test('projection matches canonical model shape', () => {
  const registry = buildAIMindRegistry({ providerHealth: { ollama: { models: [{ name: 'llama3.2:3b' }] } } });
  assert.equal(Array.isArray(registry.minds), true);
  assert.equal(typeof registry.supportSnapshot.discoveredMindCount, 'number');
  assert.equal(registry.supportSnapshot.discoveredMindCount >= 1, true);
});
