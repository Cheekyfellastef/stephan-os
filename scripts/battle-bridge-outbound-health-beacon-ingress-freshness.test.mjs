import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBattleBridgeOutboundBeacon,
  projectMailboxIngressLiveness,
} from './battle-bridge-outbound-health-beacon.mjs';

const HEAD = 'a'.repeat(40);

test('bounded ingress history without recent exact-head proof is UNPROVEN, never READY', () => {
  const now = new Date('2026-08-21T04:06:50.447Z');
  const ingress = projectMailboxIngressLiveness([], {
    sourceHead: HEAD,
    now,
  });

  assert.deepEqual(ingress, {
    state: 'UNPROVEN',
    blocker: 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF',
    pendingRequestCount: 0,
  });

  const beacon = buildBattleBridgeOutboundBeacon({
    sourceHead: HEAD,
    now,
    statusRecords: {
      mailbox: {
        timestampUtc: '2026-08-21T04:05:55.238Z',
        status: 'READY',
      },
    },
    mailboxIngressObservation: ingress,
  });
  const mailbox = beacon.surfaces.find((surface) => surface.id === 'mailbox');
  assert.equal(mailbox.state, 'UNPROVEN');
  assert.equal(mailbox.blocker, 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF');
  assert.ok(beacon.blockers.includes('mailbox:MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF'));
});

test('a recent valid exact-head command may remain non-blocking during ingress grace', () => {
  const createdAt = '2026-08-21T04:02:00.000Z';
  const expiresAt = '2026-08-21T05:00:00.000Z';
  const comments = [{
    id: 10,
    created_at: createdAt,
    user: { login: 'Cheekyfellastef' },
    body: `\`\`\`stephanos-battle-bridge-command\n${JSON.stringify({
      schemaVersion: 'stephanos.battle-bridge-github-command.v1',
      requestId: 'recent-exact-head-ingress-probe-0001',
      operation: 'RUN_BATTLE_BRIDGE_DIAGNOSTICS',
      repository: 'Cheekyfellastef/stephan-os',
      issueNumber: 1507,
      branch: 'main',
      operatorApproval: 'operator-approved',
      expectedHead: HEAD,
      expiresAt,
    })}\n\`\`\``,
  }];

  assert.deepEqual(projectMailboxIngressLiveness(comments, {
    sourceHead: HEAD,
    now: new Date('2026-08-21T04:06:50.447Z'),
  }), {
    state: 'OBSERVED',
    blocker: '',
    pendingRequestCount: 0,
  });
});
