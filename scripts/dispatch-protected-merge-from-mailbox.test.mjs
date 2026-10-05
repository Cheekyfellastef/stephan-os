import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const base = 'c'.repeat(40);
const commentId = 123456789;
const command = () => ({
  schemaVersion: 'stephanos.protected-workflow-dispatch.v1',
  requestId: 'owner-dispatch-regression-001',
  operation: 'DISPATCH_PROTECTED_OPERATOR_MERGE', repository, issueNumber: 2590,
  operatorApproval: 'operator-approved', expiresAt: new Date(Date.now() + 300_000).toISOString(),
  mode: 'user-owned-protected-squash', prNumber: 2776,
  expectedBranch: 'codex/foreman-qa-relay-publication-recovery',
  expectedHead: head, expectedHeadTree: tree, expectedBase: base,
  independentReviewRunId: 1, independentReviewRunAttempt: 1, independentReviewArtifactId: 2,
  independentReviewArtifactDigest: `sha256:${'d'.repeat(64)}`,
  independentReviewPayloadSha256: 'e'.repeat(64),
});

function runMailbox({ draft = false, observedHead = head, author = 'Cheekyfellastef', expired = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'stephanos-mailbox-test-'));
  try {
    const c = command();
    if (expired) c.expiresAt = new Date(Date.now() - 1000).toISOString();
    const eventPath = path.join(root, 'event.json');
    const callsPath = path.join(root, 'calls.jsonl');
    const preload = path.join(root, 'fetch.mjs');
    writeFileSync(eventPath, JSON.stringify({ issue: { number: 2590 }, comment: {
      id: commentId, user: { login: author }, created_at: new Date(Date.now() - 2000).toISOString(),
      body: '```stephanos-protected-workflow-dispatch\n' + JSON.stringify(c) + '\n```',
    } }));
    const pull = { number: c.prNumber, state: 'open', merged: false, draft, node_id: 'PR_test',
      head: { ref: c.expectedBranch, sha: observedHead, repo: { full_name: repository } },
      base: { ref: 'main', sha: base, repo: { full_name: repository } } };
    writeFileSync(preload, `import { appendFileSync } from 'node:fs';
      globalThis.fetch = async (url, options = {}) => {
        const call = { url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null };
        appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(call) + '\\n');
        let payload;
        let status = 200;
        if (call.url.endsWith('/pulls/2776') && call.method === 'GET') payload = ${JSON.stringify(pull)};
        else if (call.url.endsWith('/branches/main') && call.method === 'GET') payload = { commit: { sha: '${base}' } };
        else if (call.url.endsWith('/git/commits/${head}') && call.method === 'GET') payload = { tree: { sha: '${tree}' } };
        else if (call.url.endsWith('/issues/2590/comments') && call.method === 'POST') { payload = { id: 42 }; status = 201; }
        else throw new Error('Unexpected mutation or endpoint: ' + call.method + ' ' + call.url);
        return { status, text: async () => JSON.stringify(payload) };
      };`);
    const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
      fileURLToPath(new URL('./dispatch-protected-merge-from-mailbox.mjs', import.meta.url))], {
      encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', GITHUB_TOKEN: 'test-only', GITHUB_EVENT_PATH: eventPath },
    });
    let calls = [];
    try { calls = readFileSync(callsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch {}
    return { ...result, calls, command: c };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('an authorized exact ready PR yields the canonical owner request without launching a bot gate', () => {
  const result = runMailbox();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.verdict, 'PROTECTED_MERGE_OWNER_DISPATCH_REQUIRED');
  assert.equal(output.receipt.ownerDispatchRequired, true);
  const request = output.receipt.ownerDispatchRequest;
  assert.equal(request.path, `/repos/${repository}/actions/workflows/operator-merge-approval-gate.yml/dispatches`);
  assert.equal(request.body.ref, 'main');
  assert.equal(request.body.inputs.authorization_comment_id, String(commentId));
  assert.equal(request.body.inputs.expected_head, head);
  assert.equal(request.body.inputs.expected_head_tree, tree);
  assert.equal(request.body.inputs.expected_base, base);
  assert.equal(request.body.inputs.independent_review_artifact_id, '2');
  assert.equal(output.receipt.directMainWriteAllowed, false);
  assert.equal(output.receipt.deploymentAuthority, false);
  assert.deepEqual(result.calls.filter(call => call.method !== 'GET').map(call => call.url),
    [`https://api.github.com/repos/${repository}/issues/2590/comments`]);
  const published = result.calls.find(call => call.method === 'POST').body.body;
  assert.ok(published.includes('PROTECTED_MERGE_OWNER_DISPATCH_REQUIRED'));
  assert.ok(published.includes('ownerDispatchRequest'));
  assert.ok(!published.includes('test-only'));
});

for (const [name, options, blocker] of [
  ['draft PR', { draft: true }, 'PROTECTED_WORKFLOW_DISPATCH_PR_NOT_READY'],
  ['changed head', { observedHead: 'f'.repeat(40) }, 'PROTECTED_WORKFLOW_DISPATCH_PR_HEAD_CHANGED'],
  ['expired command', { expired: true }, 'PROTECTED_WORKFLOW_DISPATCH_EXPIRED'],
]) test(`${name} cannot publish an executable handoff or launch a gate`, () => {
  const result = runMailbox(options);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).blocker, blocker);
  assert.equal(result.calls.filter(call => call.method !== 'GET').length, 0);
});

test('a non-owner comment cannot publish a handoff or launch a gate', () => {
  const result = runMailbox({ author: 'github-actions[bot]' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).verdict, 'PROTECTED_WORKFLOW_DISPATCH_IGNORED');
  assert.equal(result.calls.length, 0);
});
