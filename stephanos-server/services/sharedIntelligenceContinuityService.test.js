import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStephanosSharedConversationTurnRecord } from '../../shared/agents/stephanosSharedConversationThreadV1.mjs';
import { writeAtomicJson } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { DurableMemoryStore } from './memory/memoryStore.js';
import {
  SHARED_INTELLIGENCE_PRIMARY_THREAD_ID,
  completeSharedIntelligenceAiTurnV1,
  loadSharedIntelligenceThreadRecordsV1,
  prepareSharedIntelligenceForAiTurnV1,
  prepareAuthorisedHistoricalChatContextV1,
  governAuthorisedHistoricalTeachingV1,
  recallGovernedOperatorTeachingV1,
} from './sharedIntelligenceContinuityService.js';

const NOW = '2026-09-25T22:45:00.000Z';

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-shared-intelligence-'));
  await mkdir(join(root, 'inbox'), { recursive: true });
  return root;
}

function envFor(root) {
  return {
    ...process.env,
    STEPHANOS_SHARED_AGENT_WORKSPACE: root,
  };
}

test('AI turn joins durable shared thread, sees ChatGPT context and returns existing Canvas contract', async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const repoRoot = join(tmpdir(), 'stephanos-repo-test');

  const chatgpt = createStephanosSharedConversationTurnRecord({
    threadId: SHARED_INTELLIGENCE_PRIMARY_THREAD_ID,
    turnId: 'chatgpt-turn-001',
    senderParticipantId: 'chatgpt-bridge',
    replyToTurnId: '',
    text: 'ChatGPT says the history import should remain explicitly authorised.',
    timestampUtc: '2026-09-25T22:44:30.000Z',
  }, {
    relatedIssue: '#2434',
    proofRefs: ['proof/chatgpt-turn-001'],
    workspaceValidationOptions: { nowMs: Date.parse(NOW) },
  });
  assert.equal(chatgpt.valid, true, chatgpt.errors.join(', '));
  await writeAtomicJson(
    root,
    ['inbox', 'shared-turn-aabbccddeeff001122334455.json'],
    chatgpt.record,
    { repoRoot, nowMs: Date.parse(NOW) },
  );

  const prepared = await prepareSharedIntelligenceForAiTurnV1({
    threadId: SHARED_INTELLIGENCE_PRIMARY_THREAD_ID,
    requestIdentity: 'request-live-001',
    operatorText: 'Stephanos, use the same shared conversation as ChatGPT.',
    timestampUtc: NOW,
    repoRoot,
    env,
  });

  assert.equal(prepared.ok, true, prepared.errors.join(', '));
  assert.equal(prepared.threadProjection.turnCount, 2);
  assert.match(prepared.contextBlock, /ChatGPT says the history import/);
  assert.match(prepared.contextBlock, /Stephan: Stephanos, use the same shared conversation/);
  assert.equal(prepared.knowledgeTwin.valid, true);
  assert.equal(prepared.knowledgeTwin.visibilityScope, 'CURRENT_SHARED_THREAD');
  assert.equal(prepared.authority.commandExecutionAllowed, false);

  const completed = await completeSharedIntelligenceAiTurnV1({
    prepared,
    requestIdentity: 'request-live-001',
    answerText: 'I can see the same durable shared-thread context.',
    timestampUtc: '2026-09-25T22:45:02.000Z',
    repoRoot,
    env,
    surface: 'desktop-browser',
  });

  assert.equal(completed.ok, true, completed.errors.join(', '));
  assert.equal(completed.threadProjection.turnCount, 3);
  assert.equal(completed.threadProjection.transcript.at(-1).senderParticipantId, 'stephanos');
  assert.equal(completed.conversationCanvasView.schemaVersion, 'stephanos.ui-agent.conversation-canvas-presenter.v1');
  assert.equal(completed.conversationCanvasView.valid, true);
  assert.deepEqual(
    completed.conversationCanvasView.sections[0].items.map((item) => item.contributorId),
    ['chatgpt-bridge', 'operator', 'stephanos'],
  );
  assert.equal(completed.knowledgeTwin.visibleItems.length, 3);
  assert.equal(completed.authority.memoryWriteAllowed, false);
});

test('same request identity resumes without duplicating operator or Stephanos turns', async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const repoRoot = join(tmpdir(), 'stephanos-repo-test');

  const input = {
    requestIdentity: 'request-retry-001',
    operatorText: 'Retry this exact turn.',
    timestampUtc: NOW,
    repoRoot,
    env,
  };

  const first = await prepareSharedIntelligenceForAiTurnV1(input);
  const second = await prepareSharedIntelligenceForAiTurnV1(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);

  const firstDone = await completeSharedIntelligenceAiTurnV1({
    prepared: first,
    requestIdentity: 'request-retry-001',
    answerText: 'Same deterministic answer bytes.',
    timestampUtc: '2026-09-25T22:45:02.000Z',
    repoRoot,
    env,
  });
  const secondDone = await completeSharedIntelligenceAiTurnV1({
    prepared: second,
    requestIdentity: 'request-retry-001',
    answerText: 'Same deterministic answer bytes.',
    timestampUtc: '2026-09-25T22:45:02.000Z',
    repoRoot,
    env,
  });

  assert.equal(firstDone.ok, true, firstDone.errors.join(', '));
  assert.equal(secondDone.ok, true, secondDone.errors.join(', '));
  const loaded = await loadSharedIntelligenceThreadRecordsV1({
    repoRoot,
    env,
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.records.length, 2);
});

test('conflicting retry bytes fail closed rather than rewriting durable conversation truth', async (t) => {
  const root = await workspace();
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = envFor(root);
  const repoRoot = join(tmpdir(), 'stephanos-repo-test');

  const first = await prepareSharedIntelligenceForAiTurnV1({
    requestIdentity: 'request-conflict-001',
    operatorText: 'Original text.',
    timestampUtc: NOW,
    repoRoot,
    env,
  });
  assert.equal(first.ok, true);

  const conflict = await prepareSharedIntelligenceForAiTurnV1({
    requestIdentity: 'request-conflict-001',
    operatorText: 'Changed text under the same request identity.',
    timestampUtc: NOW,
    repoRoot,
    env,
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.classification, /PERSISTENCE_BLOCKED/);
  assert.match(conflict.errors.join('\n'), /SHARED_TURN_EXISTING_CONFLICT/);
});

test('unavailable Shared Workspace fails closed without fabricating a Canvas or Knowledge Twin', async () => {
  const result = await prepareSharedIntelligenceForAiTurnV1({
    requestIdentity: 'request-no-workspace',
    operatorText: 'Hello.',
    timestampUtc: NOW,
    repoRoot: join(tmpdir(), 'stephanos-repo-test'),
    env: {
      ...process.env,
      STEPHANOS_SHARED_AGENT_WORKSPACE: join(tmpdir(), 'missing-stephanos-workspace-do-not-create'),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.conversationCanvasView, null);
  assert.equal(result.knowledgeTwin, null);
  assert.equal(result.authority.sourceMutationAllowed, false);
});


test('explicit authorised teaching is adjudicated, persists across store restart, and is recalled later', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'stephanos-governed-operator-memory-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const storagePath = join(temp, 'durable-memory.json');

  const history = prepareAuthorisedHistoricalChatContextV1({
    observedAtUtc: NOW,
    operatorConsent: {
      visibilityAllowed: true,
      learningCandidatesAllowed: true,
      durableLearningAllowed: true,
      scope: 'ALL_AUTHORISED_CHATS',
    },
    historyItems: [{
      chatId: 'chat-history-001',
      messageId: 'msg-history-001',
      role: 'operator',
      sourceSurface: 'chatgpt-web',
      originalCreatedAtUtc: '2026-09-20T10:00:00.000Z',
      text: 'Use octopus mode for bounded project builds.',
      knowledgeClass: 'PREFERENCE',
      retentionIntent: 'REMEMBER_DURABLY',
      explicitOperatorTeaching: true,
      supersedesKnowledgeId: '',
      sourceRefs: ['chat://chat-history-001/message/msg-history-001'],
      authorised: true,
    }],
  });

  assert.equal(history.ok, true, history.errors.join(', '));
  assert.equal(history.knowledgeTwin.durableTeachingCandidates.length, 1);

  const firstStore = new DurableMemoryStore(storagePath);
  const governed = governAuthorisedHistoricalTeachingV1(history, { store: firstStore, persist: true });
  assert.equal(governed.ok, true);
  assert.equal(governed.candidateCount, 1);
  assert.equal(governed.promotedCount, 1);

  const restartedStore = new DurableMemoryStore(storagePath);
  const recalled = recallGovernedOperatorTeachingV1('octopus bounded project builds', {
    store: restartedStore,
  });
  assert.equal(recalled.ok, true);
  assert.equal(recalled.classification, 'GOVERNED_OPERATOR_TEACHING_RECALLED');
  assert.equal(recalled.recordCount, 1);
  assert.match(recalled.contextBlock, /Use octopus mode for bounded project builds/);
  assert.match(recalled.contextBlock, /operator teaching/i);
});

test('context-only historical chat is never sent to durable memory adjudication', () => {
  const history = prepareAuthorisedHistoricalChatContextV1({
    observedAtUtc: NOW,
    operatorConsent: {
      visibilityAllowed: true,
      learningCandidatesAllowed: true,
      durableLearningAllowed: true,
      scope: 'ALL_AUTHORISED_CHATS',
    },
    historyItems: [{
      chatId: 'chat-context-only',
      messageId: 'msg-context-only',
      role: 'operator',
      sourceSurface: 'chatgpt-web',
      originalCreatedAtUtc: '2026-09-20T10:00:00.000Z',
      text: 'This is visible context only.',
      knowledgeClass: 'NONE',
      retentionIntent: 'CONTEXT_ONLY',
      explicitOperatorTeaching: false,
      supersedesKnowledgeId: '',
      sourceRefs: ['chat://chat-context-only/message/msg-context-only'],
      authorised: true,
    }],
  });
  let calls = 0;
  const governed = governAuthorisedHistoricalTeachingV1(history, {
    persist: true,
    adjudicateFn: () => {
      calls += 1;
      throw new Error('context-only must not reach adjudicator');
    },
  });
  assert.equal(history.ok, true);
  assert.equal(governed.ok, true);
  assert.equal(governed.candidateCount, 0);
  assert.equal(governed.promotedCount, 0);
  assert.equal(calls, 0);
});
