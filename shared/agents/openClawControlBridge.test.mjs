import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawControlBridgeProjection } from './openClawControlBridge.mjs';

test('OpenClaw Control Bridge defaults are read-only and operator-controlled', () => {
  const projection = buildOpenClawControlBridgeProjection();
  assert.equal(projection.gatewayTarget, 'ws://127.0.0.1:18789');
  assert.equal(projection.dashboardUrl, 'http://127.0.0.1:18789/');
  assert.deepEqual(projection.expectedLocalModels, ['ollama/llama3.2:3b', 'qwen:14b']);
  assert.deepEqual(projection.expectedAgents, ['stephanos-scout', 'stephanos-scout-qwen14']);
  assert.equal(projection.gatewayStatus, 'unknown');
  assert.equal(projection.dashboardStatus, 'unknown');
  assert.equal(projection.localScoutProofStatus, 'unknown');
  assert.equal(projection.mutationAuthority, 'locked');
  assert.equal(projection.autoStart, 'forbidden');
  assert.equal(projection.operatorApprovalRequired, 'yes');
  assert.equal(projection.isBuilder, false);
});

test('OpenClaw proof command preserves local scout route and fresh session-key placeholder', () => {
  const projection = buildOpenClawControlBridgeProjection();
  assert.match(projection.lastProofCommand, /--local/);
  assert.match(projection.lastProofCommand, /--agent stephanos-scout/);
  assert.match(projection.lastProofCommand, /--model ollama\/llama3\.2:3b/);
  assert.match(projection.lastProofCommand, /--session-key agent:stephanos-scout:proof-<fresh>/);
  assert.match(projection.lastProofCommand, /Reply with exactly this sentence and nothing else: OpenClaw one-shot local route works\./);
});

test('OpenClaw Control Bridge does not model auto-start or scheduled service behavior', () => {
  const projection = buildOpenClawControlBridgeProjection({ autoStart: 'enabled', mutationAuthority: 'write' });
  assert.equal(projection.autoStart, 'forbidden');
  assert.equal(projection.mutationAuthority, 'locked');
  assert.doesNotMatch(projection.startGatewayCommand, /schtasks|startup|service|autorun/i);
  assert.doesNotMatch(projection.stopOpenClawCommand, /schtasks|startup folder|autorun/i);
  assert.match(projection.noAutoStartGuarantee, /No Windows auto-start/);
});

test('Control Panel Start Gateway command uses shared canonical startup implementation', async () => {
  const { getOpenClawGatewayStartupCommand, buildOpenClawGatewayStartupTarget } = await import('./openClawGatewayStartup.mjs');
  const projection = buildOpenClawControlBridgeProjection();
  assert.equal(projection.startGatewayCommand, getOpenClawGatewayStartupCommand());
  const target = buildOpenClawGatewayStartupTarget({ commandText: projection.startGatewayCommand, token: 'test-token', approved: true });
  assert.equal(target.port, 18789);
  assert.equal(target.available, true);
});
