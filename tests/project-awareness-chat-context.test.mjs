import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatContextPack } from '../stephanos-ui/src/state/chatContextOrchestrator.js';

test('Chat Context includes Project Awareness for mission/work-routing prompts', () => {
  const missionState = { operatorReliefProjection: { projectAwarenessProjection: { status: 'degraded', missionId: 'derived-runtime-mission', title: 'Stephanos Mission Stack Verification', phase: 'verification', currentFocus: 'Verify packet truth.', nextBestAction: 'Resolve proof blockers.', recommendedRoute: 'local-ai', recommendedRouteReason: 'Builder Mesh recommends local-ai read-only verification/review.', sourceSummary: ['Packet Bay projection','Agent Reality Loop projection'], missingProof: ['browser proof'], promptInjectable: true, promptBlock: '[Project Awareness Context: bounded truth for mission-planning only]\n- mission: Stephanos Mission Stack Verification', projectionSource: 'derived-runtime-truth', confidence: 'medium', rehydrationSource: 'derived-runtime-packet-truth' } } };
  const pack = buildChatContextPack({ operatorMessage: 'what should we do next?', missionState });
  assert.equal(pack.recommendedResponseMode, 'mission-planning');
  assert.ok(pack.compactSummary.contextSourcesUsed.includes('projectAwareness'));
  assert.equal(pack.compactSummary.projectAwareness.currentMissionSummary, 'Stephanos Mission Stack Verification');
  assert.equal(pack.compactSummary.projectAwareness.recommendedRoute, 'local-ai');
});

test('Chat Context does not inject Project Awareness source into unrelated casual direct-answer prompts', () => {
  const pack = buildChatContextPack({ operatorMessage: 'tell me a short joke', missionState: {} });
  assert.equal(pack.recommendedResponseMode, 'direct-answer');
  assert.equal(pack.compactSummary.contextSourcesUsed.includes('projectAwareness'), false);
  assert.equal(pack.compactSummary.projectAwareness.status, 'unavailable');
});
