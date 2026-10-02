import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  SOVEREIGN_RELAY_FAST_POLL_MS,
  SOVEREIGN_RELAY_HOT_POLL_MS,
  SOVEREIGN_RELAY_IDLE_POLL_MS,
  SOVEREIGN_RELAY_WARM_POLL_MS,
  chooseSovereignRelayPoll,
  buildSovereignRelayStatus,
  classifySovereignRelayGuardCycle,
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

test('Sovereign Commander watchdog supervises relay but does not make it a core health dependency', () => {
  assert.match(watchdog, /battle-bridge-sovereign-relay-daemon\.mjs/);
  assert.match(watchdog, /sovereign-relay-current\.json/);
  assert.match(watchdog, /relayDaemonHealthy/);
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
