import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySovereignControlConversationV1, buildSovereignControlConversationV1,
  CONTROL_TOWER_WORKFLOW_URL } from './sovereignControlConversationV1.mjs';

const AT = '2026-10-31T12:00:00.000Z';
const HEAD = 'a'.repeat(40);
const UUID = '59a50c11-9855-45a5-bd6b-ae3816dd3fb3';
const health = () => ({
  schemaVersion: 'stephanos.ai-sovereign-commander-health.v1', available: true, healthy: true,
  observedAtUtc: AT, blocker: '', readOnly: true, localLoopbackOnly: true,
  commanderMcpAccessGranted: false, sourceMutationAllowed: false,
  guardian: { operationalState: 'NO_NEXT_CYCLE', enabled: true, running: false, scheduled: false,
    maintenanceInFlight: false, custodyHeld: false, timeoutCustodyHeld: false, cycleCount: 0,
    lastBlocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', lastSourceHead: HEAD, lastOk: false },
});
const request = (overrides = {}) => ({
  requestId: 'control-tower-build-401-1', runId: 401, state: 'UNKNOWN',
  operation: 'BUILD_NEXT_ELIGIBLE_GOAL', blocker: 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN',
  observedAtUtc: '2026-10-31T11:50:00.000Z', acceptedAtUtc: '2026-10-31T11:49:00.000Z',
  sourceHead: HEAD, historical: true, diagnosticOnly: true, exactHeadMatch: true, ...overrides,
});
const tower = (overrides = {}) => ({
  schemaVersion: 'stephanos.control-tower-build-beacon-facts.v1', observed: true,
  state: 'WAITING', blocker: '', observedAtUtc: AT, exactHeadMatch: true,
  sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false, ...overrides,
});
const reply = (input = {}) => buildSovereignControlConversationV1({
  classification: classifySovereignControlConversationV1({ prompt: 'Sovereign Commander status', requestedTargetId: 'everyone' }),
  observedAtUtc: AT, commander: health(), controlTower: tower(), handoffId: UUID, ...input,
});

test('explicit control targets and operational Everyone mentions select deterministic intents only', () => {
  const cases = [
    ['hello', 'sovereign-commander', 'CAPABILITIES'],
    ['what can you do?', 'control-tower', 'CAPABILITIES'],
    ['Sovereign Commander, are you running?', 'everyone', 'STATUS'],
    ['Control Tower latest receipt', 'everyone', 'STATUS'],
    ['Sovereign Commander, repair Stephanos', 'everyone', 'BUILD_NEXT_ELIGIBLE_GOAL'],
    ['prepare repair', 'control-tower', 'BUILD_NEXT_ELIGIBLE_GOAL'],
    ['Why did the last build fail?', 'control-tower', 'STATUS'],
    ['Show Sovereign Commander repair status.', 'everyone', 'STATUS'],
    ['/control-tower inspect', 'everyone', 'OBSERVE_CONTROL_SYSTEM'],
    ['/sovereign status', 'everyone', 'STATUS'],
    ['Inspect the native control system', 'control-tower', 'OBSERVE_CONTROL_SYSTEM'],
    ['Explain how Sovereign repair works', 'everyone', 'CAPABILITIES'],
    ["Sovereign, don't repair anything", 'everyone', 'CAPABILITIES'],
    ['Sovereign, run shell and repair now', 'everyone', 'UNSUPPORTED_OPERATION'],
    ['install the runtime', 'sovereign-commander', 'UNSUPPORTED_OPERATION'],
  ];
  for (const [prompt, requestedTargetId, intent] of cases) {
    const value = classifySovereignControlConversationV1({ prompt, requestedTargetId });
    assert.equal(value.applies, true, prompt);
    assert.equal(value.intent, intent, prompt);
  }
});

test('unrelated synthesis and the existing exact /sovereign tool retain their routes', () => {
  for (const prompt of ['hello', 'Please repair the CSS layout', 'Explain sovereign nations', 'Explain the sovereign wealth fund model', '/sovereign', 'x'.repeat(6001)]) {
    assert.equal(classifySovereignControlConversationV1({ prompt, requestedTargetId: 'everyone' }).applies, false, prompt.slice(0, 80));
  }
  assert.equal(classifySovereignControlConversationV1({ prompt: 'Sovereign repair status', requestedTargetId: 'openclaw-local' }).applies, false);
});

test('continuation and explicit repairs retain their intent without a metered fallback or invented submission', () => {
  for (const [prompt, requestedTargetId] of [
    ['keep going', 'control-tower'],
    ['continue', 'control-tower'],
    ['please continue building now', 'sovereign-commander'],
    ['get Stephanos working properly', 'control-tower'],
    ['can we get Stephanos working properly?', 'control-tower'],
    ['can we keep building?', 'control-tower'],
    ['keep building the project', 'control-tower'],
    ['keep building the next eligible goal', 'control-tower'],
    ['please keep building Stephanos', 'control-tower'],
    ['build once', 'control-tower'],
    ['Control Tower keep going', 'everyone'],
    ['Control Tower, can we keep building?', 'everyone'],
    ['Control Tower, continue', 'everyone'],
    ['Sovereign keep going', 'everyone'],
    ['Sovereign, let’s keep going', 'everyone'],
    ['/control-tower keep going', 'everyone'],
    ['Control Tower can you fix the blocked build', 'everyone'],
    ['Control Tower fix the stopped workers', 'everyone'],
    ['resume the stopped worker', 'control-tower'],
    ['repair the status projection', 'control-tower'],
    ['fix the latest receipt display', 'control-tower'],
  ]) {
    const classification = classifySovereignControlConversationV1({ prompt, requestedTargetId });
    assert.equal(classification.applies, true, prompt);
    assert.equal(classification.intent, 'BUILD_NEXT_ELIGIBLE_GOAL', prompt);
    const result = reply({ classification });
    assert.equal(result.modelInvoked, false, prompt);
    assert.equal(result.nativeActionSubmitted, false, prompt);
    assert.equal(result.handoff.state, 'NOT_SUBMITTED', prompt);
    assert.equal(result.handoff.requestSubmitted, false, prompt);
    assert.equal(result.handoff.executionAuthority, false, prompt);
    assert.equal(result.sourceMutationAllowed, false, prompt);
  }
});

test('negation, explanation, conditional continuation and status nouns never become action handoffs', () => {
  for (const [prompt, expectedIntent] of [
    ['Control Tower, do not keep going', 'CAPABILITIES'],
    ['Control Tower, don’t keep building', 'CAPABILITIES'],
    ['Control Tower, can’t you keep going?', 'CAPABILITIES'],
    ['Control Tower, never continue building', 'CAPABILITIES'],
    ['Control Tower, continue explaining the repair', 'CAPABILITIES'],
    ['Control Tower, continue showing the build status', 'STATUS'],
    ['Control Tower, keep going with the explanation', 'CAPABILITIES'],
    ['Control Tower, explain how to get Stephanos working', 'STATUS'],
    ['Control Tower, how can we keep building?', 'CAPABILITIES'],
    ['Control Tower, should we keep going?', 'CAPABILITIES'],
    ['Control Tower, if the meter resets, keep going', 'CAPABILITIES'],
    ['Control Tower, continue when the worker is ready', 'STATUS'],
    ['Control Tower, keep building if there is capacity', 'CAPABILITIES'],
    ['Control Tower, build when the worker is ready', 'STATUS'],
    ['Control Tower, build only when I ask', 'STATUS'],
    ['Control Tower, get Stephanos working when there is capacity', 'STATUS'],
    ['Control Tower, get Stephanos working after the current task finishes', 'STATUS'],
    ['Control Tower, get Stephanos working once there is capacity', 'STATUS'],
    ['Control Tower, resume before the old worker has stopped', 'STATUS'],
    ['Control Tower, fix the build if a reviewer becomes available', 'CAPABILITIES'],
    ['Control Tower, build status', 'STATUS'],
    ['Control Tower, please repair status', 'STATUS'],
    ['Control Tower, can you show build history?', 'STATUS'],
    ['Control Tower, why is the build blocked?', 'STATUS'],
  ]) {
    const classification = classifySovereignControlConversationV1({ prompt, requestedTargetId: 'everyone' });
    assert.equal(classification.applies, true, prompt);
    assert.equal(classification.intent, expectedIntent, prompt);
    const result = reply({ classification });
    assert.equal(result.handoff, null, prompt);
    assert.equal(result.modelInvoked, false, prompt);
    assert.equal(result.nativeActionSubmitted, false, prompt);
  }
  for (const prompt of ['keep going', 'continue', 'get Stephanos working properly', 'Please keep building the CSS layout']) {
    assert.equal(classifySovereignControlConversationV1({ prompt, requestedTargetId: 'everyone' }).applies, false, prompt);
  }
  assert.equal(classifySovereignControlConversationV1({ prompt: 'Control Tower keep going', requestedTargetId: 'openclaw-local' }).applies, false);
  assert.equal(classifySovereignControlConversationV1({ prompt: 'Control Tower reboot', requestedTargetId: 'everyone' }).intent, 'UNSUPPORTED_OPERATION');
});

test('oversized addressed diagnostics stay on a bounded no-model refusal path', () => {
  for (const [prefix, requestedTargetId] of [
    ['', 'control-tower'], ['', 'sovereign-commander'], ['/control-tower inspect ', 'everyone'],
    ['/sovereign ', 'everyone'], ['Sovereign Commander status ', 'everyone'],
  ]) {
    const classification = classifySovereignControlConversationV1({ prompt: prefix + 'x'.repeat(6001), requestedTargetId });
    assert.equal(classification.applies, true);
    assert.equal(classification.intent, 'INPUT_TOO_LONG');
    const value = reply({ classification });
    assert.equal(value.handoff, null);
    assert.equal(value.modelInvoked, false);
    assert.match(value.outputText, /6,000-character limit/);
    assert.doesNotMatch(value.outputText, /x{20}/);
  }
});

test('reachable service and stopped guardian remain separate facts without invented native success', () => {
  const result = reply();
  assert.equal(result.commander.reachable, true);
  assert.equal(result.commander.guardian.state, 'NO_NEXT_CYCLE');
  assert.match(result.outputText, /reachable.*no next cycle scheduled/);
  assert.match(result.outputText, /FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING/);
  assert.equal(result.modelInvoked, false);
  assert.equal(result.externalModelInvoked, false);
  assert.equal(result.nativeActionSubmitted, false);
  assert.equal(result.directParticipantDispatchProven, false);
  assert.equal(result.responder.label, 'Stephanos control');
  assert.equal(result.handoff, null);
  assert.equal(Object.isFrozen(result.commander.guardian), true);
  const degraded = reply({ commander: { ...health(), healthy: false } });
  assert.equal(degraded.commander.reachable, true);
  assert.equal(degraded.commander.healthy, false);
  assert.match(degraded.outputText, /reachable but reports degraded/);
});

test('stale, future, malformed and authority-bearing health cannot become current observations', () => {
  for (const change of [
    { observedAtUtc: '2026-10-31T11:58:00.000Z' }, { observedAtUtc: '2026-10-31T12:01:00.000Z' },
    { available: 'true' }, { readOnly: false }, { commanderMcpAccessGranted: true },
    { sourceMutationAllowed: true }, { healthy: 'true' }, { schemaVersion: 'forged' },
  ]) {
    const result = reply({ commander: { ...health(), ...change } });
    assert.equal(result.commander.observed, false, JSON.stringify(change));
    assert.equal(result.commander.guardian, null);
    assert.doesNotMatch(result.outputText, /Commander is reachable/);
  }
});

test('historical request remains historical while current poll waits, with no refreshed evidence time', () => {
  const prior = request();
  const result = reply({ controlTower: tower({ latestRequestObservation: prior, latestBuildRequestObservation: prior }) });
  assert.equal(result.controlTower.state, 'WAITING');
  assert.equal(result.controlTower.latestRequestObservation.observedAtUtc, prior.observedAtUtc);
  assert.equal(result.controlTower.latestRequestObservation.sourceHead, HEAD);
  assert.match(result.outputText, /Retained request control-tower-build-401-1 reports UNKNOWN/);
  assert.match(result.outputText, /no proven terminal outcome/);
});

test('one inert workflow handoff cannot turn a natural-language repair into native authority', () => {
  const result = reply({ classification: classifySovereignControlConversationV1({ prompt: 'Repair Stephanos', requestedTargetId: 'sovereign-commander' }) });
  assert.equal(result.handoff.state, 'NOT_SUBMITTED');
  assert.equal(result.handoff.operation, 'BUILD_NEXT_ELIGIBLE_GOAL');
  assert.equal(result.handoff.workflowUrl, CONTROL_TOWER_WORKFLOW_URL);
  assert.deepEqual(result.handoff.workflowInputs, { operation: 'BUILD_NEXT_ELIGIBLE_GOAL' });
  assert.equal(result.handoff.workflowRef, 'main');
  assert.equal(result.handoff.expiresAtUtc, '2026-10-31T12:10:00.000Z');
  assert.equal(result.handoff.requestSubmitted, false);
  assert.equal(result.handoff.executionAuthority, false);
  assert.equal(result.handoff.reusableAuthority, false);
  assert.equal(result.handoff.externalQuotaApplies, true);
  assert.match(result.outputText, /No action has been submitted/);
  assert.doesNotMatch(JSON.stringify(result), /authorization|Bearer|\/mcp|\/ignite/);
});

test('a completed inspection does not permit repeating an earlier unresolved build', () => {
  const prior = request();
  const inspection = request({ requestId: 'control-tower-build-402-1', runId: 402,
    state: 'OBSERVATION_COMPLETED', operation: 'OBSERVE_CONTROL_SYSTEM', blocker: '' });
  const result = reply({
    classification: classifySovereignControlConversationV1({ prompt: 'repair', requestedTargetId: 'control-tower' }),
    controlTower: tower({ latestRequestObservation: inspection, latestBuildRequestObservation: prior,
      latestControlSystemObservation: inspection }),
  });
  assert.equal(result.handoff.submissionBlockedReason, 'CONTROL_TOWER_REQUEST_OUTCOME_UNPROVEN');
  assert.equal(result.handoff.originalRequestId, prior.requestId);
  assert.equal(result.controlTower.latestRequestObservation.blocker, '');
  assert.match(result.outputText, /Earlier build request control-tower-build-401-1 still reports UNKNOWN/);
  assert.match(result.outputText, /newer inspection does not resolve/);
});

test('active maintenance blocks build handoff but read-only observation remains available', () => {
  const commander = health();
  commander.guardian.running = true;
  commander.guardian.operationalState = 'WORKING';
  for (const [prompt, expected] of [['repair', 'SOVEREIGN_MAINTENANCE_OWNER_BUSY'], ['inspect', '']]) {
    const result = reply({ commander,
      classification: classifySovereignControlConversationV1({ prompt, requestedTargetId: 'control-tower' }) });
    assert.equal(result.handoff.submissionBlockedReason, expected);
    assert.equal(result.handoff.requestSubmitted, false);
  }
});

test('legacy terminal ledger truth does not become an unresolved build because descriptive detail is absent', () => {
  const legacy = { schemaVersion: 'stephanos.control-tower-request-observation.v1',
    requestId: 'control-tower-build-401-1', runId: 401, runAttempt: 1,
    operation: '', sourceHead: '', acceptedAtUtc: '', observedAtUtc: '', state: 'UNKNOWN',
    blocker: 'CONTROL_TOWER_LEGACY_DETAIL_UNAVAILABLE', ledgerPhase: 'TERMINAL', terminalState: 'BLOCKED',
    detailState: 'LEGACY_DETAIL_UNAVAILABLE', historical: true, diagnosticOnly: true,
  };
  const classification = classifySovereignControlConversationV1({ prompt: 'prepare repair', requestedTargetId: 'control-tower' });
  const result = reply({ classification, controlTower: tower({ latestBuildRequestObservation: legacy, latestRequestObservation: legacy }) });
  assert.equal(result.controlTower.latestBuildRequestObservation.outcomeUnresolved, false);
  assert.equal(result.controlTower.latestBuildRequestObservation.observedAtUtc, '');
  assert.equal(result.handoff.submissionBlockedReason, '');
  assert.match(result.outputText, /original ledger is terminal \(BLOCKED\)/);
  assert.doesNotMatch(result.outputText, /do not repeat/);
  const invalid = { ...legacy, detailState: 'INVALID', blocker: 'CONTROL_TOWER_STORED_OBSERVATION_INVALID' };
  const held = reply({ classification, controlTower: tower({ latestBuildRequestObservation: invalid, latestRequestObservation: invalid }) });
  assert.equal(held.controlTower.latestBuildRequestObservation.outcomeUnresolved, true);
  assert.equal(held.handoff.submissionBlockedReason, 'CONTROL_TOWER_REQUEST_OUTCOME_UNPROVEN');
});

test('a guarded wake completion is not narrated as a finished goal build', () => {
  const result = reply({ controlTower: tower({ latestRequestObservation: request({ state: 'WAKE_COMPLETED', blocker: '' }) }) });
  assert.match(result.outputText, /wake completed.*material goal build still requires/);
  assert.equal(result.nativeActionSubmitted, false);
});

test('unknown fields, private strings and malformed request identity do not enter replies', () => {
  const commander = health();
  commander.secret = 'private-bearer-value';
  commander.guardian.lastBlocker = 'SECRET_UPPERCASE_VALUE';
  commander.guardian.lastSourceHead = { toString() { throw new Error('must not coerce'); } };
  const result = reply({ commander, controlTower: tower({
    blocker: 'SECRET_UPPERCASE_VALUE', secret: 'private-bearer-value',
    latestRequestObservation: request({ requestId: 'https://evil.invalid/submit' }),
  }) });
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /SECRET_UPPERCASE_VALUE|private-bearer-value|evil\.invalid/);
  assert.equal(result.controlTower.latestRequestObservation, null);
  assert.equal(result.commander.guardian.lastSourceHead, '');
});

test('native diagnostics reuse the closed idempotent public projector', () => {
  const result = reply({ controlTower: tower({ controlSystemStatus: {
    schemaVersion: 'stephanos.sovereign-control-system-status.v1', observedAtUtc: AT,
    observationOnly: true, observationCompleted: true, blocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
    source: { available: true, sourceHead: HEAD, stable: true },
    nativeRuntime: { available: true, qualificationObserved: false, observedAtUtc: AT,
      reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', sid: 'private-sid' },
    pid: 1234, path: 'private-path', token: 'private-token', executionAuthority: true,
  } }) });
  const diagnostic = result.controlTower.controlSystemStatus;
  assert.equal(diagnostic.observationCompleted, true);
  assert.equal(diagnostic.nativeRuntime.qualificationObserved, false);
  assert.match(result.outputText, /Runtime qualification observation: FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING/);
  assert.doesNotMatch(JSON.stringify(result), /private-sid|private-path|private-token|"pid"|"executionAuthority":true/);
});
