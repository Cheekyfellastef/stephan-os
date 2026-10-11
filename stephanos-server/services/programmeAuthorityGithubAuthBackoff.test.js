import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const programmeSourceUrl = new URL('./programmeAuthorityService.js', import.meta.url);
const authResolverSourceUrl = new URL('./githubAuthResolver.js', import.meta.url);

// Regression for PR #2318 review finding: GitHub goal-intake authentication
// resolution sits upstream of fetchGithubGoalIssues, so an unavailable/slow auth
// provider must not be invoked on every hot programme projection cycle. The
// canonical backoff now lives in the shared GitHub auth resolver so every caller
// benefits without duplicating controller-local caches.
test('programme authority inherits bounded unavailable GitHub auth resolution from the canonical resolver', async () => {
  const [programmeSource, resolverSource] = await Promise.all([
    readFile(programmeSourceUrl, 'utf8'),
    readFile(authResolverSourceUrl, 'utf8'),
  ]);

  assert.match(
    programmeSource,
    /resolveGithubTokenConfig/,
    'programme authority must continue to resolve GitHub auth through the canonical shared resolver',
  );
  assert.match(
    resolverSource,
    /GITHUB_AUTH_UNAVAILABLE_BACKOFF_MS/,
    'the shared GitHub auth resolver must define an explicit bounded unavailable-auth backoff contract',
  );
  assert.match(
    resolverSource,
    /unavailableGhCliAuthUntilMs/,
    'the shared GitHub auth resolver must retain unavailable-auth observation state outside one projection call',
  );
  assert.match(
    resolverSource,
    /Date\.now\(\) < unavailableGhCliAuthUntilMs/,
    'unavailable auth must carry an explicit retry boundary rather than retrying every controller heartbeat',
  );
});
