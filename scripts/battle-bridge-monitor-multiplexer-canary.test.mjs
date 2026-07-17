import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMonitorMultiplexerCanaryArguments,
  resolveMonitorMultiplexerCanaryWorkspace,
  runBattleBridgeMonitorMultiplexerCanary,
} from './battle-bridge-monitor-multiplexer-canary.mjs';

const HEAD = '3557023f3f27e7a1aa647400dacba0f2dae1abef';

test('canary CLI accepts only one exact head and at most one bounded request id', () => {
  const valid = parseMonitorMultiplexerCanaryArguments([
    `--expected-head=${HEAD}`,
    '--request-id=req-monitor-canary-script-0001',
  ]);
  assert.equal(valid.ok, true);
  assert.equal(valid.expectedHead, HEAD);
  assert.equal(valid.requestId, 'req-monitor-canary-script-0001');

  const generated = parseMonitorMultiplexerCanaryArguments([
    `--expected-head=${HEAD}`,
  ], {
    requestIdFactory: () => 'req-monitor-canary-fresh-0001',
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.requestId, 'req-monitor-canary-fresh-0001');

  assert.equal(parseMonitorMultiplexerCanaryArguments([]).blocker, 'CANARY_EXPECTED_HEAD_REQUIRED_ONCE');
  assert.equal(parseMonitorMultiplexerCanaryArguments([
    `--expected-head=${HEAD}`,
    `--expected-head=${HEAD}`,
  ]).blocker, 'CANARY_EXPECTED_HEAD_REQUIRED_ONCE');
  assert.equal(parseMonitorMultiplexerCanaryArguments([
    `--expected-head=${HEAD}`,
    '--request-id=req-monitor-canary-script-0001',
    '--request-id=req-monitor-canary-script-0002',
  ]).blocker, 'CANARY_REQUEST_ID_ALLOWED_ONCE');
  assert.equal(parseMonitorMultiplexerCanaryArguments([
    `--expected-head=${HEAD}`,
    '--path=C:\\unsafe',
  ]).blocker, 'CANARY_ARGUMENT_NOT_ALLOWED');
  assert.equal(parseMonitorMultiplexerCanaryArguments([
    `--expected-head=${HEAD}`,
  ], {
    requestIdFactory: () => '../unsafe',
  }).blocker, 'CANARY_REQUEST_ID_INVALID');
});

test('canary workspace uses the canonical resolver and rejects secret-shaped targets', () => {
  const unsafe = resolveMonitorMultiplexerCanaryWorkspace({
    env: {
      USERPROFILE: 'C:\\Users\\Stephan Callear',
      STEPHANOS_SHARED_AGENT_WORKSPACE: 'C:\\Users\\Stephan Callear\\.ssh',
    },
  });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.blocker, 'STEPHANOS_SHARED_AGENT_WORKSPACE_PATH_UNSAFE');
  assert.equal(unsafe.arbitraryFilesystemAccess, false);

  const safe = resolveMonitorMultiplexerCanaryWorkspace({
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
  });
  assert.equal(safe.ok, true);
  assert.equal(safe.source, 'default-documents');
  assert.equal(safe.arbitraryFilesystemAccess, false);
});

test('runner fails closed outside the real Windows Battle Bridge', async () => {
  const result = await runBattleBridgeMonitorMultiplexerCanary({
    expectedHead: HEAD,
    requestId: 'req-monitor-canary-script-0003',
    platform: 'linux',
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'WINDOWS_REQUIRED');
  assert.equal(result.finalVerdict, 'MONITOR_MULTIPLEXER_CANARY_BLOCKED');
});
