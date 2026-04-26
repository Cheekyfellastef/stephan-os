import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionBridgeState, processMissionBridgeIntent, requestMissionBridgeAI } from './missionBridge.js';

test('unknown intent keeps mission blocked', () => {
  const bridge = processMissionBridgeIntent({ operatorIntent: 'anything maybe idk' });
  assert.equal(bridge.state, 'blocked');
  assert.equal(bridge.events.some((entry) => entry.type === 'mission-blocked'), true);
});

test('submitted operator intent generates mission packet with required fields', () => {
  const bridge = processMissionBridgeIntent({ operatorIntent: 'Upgrade mission console bridge and agent routing' });
  assert.equal(bridge.missionPacketGeneratedFromOperatorIntent, true);
  assert.ok(bridge.missionPacket?.missionId);
  assert.ok(bridge.missionPacket?.missionTitle);
  assert.ok(Array.isArray(bridge.missionPacket?.successCriteria));
  assert.ok(Array.isArray(bridge.orchestration?.openTasks));
  assert.equal(bridge.events.some((entry) => entry.type === 'mission-created'), true);
  assert.equal(bridge.events.some((entry) => entry.type === 'mission-awaiting-approval'), true);
  assert.equal(bridge.events.some((entry) => entry.type === 'agent-assigned'), true);
  assert.equal(bridge.events.some((entry) => entry.type === 'approval-required'), true);
});

test('agent AI request uses injected backend/provider router callback', async () => {
  const bridge = processMissionBridgeIntent({ operatorIntent: 'Build runtime bridge for mission console agents' });
  let called = 0;
  const updated = await requestMissionBridgeAI({
    bridgeState: bridge,
    prompt: 'summarize next action',
    invokeAi: async () => {
      called += 1;
      return { output: 'Router replied with structured mission guidance.' };
    },
  });
  assert.equal(called, 1);
  assert.equal(updated.lastAiRouterRequestSource, 'mission-bridge');
  assert.equal(updated.lastAiResponseRoutedToMissionConsole, true);
  assert.equal(updated.events.some((entry) => entry.type === 'ai-request-started'), true);
  assert.equal(updated.events.some((entry) => entry.type === 'ai-response-received'), true);
});

test('mission bridge creates baseline idle state', () => {
  const bridge = createMissionBridgeState();
  assert.equal(bridge.state, 'idle');
  assert.equal(bridge.pendingApproval, false);
});
