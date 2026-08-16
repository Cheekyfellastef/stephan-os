import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../.github/workflows/battle-bridge-tailscale-bootstrap-pipe.yml', import.meta.url);
const runnerUrl = new URL('./battle-bridge-tailscale-bootstrap-pipe.mjs', import.meta.url);

test('workflow keeps live bootstrap on owner-authored issue 1507 with minimal permissions', async () => {
  const source = await readFile(workflowUrl, 'utf8');
  assert.match(source, /issue_comment:/);
  assert.match(source, /github\.event\.issue\.number == 1507/);
  assert.match(source, /github\.actor == 'Cheekyfellastef'/);
  assert.match(source, /```stephanos-battle-bridge-tailscale-bootstrap/);
  assert.match(source, /permissions:\n  contents: read/);
  assert.match(source, /bootstrap-canonical-github-sync:[\s\S]*permissions:[\s\S]*contents: read[\s\S]*id-token: write/);
  assert.doesNotMatch(source, /issues:\s*write|pull-requests:\s*write|contents:\s*write|actions:\s*write/);
});

test('workflow uses fixed Tailscale identity and no caller-selected remote command', async () => {
  const source = await readFile(workflowUrl, 'utf8');
  assert.match(source, /uses: tailscale\/github-action@v4/);
  assert.match(source, /tags: tag:stephanos-github-recovery/);
  assert.match(source, /TS_OAUTH_CLIENT_ID/);
  assert.match(source, /TS_AUDIENCE/);
  assert.match(source, /STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST/);
  assert.match(source, /STEPHANOS_BATTLE_BRIDGE_SSH_PRIVATE_KEY/);
  assert.match(source, /STEPHANOS_BATTLE_BRIDGE_SSH_KNOWN_HOSTS/);
  assert.match(source, /StrictHostKeyChecking=yes/);
  assert.match(source, /IdentitiesOnly=yes/);
  assert.match(source, /encoded-command "\$EXPECTED_HEAD"/);
  assert.doesNotMatch(source, /workflow_dispatch|repository_dispatch/);
  assert.doesNotMatch(source, /\$\{\{\s*github\.event\.comment\.body\s*\}\}[^\n]*ssh/);
});

test('runner exposes only validate-event, encoded-command and validate-receipt modes', async () => {
  const source = await readFile(runnerUrl, 'utf8');
  assert.match(source, /mode === 'validate-event'/);
  assert.match(source, /mode === 'encoded-command'/);
  assert.match(source, /mode === 'validate-receipt'/);
  assert.doesNotMatch(source, /mode === ['"](?:run|exec|shell|powershell|command)['"]/i);
  assert.doesNotMatch(source, /spawn|execFile|execSync|spawnSync/);
});
