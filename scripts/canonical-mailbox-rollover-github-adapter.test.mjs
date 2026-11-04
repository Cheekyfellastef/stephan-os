import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCanonicalMailboxRolloverGitHubAdapter } from './canonical-mailbox-rollover-github-adapter.mjs';
import { CANONICAL_MAILBOX_ISSUE as current } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { CANONICAL_MAILBOX_ROLLOVER_STATE_MARKER as marker, observeCanonicalMailboxRollover } from '../shared/agents/canonicalMailboxRolloverConsumerV1.mjs';
const context = { repo: { owner: 'Cheekyfellastef', repo: 'stephan-os' }, eventName: 'issue_comment' };
function fixture() {
  const comments = [], calls = [], issues = new Map();
  const make = number => ({ number, user: { login: 'Cheekyfellastef' }, state: 'open', locked: false,
    comments: 2200, body: '', repository_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os',
    html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/${number}` });
  issues.set(current, make(current));
  const github = {
    paginate: async () => comments,
    rest: { issues: {
      get: async args => ({ data: issues.get(args.issue_number) }),
      listForRepo: async args => { calls.push(['list', args]); return { data: [...issues.values()].sort((a,b) => b.number-a.number) }; },
      create: async args => { calls.push(['create', args]); const created = { ...make(current + 1000), ...args, user: { login: 'github-actions[bot]' } }; issues.set(created.number, created); return { data: created }; },
      listComments: () => {},
      createComment: async args => { calls.push(['createComment', args]); return { data: { id: 10, body: args.body, user: { login: 'github-actions[bot]' } } }; },
      updateComment: async args => { calls.push(['updateComment', args]); return { data: {} }; },
    } },
  };
  return { github, calls, comments, issues, adapter: createCanonicalMailboxRolloverGitHubAdapter({ github, context }) };
}
test('REST adapter provisions one inactive successor and reuses it on the next cycle', async () => {
  const f = fixture();
  const first = await observeCanonicalMailboxRollover({ sourceHead: 'a'.repeat(40), adapter: f.adapter });
  assert.equal(first.successorCreated, true);
  const second = await observeCanonicalMailboxRollover({ sourceHead: 'a'.repeat(40), adapter: f.adapter });
  assert.equal(second.successorCreated, false);
  assert.equal(f.calls.filter(x => x[0] === 'create').length, 1);
  assert.equal(f.calls.filter(x => x[0] === 'createComment').length, 1);
  assert.ok(f.calls.filter(x => /Comment/.test(x[0])).every(x => x[1].issue_number === 2315 || x[1].comment_id === 10));
});
test('REST enumeration failure or cap cannot pretend discovery is complete', async () => {
  const f = fixture();
  f.github.rest.issues.listForRepo = async () => ({ data: Array.from({length:100}, (_,i) => ({ number: current+1000-i })) });
  assert.equal((await f.adapter.listNewerIssues(current)).complete, false);
});
test('capacity state ignores attacker comments and refuses ambiguous bot records', async () => {
  const f = fixture(); const body = `<!-- ${marker} predecessor=${current} -->\nintent`;
  f.comments.push({ id: 1, user: { login: 'attacker' }, body });
  assert.equal(await f.adapter.readProvisioningIntent(), false);
  f.comments.push(...[2,3].map(id => ({ id, user: { login: 'github-actions[bot]' }, body })));
  await assert.rejects(() => f.adapter.readProvisioningIntent(), /STATE_AMBIGUOUS/);
});
test('malformed persistent state is a hold rather than authority to create again', async () => {
  const f = fixture();
  f.comments.push({ id: 1, user: { login: 'github-actions[bot]' }, body: `<!-- ${marker} predecessor=${current} -->\nunknown` });
  const r = await observeCanonicalMailboxRollover({ sourceHead: 'a'.repeat(40), adapter: f.adapter });
  assert.equal(r.blocker, 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN');
  assert.equal(f.calls.filter(x => x[0] === 'create').length, 0);
});
test('foreign repository and PR event cannot acquire the workflow adapter', () => {
  for (const c of [{ ...context, eventName: 'pull_request' }, { ...context, repo: { owner: 'attacker', repo: 'stephan-os' } }]) {
    assert.throws(() => createCanonicalMailboxRolloverGitHubAdapter({ context: c, github: {} }), /CONTEXT_INVALID/);
  }
});
test('observer reuses serialized mirror after receipt publication without a new schedule or permission', () => {
  const workflow = readFileSync(new URL('../.github/workflows/mailbox-receipt-index.yml', import.meta.url), 'utf8');
  assert.match(workflow, /mailbox-receipt-index-\$\{\{ github.event.pull_request.number \|\| 'mirror' \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /schedule:|contents: write|actions: write/);
  assert.ok(workflow.indexOf('Updated receipt truth issue') < workflow.indexOf('- name: Observe capacity'));
  assert.ok(workflow.indexOf('canonical-mailbox-workflow-event-gate.mjs receipt') < workflow.indexOf('- name: Observe capacity'));
});
