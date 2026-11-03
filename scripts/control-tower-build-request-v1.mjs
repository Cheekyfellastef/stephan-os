import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createControlTowerBuildRequestV1, CONTROL_TOWER_BUILD_FILE } from '../shared/agents/controlTowerBuildRequestV1.mjs';
import { readMailboxFreeGitHubJsonV1 } from '../shared/agents/mailboxFreeGitHubEvidenceReaderV1.mjs';

export async function stageControlTowerBuildRequestV1({ env = process.env, now = () => new Date().toISOString() } = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const first = await readMailboxFreeGitHubJsonV1(fetch, '/git/ref/heads/main', env.GITHUB_TOKEN);
  const prepared = createControlTowerBuildRequestV1(event, env, first?.object?.sha, now());
  if (!prepared.ok) throw Error(prepared.blocker);
  const last = await readMailboxFreeGitHubJsonV1(fetch, '/git/ref/heads/main', env.GITHUB_TOKEN);
  if (first.ref !== 'refs/heads/main' || last.ref !== first.ref || last.object?.sha !== prepared.request.sourceHead)
    throw Error('BUILD_DISPATCH_MAIN_MOVED');
  writeFileSync(join(env.RUNNER_TEMP, CONTROL_TOWER_BUILD_FILE), JSON.stringify(prepared.request) + '\n', { mode: 0o600 });
  process.stdout.write('CONTROL_TOWER_BUILD_REQUEST_STAGED=' + prepared.request.requestId + '\n');
  return prepared.request;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stageControlTowerBuildRequestV1().catch(() => {
    process.stderr.write('CONTROL_TOWER_BUILD_REQUEST_FAILED\n'); process.exitCode = 1;
  });
}
