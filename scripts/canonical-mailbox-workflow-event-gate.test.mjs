import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_MAILBOX_ISSUE } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { evaluateCanonicalMailboxWorkflowEvent } from './canonical-mailbox-workflow-event-gate.mjs';
const event = (patch = {}) => ({
  action: 'created',
  repository: { full_name: 'Cheekyfellastef/stephan-os' },
  issue: { number: CANONICAL_MAILBOX_ISSUE },
  comment: { user: { login: 'Cheekyfellastef' },
    body: '<!-- stephanos-battle-bridge-command-receipt -->' },
  ...patch,
});
test('new canonical shard allows event ingress but grants zero protected authority', () => {
  const result = evaluateCanonicalMailboxWorkflowEvent(event(), { mode: 'receipt' });
  assert.equal(CANONICAL_MAILBOX_ISSUE, 3149);
  assert.equal(result.admitted, true);
  assert.equal(result.issueNumber, 3149);
  assert.equal(result.downstreamExactCommandValidationRequired, true);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.protectedApprovalAuthority, false);
});
test('old mailbox, foreign owners and pull requests are denied for all event modes', () => {
  const invalid = [
    event({ issue: { number: 2808 } }),
    event({ issue: { number: 2590 } }),
    event({ issue: { number: CANONICAL_MAILBOX_ISSUE, pull_request: {} } }),
    event({ repository: { full_name: 'foreign/project' } }),
    event({ comment: { user: { login: 'someone-else' },
      body: '<!-- stephanos-battle-bridge-command-receipt -->' } }),
    event({ action: 'deleted' }),
  ];
  for (const item of invalid) {
    for (const mode of ['protected', 'receipt', 'observer', 'bootstrap', 'prerequisite']) {
      assert.equal(evaluateCanonicalMailboxWorkflowEvent(item, { mode }).admitted, false);
    }
  }
});
test('command classes are independent and edited protected approvals never admitted', () => {
  const prereq = event({
    comment: { user: { login: 'Cheekyfellastef' },
      body: 'stephanos-battle-bridge-tailscale-bootstrap-prerequisites' },
  });
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(prereq, { mode: 'bootstrap' }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(prereq, { mode: 'prerequisite' }).admitted, true);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event(), { mode: 'protected' }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event({ action: 'edited' }), { mode: 'receipt' }).admitted, true);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event({ action: 'edited' }), { mode: 'protected' }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event(), { mode: '__proto__' }).admitted, false);
});
