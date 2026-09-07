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

function proofVerifier(ref, binding) {
  if (!VERIFIED_PROOFS.has(ref)) return false;
  if (!binding) return true;
  return Object.freeze({ verified: true, proofRef: ref, ...binding });
}

function qaInput(overrides = {}) {
  return { nowMs, answeredAtUtc, proofVerifier, ...overrides };
}

function projection(overrides = {}) {
  return buildVrResearchWorkspaceProjection({
    sourceRegistry: {
      schema_version: 'test-1',
      sources: [
        {
          source_id: 'mutar-nomoreflat',
          title: 'Mutar NoMoreFlat Starfield',
          priority: 'P0',
          status: 'open-source-pinned',
          licence: 'MIT',
          snapshot_commit: 'abc123',
        },
        {
          source_id: 'vorpx',
          title: 'vorpX baseline',
          priority: 'P1',
          status: 'operational-analysis',
          licence: 'commercial proprietary',
          snapshot_version: 'current-public',
        },
        {
          source_id: 'skyrim-vr-ecosystem',
          title: 'Skyrim VR VRIK HIGGS PLANCK',
          priority: 'P0',
          status: 'benchmark-pinned',
          licence: 'mixed',
          snapshot_version: 'provider-matrix-v1',
        },
        {
          source_id: 'creation-kit',
          title: 'Starfield Creation Kit',
          priority: 'P0',
          status: 'authoritative-metadata',
          licence: 'proprietary analysis-only',
          snapshot_version: 'official-current',
        },
      ],
    },
    workspaceModel: {
      schemaVersion: 'lab-test-v1',
      targets: [{ name: 'Starfield VR' }],
      experiments: [{
        id: 'experiment-openxr-readiness',
        title: 'OpenXR readiness proof',
        status: 'queued',
        hypothesis: 'A bounded readiness probe can separate provider truth from flat fallback.',
        relatedTechniques: ['openxr'],
      }],
    },
    updatedAt,
    currentTarget: 'Starfield VR',
    nextAuthorisedAction: 'Complete the VR Research Agent Q&A participant proof before broader runtime claims.',
    facts: [
      {
        subjectRef: 'mutar',
        evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE',
        claim: 'Public implementation evidence exists.',
      },
      {
        subjectRef: 'creation-kit',
        evidencePlane: 'OFFICIAL_AUTHORING_EVIDENCE',
        claim: 'Authoring data relationships are documented.',
      },
      {
        subjectRef: 'local-starfield',
        evidencePlane: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF',
        claim: 'Observed runtime identity remains a separate evidence plane.',
      },
    ],
    blockers: [{
      id: 'spatial-runtime-proof',
      summary: 'Quest 3 runtime proof is still required before Spatial Bridge promotion.',
      owner: 'battle-bridge-vr-worker',
      evidencePlane: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF',
    }],
    runtimeEvidenceRequests: [{
      id: 'quest3-airlink-proof',
      summary: 'Collect exact Quest 3 Air Link runtime evidence.',
    }],
    discoveryCandidates: [{
      id: 'candidate-new-openxr-technique',
      summary: 'Needs provenance and licence triage.',
    }],
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
  assert.equal(
    answers.every((result) => result.answer.evidenceRefs.includes('evidence/receipts/vr-research-test')),
    true,
  );
});

test('source and licence answers preserve bounded source truth rather than claiming runtime proof', () => {
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput());
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.match(result.answer.answerText, /4 canonical VR research sources/);
  assert.equal(
    result.answer.facts.some((source) => source.sourceId === 'vorpx'
      && source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY'),
    true,
  );
  assert.equal(
    result.answer.facts.some((source) => source.sourceId === 'creation-kit'
      && source.licenceClass === 'RESTRICTED_OR_ANALYSIS_ONLY'),
    true,
  );
});

test('authoring and observed runtime evidence remain distinct planes', () => {
  const split = answerVrResearchQuestion(request('AUTHORING_VS_RUNTIME', 3), projection(), qaInput());
  assert.match(split.answer.answerText, /1 authoring fact/);
  assert.match(split.answer.answerText, /1 observed runtime\/headset fact/);
});

test('missing canonical subject evidence creates a bounded existing-goal gap', () => {
  const result = answerVrResearchQuestion(
    request('EVIDENCE_PLANE', 2, { subjectRef: 'unproven-provider' }),
    projection(),
    qaInput(),
  );
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.deepEqual(result.gapObservation.existingGoalCandidates, ['#1592', '#1594', '#1597']);
  assert.equal(result.gapObservation.status, 'OBSERVED_NEEDS_DEDUPLICATION');
});

test('stale or incompatible projection truth cannot become grounded', () => {
  const stale = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    projection({ updatedAt: '2026-08-10T10:00:00.000Z' }),
    qaInput(),
  );
  assert.equal(stale.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(stale.answer.epistemicState, 'STALE');
  assert.deepEqual(stale.answer.evidenceRefs, []);

  const missing = answerVrResearchQuestion(request('SOURCE_STACK', 0), {}, qaInput());
  assert.equal(missing.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.match(missing.answer.cannotAnswerReason, /projection is missing or incompatible/);
});

test('proof references alone never ground an answer without trusted proof authority', () => {
  const noVerifier = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    projection(),
    { nowMs, answeredAtUtc },
  );
  assert.equal(noVerifier.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(noVerifier.answer.evidenceRefs, []);

  const rejected = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    projection({ proofRefs: ['evidence/receipts/not-verified'] }),
    qaInput(),
  );
  assert.equal(rejected.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(rejected.answer.evidenceRefs, []);
});

test('ref-only boolean proof cannot ground projection facts', () => {
  const result = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    projection(),
    qaInput({ proofVerifier: (ref) => VERIFIED_PROOFS.has(ref) }),
  );
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(result.answer.evidenceRefs, []);
});

test('proof verifier exceptions fail closed rather than grounding an answer', () => {
  const result = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    projection(),
    qaInput({ proofVerifier() { throw new Error('proof backend unavailable'); } }),
  );
  assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(result.answer.evidenceRefs, []);
});

test('a projection-bound proof ref cannot be replayed after projection content changes', () => {
  let expectedBinding = null;
  const pinnedVerifier = (ref, binding) => {
    if (!VERIFIED_PROOFS.has(ref)) return false;
    if (!binding) return true;
    if (!expectedBinding) expectedBinding = { ...binding };
    if (JSON.stringify(binding) !== JSON.stringify(expectedBinding)) return false;
    return { verified: true, proofRef: ref, ...binding };
  };
  const original = projection();
  const first = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    original,
    qaInput({ proofVerifier: pinnedVerifier }),
  );
  assert.equal(first.answer.answerVerdict, 'ANSWERED_GROUNDED');
  const tampered = {
    ...original,
    facts: [
      ...original.facts,
      {
        subjectRef: 'tampered',
        evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE',
        claim: 'changed after proof',
      },
    ],
  };
  const replay = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    tampered,
    qaInput({ proofVerifier: pinnedVerifier }),
  );
  assert.equal(replay.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(replay.answer.evidenceRefs, []);
});

test('noncanonical projection IDs fail as incompatible freshness evidence', () => {
  const bad = { ...projection(), projectionId: 'bad:projection:id' };
  const result = answerVrResearchQuestion(request('SOURCE_STACK', 0), bad, qaInput());
  assert.equal(result.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.deepEqual(result.answer.evidenceRefs, []);
});

test('unsafe or malformed projection proof refs cannot ground answers', () => {
  for (const proofRefs of [['../secret.json'], [null], ['proofs/ok', 'proofs/ok']]) {
    const result = answerVrResearchQuestion(
      request('SOURCE_STACK', 0),
      projection({ proofRefs }),
      qaInput(),
    );
    assert.equal(result.answer.answerVerdict, 'GAP_KNOWLEDGE');
    assert.deepEqual(result.answer.evidenceRefs, []);
  }
});

test('only explicit FRESH non-future projection state can ground an answer', () => {
  const declaredUnknown = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    { ...projection(), freshness: 'UNKNOWN' },
    qaInput(),
  );
  assert.equal(declaredUnknown.answer.answerVerdict, 'GAP_FRESHNESS');
  const future = answerVrResearchQuestion(
    request('SOURCE_STACK', 0),
    { ...projection(), freshness: 'FRESH', updatedAt: '2026-08-14T11:00:01.000Z' },
    qaInput(),
  );
  assert.equal(future.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(future.answer.epistemicState, 'UNKNOWN');
});

test('directly deserialized lowercase classes dispatch through normalized request state', () => {
  const lowercase = { ...request('SOURCE_STACK', 0), questionClass: 'source_stack' };
  const result = answerVrResearchQuestion(lowercase, projection(), qaInput());
  assert.equal(result.valid, true);
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
});

test('wrong target and unknown question classes fail closed', () => {
  const wrongTarget = answerVrResearchQuestion(
    { ...request('SOURCE_STACK', 0), targetParticipantId: 'openclaw' },
    projection(),
    qaInput(),
  );
  assert.equal(wrongTarget.valid, false);
  assert.match(wrongTarget.errors.join('\n'), /target-participant-mismatch/);

  const unknownClass = answerVrResearchQuestion(
    { ...request('SOURCE_STACK', 0), questionClass: 'EXECUTE_GAME_MUTATION' },
    projection(),
    qaInput(),
  );
  assert.equal(unknownClass.valid, false);
  assert.match(unknownClass.errors.join('\n'), /questionClass-invalid/);
});

test('direct answer facts are sanitized before returning to Q&A consumers', () => {
  const p = projection({
    facts: [{
      subjectRef: 'mutar',
      evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE',
      claim: 'Public implementation evidence exists.',
      apiKey: 'super-secret-value',
      summary: { token: 'nested-secret' },
    }],
  });
  const result = answerVrResearchQuestion(
    request('EVIDENCE_PLANE', 2, { subjectRef: 'mutar' }),
    p,
    qaInput(),
  );
  assert.equal(result.answer.answerVerdict, 'ANSWERED_GROUNDED');
  assert.deepEqual(result.answer.facts, [{
    subjectRef: 'mutar',
    evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE',
    claim: 'Public implementation evidence exists.',
  }]);
  assert.equal(JSON.stringify(result.answer).includes('super-secret-value'), false);
  assert.equal(JSON.stringify(result.answer).includes('nested-secret'), false);
});

test('accessor-backed facts fail closed without invoking getters', () => {
  let getterCalls = 0;
  const fact = {
    subjectRef: 'mutar',
    evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE',
  };
  Object.defineProperty(fact, 'claim', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });
  const p = projection({ facts: [fact] });
  let result;
  assert.doesNotThrow(() => {
    result = answerVrResearchQuestion(
      request('EVIDENCE_PLANE', 2, { subjectRef: 'mutar' }),
      p,
      qaInput(),
    );
  });
  assert.equal(getterCalls, 0);
  assert.equal(result.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.deepEqual(result.answer.facts, []);
});

test('accessor-backed projection route fields fail closed before predicates run', () => {
  const base = projection();
  for (const field of ['subjectRef', 'sourceId']) {
    let getterCalls = 0;
    const accessorRecord = field === 'subjectRef'
      ? { evidencePlane: 'DIRECT_PUBLIC_SOURCE_EVIDENCE', claim: 'must remain unread' }
      : {
        title: 'Accessor source',
        revision: 'test',
        health: 'CURRENT',
        licenceClass: 'DIRECT_PUBLIC_IMPLEMENTATION',
      };
    Object.defineProperty(accessorRecord, field, {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error(`${field} getter must not run`);
      },
    });
    const suppliedProjection = field === 'subjectRef'
      ? { ...base, facts: [accessorRecord] }
      : { ...base, sourceRegistry: { ...base.sourceRegistry, sources: [accessorRecord] } };
    const question = field === 'subjectRef'
      ? request('EVIDENCE_PLANE', 2, { subjectRef: 'mutar' })
      : request('SOURCE_STACK', 0);
    let result;
    assert.doesNotThrow(() => {
      result = answerVrResearchQuestion(question, suppliedProjection, qaInput());
    });
    assert.equal(getterCalls, 0, field);
    assert.equal(result.answer.answerVerdict, 'GAP_FRESHNESS', field);
    assert.deepEqual(result.answer.facts, [], field);
  }
});

test('JSON __proto__ records fail closed without prototype mutation or secret leakage', () => {
  const poisonous = JSON.parse('{"__proto__":{"title":"apiKey-super-secret","status":"queued"}}');
  const supplied = { ...projection(), researchQueue: [poisonous] };
  const result = answerVrResearchQuestion(request('NEXT_EXPERIMENT', 1), supplied, qaInput());
  assert.equal(result.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.equal(result.answer.epistemicState, 'UNKNOWN');
  assert.deepEqual(result.answer.facts, []);
  assert.equal(result.answer.answerText.includes('apiKey-super-secret'), false);
  assert.equal(Object.prototype.title, undefined);
});

test('inherited and accessor-backed proof attestations cannot ground projection facts', () => {
  const question = request('SOURCE_STACK', 0);
  const inheritedVerifier = (ref, binding) => Object.create({
    verified: true,
    proofRef: ref,
    ...binding,
  });
  const inherited = answerVrResearchQuestion(
    question,
    projection(),
    qaInput({ proofVerifier: inheritedVerifier }),
  );
  assert.equal(inherited.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(inherited.answer.evidenceRefs, []);

  let getterCalls = 0;
  const accessorVerifier = (ref, binding) => {
    const attestation = { proofRef: ref, ...binding };
    Object.defineProperty(attestation, 'verified', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    return attestation;
  };
  const accessor = answerVrResearchQuestion(
    question,
    projection(),
    qaInput({ proofVerifier: accessorVerifier }),
  );
  assert.equal(getterCalls, 0);
  assert.equal(accessor.answer.answerVerdict, 'GAP_KNOWLEDGE');
  assert.deepEqual(accessor.answer.evidenceRefs, []);
});

test('accessor-backed Workspace proof attestations are rejected without getter calls', () => {
  const q = request('VORPX_BASELINE', 4);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  let getterCalls = 0;
  const accessorVerifier = (ref, binding) => {
    const attestation = { proofRef: ref, ...binding };
    Object.defineProperty(attestation, 'verified', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return true;
      },
    });
    return attestation;
  };
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    correlationId: 'vr-round-001',
    proofVerifier: accessorVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(getterCalls, 0);
  assert.equal(workspace.validation.valid, false);
  assert.ok(workspace.validation.errors.includes('missing-proofRefs'));
});

test('revoked and throwing proxies fail closed without escaping the Q&A boundary', () => {
  const question = request('SOURCE_STACK', 0);
  const revocable = Proxy.revocable(projection(), {});
  revocable.revoke();
  let revokedResult;
  assert.doesNotThrow(() => {
    revokedResult = answerVrResearchQuestion(question, revocable.proxy, qaInput());
  });
  assert.equal(revokedResult.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.deepEqual(revokedResult.answer.facts, []);

  const throwing = new Proxy(projection(), {
    getPrototypeOf() {
      throw new Error('prototype trap must fail closed');
    },
  });
  let throwingResult;
  assert.doesNotThrow(() => {
    throwingResult = answerVrResearchQuestion(question, throwing, qaInput());
  });
  assert.equal(throwingResult.answer.answerVerdict, 'GAP_FRESHNESS');
  assert.deepEqual(throwingResult.answer.facts, []);
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
  assert.equal(workspace.record.sourceMutationAllowed, false);
  assert.equal(workspace.record.commandExecutionAllowed, false);
  assert.equal(workspace.record.mergeAllowed, false);
  assert.equal(workspace.record.deploymentAllowed, false);
});

test('grounded Workspace answers cannot borrow a separate proof receipt', () => {
  const q = request('SOURCE_STACK', 0);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const forged = {
    ...answered.answer,
    evidenceRefs: [],
    facts: [{ sourceId: 'fabricated', title: 'fabricated fact' }],
  };
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, forged, {
    proofRefs: ['evidence/receipts/vr-gap-observation-proof'],
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, false);
  assert.ok(workspace.validation.errors.includes('missing-proofRefs'));
});

test('Workspace receipts are bound to exact normalized answer content', () => {
  const q = request('SOURCE_STACK', 0);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  let expectedBinding = null;
  const pinnedVerifier = (ref, binding) => {
    if (!VERIFIED_PROOFS.has(ref)) return false;
    if (!expectedBinding) expectedBinding = { ...binding };
    if (JSON.stringify(binding) !== JSON.stringify(expectedBinding)) return false;
    return { verified: true, proofRef: ref, ...binding };
  };
  const original = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofVerifier: pinnedVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(original.validation.valid, true, original.validation.errors.join(', '));
  const forged = {
    ...answered.answer,
    facts: [{ sourceId: 'fabricated', title: 'different answer content' }],
  };
  const replay = createVrResearchQaWorkspaceAnswerRecord(q, forged, {
    proofVerifier: pinnedVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(replay.validation.valid, false);
  assert.ok(replay.validation.errors.includes('missing-proofRefs'));
});

test('Workspace publication also requires proof verification rather than path-shaped refs', () => {
  const q = request('SOURCE_STACK', 0);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const withoutVerifier = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    validationOptions: { nowMs },
  });
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
  const unproven = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    validationOptions: { nowMs },
  });
  assert.equal(unproven.validation.valid, false);
  assert.ok(unproven.validation.errors.includes('missing-proofRefs'));
  const proven = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofRefs: ['evidence/receipts/vr-gap-observation-proof'],
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(proven.validation.valid, true, proven.validation.errors.join(', '));
});

test('directly deserialized request extras are never serialized into Shared Workspace body', () => {
  const q = {
    ...request('SOURCE_STACK', 0),
    apiKey: 'super-secret-value',
    arbitraryMutation: true,
  };
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  const body = JSON.parse(workspace.record.body);
  assert.equal(Object.hasOwn(body.request, 'apiKey'), false);
  assert.equal(Object.hasOwn(body.request, 'arbitraryMutation'), false);
  assert.equal(workspace.record.body.includes('super-secret-value'), false);
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

test('nested fact fields are sanitized before Workspace serialization', () => {
  const q = request('SOURCE_STACK', 0);
  const answered = answerVrResearchQuestion(q, projection(), qaInput());
  const forged = {
    ...answered.answer,
    facts: [{
      sourceId: 'mutar-nomoreflat',
      title: 'safe-title',
      apiKey: 'super-secret-value',
      summary: { token: 'nested-secret' },
    }],
  };
  const workspace = createVrResearchQaWorkspaceAnswerRecord(q, forged, {
    proofVerifier,
    validationOptions: { nowMs },
  });
  assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
  const body = JSON.parse(workspace.record.body);
  assert.deepEqual(body.answer.facts, [{ sourceId: 'mutar-nomoreflat', title: 'safe-title' }]);
  assert.equal(workspace.record.body.includes('super-secret-value'), false);
  assert.equal(workspace.record.body.includes('nested-secret'), false);
});

test('canonical source and experiment facts survive Workspace fact sanitization', () => {
  for (const [questionClass, index] of [['SOURCE_STACK', 0], ['NEXT_EXPERIMENT', 1]]) {
    const q = request(questionClass, index);
    const answered = answerVrResearchQuestion(q, projection(), qaInput());
    const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answered.answer, {
      proofVerifier,
      validationOptions: { nowMs },
    });
    assert.equal(workspace.validation.valid, true, workspace.validation.errors.join(', '));
    assert.equal(JSON.parse(workspace.record.body).answer.facts.length > 0, true);
  }
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


test('out-of-range evaluation clocks cannot throw through the public answer boundary', () => {
  for (const hostileNowMs of [Number.MAX_VALUE, Infinity, -Infinity, NaN]) {
    let result;
    assert.doesNotThrow(() => {
      result = answerVrResearchQuestion(
        request('SOURCE_STACK', 0),
        projection(),
        qaInput({ nowMs: hostileNowMs, answeredAtUtc: 'not-a-timestamp' }),
      );
    });
    assert.equal(result.valid, true);
    assert.equal(Number.isFinite(Date.parse(result.answer.answeredAtUtc)), true);
    assert.equal(new Date(Date.parse(result.answer.answeredAtUtc)).toISOString(), result.answer.answeredAtUtc);
  }
});

test('noncanonical or inconsistent answeredAtUtc falls back to the trusted evaluation timestamp', () => {
  for (const candidate of ['2026-08-14T11:00:00Z', 'not-a-timestamp', '2026-08-14T10:59:59.000Z']) {
    const result = answerVrResearchQuestion(
      request('SOURCE_STACK', 0),
      projection(),
      qaInput({ answeredAtUtc: candidate }),
    );
    assert.equal(result.answer.answeredAtUtc, answeredAtUtc);
  }
});

test('canonical answeredAtUtc consistent with nowMs remains deterministic', () => {
  const first = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput());
  const second = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), qaInput());
  assert.equal(first.answer.answeredAtUtc, answeredAtUtc);
  assert.equal(second.answer.answeredAtUtc, answeredAtUtc);
});

test('timestamp accessors are never invoked', () => {
  let nowCalls = 0;
  let answeredCalls = 0;
  const input = { proofVerifier };
  Object.defineProperty(input, 'nowMs', {
    enumerable: true,
    get() {
      nowCalls += 1;
      throw new Error('must not execute');
    },
  });
  Object.defineProperty(input, 'answeredAtUtc', {
    enumerable: true,
    get() {
      answeredCalls += 1;
      throw new Error('must not execute');
    },
  });
  let result;
  assert.doesNotThrow(() => {
    result = answerVrResearchQuestion(request('SOURCE_STACK', 0), projection(), input);
  });
  assert.equal(result.valid, true);
  assert.equal(nowCalls, 0);
  assert.equal(answeredCalls, 0);
});

test('directly deserialized contradictory answer truth states fail before proof verification', () => {
  const q = request('SOURCE_STACK', 0);
  const canonical = answerVrResearchQuestion(q, projection(), qaInput()).answer;
  const cases = [
    [{ ...canonical, freshness: 'STALE', epistemicState: 'UNKNOWN', cannotAnswerReason: 'contradictory' }, 'answer-grounded-requires-fresh'],
    [{ ...canonical, epistemicState: 'UNKNOWN' }, 'answer-grounded-epistemic-state-invalid'],
    [{ ...canonical, cannotAnswerReason: 'should not exist' }, 'answer-grounded-cannot-have-refusal-reason'],
    [{ ...canonical, answerVerdict: 'GAP_KNOWLEDGE', epistemicState: 'UNKNOWN', cannotAnswerReason: 'knowledge gap', freshness: 'UNKNOWN' }, 'answer-knowledge-gap-requires-fresh'],
    [{ ...canonical, answerVerdict: 'GAP_KNOWLEDGE', epistemicState: 'KNOWN_FROM_CANONICAL_STATE', cannotAnswerReason: 'knowledge gap' }, 'answer-knowledge-gap-epistemic-state-invalid'],
    [{ ...canonical, answerVerdict: 'GAP_KNOWLEDGE', epistemicState: 'UNKNOWN', cannotAnswerReason: null }, 'answer-gap-refusal-reason-required'],
    [{ ...canonical, answerVerdict: 'GAP_FRESHNESS', freshness: 'FRESH', epistemicState: 'UNKNOWN', cannotAnswerReason: 'freshness gap' }, 'answer-freshness-gap-state-invalid'],
    [{ ...canonical, answerVerdict: 'GAP_FRESHNESS', freshness: 'STALE', epistemicState: 'UNKNOWN', cannotAnswerReason: 'freshness gap' }, 'answer-freshness-gap-epistemic-state-mismatch'],
    [{ ...canonical, answerVerdict: 'GAP_FRESHNESS', freshness: 'UNKNOWN', epistemicState: 'UNKNOWN', cannotAnswerReason: null }, 'answer-gap-refusal-reason-required'],
    [{ ...canonical, answerVerdict: 'ANSWERED_CONFIDENT' }, 'answer-verdict-invalid'],
    [{ ...canonical, freshness: 'RECENT' }, 'answer-freshness-invalid'],
    [{ ...canonical, epistemicState: 'ASSUMED' }, 'answer-epistemic-state-invalid'],
  ];

  for (const [answer, expectedError] of cases) {
    let verifierCalls = 0;
    const workspace = createVrResearchQaWorkspaceAnswerRecord(q, answer, {
      proofVerifier(ref, binding) {
        verifierCalls += 1;
        return { verified: true, proofRef: ref, ...binding };
      },
      validationOptions: { nowMs },
    });
    assert.equal(workspace.answerValidation.valid, false, expectedError);
    assert.ok(workspace.answerValidation.errors.includes(expectedError), workspace.answerValidation.errors.join(', '));
    assert.equal(verifierCalls, 0, expectedError);
    assert.equal(workspace.validation.valid, false, expectedError);
  }
});
