import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_MODE,
  buildProjectIntelligenceContract,
  createIdeaFlywheelTurn,
  createProjectIntelligenceAnswer,
  createProjectKnowledgeGraph,
  searchKnowledgeGraph,
  validateProjectIntelligenceAnswer,
} from './projectIntelligenceV1.mjs';

test('contract exposes knowledge kinds and answer modes', () => {
  const contract = buildProjectIntelligenceContract();

  assert.equal(contract.finalVerdict, 'PROJECT_INTELLIGENCE_CONTRACT_READY');
  assert.equal(contract.knowledgeKinds.includes('GOAL'), true);
  assert.equal(contract.knowledgeKinds.includes('PR'), true);
  assert.equal(contract.answerModes.includes('HYPOTHESIS'), true);
});

test('knowledge graph links goals, PRs, proofs, systems, and ideas', () => {
  const graph = createProjectKnowledgeGraph({
    items: [
      { id: 'goal-1308', kind: 'GOAL', title: '#1308 Project Intelligence', proven: true, relatedIds: ['system-command-deck'] },
      { id: 'system-command-deck', kind: 'SYSTEM', title: 'AI Chat Command Deck', proven: true },
      { id: 'idea-flywheel', kind: 'IDEA', title: 'Conversational flywheel', proven: false, relatedIds: ['goal-1308'] },
    ],
  });

  assert.equal(graph.counts.GOAL, 1);
  assert.equal(graph.counts.SYSTEM, 1);
  assert.equal(graph.counts.IDEA, 1);
  assert.deepEqual(graph.links, [
    { from: 'goal-1308', to: 'system-command-deck' },
    { from: 'idea-flywheel', to: 'goal-1308' },
  ]);
});

test('search returns matching repository knowledge first', () => {
  const graph = createProjectKnowledgeGraph({
    items: [
      { id: 'goal-1307', kind: 'GOAL', title: 'Runtime Orchestrator', summary: 'Owns mission lifecycle.', proven: true, refs: ['#1311'] },
      { id: 'goal-1308', kind: 'GOAL', title: 'Project Intelligence', summary: 'Answers questions about the project.', proven: true },
    ],
  });

  const results = searchKnowledgeGraph(graph, 'mission lifecycle orchestrator');

  assert.equal(results[0].id, 'goal-1307');
});

test('answer separates proven facts from hypotheses and preserves refs', () => {
  const answer = createProjectIntelligenceAnswer({
    question: 'How does Stephanos discuss ideas?',
    items: [
      { id: 'goal-1308', kind: 'GOAL', title: 'Project Intelligence', summary: 'Grounds answers and discussions about ideas in project state.', proven: true, refs: ['#1308'] },
      { id: 'idea-flywheel', kind: 'IDEA', title: 'Idea flywheel', summary: 'Operator and Stephanos bounce ideas into source work.', proven: false },
    ],
    nextActions: ['Wire the answer layer into the AI Chat Command Deck.'],
  });

  assert.equal(answer.mode, ANSWER_MODE.FACT);
  assert.equal(answer.provenFacts.length, 1);
  assert.equal(answer.hypotheses.length, 1);
  assert.deepEqual(answer.relatedRefs, ['#1308']);
  assert.equal(validateProjectIntelligenceAnswer(answer).valid, true);
});

test('idea flywheel turn keeps ideas distinct from project facts', () => {
  const turn = createIdeaFlywheelTurn({
    title: 'Shared workspace conversation room',
    idea: 'Move shared workspace up the stack so humans and agents can talk through threaded messages.',
    items: [
      { id: 'shared-workspace', kind: 'SYSTEM', title: 'Shared Agent Workspace', summary: 'Message and proof bus.', proven: true },
    ],
  });

  assert.equal(turn.idea.proven, false);
  assert.equal(turn.response.hypotheses.length, 1);
  assert.equal(turn.response.finalVerdict, 'PROJECT_INTELLIGENCE_ANSWER_READY');
});

test('validator blocks incomplete answer objects', () => {
  const result = validateProjectIntelligenceAnswer({
    schemaVersion: 'project-intelligence.v1',
    kind: 'stephanos.project_intelligence.answer',
    question: '',
    answer: '',
  });

  assert.equal(result.valid, false);
  assert.equal(result.errors.includes('missing-question'), true);
  assert.equal(result.errors.includes('missing-answer'), true);
  assert.equal(result.errors.includes('missing-proven-facts'), true);
});
