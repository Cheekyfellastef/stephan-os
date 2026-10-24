import assert from 'node:assert/strict';

// Pure, read-only behavioral oracle. The task runner supplies the actual planner;
// unit tests supply implementations with deliberate defects. No runtime authority.
export function assertLegacyGoalDeclaredTestAcceptanceV1(planner) {
  const repo = 'Cheekyfellastef/stephan-os';
  const resource = path => `repo:cheekyfellastef/stephan-os:path:${path}`;
  const plan = (resources, requiredTests) => {
    const goal = { issue: 2314, title: 'Bounded source verification task', lifecycle: 'READY',
      route: 'CHATGPT_GITHUB', repository: repo, resourceIds: resources };
    const scheduler = { schemaVersion: 'stephanos.mission-scheduler.v1', readOnly: true, failClosed: false,
      activeGoals: [], elasticCapacity: { status: 'RUNNING', desiredWidth: 5, remainingAdmissionSlots: 5 },
      parallelCandidateDetails: [{ candidateId: '#2314', issue: 2314, route: goal.route, resourceIds: resources }], portfolio: [goal] };
    const record = { schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
      goalId: 'goal-2314', issueNumber: 2314, repository: repo, resourceIds: resources,
      source: 'github-goal-estate-mirror', mirrorSchema: 'stephanos.github-goal-mirror.v1',
      mirrorIssueNumber: 2314, mirrorRepository: repo, mirrorBuildPickupAllowed: true,
      githubAdmissionState: 'ADMISSION_PROVEN', requiredTests };
    return planner(scheduler, [], { goalRecords: requiredTests ? [record] : [] });
  };
  const resources = [resource('shared/agents/example.mjs'), resource('scripts/declared.test.mjs'),
    resource('stephanos-server/services/another.test.js')];
  const result = plan(resources);
  assert.equal(result.admitted.length, 1);
  assert.deepEqual(result.admitted[0].missionInput.requiredTests,
    ['npm run stephanos:verify', 'node --test scripts/declared.test.mjs',
      'node --test stephanos-server/services/another.test.js']);
  assert.deepEqual(result.admitted[0].resourceIds, [...resources].sort());
  for (const scope of [[resource('shared/agents/example.mjs')], [resource('shared/agents')], ['repo:cheekyfellastef/stephan-os']]) {
    const broad = plan(scope);
    assert.equal(broad.admitted.length, 1);
    assert.deepEqual(broad.admitted[0].missionInput.requiredTests, ['npm run stephanos:verify']);
    assert.equal(broad.mergeAuthority, false);
  }
  const explicit = plan(resources, ['node --test scripts/independent.test.mjs']);
  assert.equal(explicit.admitted.length, 1);
  assert.deepEqual(explicit.admitted[0].missionInput.requiredTests,
    ['npm run stephanos:verify', 'node --test scripts/independent.test.mjs']);
  assert.equal(explicit.admitted[0].missionInput.allowedFiles.some(path => path.includes('independent.test.mjs')), false);
  const overlarge = plan(Array.from({length: 17}, (_, i) => resource(`scripts/declared${i}.test.mjs`)));
  assert.equal(overlarge.admitted.length, 0, 'An overlarge legacy plan must hold its goal, not truncate acceptance');
  assert.ok(overlarge.held.length > 0);
}
