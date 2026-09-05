import test from 'node:test';
import assert from 'node:assert/strict';
import { readGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';

test('GitHub telemetry deadline remains active while parsing a stalled response body', async () => {
  const startedAt = Date.now();
  const telemetry = await readGithubTelemetry({
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'bounded-token' },
    secretStoreToken: '',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => new Promise(() => {}),
    }),
    requestTimeoutMs: 20,
  });

  assert.equal(telemetry.status, 'adapter_error');
  assert.match(telemetry.blockers[0], /GitHub telemetry request timed out/);
  assert.equal(Date.now() - startedAt < 500, true);
  assert.equal(JSON.stringify(telemetry).includes('bounded-token'), false);
});
