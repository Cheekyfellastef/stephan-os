import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CANONICAL_MAILBOX_ISSUE as current, CANONICAL_MAILBOX_ROTATION_THRESHOLD_COMMENTS as threshold } from './canonicalMailboxAuthorityV1.mjs';
import {
  observeCanonicalMailboxRollover, evaluateCanonicalMailboxSuccessorCandidate,
  canonicalMailboxSuccessorBody, buildCanonicalMailboxCapacityStateBody,
} from './canonicalMailboxRolloverConsumerV1.mjs';
const head = 'a'.repeat(40);
const next = current + 1000;
const issue = (number, overrides = {}) => ({ number,
  repository_url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os',
  html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/${number}`,
  user: { login: 'Cheekyfellastef' }, state: 'open', locked: false,
  body: number === current ? '' : canonicalMailboxSuccessorBody(), comments: threshold,
  ...overrides,
});
function fixture({ candidates = [issue(next)], count = threshold } = {}) {
  const calls = []; let intent = false;
  const adapter = {
    getIssue: async number => { calls.push(['get', number]); return issue(number, number === current ? { comments: count } : {}); },
    listNewerIssues: async () => ({ complete: true, issues: candidates }),
    readProvisioningIntent: async () => intent,
    beginProvisioning: async () => { calls.push(['intent']); intent = true; },
    createInactiveSuccessor: async data => { calls.push(['create', data]); return issue(next); },
    publishState: async status => { calls.push(['publish', status]); },
  };
  return { adapter, calls, setIntent: () => { intent = true; } };
}
const run = f => observeCanonicalMailboxRollover({ sourceHead: head, adapter: f.adapter });

test('below threshold observes only and performs no listing or mutation', async () => {
  const f = fixture({ count: threshold - 1 });
  f.adapter.listNewerIssues = () => { throw Error('must not list'); };
  assert.equal((await run(f)).state, 'HEALTHY');
  assert.deepEqual(f.calls, [['get', current]]);
});
test('threshold nominates the existing successor without creating another', async () => {
  const f = fixture(); const r = await run(f);
  assert.equal(r.successorIssue, next); assert.equal(r.successorCreated, false);
  assert.equal(r.cutoverReady, false); assert.equal(r.commandAuthorityChanged, false);
  assert.equal(r.executionBlocker, 'CANONICAL_MAILBOX_PROTECTED_CUTOVER_NOT_COMMISSIONED');
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
  for (const key of ['sourceMutationAuthority', 'runtimeMutationAuthority', 'mergeAuthority']) assert.equal(r[key], false);
});
test('one durable intent precedes one inert creation and authenticated readback', async () => {
  const f = fixture({ candidates: [] }); const r = await run(f);
  assert.equal(r.successorCreated, true);
  assert.deepEqual(f.calls.map(c => c[0]), ['get', 'intent', 'create', 'get', 'publish']);
  assert.match(f.calls[2][1].body, /NO COMMAND AUTHORITY/);
});
test('lost create response leaves durable intent and never creates twice', async () => {
  const f = fixture({ candidates: [] });
  f.adapter.createInactiveSuccessor = async () => { f.calls.push(['create']); throw Error('response lost'); };
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN');
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN');
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 1);
});
test('intent write failure cannot cause issue creation', async () => {
  const f = fixture({ candidates: [] }); f.adapter.beginProvisioning = async () => { throw Error('denied'); };
  assert.equal((await run(f)).ok, false);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
});
test('lost response can recover a subsequently enumerated successor without replay', async () => {
  const f = fixture(); f.setIntent();
  assert.equal((await run(f)).successorIssue, next);
  assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
});
test('an existing nomination removed from discovery fails closed', async () => {
  const f = fixture({ candidates: [] }); f.setIntent();
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_CREATE_OUTCOME_UNKNOWN');
});
test('duplicate nominations block without choosing or creating', async () => {
  const f = fixture({ candidates: [issue(next), issue(next + 1)] });
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_MULTIPLE_SUCCESSORS');
  assert.deepEqual(f.calls, [['get', current]]);
});
for (const [name, override] of Object.entries({ closed: { state: 'closed' }, locked: { locked: true }, foreign: { user: { login: 'attacker' } }, pr: { pull_request: {} }, wrongRepository: { repository_url: 'https://api.github.com/repos/other/repo' } })) {
  test(`${name} nominated successor blocks instead of creating a replacement`, async () => {
    const f = fixture(); f.adapter.getIssue = async number => issue(number, number === current ? {} : override);
    assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_IDENTITY_UNVERIFIED');
    assert.equal(f.calls.filter(c => c[0] === 'create').length, 0);
  });
}
test('forged or malformed nomination is a hold, never a second creation', async () => {
  const f = fixture({ candidates: [issue(next, { body: canonicalMailboxSuccessorBody().replace('state=INACTIVE', 'state=ACTIVE') })] });
  f.adapter.getIssue = async number => number === current ? issue(current) : f.adapter.listNewerIssues().then(r => r.issues[0]);
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_MARKER_UNVERIFIED');
});
test('incomplete enumeration has no provisioning authority', async () => {
  const f = fixture(); f.adapter.listNewerIssues = async () => ({ complete: false, issues: [] });
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_SUCCESSOR_ENUMERATION_INCOMPLETE');
});
test('same, retired, older and non-integer successors are rejected', () => {
  for (const number of [current, 1507, current - 1, 0, next + 0.5, String(next)]) assert.equal(evaluateCanonicalMailboxSuccessorCandidate(issue(number)).ok, false);
});
test('explicit self-number marker and governed workflow principal are accepted as inert only', () => {
  const r = evaluateCanonicalMailboxSuccessorCandidate(issue(next, {
    user: { login: 'github-actions[bot]' },
    body: canonicalMailboxSuccessorBody().replace(`predecessor=${current}`, `predecessor=${current} successor=${next}`),
  })); assert.equal(r.ok, true); assert.equal(r.cutoverReady, false);
});
test('a candidate carrying executable command content is rejected', () => {
  const r = evaluateCanonicalMailboxSuccessorCandidate(issue(next, { body: canonicalMailboxSuccessorBody() + '\n```stephanos-battle-bridge-command\n{}\n```' }));
  assert.equal(r.blocker, 'CANONICAL_MAILBOX_SUCCESSOR_MARKER_UNVERIFIED');
});
test('invalid count and current owner never reach provisioning', async () => {
  const f = fixture({ count: -1 }); assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_COMMENT_COUNT_INVALID');
  f.adapter.getIssue = async () => issue(current, { user: { login: 'attacker' } });
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_CURRENT_IDENTITY_UNVERIFIED');
});
test('no authenticated adapter or exact source means no mutation', async () => {
  assert.equal((await observeCanonicalMailboxRollover({})).ok, false);
  assert.equal((await observeCanonicalMailboxRollover({ sourceHead: 'main', adapter: fixture().adapter })).ok, false);
});
test('readback failure never produces a provisioned verdict', async () => {
  const f = fixture({ candidates: [] }); f.adapter.getIssue = async number => { if (number !== current) throw Error('lost'); return issue(current); };
  assert.equal((await run(f)).ok, false);
});
test('durable publication failure cannot be mistaken for successful commissioning', async () => {
  const f = fixture(); f.adapter.publishState = async () => { throw Error('write failed'); };
  assert.equal((await run(f)).blocker, 'CANONICAL_MAILBOX_CAPACITY_STATE_PUBLICATION_FAILED');
});
test('capacity state preserves exact head and every unsatisfied live gate', async () => {
  const r = await run(fixture()); const body = buildCanonicalMailboxCapacityStateBody(r);
  assert.match(body, /MAILBOX_ROTATION_REQUIRED/); assert.match(body, new RegExp(head));
  assert.match(body, /ALL_PRODUCER_FREEZE_ACKNOWLEDGEMENTS/);
  assert.match(body, /CROSS_EPOCH_DEDUPLICATION_AND_RECEIPT_ONLY_DUAL_READ/);
  assert.throws(() => buildCanonicalMailboxCapacityStateBody({}), /CAPACITY_STATE_INVALID/);
});

test('A→B→C preparation derives each epoch solely from changed canonical authority', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stephanos-mailbox-epoch-test-'));
  assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const authority = await readFile(new URL('./canonicalMailboxAuthorityV1.mjs', import.meta.url), 'utf8');
  const consumer = await readFile(new URL('./canonicalMailboxRolloverConsumerV1.mjs', import.meta.url), 'utf8');
  const planner = await readFile(new URL('./canonicalMailboxRolloverPlannerV1.mjs', import.meta.url), 'utf8');
  for (const [i, epoch] of [current, next, next + 1000].entries()) {
    const suffix = `-${i}`;
    const authorityName = `authority${suffix}.mjs`, plannerName = `planner${suffix}.mjs`;
    await writeFile(join(dir, authorityName), authority.replace(`CANONICAL_MAILBOX_ISSUE = ${current}`, `CANONICAL_MAILBOX_ISSUE = ${epoch}`));
    await writeFile(join(dir, plannerName), planner.replaceAll('./canonicalMailboxAuthorityV1.mjs', `./${authorityName}`));
    const consumerName = `consumer${suffix}.mjs`;
    await writeFile(join(dir, consumerName), consumer.replaceAll('./canonicalMailboxAuthorityV1.mjs', `./${authorityName}`).replaceAll('./canonicalMailboxRolloverPlannerV1.mjs', `./${plannerName}`));
    const module = await import(pathToFileURL(join(dir, consumerName)).href);
    const future = epoch + 1000;
    let creations = 0;
    const epochIssue = number => ({ ...issue(number), user: { login: i ? 'github-actions[bot]' : 'Cheekyfellastef' }, body: number === epoch ? '' : module.canonicalMailboxSuccessorBody() });
    const r = await module.observeCanonicalMailboxRollover({ sourceHead: head, adapter: {
      getIssue: async number => epochIssue(number),
      listNewerIssues: async () => ({ complete: true, issues: [epochIssue(future)] }),
      readProvisioningIntent: async () => false,
      beginProvisioning: async () => {}, createInactiveSuccessor: async () => { creations++; },
      publishState: async () => {},
    } });
    assert.equal(r.currentIssue, epoch); assert.equal(r.successorIssue, future);
    assert.equal(r.cutoverReady, false); assert.equal(creations, 0);
  }
});
