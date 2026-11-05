import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_WORKFLOW_URL, projectControlReplyForSurfaceV1 } from '../apps/stephanos-ai/controlSurface.mjs';

const NOW = Date.parse('2026-10-31T12:00:00.000Z');
function fixture() {
  return { data: { sovereign_control_conversation: {
    schemaVersion: 'stephanos.sovereign-control-conversation.v1',
    observedAtUtc: new Date(NOW).toISOString(), responseSource: 'CANONICAL_CONTROL_OBSERVATIONS',
    readOnly: true, modelInvoked: false, nativeActionSubmitted: false, directParticipantDispatchProven: false,
    controlTower: { latestRequestObservation: {
      requestId: 'control-tower-build-123-1', state: 'UNKNOWN', historical: true,
      observedAtUtc: new Date(NOW - 60000).toISOString(),
    } },
    handoff: { state: 'NOT_SUBMITTED', requestSubmitted: false, executionAuthority: false,
      reusableAuthority: false, authenticatedOwnerSubmissionRequired: true, singleAuthenticatedRunRequired: true,
      operation: 'OBSERVE_CONTROL_SYSTEM', workflowUrl: CONTROL_WORKFLOW_URL, workflowRef: 'main',
      workflowInputs: { operation: 'OBSERVE_CONTROL_SYSTEM' },
      createdAtUtc: new Date(NOW).toISOString(), expiresAtUtc: new Date(NOW + 600000).toISOString(),
      submissionBlockedReason: '',
    },
  } } };
}

test('unknown retained outcomes and prepared handoffs are never displayed as completed actions', () => {
  const view = projectControlReplyForSurfaceV1(fixture(), NOW);
  assert.equal(view.request.label, 'Outcome unproven');
  assert.equal(view.request.historical, true);
  assert.equal(view.handoff.status, 'Prepared · not submitted');
  assert.equal(view.handoff.workflowUrl, CONTROL_WORKFLOW_URL);
  assert.equal(view.handoff.available, true);
});

test('forged links, inputs, authority and invalid clocks never become actionable handoff links', () => {
  for (const edit of [
    h => { h.workflowUrl = 'javascript:alert(1)'; },
    h => { h.workflowUrl = CONTROL_WORKFLOW_URL + '?command=repair'; },
    h => { h.workflowRef = 'feature'; },
    h => { h.workflowInputs.shell = 'anything'; },
    h => { h.workflowInputs.operation = 'BUILD_NEXT_ELIGIBLE_GOAL'; },
    h => { h.requestSubmitted = true; }, h => { h.executionAuthority = true; },
    h => { h.reusableAuthority = true; }, h => { h.authenticatedOwnerSubmissionRequired = false; },
    h => { h.operation = 'REBOOT'; }, h => { h.createdAtUtc = new Date(NOW + 6000).toISOString(); },
    h => { h.expiresAtUtc = new Date(NOW + 600001).toISOString(); },
    h => { h.expiresAtUtc = 'not a date'; },
  ]) {
    const result = fixture(); edit(result.data.sovereign_control_conversation.handoff);
    assert.equal(projectControlReplyForSurfaceV1(result, NOW).handoff, null);
  }
});

test('expiry and unresolved prior work remove the link without rewriting the historical outcome', () => {
  let view = projectControlReplyForSurfaceV1(fixture(), NOW + 600000);
  assert.equal(view.handoff.available, false);
  assert.match(view.handoff.status, /expired/);
  const result = fixture(); result.data.sovereign_control_conversation.handoff.submissionBlockedReason = 'CONTROL_TOWER_REQUEST_OUTCOME_UNPROVEN';
  view = projectControlReplyForSurfaceV1(result, NOW);
  assert.equal(view.handoff.available, false);
  assert.equal(view.request.state, 'UNKNOWN');
});

test('a completed inspection cannot conceal an earlier unresolved build in the receipt card', () => {
  const result = fixture();
  const tower = result.data.sovereign_control_conversation.controlTower;
  tower.latestBuildRequestObservation = tower.latestRequestObservation;
  tower.latestRequestObservation = { requestId: 'control-tower-build-124-1', state: 'OBSERVATION_COMPLETED', historical: true };
  const view = projectControlReplyForSurfaceV1(result, NOW);
  assert.equal(view.request.label, 'Inspection completed');
  assert.equal(view.unresolvedBuild.requestId, 'control-tower-build-123-1');
  assert.equal(view.unresolvedBuild.label, 'Outcome unproven');
});

test('older terminal ledger facts remain terminal even when detailed receipt metadata was never stored', () => {
  const result = fixture();
  Object.assign(result.data.sovereign_control_conversation.controlTower.latestRequestObservation,
    { ledgerPhase: 'TERMINAL', terminalState: 'BLOCKED', detailState: 'LEGACY_DETAIL_UNAVAILABLE' });
  const view = projectControlReplyForSurfaceV1(result, NOW);
  assert.equal(view.request.label, 'Recorded terminal: blocked · detail unavailable');
  assert.equal(view.request.unresolved, false);
});

test('ordinary model replies and claimed native dispatch cannot masquerade as control receipts', () => {
  for (const fields of [{ modelInvoked: true }, { nativeActionSubmitted: true },
    { directParticipantDispatchProven: true }, { readOnly: false }, { observedAtUtc: '' },
    { responseSource: 'MODEL' }]) {
    const result = fixture(); Object.assign(result.data.sovereign_control_conversation, fields);
    assert.equal(projectControlReplyForSurfaceV1(result, NOW), null);
  }
  assert.equal(projectControlReplyForSurfaceV1({ output_text: 'Working' }, NOW), null);
});
