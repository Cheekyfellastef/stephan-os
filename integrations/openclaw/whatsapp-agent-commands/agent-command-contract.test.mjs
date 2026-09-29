import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentRequest,
  boundAgentReply,
  COMMANDS,
  parseAgentCommand,
  unavailableReply,
} from './lib/agent-command-contract.mjs';

test('routes /standalone to canonical OpenClaw Standalone with bounded identity evidence', () => {
  const request = buildAgentRequest(COMMANDS.standalone, '  status please  ');
  assert.equal(request.targetAgentId, 'openclaw-standalone');
  assert.deepEqual(request.targetIdentity, {
    canonicalAgentId: 'openclaw-standalone',
    aliases: ['standalone'],
    topologyRole: 'OPENCLAW_STANDALONE',
  });
  assert.equal(request.message, 'status please');
  assert.equal(request.source, 'openclaw-whatsapp-agent-command');
  assert.equal(request.channel, 'whatsapp');
  assert.equal(request.operatorInitiated, true);
  assert.equal(request.command, '/standalone');
  assert.equal(request.canonicalCommand, '/standalone');
  assert.equal(request.timeoutMs, 90000);
});

test('routes /scout-coder and /scout_coder to canonical OpenClaw Local with the legacy id only as an alias', () => {
  const hyphen = buildAgentRequest(COMMANDS.scoutCoder, 'inspect repo');
  const underscore = buildAgentRequest(COMMANDS.scoutCoderAlias, 'inspect repo');
  assert.equal(hyphen.targetAgentId, 'openclaw-local');
  assert.equal(underscore.targetAgentId, 'openclaw-local');
  assert.deepEqual(hyphen.targetIdentity, {
    canonicalAgentId: 'openclaw-local',
    aliases: ['stephanos-scout-coder'],
    topologyRole: 'OPENCLAW_LOCAL',
  });
  assert.deepEqual(underscore.targetIdentity, hyphen.targetIdentity);
  assert.equal(hyphen.canonicalCommand, '/scout-coder');
  assert.equal(underscore.canonicalCommand, '/scout-coder');
  assert.equal(hyphen.message, underscore.message);
});

test('Standalone and Local remain distinct canonical identities and generic OpenClaw is not a routable command', () => {
  assert.notEqual(COMMANDS.standalone.targetAgentId, COMMANDS.scoutCoder.targetAgentId);
  assert.equal(COMMANDS.standalone.targetAgentId, 'openclaw-standalone');
  assert.equal(COMMANDS.scoutCoder.targetAgentId, 'openclaw-local');
  assert.equal(Object.values(COMMANDS).some((spec) => spec.command === 'openclaw'), false);
  assert.equal(Object.values(COMMANDS).some((spec) => spec.targetAgentId === 'stephanos-scout-coder'), false);
});

test('rejects empty command messages with command-specific usage', () => {
  assert.deepEqual(parseAgentCommand(COMMANDS.standalone, '   '), {
    ok: false,
    error: 'Usage: /standalone <message>',
  });
  assert.deepEqual(parseAgentCommand(COMMANDS.scoutCoderAlias, ''), {
    ok: false,
    error: 'Usage: /scout_coder <message>',
  });
});

test('rejects oversized command messages', () => {
  const result = parseAgentCommand(COMMANDS.scoutCoder, 'x'.repeat(4001));
  assert.equal(result.ok, false);
  assert.match(result.error, /4000 characters/);
});

test('bounds timeout between one second and two minutes', () => {
  assert.equal(buildAgentRequest(COMMANDS.standalone, 'go', 1).timeoutMs, 1000);
  assert.equal(buildAgentRequest(COMMANDS.standalone, 'go', 999999).timeoutMs, 120000);
});

test('prefixes successful replies with route proof and caps very long replies', () => {
  assert.equal(
    boundAgentReply(COMMANDS.scoutCoder, 'OK'),
    '[OpenClaw Local via OpenClaw]\nOK',
  );
  const long = boundAgentReply(COMMANDS.standalone, 'x'.repeat(8000));
  assert.ok(long.length <= 7000);
  assert.match(long, /truncated/);
});

test('safe unavailable reply does not fall back to any hidden route', () => {
  const reply = unavailableReply(COMMANDS.scoutCoderAlias);
  assert.match(reply, /not sent anywhere else/);
  assert.match(reply, /OpenClaw Gateway/);
  assert.doesNotMatch(reply, /cloud/i);
});
