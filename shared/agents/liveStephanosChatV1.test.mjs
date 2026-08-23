import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_INTENT,
  buildLiveStephanosChatContract,
  createLiveChatContext,
  createLiveStephanosChatResponse,
  validateLiveStephanosChatResponse,
} from './liveStephanosChatV1.mjs';

test('contract exposes chat intents and live sources', () => {
  const contract = buildLiveStephanosChatContract();
  assert.equal(contract.finalVerdict, 'LIVE_STEPHANOS_CHAT_CONTRACT_READY');
  assert.equal(contract.chatIntents.includes('STATUS'), true);
  assert.equal(contract.requiredSources.includes('missionOperations'), true);
});

test('context composes mission operations, orchestrator, and intelligence', () => {
  const context = createLiveChatContext({
    goalId: '#1280',
    idea: 'Make Stephanos useful from WhatsApp and Command Deck chat.',
    branch: 'feature/live-stephanos-chat-v1',
    sourceFiles: ['shared/agents/liveStephanosChatV1.mjs'],
  });
  assert.equal(context.finalVerdict, 'LIVE_STEPHANOS_CHAT_CONTEXT_READY');
  assert.equal(context.missionOperations.currentGoal, '#1280');
  assert.equal(context.projectIntelligence.finalVerdict, 'PROJECT_INTELLIGENCE_ANSWER_READY');
});

test('status message answers from mission operations', () => {
  const response = createLiveStephanosChatResponse({
    message: 'What is the current status?',
    goalId: '#1280',
    idea: 'Live chat should answer from mission state.',
    branch: 'feature/live-stephanos-chat-v1',
    sourceFiles: ['shared/agents/liveStephanosChatV1.mjs'],
  });
  assert.equal(response.intent, CHAT_INTENT.STATUS);
  assert.match(response.answer, /Mission status/);
  assert.equal(response.goalId, '#1280');
  assert.equal(validateLiveStephanosChatResponse(response).valid, true);
});

test('idea message captures idea and returns a next action', () => {
  const response = createLiveStephanosChatResponse({
    message: 'I am thinking about a better goal dashboard.',
    goalId: '#1280',
    idea: 'Live chat should shape ideas.',
    branch: 'feature/live-stephanos-chat-v1',
    sourceFiles: ['shared/agents/liveStephanosChatV1.mjs'],
  });
  assert.equal(response.intent, CHAT_INTENT.IDEA);
  assert.match(response.answer, /Idea captured/);
  assert.match(response.nextAction, /Continue|Add|Record|Run|Wait|Provide/i);
});

test('blocker message surfaces exact blocker when present', () => {
  const response = createLiveStephanosChatResponse({
    message: 'Why is this blocked?',
    goalId: '#1280',
    idea: 'Live chat blocker surfacing.',
    blocker: 'Run proof before merge.',
  });
  assert.equal(response.intent, CHAT_INTENT.BLOCKER);
  assert.equal(response.blocker, 'Run proof before merge.');
  assert.match(response.answer, /Run proof before merge/);
});

test('next action message returns deterministic next action', () => {
  const response = createLiveStephanosChatResponse({
    message: 'What should we do next?',
    goalId: '#1280',
    idea: 'Live chat next action.',
    branch: 'feature/live-stephanos-chat-v1',
    sourceFiles: ['shared/agents/liveStephanosChatV1.mjs'],
  });
  assert.equal(response.intent, CHAT_INTENT.NEXT_ACTION);
  assert.match(response.answer, /Next action/);
});

test('validator blocks malformed responses', () => {
  const result = validateLiveStephanosChatResponse({
    schemaVersion: 'live-stephanos-chat.v1',
    kind: 'stephanos.live_chat.response',
    intent: CHAT_INTENT.STATUS,
    answer: 'x',
  });
  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-goal-id'), true);
  assert.equal(result.errors.includes('missing-next-action'), true);
});
