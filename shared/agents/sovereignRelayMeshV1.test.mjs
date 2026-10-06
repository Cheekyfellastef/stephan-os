import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  SOVEREIGN_RELAY_FALLBACK_COVERAGE_FAILURES,
  SOVEREIGN_RELAY_FAST_POLL_MS,
  SOVEREIGN_RELAY_HOT_POLL_MS,
  SOVEREIGN_RELAY_IDLE_POLL_MS,
  SOVEREIGN_RELAY_INFLIGHT_HEARTBEAT_MS,
  SOVEREIGN_RELAY_WARM_POLL_MS,
  chooseSovereignRelayPoll,
  buildSovereignRelayInFlightStatus,
  buildSovereignRelayStatus,
  classifySovereignRelayDeliveryState,
  classifySovereignRelayGuardCycle,
  readSovereignRelaySourceHead,
  runSovereignRelayCycleWithHeartbeat,
} from '../../scripts/battle-bridge-sovereign-relay-daemon.mjs';

const watchdog = await readFile(
  new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url),
  'utf8',
);
const architecture = await readFile(
  new URL('../../docs/architecture/sovereign-commander-v1.md', import.meta.url),
  'utf8',
);
const relaySource = await readFile(
  new URL('../../scripts/battle-bridge-sovereign-relay-daemon.mjs', import.meta.url),
  'utf8',
);

test('relay source head proof is exact and uses a non-shell git boundary', () => {
  const calls = [];
  const head = 'a'.repeat(40);
  const result = readSovereignRelaySourceHead({
    platform: 'linux',
    cwd: '/repo',
    spawnSyncFn: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: head + '\n', stderr: '' };
    },
  });
  assert.equal(result, head);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'git');
  assert.deepEqual(calls[0].args, ['-C', '/repo', 'rev-parse', 'HEAD']);
  assert.equal(calls[0].options.shell, false);
});

test('relay refuses an unproven source head', () => {
  assert.throws(() => readSovereignRelaySourceHead({
    platform: 'linux',
    cwd: '/repo',
    spawnSyncFn: () => ({ status: 0, stdout: 'not-a-head\n', stderr: '' }),
  }), /SOVEREIGN_RELAY_SOURCE_HEAD_UNPROVEN/);
});

test('sovereign relay uses the existing guarded mailbox as transport only', () => {
  assert.ok(SOVEREIGN_RELAY_FAST_POLL_MS >= 1000);
  assert.ok(SOVEREIGN_RELAY_FAST_POLL_MS <= 3000);
  assert.match(relaySource, /battle-bridge-github-command-mailbox-outbox-guard-v1\.mjs/);
  assert.match(relaySource, /spawnFn\(process\.execPath, \[guardPath\]/);
  assert.match(relaySource, /shell:\s*false/);
  assert.match(relaySource, /windowsHide:\s*true/);
  assert.match(relaySource, /duplicateExecutionAllowed:\s*false/);
  assert.match(relaySource, /externalCarrierOwnsExecution:\s*false/);
  assert.match(relaySource, /externalCarrierOwnsState:\s*false/);
  assert.match(relaySource, /externalCarrierOwnsAuthority:\s*false/);
});

test('adaptive relay stays hot around activity then cools through warm to idle', () => {
  assert.equal(SOVEREIGN_RELAY_FAST_POLL_MS, SOVEREIGN_RELAY_HOT_POLL_MS);
  assert.equal(SOVEREIGN_RELAY_HOT_POLL_MS, 2500);
  assert.equal(SOVEREIGN_RELAY_WARM_POLL_MS, 5000);
  assert.equal(SOVEREIGN_RELAY_IDLE_POLL_MS, 15000);

  const activityAt = Date.parse('2026-10-02T20:00:00.000Z');
  const hot = chooseSovereignRelayPoll({
    cycle: { ok: true, mailboxSelectedCount: 1 },
    nowMs: activityAt,
    lastActivityAtMs: null,
  });
  assert.equal(hot.mode, 'HOT');
  assert.equal(hot.pollMs, 2500);
  assert.equal(hot.activity, true);

  const warm = chooseSovereignRelayPoll({
    cycle: { ok: true },
    nowMs: activityAt + (6 * 60 * 1000),
    lastActivityAtMs: activityAt,
  });
  assert.equal(warm.mode, 'WARM');
  assert.equal(warm.pollMs, 5000);

  const idle = chooseSovereignRelayPoll({
    cycle: { ok: true },
    nowMs: activityAt + (11 * 60 * 1000),
    lastActivityAtMs: activityAt,
  });
  assert.equal(idle.mode, 'IDLE');
  assert.equal(idle.pollMs, 15000);

  const degraded = chooseSovereignRelayPoll({
    cycle: { ok: false, blocker: 'NETWORK_UNAVAILABLE' },
    nowMs: activityAt + 1,
    lastActivityAtMs: activityAt,
  });
  assert.equal(degraded.mode, 'DEGRADED');
  assert.equal(degraded.pollMs, 15000);

  const fixed = chooseSovereignRelayPoll({
    cycle: { ok: true },
    nowMs: activityAt + 1,
    lastActivityAtMs: activityAt,
    fixedPollMs: 2500,
  });
  assert.equal(fixed.mode, 'FIXED');
  assert.equal(fixed.pollMs, 2500);
});

test('relay classifies bounded mailbox activity metrics for adaptive polling', () => {
  const result = classifySovereignRelayGuardCycle({
    exitCode: 0,
    stdout: JSON.stringify({
      ok: true,
      finalVerdict: 'MAILBOX_OUTBOX_GUARD_READY',
      childMailboxSelectedCount: 2,
      childMailboxControlCount: 1,
      childMailboxObservationCount: 1,
      childMailboxBlockedCount: 0,
      attemptedPublicationCount: 1,
      pendingPublicationCountAfterChild: 0,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.mailboxSelectedCount, 2);
  assert.equal(result.mailboxControlCount, 1);
  assert.equal(result.mailboxObservationCount, 1);
  assert.equal(result.attemptedPublicationCount, 1);
});

test('relay publishes watchdog-safe in-flight status without widening authority', () => {
  const sourceHead = 'b'.repeat(40);
  const status = buildSovereignRelayInFlightStatus({
    now: new Date('2026-10-03T12:00:00.000Z'),
    cycleStartedAtMs: Date.parse('2026-10-03T11:59:59.000Z'),
    previousStatus: { carrierHealthy: true },
    consecutiveCarrierFailures: 1,
    sourceHead,
  });
  assert.equal(status.daemonHealthy, true);
  assert.equal(status.cycleInFlight, true);
  assert.equal(status.deliveryState, 'FAST_CHECKING');
  assert.equal(status.sourceHead, sourceHead);
  assert.equal(status.retryIdentityPreserved, true);
  assert.equal(status.duplicateExecutionAllowed, false);
  assert.equal(status.arbitraryShellAllowed, false);
  assert.equal(status.finalVerdict, 'SOVEREIGN_RELAY_CYCLE_IN_FLIGHT');
});

test('relay refreshes its in-flight heartbeat while a guarded cycle remains active', async () => {
  assert.equal(SOVEREIGN_RELAY_INFLIGHT_HEARTBEAT_MS, 10_000);
  const writes = [];
  let scheduledHeartbeat = null;
  let clearCount = 0;
  const result = await runSovereignRelayCycleWithHeartbeat({
    runCycle: async () => {
      assert.equal(writes.length, 1);
      scheduledHeartbeat();
      await Promise.resolve();
      await Promise.resolve();
      return { ok: true, busy: false };
    },
    env: {},
    statusPath: '/virtual/sovereign-relay-current.json',
    now: () => new Date('2026-10-03T12:00:00.000Z'),
    cycleStartedAtMs: Date.parse('2026-10-03T11:59:59.000Z'),
    previousStatus: { carrierHealthy: true },
    consecutiveCarrierFailures: 0,
    sourceHead: 'c'.repeat(40),
    heartbeatMs: 1000,
    writeStatus: async (_path, status) => { writes.push(status); },
    setTimeoutFn: (callback) => {
      scheduledHeartbeat = callback;
      return { unref() {} };
    },
    clearTimeoutFn: () => { clearCount += 1; },
  });
  assert.equal(result.ok, true);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((status) => status.cycleInFlight === true));
  assert.ok(writes.every((status) => status.sourceHead === 'c'.repeat(40)));
  assert.ok(writes.every((status) => status.duplicateExecutionAllowed === false));
  assert.equal(clearCount, 1);
});

test('relay distinguishes recovering, fallback-covered, and recovered fast path', () => {
  assert.equal(SOVEREIGN_RELAY_FALLBACK_COVERAGE_FAILURES, 3);
  assert.equal(classifySovereignRelayDeliveryState({
    cycle: { ok: false },
    consecutiveCarrierFailures: 1,
  }), 'RECOVERING');
  assert.equal(classifySovereignRelayDeliveryState({
    cycle: { ok: false },
    consecutiveCarrierFailures: SOVEREIGN_RELAY_FALLBACK_COVERAGE_FAILURES,
  }), 'FALLBACK_COVERED');
  assert.equal(classifySovereignRelayDeliveryState({
    cycle: { ok: true, busy: false },
    consecutiveCarrierFailures: 0,
    recoveredThisCycle: true,
  }), 'FAST_RECOVERED');
  assert.equal(classifySovereignRelayDeliveryState({
    cycle: { ok: true, busy: true },
    consecutiveCarrierFailures: 0,
  }), 'FAST_BUSY');
});

test('completed relay status exposes delivery and fallback proof without duplicate execution', () => {
  const completedAtMs = Date.parse('2026-10-03T12:00:00.000Z');
  const sourceHead = 'd'.repeat(40);
  const status = buildSovereignRelayStatus({
    now: new Date(completedAtMs),
    cycle: { ok: false, busy: false, blocker: 'NETWORK_UNAVAILABLE' },
    sourceHead,
    cycleStartedAtMs: completedAtMs - 1000,
    cycleCompletedAtMs: completedAtMs,
    consecutiveCarrierFailures: SOVEREIGN_RELAY_FALLBACK_COVERAGE_FAILURES,
    lastCarrierHealthyAtMs: completedAtMs - 60_000,
    recoveredThisCycle: false,
  });
  assert.equal(status.cycleInFlight, false);
  assert.equal(status.sourceHead, sourceHead);
  assert.equal(status.deliveryState, 'FALLBACK_COVERED');
  assert.equal(status.fallbackCovered, true);
  assert.equal(status.scheduledMailboxFallbackExpected, true);
  assert.equal(status.retryIdentityPreserved, true);
  assert.equal(status.duplicateExecutionAllowed, false);
});

test('relay treats the canonical mailbox lock as healthy fallback concurrency', () => {
  const result = classifySovereignRelayGuardCycle({
    exitCode: 1,
    stdout: JSON.stringify({
      ok: false,
      blocker: 'MAILBOX_OUTBOX_GUARD_FAILED',
      error: 'MAILBOX_OUTBOX_GUARD_ALREADY_RUNNING',
      finalVerdict: 'MAILBOX_OUTBOX_GUARD_BLOCKED',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.busy, true);
  assert.equal(result.blocker, '');
});

test('relay status retains all fallback transports without granting them authority', () => {
  const status = buildSovereignRelayStatus({
    now: new Date('2026-10-02T15:00:00.000Z'),
    cycle: { ok: true, busy: false, childExitCode: 0, guardVerdict: 'MAILBOX_OUTBOX_GUARD_READY' },
    cycleStartedAtMs: Date.parse('2026-10-02T14:59:59.000Z'),
    cycleCompletedAtMs: Date.parse('2026-10-02T15:00:00.000Z'),
  });
  assert.equal(status.daemonHealthy, true);
  assert.equal(status.executionOwner, 'sovereign-commander');
  assert.equal(status.externalCarrierOwnsExecution, false);
  assert.equal(status.duplicateExecutionAllowed, false);
  assert.deepEqual(status.retainedFallbacks, [
    'scheduled-github-mailbox',
    'tailscale-private',
    'openai-secure-mcp-tunnel',
    'remote-desktop-commander',
  ]);
});

test('watchdog recycles a fresh but stale-head Sovereign relay after main advances', () => {
  assert.match(watchdog, /\$sourceHead\s*=\s*\(\[string\]\$status\.sourceHead\)/);
  assert.match(watchdog, /rev-parse HEAD/);
  assert.match(watchdog, /sourceHeadMatchesLive/);
  assert.match(watchdog, /SOVEREIGN_RELAY_SOURCE_HEAD_MISSING/);
  assert.match(watchdog, /SOVEREIGN_RELAY_SOURCE_HEAD_STALE/);
  assert.match(watchdog, /\$status\.daemonHealthy\s+-eq\s+\$true[\s\S]*\$age\s+-le\s+30[\s\S]*\$sourceHeadMatchesLive/);
  assert.match(watchdog, /if \(\$relayBefore\.Count -eq 0 -or -not \[bool\]\$relayHealthBefore\.healthy\)/);
  assert.match(watchdog, /relayDaemonSourceHeadMatchesLive/);
});

test('Sovereign Commander watchdog supervises relay but does not make it a core health dependency', () => {
  assert.match(watchdog, /battle-bridge-sovereign-relay-daemon\.mjs/);
  assert.match(watchdog, /sovereign-relay-current\.json/);
  assert.match(watchdog, /relayDaemonHealthy/);
  assert.match(relaySource, /SOVEREIGN_RELAY_INFLIGHT_HEARTBEAT_MS\s*=\s*10_000/);
  assert.match(relaySource, /runSovereignRelayCycleWithHeartbeat/);
  assert.match(relaySource, /writeStatus\(statusPath, inFlightStatus\(\)\)/);
  assert.match(
    watchdog,
    /\$overallOk\s*=\s*\[bool\]\(\$ok\s+-and\s+\$vrGovernorOk\s+-and\s+\$coreDaemonOk\s+-and\s+\$fleetGoalSupervisorOk\)/,
  );
  assert.doesNotMatch(
    watchdog,
    /\$overallOk\s*=.*relayDaemonOk/i,
  );
});

test('architecture makes the transport mesh additive and keeps every fallback', () => {
  assert.match(architecture, /Sovereign transport mesh/i);
  assert.match(architecture, /GitHub.*fast carrier/i);
  assert.match(architecture, /Tailscale.*fallback/i);
  assert.match(architecture, /OpenAI Secure MCP Tunnel.*fallback/i);
  assert.match(architecture, /Remote Desktop Commander.*fallback/i);
  assert.match(architecture, /no single transport.*critical path/i);
});
