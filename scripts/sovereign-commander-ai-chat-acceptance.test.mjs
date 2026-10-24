import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_COMMANDER_ACCEPTANCE_MARKER,
  AI_COMMANDER_ACCEPTANCE_SCHEMA,
  verifyStephanosAiCommanderTool,
  runStephanosAiCommanderToolAcceptance,
} from './sovereign-commander-ai-chat-acceptance.mjs';

const OBSERVATION = {
  schemaVersion: 'stephanos.ai-sovereign-commander-health.v1',
  available: true,
  healthy: true,
  state: 'SERVICE_REACHABLE',
  localLoopbackOnly: true,
  readOnly: true,
  commanderMcpAccessGranted: false,
  executionProven: false,
  coreAwakeProven: false,
  physicalWorkerPickupProven: false,
  sourceMutationAllowed: false,
  arbitraryShellAllowed: false,
  mergeAuthority: false,
  guardian: { cycleCount: 3 },
  privateSecret: 'DO_NOT_LEAK',
};
const RESPONSE = {
  success: true,
  type: 'tool_result',
  route: 'system',
  command: '/sovereign',
  tools_used: ['getSovereignCommanderStatus'],
  data: { observation: OBSERVATION },
};
function mockResult(payload, status = 200) {
  return {
    ok: status === 200,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

test('canonical Stephanos /sovereign reaches a real typed local Commander tool without machine authority', async () => {
  let received;
  const actual = await verifyStephanosAiCommanderTool({
    fetchFn: async (url, options) => {
      received = { url, options };
      return mockResult(RESPONSE);
    },
  });
  assert.equal(received.url, 'http://127.0.0.1:8787/api/ai/chat');
  assert.equal(received.options.method, 'POST');
  assert.equal(received.options.redirect, 'error');
  assert.equal(JSON.parse(received.options.body).prompt, '/sovereign');
  assert.equal(actual.schemaVersion, AI_COMMANDER_ACCEPTANCE_SCHEMA);
  assert.equal(actual.ok, true);
  assert.equal(actual.toolCalled, true);
  assert.equal(actual.healthAvailable, true);
  assert.equal(actual.guardianCycleCount, 3);
  assert.equal(actual.finalVerdict, 'STEPHANOS_AI_COMMANDER_TOOL_CALL_PROVEN');
  assert.equal(actual.sourceMutationAllowed, false);
  assert.equal(actual.mergeAuthority, false);
  assert.equal(actual.physicalWorkerPickupProven, false);
  assert.match(actual.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(actual).includes('DO_NOT_LEAK'), false);
  assert.match(AI_COMMANDER_ACCEPTANCE_MARKER, /^SOVEREIGN_COMMANDER_/);
});

test('falsified tool name, extra tools, missing safety and held health do not pass', async () => {
  for (const candidate of [
    { ...RESPONSE, tools_used: ['shell'] },
    { ...RESPONSE, tools_used: ['getSovereignCommanderStatus', 'runShell'] },
    { ...RESPONSE, data: { observation: { ...OBSERVATION, arbitraryShellAllowed: true } } },
    { ...RESPONSE, data: { observation: { ...OBSERVATION, executionProven: true } } },
    { ...RESPONSE, data: { observation: { ...OBSERVATION, state: 'UNKNOWN', healthy: false } } },
  ]) {
    const result = await verifyStephanosAiCommanderTool({
      fetchFn: async () => mockResult(candidate),
    });
    assert.equal(result.ok, false);
    assert.equal(result.sourceMutationAllowed, false);
    assert.equal(result.physicalWorkerPickupProven, false);
  }
});

test('malformed/unreachable/oversized responses do not invent a proof', async () => {
  for (const fetchFn of [
    async () => { throw new Error('C:\\secrets\\never-echo'); },
    async () => mockResult(RESPONSE, 403),
    async () => ({ ...mockResult(RESPONSE), headers: { get: () => '999999' } }),
    async () => ({ ...mockResult(RESPONSE), text: async () => 'not JSON' }),
  ]) {
    const result = await verifyStephanosAiCommanderTool({ fetchFn });
    assert.equal(result.ok, false);
    assert.equal(result.toolCalled, false);
    assert.equal(JSON.stringify(result).includes('never-echo'), false);
  }
});


test('offline HTTP state remains typed BLOCKED yet preserves a completed script receipt', async () => {
  let received = '';
  const previousExitCode = process.exitCode;
  const actual = await runStephanosAiCommanderToolAcceptance({
    fetchFn: async () => mockResult(RESPONSE, 404),
    emitLine: (line) => { received += line; },
  });
  assert.equal(actual.ok, false);
  assert.equal(actual.blocker, 'AI_COMMANDER_CHAT_HTTP_404');
  assert.equal(actual.finalVerdict, 'STEPHANOS_AI_COMMANDER_TOOL_CALL_BLOCKED');
  assert.equal(process.exitCode, previousExitCode);
  assert.equal(received.split('\n').filter(Boolean).length, 1);
  assert.ok(received.startsWith(AI_COMMANDER_ACCEPTANCE_MARKER));
  const receipt = JSON.parse(received.trim().slice(AI_COMMANDER_ACCEPTANCE_MARKER.length));
  assert.equal(receipt.ok, false);
  assert.match(receipt.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(receipt.mergeAuthority, false);
  assert.equal(receipt.physicalWorkerPickupProven, false);
});
