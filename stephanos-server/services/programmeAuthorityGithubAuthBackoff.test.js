import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('./programmeAuthorityService.js', import.meta.url);

// Regression for PR #2318 review finding: GitHub goal-intake authentication
// resolution sits upstream of fetchGithubGoalIssues, so an unavailable/slow auth
// provider must not be invoked on every hot programme projection cycle.
test('programme authority bounds repeated unavailable GitHub auth resolution', async () => {
  const source = await readFile(sourceUrl, 'utf8');

  assert.match(
    source,
    /GITHUB_GOAL_(?:ESTATE_)?AUTH_(?:FAILURE_)?BACKOFF_MS/,
    'programme authority must define an explicit bounded GitHub goal-auth backoff contract',
  );
  assert.match(
    source,
    /githubGoal(?:Estate)?Auth(?:Failure)?Cache/i,
    'programme authority must retain unavailable-auth observation state outside a single projection call',
  );
  assert.match(
    source,
    /nextRetryAtMs|retryAfterMs|backoffUntilMs/,
    'unavailable auth must carry an explicit retry boundary rather than retrying every controller heartbeat',
  );
});
