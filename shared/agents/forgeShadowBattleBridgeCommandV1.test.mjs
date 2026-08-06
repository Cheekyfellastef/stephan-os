import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORGE_SHADOW_BATTLE_BRIDGE_ACTION,
  FORGE_SHADOW_BATTLE_BRIDGE_COMMAND_SCHEMA,
  validateForgeShadowBattleBridgeCommand,
} from './forgeShadowBattleBridgeCommandV1.mjs';

const HEAD = 'a'.repeat(40);
const DIGEST = `sha256:${'b'.repeat(64)}`;
const NOW = '2026-08-06T22:00:00Z';

function command(overrides = {}) {
  return {
    schemaVersion: FORGE_SHADOW_BATTLE_BRIDGE_COMMAND_SCHEMA,
    commandId: 'forge-shadow-canary-1',
    action: FORGE_SHADOW_BATTLE_BRIDGE_ACTION,
    sourceHead: HEAD,
    imageDigest: DIGEST,
    issuedAtUtc: '2026-08-06T21:55:00Z',
    expiresAtUtc: '2026-08-06T22:10:00Z',
    canary: true,
    ...overrides,
  };
}
function context(overrides = {}) {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    authenticatedRequester: 'Cheekyfellastef',
    liveMainHead: HEAD,
    hostId: 'battle-bridge',
    nowUtc: NOW,
    ...overrides,
  };
}

test('valid owner-authenticated exact-head command yields one fixed non-executed invocation', () => {
  const result = validateForgeShadowBattleBridgeCommand(command(), context());
  assert.equal(result.valid, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.executionPlan.adapterId, 'forge-shadow-battle-bridge-executor-v1');
  assert.equal(result.executionPlan.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(result.executionPlan.scriptIdentity, 'scripts/windows/install-forge-shadow-podman-v1.ps1');
  assert.equal(result.executionPlan.argv.at(-1), '-OperatorApproved');
  assert.equal(result.executionPlan.executed, false);
  assert.equal(result.executionPlan.singleUse, true);
  assert.equal(result.authority.hostMutationByValidator, false);
  assert.equal(result.authority.merge, false);
  assert.equal(result.authority.runnerRegistration, false);
});

test('wrong repository requester host or live main head fails closed', () => {
  for (const ctx of [
    context({ repository: 'other/repo' }),
    context({ authenticatedRequester: 'someone-else' }),
    context({ hostId: 'other-host' }),
    context({ liveMainHead: 'c'.repeat(40) }),
  ]) {
    assert.equal(validateForgeShadowBattleBridgeCommand(command(), ctx).valid, false);
  }
});

test('only the fixed install action and canary are accepted', () => {
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ action: 'RUN_COMMAND' }), context()).valid, false);
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ canary: false }), context()).valid, false);
});

test('source head and image digest are exact and immutable', () => {
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ sourceHead: 'short' }), context()).valid, false);
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ sourceHead: 'c'.repeat(40) }), context()).valid, false);
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ imageDigest: 'forgejo:15' }), context()).valid, false);
});

test('expired future or overlong authority windows fail closed', () => {
  const cases = [
    command({ expiresAtUtc: '2026-08-06T21:59:59Z' }),
    command({ issuedAtUtc: '2026-08-06T22:02:00Z' }),
    command({ issuedAtUtc: '2026-08-06T21:00:00Z', expiresAtUtc: '2026-08-06T22:10:00Z' }),
    command({ issuedAtUtc: 'bad' }),
    command({ expiresAtUtc: 'bad' }),
  ];
  for (const item of cases) assert.equal(validateForgeShadowBattleBridgeCommand(item, context()).valid, false);
});

test('caller cannot supply command executable path environment credential or merge fields', () => {
  for (const key of ['command', 'executable', 'path', 'environment', 'credential', 'merge']) {
    const result = validateForgeShadowBattleBridgeCommand({ ...command(), [key]: 'x' }, context());
    assert.equal(result.valid, false, key);
    assert.ok(result.blockers.includes('command-schema-unbounded'));
  }
});

test('trusted context is exact-schema bounded too', () => {
  const result = validateForgeShadowBattleBridgeCommand(command(), { ...context(), command: 'x' });
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('context-schema-unbounded'));
});

test('command identity is bounded and cannot be blank', () => {
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ commandId: '' }), context()).valid, false);
  assert.equal(validateForgeShadowBattleBridgeCommand(command({ commandId: 'x'.repeat(200) }), context()).valid, false);
});

test('fixed invocation carries only the reviewed head and digest as variable arguments', () => {
  const result = validateForgeShadowBattleBridgeCommand(command(), context());
  const argv = result.executionPlan.argv;
  assert.deepEqual(argv.slice(0, 6), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    '%USERPROFILE%\\Documents\\GitHub\\stephan-os\\scripts\\windows\\install-forge-shadow-podman-v1.ps1',
  ]);
  assert.equal(argv[7], HEAD);
  assert.equal(argv[9], DIGEST);
});
