import assert from 'node:assert/strict';
import test from 'node:test';
import { CANONICAL_MAILBOX_ISSUE, CANONICAL_MAILBOX_RECEIPT_PREDECESSOR } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { evaluateCanonicalMailboxWorkflowEvent } from './canonical-mailbox-workflow-event-gate.mjs';
import { MAILBOX_WORKFLOW_EVENT_SOURCE_POLICY_VERSION, evaluateMailboxWorkflowEventSource,
  assertMailboxRotationWorkflowAdmission } from './canonical-mailbox-workflow-admission-v1.mjs';
import { buildMailboxRotationFence } from '../shared/agents/canonicalMailboxRotationFenceV1.mjs';
const event = (patch = {}) => ({
  action: 'created',
  repository: { full_name: 'Cheekyfellastef/stephan-os' },
  issue: { number: CANONICAL_MAILBOX_ISSUE },
  comment: { user: { login: 'Cheekyfellastef' },
    body: '<!-- stephanos-battle-bridge-command-receipt -->' },
  ...patch,
});
test('new canonical shard allows event ingress but grants zero protected authority', () => {
  const result = evaluateCanonicalMailboxWorkflowEvent(event(), { mode: 'receipt' });
  assert.equal(result.admitted, true);
  assert.equal(result.issueNumber, CANONICAL_MAILBOX_ISSUE);
  assert.equal(result.downstreamExactCommandValidationRequired, true);
  assert.equal(result.sourceMutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.protectedApprovalAuthority, false);
});
test('old mailbox, foreign owners and pull requests are denied for all event modes', () => {
  const invalid = [
    event({ issue: { number: 2590 } }),
    event({ issue: { number: CANONICAL_MAILBOX_ISSUE, pull_request: {} } }),
    event({ repository: { full_name: 'foreign/project' } }),
    event({ comment: { user: { login: 'someone-else' },
      body: '<!-- stephanos-battle-bridge-command-receipt -->' } }),
    event({ action: 'deleted' }),
  ];
  for (const item of invalid) {
    for (const mode of ['protected', 'receipt', 'observer', 'bootstrap', 'prerequisite']) {
      assert.equal(evaluateCanonicalMailboxWorkflowEvent(item, { mode }).admitted, false);
    }
  }
});

test('only predecessor receipt ingress is read-only; every executable class remains denied', () => {
  const predecessor = event({ issue: { number: CANONICAL_MAILBOX_RECEIPT_PREDECESSOR } });
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(predecessor, { mode: 'receipt' }).admitted, true);
  for (const mode of ['protected', 'observer', 'bootstrap', 'prerequisite']) assert.equal(evaluateCanonicalMailboxWorkflowEvent(predecessor, { mode }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(predecessor, { mode: 'receipt' }).mergeAuthority, false);
});
test('command classes are independent and edited protected approvals never admitted', () => {
  const prereq = event({
    comment: { user: { login: 'Cheekyfellastef' },
      body: 'stephanos-battle-bridge-tailscale-bootstrap-prerequisites' },
  });
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(prereq, { mode: 'bootstrap' }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(prereq, { mode: 'prerequisite' }).admitted, true);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event(), { mode: 'protected' }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event({ action: 'edited' }), { mode: 'receipt' }).admitted, true);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event({ action: 'edited' }), { mode: 'protected' }).admitted, false);
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(event(), { mode: '__proto__' }).admitted, false);
});

const sourceHead = 'a'.repeat(40), nextHead = 'b'.repeat(40);
const historicalHead = '0b6d131bf9b359c2a118b881f8dedeff4acd8692';
const repository = 'Cheekyfellastef/stephan-os';
const sourceEnvironment = (workflow = 'mailbox-receipt-index.yml', job = 'mirror', head = sourceHead) => ({
  GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'issue_comment', GITHUB_REPOSITORY: repository,
  GITHUB_REPOSITORY_ID: '1179385578', GITHUB_REPOSITORY_OWNER: 'Cheekyfellastef',
  GITHUB_REPOSITORY_OWNER_ID: '267490109', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/${workflow}@refs/heads/main`,
  GITHUB_WORKFLOW_SHA: head, GITHUB_SHA: head, GITHUB_JOB: job,
  GITHUB_RUN_ID: '43098316698', GITHUB_RUN_ATTEMPT: '1',
});
const evaluateSource = (env, mode = 'receipt', head = sourceHead) =>
  evaluateMailboxWorkflowEventSource({ mode, sourceHead: head, env });
async function withEnvironment(env, run) {
  const keys = Object.keys(sourceEnvironment()), saved = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    return await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
function unfencedApi(head = sourceHead) {
  const reads = [];
  return { reads, api: async path => {
    reads.push(path);
    if (path === '/branches/main') return { commit: { sha: head } };
    if (path === '/issues/2315/comments?per_page=100&page=1') return [];
    throw new Error(`Unexpected admission endpoint ${path}`);
  } };
}

test('event source policy covers only the actual production jobs and their existing modes', () => {
  assert.equal(MAILBOX_WORKFLOW_EVENT_SOURCE_POLICY_VERSION, 1);
  for (const [workflow, job, modes] of [
    ['mailbox-receipt-index.yml', 'mirror', ['receipt']],
    ['codex-banked-reset-telemetry.yml', 'mirror', ['receipt']],
    ['protected-workflow-dispatch-mailbox.yml', 'dispatch', ['protected']],
    ['battle-bridge-out-of-band-observer-v1.yml', 'observe', ['observer', 'receipt']],
    ['battle-bridge-tailscale-bootstrap-pipe.yml', 'bootstrap-canonical-github-sync', ['bootstrap']],
    ['battle-bridge-tailscale-bootstrap-pipe.yml', 'prerequisite-proof', ['prerequisite']],
  ]) {
    for (const mode of modes) {
      const result = evaluateSource(sourceEnvironment(workflow, job), mode);
      assert.equal(result.admitted, true, `${workflow}/${job}/${mode}`);
      assert.equal(result.reason, 'MAILBOX_WORKFLOW_EVENT_SOURCE_ADMITTED');
      assert.equal(result.eventHead, sourceHead);
      assert.equal(result.workflowPath, `.github/workflows/${workflow}`);
      assert.equal(result.job, job);
      assert.equal(Object.isFrozen(result), true);
    }
  }
});

for (const key of Object.keys(sourceEnvironment())) {
  test(`issue-comment source admission rejects missing ${key}`, () => {
    const env = sourceEnvironment(); delete env[key];
    // A missing hosted event name cannot be recast as a non-comment event.
    assert.equal(evaluateSource(env).admitted, false);
  });
}

for (const [name, patch] of [
  ['non-GitHub execution', { GITHUB_ACTIONS: 'false' }],
  ['foreign repository', { GITHUB_REPOSITORY: 'foreign/stephan-os' }],
  ['foreign repository identity', { GITHUB_REPOSITORY_ID: '1179385579' }],
  ['foreign owner', { GITHUB_REPOSITORY_OWNER: 'someone-else' }],
  ['foreign owner identity', { GITHUB_REPOSITORY_OWNER_ID: '267490110' }],
  ['PR ref', { GITHUB_REF: 'refs/pull/3556/merge' }],
  ['candidate workflow ref', { GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/mailbox-receipt-index.yml@refs/heads/candidate` }],
  ['foreign workflow ref', { GITHUB_WORKFLOW_REF: 'foreign/repo/.github/workflows/mailbox-receipt-index.yml@refs/heads/main' }],
  ['unregistered workflow', { GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/unknown.yml@refs/heads/main` }],
  ['proof job on issue comment', { GITHUB_JOB: 'proof' }],
  ['wrong production job', { GITHUB_JOB: 'dispatch' }],
  ['zero run ID', { GITHUB_RUN_ID: '0' }],
  ['unsafe run ID', { GITHUB_RUN_ID: '9007199254740992' }],
  ['zero attempt', { GITHUB_RUN_ATTEMPT: '0' }],
  ['noninteger attempt', { GITHUB_RUN_ATTEMPT: '1.5' }],
  ['malformed event SHA', { GITHUB_SHA: 'main' }],
  ['malformed workflow SHA', { GITHUB_WORKFLOW_SHA: 'main' }],
  ['different workflow source', { GITHUB_WORKFLOW_SHA: nextHead }],
]) {
  test(`issue-comment source admission rejects ${name}`, () => {
    assert.equal(evaluateSource({ ...sourceEnvironment(), ...patch }).admitted, false);
  });
}

test('stale event source and inherited or malformed context never qualify', () => {
  assert.deepEqual(evaluateSource(sourceEnvironment('mailbox-receipt-index.yml', 'mirror', historicalHead)), {
    admitted: false, reason: 'MAILBOX_WORKFLOW_EVENT_SOURCE_STALE', eventHead: '', workflowPath: '', job: '',
  });
  for (const env of [null, [], Object.create(sourceEnvironment())]) assert.equal(evaluateSource(env).admitted, false);
  assert.equal(evaluateSource(sourceEnvironment(), 'protected').admitted, false);
  assert.equal(evaluateSource(sourceEnvironment(), '__proto__').admitted, false);
});

test('current event generation may project authentic historical receipt payloads', async () => {
  const historicalReceipt = event({ comment: { user: { login: 'Cheekyfellastef' },
    body: `<!-- stephanos-battle-bridge-command-receipt -->\n\`\`\`json\n${JSON.stringify({ expectedHead: historicalHead })}\n\`\`\`` } });
  assert.equal(evaluateCanonicalMailboxWorkflowEvent(historicalReceipt, { mode: 'receipt' }).admitted, true);
  await withEnvironment(sourceEnvironment(), async () => {
    const f = unfencedApi();
    assert.equal((await assertMailboxRotationWorkflowAdmission({ mode: 'receipt', api: f.api, checkoutHead: () => sourceHead })).admitted, true);
    assert.deepEqual(f.reads, ['/branches/main', '/issues/2315/comments?per_page=100&page=1', '/branches/main']);
  });
});

test('central admission denies stale event metadata before fence reads and ignores caller override flags', async () => {
  await withEnvironment(sourceEnvironment('mailbox-receipt-index.yml', 'mirror', historicalHead), async () => {
    const f = unfencedApi();
    await assert.rejects(assertMailboxRotationWorkflowAdmission({ mode: 'receipt', api: f.api,
      checkoutHead: () => sourceHead, env: sourceEnvironment(), allowStaleEvent: true }), /MAILBOX_WORKFLOW_EVENT_SOURCE_STALE/);
    assert.deepEqual(f.reads, ['/branches/main']);
  });
});

test('a direct observer always-publisher must recheck event source after an earlier admission', async () => {
  await withEnvironment(sourceEnvironment('battle-bridge-out-of-band-observer-v1.yml', 'observe'), async () => {
    const initial = unfencedApi();
    assert.equal((await assertMailboxRotationWorkflowAdmission({ mode: 'observer', api: initial.api, checkoutHead: () => sourceHead })).admitted, true);
    // A fresh dynamic-main checkout cannot carry the earlier event's authority.
    const later = unfencedApi(nextHead);
    await assert.rejects(assertMailboxRotationWorkflowAdmission({ mode: 'receipt', api: later.api,
      checkoutHead: () => nextHead }), /MAILBOX_WORKFLOW_EVENT_SOURCE_STALE/);
  });
});

test('event-source binding retains the second fresh-main read', async () => {
  await withEnvironment(sourceEnvironment(), async () => {
    let mainReads = 0;
    await assert.rejects(assertMailboxRotationWorkflowAdmission({ mode: 'receipt', checkoutHead: () => sourceHead,
      api: async path => path === '/branches/main' ? { commit: { sha: ++mainReads === 1 ? sourceHead : nextHead } } : [] }), /MAILBOX_WORKFLOW_MAIN_MOVED/);
    assert.equal(mainReads, 2);
  });
});

test('valid event identity does not bypass the existing execution freeze fence', async () => {
  const transitionId = 'admission-source-freeze-v1';
  const value = { schemaVersion: 'stephanos.battle-bridge-github-command.v1', requestId: 'admission-source-freeze-request-v1',
    operation: 'MANAGE_CANONICAL_MAILBOX_ROTATION', repository, issueNumber: CANONICAL_MAILBOX_ISSUE, branch: 'main',
    operatorApproval: 'operator-approved', expectedHead: sourceHead, rotationAction: 'FREEZE', transitionId,
    successorIssue: CANONICAL_MAILBOX_ISSUE + 1000, cutoverPrNumber: 4000, cutoverHead: nextHead };
  const freeze = { id: 100, user: { login: 'Cheekyfellastef' },
    html_url: `https://github.com/${repository}/issues/${CANONICAL_MAILBOX_ISSUE}#issuecomment-100`,
    body: `\`\`\`stephanos-battle-bridge-command\n${JSON.stringify(value)}\n\`\`\`` };
  const fence = { id: 101, user: { login: 'Cheekyfellastef' }, body: buildMailboxRotationFence({
    transitionId, phase: 'DRAINING', predecessorIssue: CANONICAL_MAILBOX_ISSUE, successorIssue: value.successorIssue,
    cutoverPrNumber: 4000, cutoverHead: nextHead, preparationHead: sourceHead, freezeCommentId: 100,
  }, { commandCommentId: 100 }) };
  const api = async path => path === '/branches/main' ? { commit: { sha: sourceHead } }
    : path === '/issues/2315/comments?per_page=100&page=1' ? [fence] : freeze;
  await withEnvironment(sourceEnvironment('protected-workflow-dispatch-mailbox.yml', 'dispatch'), async () => {
    await assert.rejects(assertMailboxRotationWorkflowAdmission({ mode: 'protected', api, checkoutHead: () => sourceHead }), /MAILBOX_ROTATION_GLOBAL_FREEZE_ACTIVE/);
  });
  await withEnvironment(sourceEnvironment(), async () => {
    assert.equal((await assertMailboxRotationWorkflowAdmission({ mode: 'receipt', api, checkoutHead: () => sourceHead })).admitted, true);
  });
});

test('existing non-comment admission keeps source and fence checks without event-generation coupling', async () => {
  for (const name of ['push', 'workflow_dispatch', 'pull_request', 'pull_request_target']) {
    const env = { ...sourceEnvironment('mailbox-receipt-index.yml', 'proof', historicalHead), GITHUB_EVENT_NAME: name };
    await withEnvironment(env, async () => {
      const f = unfencedApi();
      assert.equal((await assertMailboxRotationWorkflowAdmission({ mode: 'receipt', api: f.api, checkoutHead: () => sourceHead })).admitted, true);
      assert.equal(f.reads.filter(path => path === '/branches/main').length, 2);
    });
  }
});

await import('./canonical-mailbox-historical-inline-nonadmission.test.mjs');
