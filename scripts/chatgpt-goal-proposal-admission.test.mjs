import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_GOAL_ADMISSION_ROUTE,
  CHATGPT_GOAL_ADMISSION_STATUS,
  buildChatGptSchedulerGoalRecord,
  promoteChatGptGoalIntent,
  runChatGptSharedWorkspaceGitHubRelay,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
} from './chatgpt-shared-workspace-github-relay.mjs';
import { buildSchedulerGoalsFromProgrammeSources } from '../shared/agents/programmeAuthorityV1.mjs';
import {
  SHARED_WORKSPACE_RECORD_KINDS,
  SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';

const NOW = '2026-09-08T08:20:00.000Z';
const NOW_MS = Date.parse(NOW);
const REPOSITORY = 'Cheekyfellastef/stephan-os';

for (const failure of ['none', 'goal-conflict', 'inbox-conflict', 'inbox-read', 'goal-read', 'goal-write']) {
  test(`persisted inbox retry reconciles before completion: ${failure}`, async () => {
    const records = new Map();
    const responses = [];
    let attempt = 0;
    const request = { schemaVersion: 'chatgpt-participant-bridge.v1', requestId: 'goal-retry-2002',
      operation: 'WRITE_MESSAGE', recordKind: 'goal-intent-proposal', relatedGoal: '#2002' };
    const options = {
      paths: { workspaceRoot: '/external-shared-workspace', repoRoot: '/repo' },
      adapter: {
        readRequest: () => ({ ok: true, body: `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}\n\`\`\`json\n${JSON.stringify({ schemaVersion: 'chatgpt-participant-bridge.v1', state: 'REQUEST_READY', request })}\n\`\`\`` }),
        writeResponse: (body) => { responses.push(JSON.parse(body.match(/```json\s*([\s\S]*?)```/)[1])); return { ok: true }; },
      },
      verifyRequestFn: () => ({ accepted: true, responseStatus: 'ACCEPTED', proofRefs: [] }),
      recordBuilder: (_request, { timestampUtc }) => ({ ok: true, record: proposal({}, { timestampUtc }) }),
      receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
      recordExistsFn: async ({ segments }) => records.has(segments.join('/')),
      readFileFn: async (file) => {
        const key = file.replace('/external-shared-workspace/', '');
        if (attempt === 2 && ((failure === 'inbox-read' && key.startsWith('inbox/')) || (failure === 'goal-read' && key.startsWith('goals/')))) throw new Error('read failed');
        if (!records.has(key)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return JSON.stringify(records.get(key));
      },
      writeAtomicJsonFn: async (_root, segments, record) => {
        if (segments[0] === 'goals' && (attempt === 1 || failure === 'goal-write')) return { ok: false, reason: 'TRANSIENT_GOAL_WRITE_FAILURE' };
        records.set(segments.join('/'), record);
        return { ok: true, bytes: 100 };
      },
    };
    attempt = 1;
    const first = await runChatGptSharedWorkspaceGitHubRelay({ ...options, now: new Date(NOW) });
    assert.equal(first.ok, false);
    assert.deepEqual([...records.keys()], ['inbox/goal-retry-2002.json']);
    assert.equal(responses.at(-1).completed, false);
    if (failure === 'goal-conflict') records.set('goals/goal-2002.json', { wrong: true });
    if (failure === 'inbox-conflict') records.set('inbox/goal-retry-2002.json', proposal({ title: 'Other goal' }));
    attempt = 2;
    const second = await runChatGptSharedWorkspaceGitHubRelay({ ...options, now: new Date(NOW_MS + 1000) });
    assert.equal(second.ok, failure === 'none');
    assert.equal(responses.at(-1).completed, failure === 'none');
    if (failure === 'none') {
      assert.equal(records.get('goals/goal-2002.json').timestampUtc, NOW);
      assert.equal(second.goalAdmission.reason, 'CHATGPT_GOAL_ADMITTED');
      assert.ok([...records.keys()].some(key => key.startsWith('receipts/')));
    } else {
      assert.equal([...records.keys()].some(key => /^(receipts|events)\//.test(key)), false);
    }
  });
}

function proposal(overrides = {}, messageOverrides = {}) {
  const boundedPayload = {
    issueNumber: 2002,
    title: 'Keep Stephanos building durable goals autonomously',
    repository: REPOSITORY,
    prerequisites: [1557, 1637],
    priority: 90,
    criticalPathWeight: 95,
    reversibility: 'REVERSIBLE',
    operatorPriority: true,
    ...overrides,
  };
  return {
    schemaVersion: SHARED_WORKSPACE_RECORD_SCHEMA_VERSION,
    kind: SHARED_WORKSPACE_RECORD_KINDS.MESSAGE,
    messageId: 'goal-intent-proposal-controller-2002',
    participantId: 'chatgpt-bridge',
    timestampUtc: NOW,
    correlationId: 'controller-goal-2002',
    relatedIssue: '#2002',
    relatedPr: '',
    proofRefs: ['receipts/controller-goal-2002'],
    channel: 'chatgpt-participant-bridge',
    summary: boundedPayload.title,
    body: JSON.stringify({
      recordKind: 'goal-intent-proposal',
      boundedPayload,
    }),
    ...messageOverrides,
  };
}

test('ChatGPT goal proposal becomes a canonical scheduler GOAL record', () => {
  const built = buildChatGptSchedulerGoalRecord(proposal(), { nowMs: NOW_MS });
  assert.equal(built.applicable, true);
  assert.equal(built.ok, true);
  assert.equal(built.record.kind, SHARED_WORKSPACE_RECORD_KINDS.GOAL);
  assert.equal(built.record.goalId, 'goal-2002');
  assert.equal(built.record.issueNumber, 2002);
  assert.equal(built.record.repository, REPOSITORY);
  assert.equal(built.record.status, CHATGPT_GOAL_ADMISSION_STATUS);
  assert.equal(built.record.route, CHATGPT_GOAL_ADMISSION_ROUTE);
  assert.deepEqual(built.record.prerequisites, [1557, 1637]);
  assert.equal(built.record.approvalRequired, false);
  assert.equal(built.record.operatorPriority, true);
  assert.equal(built.record.proofState, 'PROPOSAL_ADMITTED');

  const schedulerGoals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc: NOW,
    goalRecords: [built.record],
  });
  assert.equal(schedulerGoals.valid, true);
  assert.deepEqual(schedulerGoals.blockers, []);
  assert.equal(schedulerGoals.goals.length, 1);
  assert.equal(schedulerGoals.goals[0].issue, 2002);
  assert.equal(schedulerGoals.goals[0].route, CHATGPT_GOAL_ADMISSION_ROUTE);
  assert.deepEqual(schedulerGoals.goals[0].prerequisites, [1557, 1637]);
});

test('goal admission fails closed on mismatched issue identity, repository or open payload authority', () => {
  for (const [record, reason] of [
    [proposal({ issueNumber: 2003 }), 'CHATGPT_GOAL_ISSUE_IDENTITY_MISMATCH'],
    [proposal({ repository: 'other/repository' }), 'CHATGPT_GOAL_REPOSITORY_NOT_CANONICAL'],
    [proposal({ command: 'do something' }), 'CHATGPT_GOAL_PAYLOAD_NOT_CLOSED_WORLD'],
  ]) {
    const result = buildChatGptSchedulerGoalRecord(record, { nowMs: NOW_MS });
    assert.equal(result.applicable, true);
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.record, null);
  }
});

test('goal admission rejects self, duplicate, malformed and oversized prerequisite sets', () => {
  const oversized = Array.from({ length: 33 }, (_, index) => 3000 + index);
  for (const prerequisites of [
    [2002],
    [1557, 1557],
    ['not-an-issue'],
    oversized,
  ]) {
    const result = buildChatGptSchedulerGoalRecord(proposal({ prerequisites }), { nowMs: NOW_MS });
    assert.equal(result.applicable, true);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'CHATGPT_GOAL_PREREQUISITES_INVALID');
  }
});

test('goal admission rejects malformed bounded scoring and operator-priority fields', () => {
  for (const [overrides, reason] of [
    [{ priority: -1 }, 'CHATGPT_GOAL_PRIORITY_INVALID'],
    [{ priority: 101 }, 'CHATGPT_GOAL_PRIORITY_INVALID'],
    [{ criticalPathWeight: Number.POSITIVE_INFINITY }, 'CHATGPT_GOAL_CRITICAL_PATH_WEIGHT_INVALID'],
    [{ operatorPriority: 'yes' }, 'CHATGPT_GOAL_OPERATOR_PRIORITY_INVALID'],
    [{ reversibility: 'MAGIC' }, 'CHATGPT_GOAL_REVERSIBILITY_INVALID'],
  ]) {
    const result = buildChatGptSchedulerGoalRecord(proposal(overrides), { nowMs: NOW_MS });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
  }
});

test('promotion writes exactly one deterministic goals/goal-issue record and no caller path', async () => {
  const writes = [];
  const result = await promoteChatGptGoalIntent({
    root: '/external-shared-workspace',
    segments: ['inbox', 'controller-goal-2002.json'],
    record: proposal(),
    writeOptions: { repoRoot: '/repo' },
    nowMs: NOW_MS,
    readFileFn: async () => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    },
    writeAtomicJsonFn: async (root, segments, record) => {
      writes.push({ root, segments, record });
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'CHATGPT_GOAL_ADMITTED');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].root, '/external-shared-workspace');
  assert.deepEqual(writes[0].segments, ['goals', 'goal-2002.json']);
  assert.equal(writes[0].record.goalId, 'goal-2002');
});

test('promotion is idempotent for the same goal and fails closed on conflicting goal identity', async () => {
  const built = buildChatGptSchedulerGoalRecord(proposal(), { nowMs: NOW_MS });
  assert.equal(built.ok, true);

  const same = await promoteChatGptGoalIntent({
    root: '/external-shared-workspace',
    segments: ['inbox', 'controller-goal-2002.json'],
    record: proposal(),
    writeOptions: { repoRoot: '/repo' },
    nowMs: NOW_MS,
    readFileFn: async () => JSON.stringify(built.record),
    writeAtomicJsonFn: async () => { throw new Error('idempotent promotion must not rewrite'); },
  });
  assert.equal(same.ok, true);
  assert.equal(same.reason, 'CHATGPT_GOAL_ALREADY_ADMITTED');

  const conflicting = { ...built.record, title: 'Different goal claiming the same canonical issue identity' };
  let writes = 0;
  const conflict = await promoteChatGptGoalIntent({
    root: '/external-shared-workspace',
    segments: ['inbox', 'controller-goal-2002.json'],
    record: proposal(),
    writeOptions: { repoRoot: '/repo' },
    nowMs: NOW_MS,
    readFileFn: async () => JSON.stringify(conflicting),
    writeAtomicJsonFn: async () => { writes += 1; return { ok: true }; },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, 'CHATGPT_GOAL_CONFLICT');
  assert.equal(writes, 0);
});

test('non-inbox and non-goal bridge records cannot create scheduler goals', async () => {
  const writes = [];
  const outsideInbox = await promoteChatGptGoalIntent({
    root: '/external-shared-workspace',
    segments: ['status', 'anything.json'],
    record: proposal(),
    writeAtomicJsonFn: async (...args) => { writes.push(args); return { ok: true }; },
  });
  assert.equal(outsideInbox.applicable, false);

  const ordinaryBridgeMessage = proposal({}, {
    body: JSON.stringify({ recordKind: 'next-action-packet', boundedPayload: { summary: 'continue' } }),
  });
  const notGoal = buildChatGptSchedulerGoalRecord(ordinaryBridgeMessage, { nowMs: NOW_MS });
  assert.equal(notGoal.applicable, false);
  assert.equal(writes.length, 0);
});
