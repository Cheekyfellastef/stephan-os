import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
import { buildVrResearchWorkspaceProjection } from './vrResearchWorkspaceProjectionV1.mjs';
import {
  VR_RESEARCH_PARTICIPANT_ID,
  VR_RESEARCH_QA_CAPABILITY,
  VR_RESEARCH_QUESTION_CLASSES,
  answerVrResearchQuestion,
  createVrResearchQaWorkspaceAnswerRecord,
  createVrResearchQuestion,
} from './vrResearchParticipantQaV1.mjs';

const updatedAt = '2026-08-14T10:50:00.000Z';
const nowMs = Date.parse('2026-08-14T11:00:00.000Z');

function projection(overrides = {}) {
  return buildVrResearchWorkspaceProjection({
    sourceRegistry: {
      schema_version: 'test-1',
      sources: [
        { source_id: 'mutar-nomoreflat', title: 'Mutar NoMoreFlat Starfield', priority: 'P0', status: 'open-source-pinned', licence: 'MIT', snapshot_commit: 'abc123' },
        { source_id: 'vorpx', title: 'vorpX baseline', priority: 'P1', status: 'operational-analysis', licence: 'commercial proprietary', snapshot_version: 'current-public' },
        { source_id: 'skyrim-vr-ecosystem', title: 'Skyrim VR VRIK HIGGS PLANCK', priority: 'P0', status: 'benchmark-pinned', licence: 'mixed', snapshot_version: 'provider-matrix-v1' },
        { source_id: 'creation-kit', title: 'Starfield Creation Kit', priority: 'P0', status: 'authoritative-metadata', licence: 'proprietary analysis-only', snapshot_version: 'official-current' },
      ],
    },
    workspaceModel: {
      schemaVersion: 'lab-test-v1',
      targets: [{ name: 'Starfield VR' }],
      experiments: [
        { id: 'experiment-openxr-readiness', title: 'OpenXR readiness proof', status: 'queued', hypothesis: 'A bounded readiness probe can separate provider truth from flat fallback.', relatedTechniques: ['openxr'] },
      ],
    },
    updatedAt,
    currentTarget: 'Starfield VR',
    nextAuthorisedAction: 'Complete the VR Research Agent Q&A participant proof before broader runtime claims.',
    facts: [
      { subjectRef: 'mutar', evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE', claim: 'Public implementation evidence exists.' },
      { subjectRef: 'creation-kit', evidencePlane: 'OFFICIAL_AUTHORING_EVIDENCE', claim: 'Authoring data relationships are documented.' },
      { subjectRef: 'local-starfield', evidencePlane: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF', claim: 'Observed runtime identity remains a separate evidence plane.' },
    ],
    blockers: [
      { id: 'spatial-runtime-proof', summary: 'Quest 3 runtime proof is still required before Spatial Bridge promotion.', owner: 'battle-bridge-vr-worker', evidencePlane: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF' },
    ],
    runtimeEvidenceRequests: [
      { id: 'quest3-airlink-proof', summary: 'Collect exact Quest 3 Air Link runtime evidence.' },
    ],
    discoveryCandidates: [
      { id: 'candidate-new-openxr-technique', summary: 'Needs provenance and licence triage.' },
    ],
    proofRefs: ['evidence/receipts/vr-research-test'],
    ...overrides,
  });
}

function request(questionClass, index, overrides = {}) {
  return createVrResearchQuestion({
    questionId: `vr-question-${String(index + 1).padStart(2, '0')}`,
    askerParticipantId: 'chatgpt-bridge',
    questionClass,
    questionText: `Answer the bounded VR research question for ${questionClass}.`,
    createdAtUtc: updatedAt,
    ...overrides,
  });
}

test('VR Research participant advertises the intended participant identity and Q&A capability', () => {
  assert.equal(VR_RESEARCH_PARTICIPANT_ID, 'stephanos-vr-research');
  assert.equal(VR_RESEARCH_QA_CAPABILITY, 'CAN_ASK_AND_ANSWER');
  assert.equal(VR_RESEARCH_QUESTION_CLASSES.length, 10);
});

test('the ten required VR question classes answer from one canonical projection without private state', () => {
  const p = projection();
  const requests = [
    request('SOURCE_STACK', 0),
    request('NEXT_EXPERIMENT', 1),
    request('EVIDENCE_PLANE', 2, { subjectRef: 'mutar' }),
    request('AUTHORING_VS_RUNTIME', 3),
    request('VORPX_BASELINE', 4),
    request('SKYRIM_PARITY', 5),
    request('LICENCE_BOUNDARIES', 6),
    request('SPATIAL_BRIDGE_BLOCKERS', 7),
    request('NEXT_BOUNDED_GOAL', 8),
    request('KNOWN_UNKNOWNS', 9),
  ];

  const answers = requests.map((question) => answerVrResearchQuestion(question, p, { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' }));
  assert.equal(answers.length, 10);
  assert.equal(answers.every((result) => result.valid), true);
  assert.equal(answers.every((result) => result.answer.responderParticipantId === VR_RESEARCH_PARTICIPANT_ID), true);
  assert.equal(answers.every((result) => result.answer.answerVerdict === 'ANSWERED_GROUNDED'), true);
  assert.equal(answers.every((result) => result.answer.freshness === 'FRESH'), true);
  assert.equal(answers.every((result) => result.answer.evidenceRefs.includes('evidence/receipts/vr-research-test')), true);
});

test('source-stack answer exposes bounded source identity and rights state rather than claiming runtime proof', () => {
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.match(result.answer.answerText, /4 canonical VR research sources/);
  assert.equal(result.answer.facts.some((source) => source.sourceId === 'vorpx' && source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY'), true);
  assert.equal(result.answer.facts.some((source) => source.sourceId === 'creation-kit' && source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY'), true);
});

test('evidence-plane answer keeps public implementation, authoring and observed runtime evidence distinct', () => {
  const p = projection();
  const mutar = answerVrResearchQuestion(request('EVIDENCE_PLANE', 2, { subjectRef: 'mutar' }), p, { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  assert.match(mutar.answer.answerText, /DIRECT_PUBLIC_SOURCE_EVIDENCE/);

  const split = answerVrResearchQuestion(request('AUTHORING_VS_RUNTIME', 3), p, { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  assert.match(split.answer.answerText, /1 authoring fact/);
  assert.match(split.answer.answerText, /1 observed runtime\/headset fact/);
});

test('missing canonical evidence becomes one bounded gap observation linked to existing goals', () => {
  const result = answerVrResearchQuestion(request('EVIDENCE_PLANE', 2, { subjectRef: 'unproven-provider' }), projection(), { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.ok(result.gapObservation);
  assert.deepEqual(result.gapObservation.existingGoalCandidates, ['#1592', '#1594', '#1597']);
  assert.equal(result.gapObservation.status, 'OBSERVED_NEEDS_DEDUPLICATION');
});

test('stale projection truth cannot be promoted into a grounded answer', () => {
  const staleProjection = projection({ updatedAt: '2026-08-10T10:00:00.000Z' });
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), staleProjection, { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  assert.equal(result.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(result.answer.epistemicState, 'STALE');
  assert.equal(result.answer.evidenceRefs.length, 0);
  assert.ok(result.gapObservation);
});

test('missing or incompatible canonical projection fails honestly rather than fabricating VR knowledge', () => {
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), {}, { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  assert.equal(result.valid, true);
  assert.equal(result.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.match(result.answer.cannotAnswerReason, /projection is missing or incompatible/);
  assert.ok(result.gapObservation);
});

test('a VR Q&A answer projects into the existing Shared Workspace message contract with zero mutation authority', () => {
  const q = request('VORPX_BASELINE', 4);
  const answered = answerVrResearchQuestion(q, projection(), { nowMs, answeredAtUtc: '2026-08-14T11:00:00.000Z' });
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, { correlationId: 'vr-round-001' });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  assert.equal(validateSharedWorkspaceRecord(workspace.record).valid, true);
  assert.equal(workspace.record.participantId, VR_RESEARCH_PARTICIPANT_ID);
  assert.equal(workspace.record.recipientParticipantId, 'chatgpt-bridge');
  assert.equal(workspace.record.channel, 'vr-research-qa');
  assert.equal(workspace.record.sourceMutationAllowed, false);
  assert.equal(workspace.record.commandExecutionAllowed, false);
  assert.equal(workspace.record.mergeAllowed, false);
  assert.equal(workspace.record.deploymentAllowed, false);
});

test('question requests targeting another participant or unknown classes are rejected', () => {
  const wrongTarget = { ...request('SOURCE_STACK', 0), targetParticipantId: 'openclaw' };
  const rejectedTarget = answerVrResearchQuestion(wrongTarget, projection(), { nowMs });
  assert.equal(rejectedTarget.valid, false);
  assert.match(rejectedTarget.errors.join('\n'), /target-participant-mismatch/);

  const unknownClass = { ...request('SOURCE_STACK', 0), questionClass: 'EXECUTE_GAME_MUTATION' };
  const rejectedClass = answerVrResearchQuestion(unknownClass, projection(), { nowMs });
  assert.equal(rejectedClass.valid, false);
  assert.match(rejectedClass.errors.join('\n'), /questionClass-invalid/);
});

test('grounded answers require real projection proof refs rather than receipt-shaped fallbacks', () => {
  const noProofProjection = projection({ proofRefs: [] });
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), noProofProjection, {
    nowMs,
    answeredAtUtc: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.deepEqual(result.answer.evidenceRefs, []);
  assert.match(result.answer.cannotAnswerReason, /does not carry proof references/);
  assert.ok(result.gapObservation);
});

test('only explicit FRESH non-future projection state can ground an answer', () => {
  const declaredUnknown = { ...projection(), freshness: 'UNKNOWN' };
  const unknown = answerVrResearchQuestion(request('SOURCE_STACK', 0), declaredUnknown, {
    nowMs,
    answeredAtUtc: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(unknown.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(unknown.answer.epistemicState, 'UNKNOWN');

  const future = { ...projection(), freshness: 'FRESH', updatedAt: '2026-08-14T11:00:01.000Z' };
  const futureResult = answerVrResearchQuestion(request('SOURCE_STACK', 0), future, {
    nowMs,
    answeredAtUtc: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(futureResult.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(futureResult.answer.epistemicState, 'UNKNOWN');
});

test('directly deserialized lowercase question classes dispatch through the normalized class', () => {
  const lowercase = { ...request('SOURCE_STACK', 0), questionClass: 'source_stack' };
  const result = answerVrResearchQuestion(lowercase, projection(), {
    nowMs,
    answeredAtUtc: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(result.valid, true);
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.match(result.answer.answerText, /4 canonical VR research sources/);
});

test('evidence-free gap messages remain invalid until a real proof reference is supplied', () => {
  const q = request('EVIDENCE_PLANE', 2, { subjectRef: 'unproven-provider' });
  const answered = answerVrResearchQuestion(q, projection(), {
    nowMs,
    answeredAtUtc: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(answered.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(answered.answer.evidenceRefs, []);

  const unproven = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer);
  assert.equal(unproven.validation.valid, false);
  assert.ok(unproven.validation.errors.includes('missing-proofRefs'));

  const proven = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofRefs: ['evidence/receipts/vr-gap-observation-proof'],
  });
  assert.equal(proven.validation.valid, true, proven.validation.errors.join(', '));
  assert.deepEqual(proven.record.proofRefs, ['evidence/receipts/vr-gap-observation-proof']);
});

test('default workspace correlation is safely derived for long colon-bearing question ids', () => {
  const q = request('SOURCE_STACK', 0, { questionId: `vr:${'a'.repeat(100)}` });
  const answered = answerVrResearchQuestion(q, projection(), {
    nowMs,
    answeredAtUtc: '2026-08-14T11:00:00.000Z',
  });
  assert.equal(answered.valid, true);
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer);
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  assert.match(workspace.record.correlationId, /^vr-correlation-[0-9a-f]{24}$/);
  assert.equal(workspace.record.correlationId.includes(':'), false);
});
