import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const aiRouteUrl = new URL('./ai.js', import.meta.url);

test('canonical AI chat is wired to Stephanos executive flywheel grounding and bounded delegation', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');

  assert.match(source, /buildStephanosExecutiveChatBridge/);
  assert.match(source, /const executiveChatBridge = await buildStephanosExecutiveChatBridge\(\{/);
  assert.match(source, /executiveChatBridge\.contextBlock/);
  assert.match(source, /executive_command_bridge: executiveChatBridge/);
  assert.match(source, /executive_chat_bridge_state: executiveChatBridge\.state/);
  assert.match(source, /executive_command_status: executiveChatBridge\.plan\?\.status/);
  assert.match(source, /executive_target_system: executiveChatBridge\.plan\?\.delegation\?\.targetSystem/);
  assert.match(source, /executive_handoff_id: executiveChatBridge\.handoff\?\.record\?\.handoffId/);
  assert.match(source, /executive_delegation_published: executiveChatBridge\.state === 'DELEGATION_PUBLISHED'/);
});

test('legacy live telemetry shortcut yields to executive programme grounding when applicable', async () => {
  const source = await readFile(aiRouteUrl, 'utf8');

  assert.match(source, /executiveChatBridge\.state === 'NOT_APPLICABLE'/);
  assert.match(source, /answered-from-live-goal-projection/);
});
