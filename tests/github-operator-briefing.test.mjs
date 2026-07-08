import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildGitHubOperatorBriefing } from '../shared/agents/githubOperatorBriefing.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/github-operator-assistant/input.json', import.meta.url), 'utf8'));

test('briefing preserves blockers and recognizes active implementation PRs', () => {
  const briefing = buildGitHubOperatorBriefing(fixture);
  assert.equal(briefing.pullRequests.find((pr) => pr.number === 1448).status, 'ready');
  assert.deepEqual(briefing.pullRequests.find((pr) => pr.number === 1444), {
    number: 1444,
    title: 'Runtime blocked implementation',
    status: 'blocked',
    reason: 'runtime-blocked',
  });
  assert.equal(briefing.pullRequests.find((pr) => pr.number === 1447).reason, 'claimed-head drift blocked');
  const issue = briefing.issues.find((candidate) => candidate.number === 1286);
  assert.equal(issue.status, 'waiting-for-review');
  assert.deepEqual(issue.activeImplementationPrs, [1449]);
});

test('active implementation PR without review evidence is implementation-in-progress', () => {
  const input = { pullRequests: [{ number: 1449, state: 'open', body: 'Implements #1286' }], issues: [{ number: 1286 }] };
  const issue = buildGitHubOperatorBriefing(input).issues[0];
  assert.equal(issue.status, 'implementation-in-progress');
});
