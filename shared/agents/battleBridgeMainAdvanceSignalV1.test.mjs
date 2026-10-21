import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES,
  createBattleBridgeMainAdvanceSignal,
  readMergedMainAdvanceSignalV1,
  validateBattleBridgeMainAdvanceSignal,
} from './battleBridgeMainAdvanceSignalV1.mjs';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';

const HEAD = 'a'.repeat(40);
const MERGED_AT = '2026-08-18T10:45:00Z';

function validSignal(overrides = {}) {
  return createBattleBridgeMainAdvanceSignal({
    prNumber: 1877,
    mainHead: HEAD,
    mergedAtUtc: MERGED_AT,
    workflowRunId: '32000000001',
    ...overrides,
  });
}

test('main advance signal is exact-head, signal-only and grants no mutation authority', () => {
  const signal = validSignal();
  assert.equal(signal.repository, 'Cheekyfellastef/stephan-os');
  assert.equal(signal.issueNumber, CANONICAL_MAILBOX_ISSUE);
  assert.equal(signal.branch, 'main');
  assert.equal(signal.event, 'PULL_REQUEST_MERGED');
  assert.equal(signal.mainHead, HEAD);
  assert.equal(signal.mergedAtUtc, '2026-08-18T10:45:00.000Z');
  assert.equal(signal.syncIntervalMinutes, 1);
  assert.equal(signal.signalOnly, true);
  assert.equal(signal.syncAuthorityGranted, false);
  assert.equal(signal.runtimeMutationAuthorityGranted, false);
  assert.equal(signal.arbitraryShellAllowed, false);
  assert.equal(signal.destructiveGitAllowed, false);
  assert.deepEqual(signal.lifecycle, [
    'MERGED',
    'SIGNAL_SENT',
    'SYNC_OBSERVED',
    'SAFE_FF_APPLIED_OR_BLOCKED',
    'POST_SYNC_REFRESH',
    'EXACT_HEAD_RUNTIME_PROVED',
  ]);
  assert.equal(validateBattleBridgeMainAdvanceSignal({ ...signal }).ok, true);
});

test('signal validation accepts GitHub second-resolution UTC and fails closed on invalid identity or extras', () => {
  assert.equal(validSignal({ mergedAtUtc: '2026-08-18T10:45:00Z' }).mergedAtUtc, '2026-08-18T10:45:00.000Z');
  assert.equal(validSignal({ mergedAtUtc: '2026-08-18T10:45:00.123Z' }).mergedAtUtc, '2026-08-18T10:45:00.123Z');
  assert.throws(() => validSignal({ mergedAtUtc: '2026-08-18 10:45:00Z' }), /MAIN_ADVANCE_MERGED_AT_INVALID/);
  assert.throws(() => validSignal({ repository: 'other/repo' }), /MAIN_ADVANCE_REPOSITORY_INVALID/);
  assert.throws(() => validSignal({ branch: 'feature' }), /MAIN_ADVANCE_BRANCH_INVALID/);
  assert.throws(() => validSignal({ mainHead: 'abc' }), /MAIN_ADVANCE_HEAD_INVALID/);
  const signal = validSignal();
  assert.equal(validateBattleBridgeMainAdvanceSignal({ ...signal, command: 'git reset --hard HEAD' }).ok, false);
  assert.equal(validateBattleBridgeMainAdvanceSignal({ ...signal, syncAuthorityGranted: true }).ok, false);
});

test('GitHub workflow signals main-associated events with a bounded publisher', () => {
  const workflow = readFileSync('.github/workflows/battle-bridge-main-advance-express-sync-v1.yml', 'utf8');
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /workflow_run:\s*\n\s*workflows: \[Protected Operator Merge Queue Boundary\]\s*\n\s*types: \[completed\]/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node scripts\/publish-battle-bridge-main-advance-signal\.mjs/);
  assert.doesNotMatch(workflow, /^\s*pull_request(?:_target)?:/m);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref:.*github\.event\.pull_request\.(?:head|merge_commit_sha)/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
});

test('main signal uses protected default-branch code and bounded post-merge data only', () => {
  const workflow = readFileSync('.github/workflows/battle-bridge-main-advance-express-sync-v1.yml', 'utf8');
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.event == 'workflow_dispatch'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.equal((workflow.match(/uses: actions\/checkout@v4/g) || []).length, 1);
  assert.equal((workflow.match(/ref: \$\{\{ github\.sha \}\}/g) || []).length, 1);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|id-token: write|secrets\./);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /STEPHANOS_MAIN_ADVANCE_(?:PR|HEAD|MERGED_AT):/);
  assert.doesNotMatch(workflow, /run:.*\$\{\{.*pull_request/);
  assert.match(workflow, /timeout-minutes: 5/);
});

const REPO = 'Cheekyfellastef/stephan-os';
const ROOT = '/repos/' + REPO;
function publicationFixture(kind = 'workflow_run') {
  const parent = { id: 123, repository: { full_name: REPO }, head_repository: { full_name: REPO },
    path: '.github/workflows/operator-merge-approval-gate.yml', display_title: 'Protected operator merge ' + 'b'.repeat(40),
    head_sha: 'c'.repeat(40), event: 'workflow_dispatch', head_branch: 'main', status: 'completed', conclusion: 'success' };
  const summary = { number: 3193, state: 'closed', merge_commit_sha: HEAD, merged_at: MERGED_AT,
    head: { sha: 'b'.repeat(40) }, base: { ref: 'main', repo: { full_name: REPO } } };
  const detail = { ...structuredClone(summary), merged: true };
  const main = { ref: 'refs/heads/main', object: { sha: HEAD } };
  const commit = { sha: HEAD, parents: [{ sha: parent.head_sha }] };
  const event = kind === 'push' ? { repository: { full_name: REPO }, ref: 'refs/heads/main', after: HEAD, deleted: false }
    : { repository: { full_name: REPO }, action: 'completed', workflow_run: { id: parent.id } };
  const calls = [];
  const facts = { parent, summaries: [summary], detail, main, finalMain: main, commit, calls };
  let mainReads = 0;
  const readJson = async path => {
    calls.push(path);
    if (path === ROOT + '/actions/runs/123') return structuredClone(facts.parent);
    if (path === ROOT + '/git/ref/heads/main') return structuredClone(mainReads++ ? facts.finalMain : facts.main);
    if (path === ROOT + '/commits/' + HEAD + '/pulls?per_page=100') return structuredClone(facts.summaries);
    if (path === ROOT + '/pulls/3193') return structuredClone(facts.detail);
    if (path === ROOT + '/git/commits/' + HEAD) return structuredClone(facts.commit);
    throw new Error('UNEXPECTED_READ:' + path);
  };
  return { facts, input: { repository: REPO, eventName: kind, event, mainHead: HEAD, workflowRunId: '456', readJson } };
}

test('protected workflow completion authenticates merged PR and exact squash parent before signalling', async () => {
  const f = publicationFixture(); const out = await readMergedMainAdvanceSignalV1(f.input);
  assert.equal(out.disposition, 'MERGED_MAIN_SIGNAL_OBSERVED');
  assert.equal(out.signal.prNumber, 3193);
  assert.equal(out.signal.syncAuthorityGranted, false);
  assert.equal(out.signal.runtimeMutationAuthorityGranted, false);
  assert.equal(f.facts.calls.length, 6);
  assert.equal(f.facts.calls.filter(p => p.endsWith('/git/ref/heads/main')).length, 2);
});

test('main push independently observes merged PR without a PR-scoped event', async () => {
  const f = publicationFixture('push'); const out = await readMergedMainAdvanceSignalV1(f.input);
  assert.equal(out.signal.mainHead, HEAD);
  assert.equal(f.facts.calls.length, 4);
  f.input.eventName = 'pull_request_target';
  await assert.rejects(readMergedMainAdvanceSignalV1(f.input), /EVENT_NOT_MAIN_ASSOCIATED/);
});

test('unmerged close, unrelated push, missing parent and foreign events cannot supply a signal', async () => {
  for (const mutate of [
    f => { f.input.eventName = 'pull_request'; },
    f => { f.input.eventName = 'pull_request_target'; },
    f => { f.input.event.repository.full_name = 'other/repo'; },
    f => { f.input.event.action = 'requested'; },
    f => { f.input.event.workflow_run.id = 0; },
  ]) {
    const f = publicationFixture(); mutate(f);
    await assert.rejects(readMergedMainAdvanceSignalV1(f.input));
    assert.equal(f.facts.calls.length, 0);
  }
  for (const patch of [{ ref: 'refs/heads/feature' }, { after: 'f'.repeat(40) }, { deleted: true }]) {
    const f = publicationFixture('push'); Object.assign(f.input.event, patch);
    await assert.rejects(readMergedMainAdvanceSignalV1(f.input), /PUSH_NOT_EXACT_MAIN/);
  }
});

test('fresh parent read rejects spoofed workflow, branch, repository, source and completion', async () => {
  for (const patch of [
    { path: '.github/workflows/untrusted.yml' }, { event: 'pull_request_target' },
    { head_branch: 'feature' }, { status: 'in_progress' }, { conclusion: 'failure' },
    { id: 124 }, { repository: { full_name: 'other/repo' } }, { head_repository: { full_name: 'other/repo' } },
    { head_sha: 'invalid' }, { display_title: 'untrusted' },
  ]) {
    const f = publicationFixture(); Object.assign(f.facts.parent, patch);
    await assert.rejects(readMergedMainAdvanceSignalV1(f.input), /PROTECTED_PARENT_UNPROVEN/);
    assert.equal(f.facts.calls.length, 1);
  }
});

test('moved main, incomplete or ambiguous PR inventory and changed live PR all hold closed', async () => {
  const moved = publicationFixture(); moved.facts.finalMain = { ref: 'refs/heads/main', object: { sha: 'f'.repeat(40) } };
  await assert.rejects(readMergedMainAdvanceSignalV1(moved.input), /MAIN_MOVED/);
  for (const summaries of [null, Array.from({ length: 100 }, () => ({}))]) {
    const f = publicationFixture(); f.facts.summaries = summaries;
    await assert.rejects(readMergedMainAdvanceSignalV1(f.input), /PR_INVENTORY_UNPROVEN/);
  }
  const duplicated = publicationFixture(); duplicated.facts.summaries.push(structuredClone(duplicated.facts.summaries[0]));
  await assert.rejects(readMergedMainAdvanceSignalV1(duplicated.input), /MERGED_PR_AMBIGUOUS/);
  for (const patch of [
    { merged: false }, { state: 'open' }, { number: 3194 }, { merge_commit_sha: 'f'.repeat(40) },
    { merged_at: 'invalid' }, { head: { sha: 'f'.repeat(40) } },
    { base: { ref: 'feature', repo: { full_name: REPO } } },
  ]) {
    const f = publicationFixture(); Object.assign(f.facts.detail, patch);
    await assert.rejects(readMergedMainAdvanceSignalV1(f.input), /MERGED_PR_CHANGED_OR_UNPROVEN/);
  }
});

test('protected completion cannot signal another source or a non-exact squash ancestry', async () => {
  for (const commit of [null, { sha: HEAD, parents: [] }, { sha: HEAD, parents: [{ sha: 'f'.repeat(40) }] },
    { sha: HEAD, parents: [{ sha: 'c'.repeat(40) }, { sha: 'd'.repeat(40) }] }]) {
    const f = publicationFixture(); f.facts.commit = commit;
    await assert.rejects(readMergedMainAdvanceSignalV1(f.input), /PARENT_MERGE_NOT_EXACT/);
  }
  const stale = publicationFixture(); stale.facts.parent.display_title = 'Protected operator merge ' + 'f'.repeat(40);
  const out = await readMergedMainAdvanceSignalV1(stale.input);
  assert.equal(out.signal, null); assert.equal(out.disposition, 'NO_MATCHING_MERGED_PR');
});

test('non-PR main advances emit no signal and upstream failures cannot be called success', async () => {
  const empty = publicationFixture('push'); empty.facts.summaries = [];
  assert.equal((await readMergedMainAdvanceSignalV1(empty.input)).signal, null);
  const unavailable = publicationFixture(); unavailable.input.readJson = async () => { throw new Error('UPSTREAM_FAILED'); };
  await assert.rejects(readMergedMainAdvanceSignalV1(unavailable.input), /UPSTREAM_FAILED/);
});

test('existing bounded GitHub Sync becomes a one-minute near-real-time fallback without new Git authority', () => {
  const installer = readFileSync('scripts/windows/install-battle-bridge-github-sync.ps1', 'utf8');
  assert.equal(BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES, 1);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /intervalMinutes = 1/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /RunLevel Limited/);
  assert.match(installer, /fast-forwards only the canonical stephan-os main checkout every minute/);
  assert.doesNotMatch(installer, /git reset --hard|git clean|git stash|git rebase|git push/i);
  assert.doesNotMatch(installer, /OpenClaw.*updateAllowed = \$true/i);
});
