import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stageControlTowerBuildRequestV1 } from '../../scripts/control-tower-build-request-v1.mjs';
import { createControlTowerBuildRequestV1, validateControlTowerBuildRequestV1,
  validateHistoricalControlTowerBuildRequestV1, formatControlTowerOwnerCommandV1 } from './controlTowerBuildRequestV1.mjs';
import { inputs, fixture, ownerCommentInputs, HEAD, NOW, API } from './fixtures/controlTowerBuildV1.mjs';

test('exact owner comment and independent immutable readback prepare the existing two closed operations', () => {
  for (const operation of ['BUILD_NEXT_ELIGIBLE_GOAL', 'OBSERVE_CONTROL_SYSTEM']) {
    const f = ownerCommentInputs(operation);
    const result = createControlTowerBuildRequestV1(f.event, f.env, HEAD, NOW, f.readback);
    assert.equal(result.ok, true, result.blocker);
    assert.equal(result.request.operation, operation);
    assert.equal(result.request.requestId, 'control-tower-comment-700-1');
    assert.equal(result.request.runId, 100);
    assert.equal(result.request.createdAtUtc, f.comment.created_at);
    assert.equal(result.request.expiresAtUtc, '2026-10-28T12:09:59.000Z');
    assert.equal(result.request.ownerCommentSha256, f.readback.bodySha256);
    for (const flag of ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed'])
      assert.equal(result.request[flag], false);
  }
});

test('owner-comment ingress refuses missing readback, edited or foreign identities, expired consent and source drift', () => {
  const cases = [
    ['missing readback', f => { f.readback = null; }],
    ['edited event', f => { f.event.action = 'edited'; }],
    ['retired issue', f => { f.event.issue.number = 3149; }],
    ['PR comment', f => { f.event.issue.pull_request = {}; }],
    ['event sender ID', f => { f.event.sender.id = 1; }],
    ['event comment ID', f => { f.event.comment.id = 701; }],
    ['event owner ID', f => { f.event.comment.user.id = 1; }],
    ['event owner type', f => { f.event.comment.user.type = 'Bot'; }],
    ['actor ID', f => { f.env.GITHUB_ACTOR_ID = '1'; }],
    ['triggering actor', f => { f.env.GITHUB_TRIGGERING_ACTOR = 'github-actions[bot]'; }],
    ['workflow source', f => { f.env.GITHUB_WORKFLOW_SHA = 'b'.repeat(40); }],
    ['rerun', f => { f.env.GITHUB_RUN_ATTEMPT = '2'; }],
    ['live owner ID', f => { f.comment.user.id = 1; }],
    ['live owner login', f => { f.comment.user.login = 'github-actions[bot]'; }],
    ['live owner type', f => { f.comment.user.type = 'Bot'; }],
    ['live edited', f => { f.comment.updated_at = NOW; }],
    ['live issue URL', f => { f.comment.issue_url = API + '/issues/3149'; }],
    ['live PR', f => { f.issue.pull_request = {}; }],
    ['closed mailbox', f => { f.issue.state = 'closed'; }],
    ['locked mailbox', f => { f.issue.locked = true; }],
    ['saturated mailbox', f => { f.issue.comments = 2200; }],
    ...[undefined, null, '10', false].map(value => ['unproven live comment count ' + value, f => { f.issue.comments = value; }]),
    ...[undefined, null, '10', false].map(value => ['unproven event comment count ' + value, f => { f.event.issue.comments = value; }]),
    ['foreign repository', f => { f.issue.repository_url = 'https://api.github.com/repos/foreign/repo'; }],
    ['stale comment', f => { f.comment.created_at = f.comment.updated_at = '2026-10-28T11:50:20.000Z'; }],
    ['future comment', f => { f.comment.created_at = f.comment.updated_at = '2026-10-28T12:00:21.000Z'; }],
    ['changed body', f => { f.comment.body = formatControlTowerOwnerCommandV1({ ...f.command, operation: 'OBSERVE_CONTROL_SYSTEM' }); }],
    ['forged input fields', f => { f.event.inputs = { operation: 'OBSERVE_CONTROL_SYSTEM' }; }],
  ];
  for (const [label, mutate] of cases) {
    const f = ownerCommentInputs(); mutate(f);
    assert.equal(createControlTowerBuildRequestV1(f.event, f.env, HEAD, NOW, f.readback).ok, false, label);
  }
});

test('owner-comment grammar accepts only the exact closed packet and never caller identity, commands or grants', () => {
  const changes = [
    command => ({ ...command, operation: 'repair-stephanos' }),
    command => ({ ...command, operation: 'BUILD_NEXT_ELIGIBLE_GOAL ' }),
    command => ({ ...command, expectedMain: 'b'.repeat(40) }),
    command => ({ ...command, schemaVersion: 'other' }),
    ...['authenticated', 'operatorId', 'command', 'path', 'url', 'arguments', 'goalId', 'admissionGranted', 'expiresAtUtc']
      .map(key => command => ({ ...command, [key]: true })),
  ];
  for (const change of changes) {
    const f = ownerCommentInputs();
    f.comment.body = f.event.comment.body = '<!-- stephanos-control-tower-owner-command-v1 -->\n```json\n'
      + JSON.stringify(change(f.command), null, 2) + '\n```';
    assert.equal(createControlTowerBuildRequestV1(f.event, f.env, HEAD, NOW, f.readback).ok, false);
  }
  for (const change of [body => body + '\n', body => 'please execute\n' + body,
    body => body.replace('"operation":', '"operation": "OBSERVE_CONTROL_SYSTEM", "operation":')]) {
    const f = ownerCommentInputs(); f.comment.body = f.event.comment.body = change(f.comment.body);
    assert.equal(createControlTowerBuildRequestV1(f.event, f.env, HEAD, NOW, f.readback).ok, false);
  }
});

test('a second authentic run keeps the comment request identity and cannot renew its ten-minute window', () => {
  const first = fixture({ ownerComment: true }), later = fixture({ ownerComment: true, runId: 101 });
  assert.equal(first.request.requestId, later.request.requestId);
  assert.notEqual(first.request.runId, later.request.runId);
  assert.equal(first.request.createdAtUtc, later.request.createdAtUtc);
  assert.equal(first.request.expiresAtUtc, later.request.expiresAtUtc);
  assert.equal(validateControlTowerBuildRequestV1(first.request, first.run, HEAD, NOW).ok, true);
  assert.equal(validateControlTowerBuildRequestV1(later.request, later.run, HEAD, NOW).ok, true);
  for (const patch of [{ createdAtUtc: NOW, expiresAtUtc: '2026-10-28T12:10:20.000Z' },
    { requestId: 'control-tower-build-100-1' }, { ownerCommentId: 701 },
    { ownerCommentIssueNumber: 3149 }, { ownerCommentSha256: 'not-a-digest' }])
    assert.equal(validateControlTowerBuildRequestV1({ ...first.request, ...patch }, first.run, HEAD, NOW).ok, false);
  const expired = '2026-10-28T12:10:00.000Z';
  assert.equal(validateControlTowerBuildRequestV1(first.request, first.run, HEAD, expired).ok, false);
  assert.equal(validateHistoricalControlTowerBuildRequestV1(first.request, first.run, HEAD, expired).ok, true);
});

test('real Actions producer performs exact independent comment reads and never stages after edit or main movement', async t => {
  const root = mkdtempSync(join(tmpdir(), 'ct-comment-producer-'));
  t.after(() => rmSync(root, { recursive: true }));
  for (const mode of ['valid', 'edited', 'main-moved']) {
    const f = ownerCommentInputs(), directory = join(root, mode);
    const { mkdirSync } = await import('node:fs'); mkdirSync(directory);
    const eventPath = join(directory, 'event.json'); writeFileSync(eventPath, JSON.stringify(f.event));
    const calls = []; let mains = 0;
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer fixture-producer');
      if (url === API + '/git/ref/heads/main') return Response.json({ ref: 'refs/heads/main',
        object: { sha: mode === 'main-moved' && ++mains > 1 ? 'b'.repeat(40) : HEAD } });
      if (url === API + '/issues/comments/700') return Response.json(mode === 'edited' ? { ...f.comment, updated_at: NOW } : f.comment);
      if (url === f.issue.url) return Response.json(f.issue);
      throw Error('UNEXPECTED_PRODUCER_ENDPOINT');
    };
    const invoke = () => stageControlTowerBuildRequestV1({
      env: { ...f.env, GITHUB_TOKEN: 'fixture-producer', GITHUB_EVENT_PATH: eventPath, RUNNER_TEMP: directory },
      now: () => NOW, fetchImpl,
    });
    const artifact = join(directory, 'control-tower-build-request.json');
    if (mode === 'valid') {
      const result = await invoke(); assert.deepEqual(JSON.parse(readFileSync(artifact)), result);
      assert.equal(result.requestId, 'control-tower-comment-700-1');
      assert.equal(calls.length, 4);
    } else {
      await assert.rejects(invoke, /READBACK_INVALID|MAIN_MOVED/);
      assert.equal(existsSync(artifact), false);
    }
  }
});

test('owner dispatch defaults to the next canonically eligible build, with no grant', () => {
  const { event, env } = inputs();
  const result = createControlTowerBuildRequestV1(event, env, HEAD, NOW);
  assert.equal(result.ok, true); assert.equal(result.request.operation, 'BUILD_NEXT_ELIGIBLE_GOAL');
  for (const flag of ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed'])
    assert.equal(result.request[flag], false);
  const f = fixture(); assert.equal(validateControlTowerBuildRequestV1(f.request, f.run, HEAD, NOW).ok, true);
});
test('PR, fork, rerun, foreign operator, workflow, job and source contexts cannot request a build', () => {
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_ACTOR_ID: '1' }, { GITHUB_ACTOR: 'attacker' },
    { GITHUB_WORKFLOW_REF: 'foreign/file@main' }, { GITHUB_JOB: 'contract-test' },
    { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_RUN_ID: '1.5' }]) {
    const { event, env } = inputs(); Object.assign(env, patch);
    assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
  }
  const { event, env } = inputs(); event.repository.id = 1;
  assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
});
test('unknown operations, shell, scopes, routes and goal grants are never dispatch inputs', () => {
  for (const key of ['operation', 'command', 'path', 'goal_issue', 'route', 'admissionGranted']) {
    const { event, env } = inputs(); event.inputs[key] = 'anything';
    assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).blocker, 'BUILD_DISPATCH_INPUTS_FORBIDDEN');
  }
});

test('the same exact owner can select a fixed read-only control-system observation', () => {
  const { event, env } = inputs();
  event.inputs = { operation: 'OBSERVE_CONTROL_SYSTEM' };
  const result = createControlTowerBuildRequestV1(event, env, HEAD, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.request.operation, 'OBSERVE_CONTROL_SYSTEM');
  for (const flag of ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed'])
    assert.equal(result.request[flag], false);
  const { run } = fixture();
  assert.equal(validateControlTowerBuildRequestV1(result.request, run, HEAD, NOW).ok, true);
  assert.equal(validateControlTowerBuildRequestV1(result.request, { ...run, event: 'push' }, HEAD, NOW).ok, false);
});

test('fixed observation choice cannot smuggle arguments or relax owner and source binding', () => {
  for (const operation of ['', null, true, 1, [], {}, 'OBSERVE_CONTROL_SYSTEM ',
    'observe_control_system', 'FREEZE', 'DRAIN', 'STATUS', 'REPAIR_CONTROL_PLANE', 'RUN_COMMAND']) {
    const { event, env } = inputs(); event.inputs = { operation };
    assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
  }
  for (const key of ['command', 'text', 'question', 'path', 'url', 'pid', 'sourceHead', 'operatorApproval']) {
    const { event, env } = inputs(); event.inputs = { operation: 'OBSERVE_CONTROL_SYSTEM', [key]: 'value' };
    assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
  }
  for (const patch of [{ GITHUB_ACTOR_ID: '1' }, { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_EVENT_NAME: 'repository_dispatch' }]) {
    const { event, env } = inputs(); event.inputs = { operation: 'OBSERVE_CONTROL_SYSTEM' };
    assert.equal(createControlTowerBuildRequestV1(event, { ...env, ...patch }, HEAD, NOW).ok, false);
  }
  const { event, env } = inputs(); event.inputs = Object.create({ operation: 'OBSERVE_CONTROL_SYSTEM' });
  assert.equal(createControlTowerBuildRequestV1(event, env, HEAD, NOW).ok, false);
});

test('unknown observation operation and elevated grants are rejected after authenticated readback', () => {
  const f = fixture();
  for (const operation of ['FREEZE', 'DRAIN', 'RUN_COMMAND', '', null])
    assert.equal(validateControlTowerBuildRequestV1({ ...f.request, operation }, f.run, HEAD, NOW).ok, false);
  for (const key of ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed'])
    assert.equal(validateControlTowerBuildRequestV1({ ...f.request, operation: 'OBSERVE_CONTROL_SYSTEM', [key]: true }, f.run, HEAD, NOW).ok, false);
});
test('authority flags, unknown fields, expiry and source substitution are rejected at native readback', () => {
  const f = fixture();
  for (const patch of [{ admissionGranted: true }, { mergeAuthority: true }, { arbitraryShellAllowed: true },
    { command: 'anything' }, { sourceHead: 'b'.repeat(40) }, { runId: 101 }, { runAttempt: 2 },
    { expiresAtUtc: '2026-10-29T12:00:05.000Z' }, { createdAtUtc: 'invalid' }])
    assert.equal(validateControlTowerBuildRequestV1({ ...f.request, ...patch }, f.run, HEAD, NOW).ok, false);
  assert.equal(validateControlTowerBuildRequestV1(f.request, f.run, HEAD, '2026-10-28T12:11:00.000Z').ok, false);
});
test('expired requests can be authenticated only for historical diagnosis, never live execution', () => {
  const f = fixture();
  const afterExpiry = '2026-10-28T12:11:00.000Z';
  assert.equal(validateControlTowerBuildRequestV1(f.request, f.run, HEAD, afterExpiry).ok, false);
  assert.equal(validateHistoricalControlTowerBuildRequestV1(f.request, f.run, HEAD, afterExpiry).ok, true);
  assert.equal(validateHistoricalControlTowerBuildRequestV1(f.request, f.run, HEAD, NOW).ok, false);
  assert.equal(validateHistoricalControlTowerBuildRequestV1({ ...f.request, mergeAuthority: true },
    f.run, HEAD, afterExpiry).ok, false);
  assert.equal(validateHistoricalControlTowerBuildRequestV1(f.request,
    { ...f.run, actor: { login: 'Cheekyfellastef', id: 1 } }, HEAD, afterExpiry).ok, false);
});

test('authenticated run identity cannot be replaced by a familiar artifact name', () => {
  for (const patch of [{ actor: { login: 'Cheekyfellastef', id: 1 } }, { triggering_actor: { login: 'Cheekyfellastef' } },
    { repository: { full_name: 'Cheekyfellastef/stephan-os', id: 1 } }, { event: 'repository_dispatch' }, { run_attempt: 2 }]) {
    const f = fixture(); assert.equal(validateControlTowerBuildRequestV1(f.request, { ...f.run, ...patch }, HEAD, NOW).ok, false);
  }
});

test('authenticated non-forced protected-main push requests only the existing fixed scheduler wake', () => {
  const { event, env } = inputs();
  env.GITHUB_EVENT_NAME = 'push';
  event.ref = 'refs/heads/main';
  event.before = 'b'.repeat(40);
  event.after = HEAD;
  event.head_commit = { id: HEAD };
  event.created = false;
  event.deleted = false;
  event.forced = false;
  delete event.inputs;
  const result = createControlTowerBuildRequestV1(event, env, HEAD, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.request.operation, 'BUILD_NEXT_ELIGIBLE_GOAL');
  for (const key of ['admissionGranted', 'mergeAuthority', 'runtimeMutationAuthority', 'leaseSeizureAllowed', 'arbitraryShellAllowed'])
    assert.equal(result.request[key], false);
  const f = fixture();
  assert.equal(validateControlTowerBuildRequestV1(result.request, { ...f.run, event: 'push' }, HEAD, NOW).ok, true);
});

test('push origin cannot forge source, force-update main or smuggle inputs', () => {
  const { event: canonical, env: originalEnv } = inputs();
  originalEnv.GITHUB_EVENT_NAME = 'push';
  canonical.ref = 'refs/heads/main';
  canonical.before = 'b'.repeat(40);
  canonical.after = HEAD;
  canonical.head_commit = { id: HEAD };
  canonical.created = false;
  canonical.deleted = false;
  canonical.forced = false;
  delete canonical.inputs;
  for (const patch of [
    { forced: true }, { deleted: true }, { created: true },
    { after: 'b'.repeat(40) }, { before: HEAD },
    { head_commit: { id: 'c'.repeat(40) } },
    { before: 'invalid' }, { ref: 'refs/heads/attacker' },
    { inputs: { action: 'arbitrary-shell' } },
  ]) {
    const event = { ...canonical, ...patch };
    assert.equal(createControlTowerBuildRequestV1(event, originalEnv, HEAD, NOW).ok, false);
  }
  for (const change of [{ GITHUB_ACTOR_ID: '1' }, { GITHUB_ACTOR: 'attacker' },
    { GITHUB_REF: 'refs/heads/attacker' }, { GITHUB_RUN_ATTEMPT: '2' }]) {
    assert.equal(createControlTowerBuildRequestV1(canonical, { ...originalEnv, ...change }, HEAD, NOW).ok, false);
  }
});
