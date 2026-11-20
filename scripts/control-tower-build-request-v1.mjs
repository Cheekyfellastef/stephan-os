import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createControlTowerBuildRequestV1, CONTROL_TOWER_BUILD_FILE } from '../shared/agents/controlTowerBuildRequestV1.mjs';
import { readMailboxFreeGitHubJsonV1 } from '../shared/agents/mailboxFreeGitHubEvidenceReaderV1.mjs';
import { CANONICAL_MAILBOX_ISSUE } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';

export async function stageControlTowerBuildRequestV1({ env = process.env, now = () => new Date().toISOString(),
  fetchImpl = globalThis.fetch } = {}) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const get = path => readMailboxFreeGitHubJsonV1(fetchImpl, path, env.GITHUB_TOKEN);
  const first = await get('/git/ref/heads/main');
  let readback = null;
  if (env.GITHUB_EVENT_NAME === 'issue_comment') {
    if (!Number.isSafeInteger(event.comment?.id) || event.comment.id <= 0) throw Error('CONTROL_TOWER_OWNER_COMMENT_ID_INVALID');
    const comment = await get('/issues/comments/' + event.comment.id);
    const issue = await get('/issues/' + CANONICAL_MAILBOX_ISSUE);
    readback = { comment, issue,
      bodySha256: createHash('sha256').update(typeof comment.body === 'string' ? comment.body : '').digest('hex') };
  }
  const prepared = createControlTowerBuildRequestV1(event, env, first?.object?.sha, now(), readback);
  if (!prepared.ok) throw Error(prepared.blocker);
  const last = await get('/git/ref/heads/main');
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
