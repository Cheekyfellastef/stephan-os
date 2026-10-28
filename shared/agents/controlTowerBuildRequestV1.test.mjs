import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlTowerBuildRequestV1, validateControlTowerBuildRequestV1 } from './controlTowerBuildRequestV1.mjs';
import { inputs, fixture, HEAD, NOW } from './fixtures/controlTowerBuildV1.mjs';

test('owner dispatch can request only the next canonically eligible build, with no grant', () => {
  const { event, env } = inputs();
  const result = createControlTowerBuildRequestV1(event, env, HEAD, NOW);
  assert.equal(result.ok, true); assert.equal(result.request.operation, 'BUILD_NEXT_ELIGIBLE_GOAL');
  for (const flag of ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed'])
    assert.equal(result.request[flag], false);
  const f = fixture(); assert.equal(validateControlTowerBuildRequestV1(f.request, f.run, HEAD, NOW).ok, true);
});
test('PR, fork, rerun, foreign operator, workflow, job and source contexts cannot request a build', () => {
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_ACTOR_ID: '1' }, { GITHUB_ACTOR: 'attacker' },
    { GITHUB_WORKFLOW_REF: 'foreign/file@main' }, { GITHUB_JOB: 'contract-test' },
    { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_RUN_ID: '1.5' }]) {
    const { event, env } = inputs(); Object.assign(env, patch);
    assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
  }
  const { event, env } = inputs(); event.repository.id = 1;
  assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
});
test('caller operations, shell, scopes, routes and goal grants are never dispatch inputs', () => {
  for (const key of ['operation', 'command', 'path', 'goal_issue', 'route', 'admissionGranted']) {
    const { event, env } = inputs(); event.inputs[key] = 'anything';
    assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).blocker, 'BUILD_DISPATCH_INPUTS_FORBIDDEN');
  }
});
test('authority flags, unknown fields, expiry and source substitution are rejected at native readback', () => {
  const f = fixture();
  for (const patch of [{ admissionGranted: true }, { mergeAuthority: true }, { arbitraryShellAllowed: true },
    { command: 'anything' }, { sourceHead: 'b'.repeat(40) }, { runId: 101 }, { runAttempt: 2 },
    { expiresAtUtc: '2026-10-29T12:00:05.000Z' }, { createdAtUtc: 'invalid' }])
    assert.equal(validateControlTowerBuildRequestV1({ ...f.request, ...patch }, f.run, HEAD, NOW).ok, false);
  assert.equal(validateControlTowerBuildRequestV1(f.request, f.run, HEAD, '2026-10-28T12:11:00.000Z').ok, false);
});
test('authenticated run identity cannot be replaced by a familiar artifact name', () => {
  for (const patch of [{ actor: { login: 'Cheekyfellastef', id: 1 } }, { triggering_actor: { login: 'Cheekyfellastef' } },
    { repository: { full_name: 'Cheekyfellastef/stephan-os', id: 1 } }, { event: 'push' }, { run_attempt: 2 }]) {
    const f = fixture(); assert.equal(validateControlTowerBuildRequestV1(f.request, { ...f.run, ...patch }, HEAD, NOW).ok, false);
  }
});
