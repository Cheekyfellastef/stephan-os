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
const answeredAtUtc = '2026-08-14T11:00:00.000Z';
const nowMs = Date.parse(answeredAtUtc);
const VERIFIED_PROOFS = new Set([
  'evidence/receipts/vr-research-test',
  'evidence/receipts/vr-gap-observation-proof',
]);

function proofVerifier(ref) {
  return VERIFIED_PROOFS.has(ref);
}

function qaInput(overrides = {}) {
  return {
    nowMs,
    answeredAtUtc,
    proofVerifier,
    ...overrides,
  };
}

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

test('VR Research participant exposes one bounded Q&A identity', () => {
  assert.equal(VR_RESEARCH_PARTICIPANT_ID, 'stephanos-vr-research');
  assert.equal(VR_RESEARCH_QA_CAPABILITY, 'CAN_ASK_AND_ANSWER');
  assert.equal(VR_RESEARCH_QUESTION_CLASSES.length, 10);
});

test('all ten proving classes ground only when canonical projection proofs are verified', () => {
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
  const answers = requests.map((question) => answerVrResearchQuestion(question, p, qaInput()));
  assert.equal(answers.every((result) => result.valid), true);
  assert.equal(answers.every((result) => result.answer.answerVerdict === 'ANSWERED_GROUNDED'), true);
  assert.equal(answers.every((result) => result.answer.evidenceRefs.includes('evidence/receipts/vr-research-test')), true);
});

test('source and licence answers preserve bounded source truth rather than claiming runtime proof', () => {
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput());
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.match(result.answer.answerText, /4 canonical VR research sources/);
  assert.equal(result.answer.facts.some((source) => source.sourceId === 'vorpx' && source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY'), true);
  assert.equal(result.answer.facts.some((source) => source.sourceId === 'creation-kit' && source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY'), true);
});

test('authoring and observed runtime evidence remain distinct planes', () => {
  const split = answerVrResearchQuestion(request('AUTHORING_VS_RUNTIME', 3), projection(), qaInput());
  assert.match(split.answer.answerText, /1 authoring fact/);
  assert.match(split.answer.answerText, /1 observed runtime\/headset fact/);
});

test('missing canonical subject evidence creates a bounded existing-goal gap', () => {
  const result = answerVrResearchQuestion(request('EVIDENCE_PLANE', 2, { subjectRef: 'unproven-provider' }), projection(), qaInput());
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.deepEqual(result.gapObservation.existingGoalCandidates, ['#1592', '#1594', '#1597']);
  assert.equal(result.gapObservation.status, 'OBSERVED_NEEDS_DEDUPLICATION');
});

test('stale or incompatible projection truth cannot become grounded', () => {
  const stale = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection({ updatedAt: '2026-08-10T10:00:00.000Z' }), qaInput());
  assert.equal(stale.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(stale.answer.epistemicState, 'STALE');
  assert.deepEqual(stale.answer.evidenceRefs, []);

  const missing = answerVrResearchQuestion(request('SOURCE_STACK', 0), {}, qaInput());
  assert.equal(missing.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.match(missing.answer.cannotAnswerReason, /projection is missing or incompatible/);
});

test('proof references alone never ground an answer without trusted proof authority', () => {
  const noVerifier = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), {
    nowMs,
    answeredAtUtc,
  });
  assert.equal(noVerifier.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(noVerifier.answer.evidenceRefs, []);
  assert.match(noVerifier.answer.cannotAnswerReason, /not verified by the trusted proof authority/);

  const rejected = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection({ proofRefs: ['evidence/receipts/not-verified'] }), qaInput());
  assert.equal(rejected.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(rejected.answer.evidenceRefs, []);
});

test('proof verifier exceptions fail closed rather than grounding an answer', () => {
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput({
    proofVerifier() { throw new Error('proof backend unavailable'); },
  }));
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(result.answer.evidenceRefs, []);
});

test('unsafe or malformed projection proof refs cannot ground answers', () => {
  for (const proofRefs of [['../secret.json'], [null], ['proofs/ok', 'proofs/ok']]) {
    const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection({ proofRefs }), qaInput());
    assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
    assert.deepEqual(result.answer.evidenceRefs, []);
  }
});

test('only explicit FRESH non-future projection state can ground an answer', () => {
  const declaredUnknown = answerVrResearchQuestion(request('SOURCE_STACK', 0), { ...projection(), freshness: 'UNKNOWN' }, qaInput());
  assert.equal(declaredUnknown.answer.answerVerdict, 'GAP_FRESHNESS');

  const future = answerVrResearchQuestion(request('SOURCE_STACK', 0), { ...projection(), freshness: 'FRESH', updatedAt: '2026-08-14T11:00:01.000Z' }, qaInput());
  assert.equal(future.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(future.answer.epistemicState, 'UNKNOWN');
});

test('directly deserialized lowercase classes dispatch through normalized request state', () => {
  const lowercase = { ...request('SOURCE_STACK', 0), questionClass: 'source_stack' };
  const result = answerVrResearchQuestion(lowercase, projection(), qaInput());
  assert.equal(result.valid, true);
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.match(result.answer.answerText, /4 canonical VR research sources/);
});

test('wrong target and unknown question classes fail closed', () => {
  const wrongTarget = answerVrResearchQuestion({ ...request('SOURCE_STACK', 0), targetParticipantId: 'openclaw' }, projection(), qaInput());
  assert.equal(wrongTarget.valid, false);
  assert.match(wrongTarget.errors.join('\n'), /target-participant-mismatch/);

  const unknownClass = answerVrResearchQuestion({ ...request('SOURCE_STACK', 0), questionClass: 'EXECUTE_GAME_MUTATION' }, projection(), qaInput());
  assert.equal(unknownClass.valid, false);
  assert.match(unknownClass.errors.join('\n'), /questionClass-invalid/);
});

test('verified grounded answers publish through the existing Shared Workspace contract with zero authority', () => {
  const q = request('VORPX_BASELINE', 4);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    correlationId: 'vr-round-001',
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  assert.equal(validateSharedWorkspaceRecord(workspace.record, { nowMs }).valid, true);
  assert.equal(workspace.record.participantId, VR_RESEARCH_PARTICIPANT_ID);
  assert.equal(workspace.record.recipientParticipantId, 'chatgpt-bridge');
  assert.equal(workspace.record.sourceMutationAllowed, false);
  assert.equal(workspace.record.commandExecutionAllowed, false);
  assert.equal(workspace.record.mergeAllowed, false);
  assert.equal(workspace.record.deploymentAllowed, false);
});

test('Workspace publication also requires proof verification rather than path-shaped refs', () => {
  const q = request('SOURCE_STACK', 0);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const withoutVerifier = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, { validationOptions: { nowMs } });
  assert.equal(withoutVerifier.validation.valid, false);
  assert.ok(withoutVerifier.validation.errors.includes('missing-proofRefs'));

  const rejectingVerifier = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofVerifier: () => false,
    validationOptions: { nowMs },
  });
  assert.equal(rejectingVerifier.validation.valid, false);
  assert.ok(rejectingVerifier.validation.errors.includes('missing-proofRefs'));
});

test('evidence-free gap messages require a separately verified proof before publication', () => {
  const q = request('EVIDENCE_PLANE', 2, { subjectRef: 'unproven-provider' });
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  assert.equal(answered.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(answered.answer.evidenceRefs, []);

  const unproven = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, { validationOptions: { nowMs } });
  assert.equal(unproven.validation.valid, false);
  assert.ok(unproven.validation.errors.includes('missing-proofRefs'));

  const proven = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofRefs: ['evidence/receipts/vr-gap-observation-proof'],
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(proven.validation.valid, true, proven.validation.errors.join(', '));
  assert.deepEqual(proven.record.proofRefs, ['evidence/receipts/vr-gap-observation-proof']);
});

test('directly deserialized request extras are never serialized into Shared Workspace body', () => {
  const q = { ...request('SOURCE_STACK', 0), apiKey: 'super-secret-value', arbitraryMutation: true };
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  assert.equal(answered.valid, true);
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  const body = JSON.parse(workspace.record.body);
  assert.equal(Object.hasOwn(body.request, 'apiKey'), false);
  assert.equal(Object.hasOwn(body.request, 'arbitraryMutation'), false);
  assert.equal(workspace.record.body.includes('super-secret-value'), false);
  assert.deepEqual(Object.keys(body.request).sort(), [
    'askerParticipantId',
    'createdAtUtc',
    'questionClass',
    'questionId',
    'questionText',
    'schemaVersion',
    'subjectRef',
    'targetParticipantId',
  ]);
});

test('caller-added answer fields are also excluded from Workspace serialization', () => {
  const q = request('SOURCE_STACK', 0);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const forged = { ...answered.answer, apiKey: 'answer-secret', mergeAllowed: true };
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, forged, {
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  const body = JSON.parse(workspace.record.body);
  assert.equal(Object.hasOwn(body.answer, 'apiKey'), false);
  assert.equal(Object.hasOwn(body.answer, 'mergeAllowed'), false);
  assert.equal(workspace.record.body.includes('answer-secret'), false);
});

test('default Workspace correlation safely derives long colon-bearing question ids', () => {
  const q = request('SOURCE_STACK', 0, { questionId: `vr:${'a'.repeat(100)}` });
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  assert.match(workspace.record.correlationId, /^vr-correlation-[0-9a-f]{24}$/);
  assert.equal(workspace.record.correlationId.includes(':'), false);
});
