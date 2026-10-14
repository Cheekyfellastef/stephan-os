import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { inspectRescueIslandPilotOwnerIntakeV1 as inspect } from './rescueIslandPilotOwnerIntakeV1.mjs';

const HEAD = 'a'.repeat(40);
const CONTENT = '# Rescue Island pilot\n\nFirst production-intake security proof, no live authority.\n';
const hash = createHash('sha256').update(CONTENT).digest('hex');
const NOW = '2026-10-14T12:18:00.000Z';
const ISSUE_TITLE = 'Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)';
const URL = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/3109';
function fixture() {
  const task = {
    schemaVersion: 'stephanos.rescue-island-pilot-task.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 3109,
    issueTitle: ISSUE_TITLE,
    workerId: 'rescue-island-01',
    taskId: 'pilot-3109-01',
    baseHead: HEAD,
    targetPath: 'docs/architecture/rescue-island-pilot-pilot-3109-01.md',
    testPath: 'shared/agents/rescueIslandPreflightV1.test.mjs',
    content: CONTENT,
    approvalSource: 'EXTERNAL_OWNER_ATTESTATION_REQUIRED',
    expiresAtUtc: '2026-10-14T12:24:00.000Z',
  };
  const comment = {
    id: 42,
    url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/comments/42',
    issue_url: URL,
    user: { login: 'Cheekyfellastef', type: 'User', id: 267490109 },
    author_association: 'OWNER',
    created_at: '2026-10-14T12:17:00.000Z',
    updated_at: '2026-10-14T12:17:00.000Z',
    body: '/rescue-island-01 pilot ' + HEAD + ' pilot-3109-01 ' + hash,
  };
  return {
    issue: { number: 3109, title: ISSUE_TITLE, state: 'open', url: URL },
    comment, commentId: 42, mainHead: HEAD, nowUtc: NOW, task,
    consumedCommentIds: [],
  };
}
test('exact owner issue/comment/content reaches only structural admission without source authority', () => {
  const result = inspect(fixture());
  assert.equal(result.disposition, 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED');
  assert.deepEqual(result.blockers, []);
  for (const key of ['approvalAuthenticated','ownershipAuthenticated','productionAdmissionAllowed','physicalPickupAllowed','sourceMutationAllowed','canonicalLeaseAccessAllowed','seedForgeQueueAccessAllowed','mergeAllowed','unattendedRefillAllowed']) {
    assert.equal(result[key], false, key);
  }
});
test('rejects forged owner login, numeric ID, bot actor and author association', () => {
  for (const user of [
    { login: 'Cheekyfellastef', id: 1, type: 'User' },
    { login: 'cheekyfellastef', id: 267490109, type: 'User' },
    { login: 'Cheekyfellastef', id: 267490109, type: 'Bot' },
  ]) {
    const x=fixture(); x.comment.user=user;
    assert.equal(inspect(x).disposition, 'HELD');
  }
  const x=fixture(); x.comment.author_association='NONE';
  assert.ok(inspect(x).blockers.includes('OWNER_COMMENT_IDENTITY_UNPROVEN'));
});
test('rejects unrelated issue, PR masquerade, comment URL substitution and edited command', () => {
  for (const mutate of [
    x => { x.issue.number=3103; },
    x => { x.issue.pull_request={url:'https://example.invalid'}; },
    x => { x.comment.issue_url='https://api.github.com/repos/elsewhere/project/issues/3109'; },
    x => { x.comment.url += '-evil'; },
    x => { x.comment.updated_at='2026-10-14T12:17:01.000Z'; },
    x => { x.comment.body += '\nother command'; },
  ]) {
    const x=fixture(); mutate(x); assert.equal(inspect(x).disposition,'HELD');
  }
});
test('rejects stale comment, expired task and current-main drift', () => {
  for (const mutate of [
    x => { x.nowUtc='2026-10-14T12:30:00.000Z'; },
    x => { x.task.expiresAtUtc='2026-10-14T12:17:00.000Z'; },
    x => { x.mainHead='b'.repeat(40); },
    x => { x.comment.created_at='2026-10-14T12:22:00.000Z'; x.comment.updated_at=x.comment.created_at; },
  ]) {
    const x=fixture(); mutate(x); assert.equal(inspect(x).disposition,'HELD');
  }
});
test('no replay or untrusted consumed-comment inventory may pass', () => {
  for (const consumedCommentIds of [[42], [43,43], [null], '42']) {
    const x=fixture(); x.consumedCommentIds=consumedCommentIds;
    assert.ok(inspect(x).blockers.includes('COMMENT_ALREADY_OWNED_OR_INVENTORY_INVALID'));
  }
});
test('rejects task content changes, alternate branch/head/worker and path escapes', () => {
  for (const mutate of [
    x => { x.task.content += 'changed'; },
    x => { x.task.workerId='rescue-island-02'; },
    x => { x.task.baseHead='b'.repeat(40); },
    x => { x.task.targetPath='../unsafe'; },
    x => { x.task.targetPath='docs/architecture/another.md'; },
    x => { x.task.issueNumber=3103; },
    x => { x.task.content=123; },
    x => { x.task.taskId=['pilot-3109-01']; },
    x => { x.task.expiresAtUtc=['2026-10-14T12:24:00.000Z']; },
  ]) {
    const x=fixture(); mutate(x); assert.equal(inspect(x).disposition,'HELD');
  }
});
test('untrusted primitive coercion cannot smuggle task identities', () => {
  const x=fixture();
  const hostile={ [Symbol.toPrimitive]() { throw new Error('never-coerce-untrusted'); } };
  x.task.taskId=hostile;
  assert.equal(inspect(x).disposition,'HELD');
  x.task.taskId='pilot-3109-01';
  x.task.expiresAtUtc=hostile;
  assert.equal(inspect(x).disposition,'HELD');
});
