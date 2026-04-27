import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionBridgeState, processMissionBridgeIntent, requestMissionBridgeAI } from './missionBridge.js';

test('unknown intent keeps mission blocked', () => {
  const bridge = processMissionBridgeIntent({ operatorIntent: 'anything maybe idk' });
  assert.equal(bridge.state, 'blocked');
  assert.equal(bridge.events.some((entry) => entry.type === 'mission-blocked'), true);
});

test('submitted operator intent generates mission packet with required fields', () => {
  const bridge = processMissionBridgeIntent({
    operatorIntent: 'Upgrade mission console bridge and agent routing',
    finalRouteTruth: {
      routeLayerStatus: 'healthy',
      backendExecutionContractStatus: 'validated',
      providerExecutionGateStatus: 'open',
      routeUsableState: 'yes',
    },
  });
  assert.equal(bridge.missionPacketGeneratedFromOperatorIntent, true);
  assert.equal(bridge.localDesktopAgentGatePassed, true);
  assert.ok(bridge.missionPacket?.missionId);
  assert.ok(bridge.missionPacket?.missionTitle);
  assert.ok(Array.isArray(bridge.missionPacket?.successCriteria));
  assert.ok(Array.isArray(bridge.orchestration?.openTasks));
  assert.equal(bridge.events.some((entry) => entry.type === 'mission-created'), true);
  assert.equal(bridge.events.some((entry) => entry.type === 'mission-awaiting-approval'), true);
  assert.equal(bridge.events.some((entry) => entry.type === 'agent-assigned'), true);
  assert.equal(bridge.events.some((entry) => entry.type === 'approval-required'), true);
});

test('mission bridge transitions from idle and records mission creation event after operator intent submission', () => {
  const idle = createMissionBridgeState();
  assert.equal(idle.state, 'idle');

  const bridge = processMissionBridgeIntent({ operatorIntent: 'Build guarded execution plan for runtime-truth dependency gate.' });
  assert.notEqual(bridge.state, 'idle');
  const lastEventType = bridge.events[bridge.events.length - 1]?.type || '';
  assert.equal(['mission-created', 'mission-awaiting-approval', 'approval-required', 'agent-assigned', 'codex-handoff-ready'].includes(lastEventType), true);
  assert.equal(bridge.events.some((entry) => ['mission-created', 'mission-awaiting-approval'].includes(entry.type)), true);
  assert.equal(bridge.missionPacketGeneratedFromOperatorIntent, true);
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
