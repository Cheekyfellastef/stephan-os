import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionScheduler } from './missionScheduler.mjs';

const NOW = '2026-07-24T21:00:00.000Z';
const FRESH = '2026-07-24T20:55:00.000Z';

function goal(issue, overrides = {}) {
  return {
    issue,
    state: 'QUEUED',
    prerequisites: [],
    priority: 1,
    criticalPathWeight: 1,
    reversibility: 'HIGH',
    route: 'CHATGPT_GITHUB',
    evidenceAt: FRESH,
    ...overrides,
  };
}

test('oversized proof-head evidence fails closed before normalization', () => {
  const proofHeadShas = new Array(10001);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1)], proofHeadShas });
  const contradiction = result.contradictions.find(({ code }) => code === 'INVALID_PROOF_HEAD_EVIDENCE');

  assert.equal(result.failClosed, true);
  assert.equal(contradiction?.boundExceeded, true);
  assert.equal(contradiction?.suppliedCount, 10001);
  assert.equal(contradiction?.maximumCount, 10000);
});

test('oversized top-level proof references fail closed before iteration', () => {
  const proofRefs = new Array(10001);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1)], proofRefs });
  const contradiction = result.contradictions.find(({ code }) => code === 'INVALID_PROOF_REFERENCE_EVIDENCE');

  assert.equal(result.failClosed, true);
  assert.equal(contradiction?.boundExceeded, true);
  assert.equal(contradiction?.suppliedCount, 10001);
});

test('oversized goal proof-reference evidence fails closed before iteration', () => {
  const resultProofRefs = new Array(10001);
  const result = buildMissionScheduler({ now: NOW, goals: [goal(1, { resultProofRefs })] });
  const contradiction = result.contradictions.find(({ code }) => code === 'GOAL_PROOF_REFERENCE_EVIDENCE_BOUND_EXCEEDED');

  assert.equal(result.failClosed, true);
  assert.equal(result.portfolio[0].boundExceededFlywheelEvidence[0].suppliedCount, 10001);
  assert.equal(contradiction?.maximumCount, 10000);
});

test('aggregate scheduler evidence fails closed at an operational bound before normalization', () => {
  const goals = Array.from({ length:6 }, (_, goalIndex) => goal(goalIndex + 1, {
    resourceIds:new Array(10000),
  }));
  const result = buildMissionScheduler({ now: NOW, goals });
  const contradiction = result.contradictions.find(({ code }) => code === 'TOTAL_EVIDENCE_BOUND_EXCEEDED');

  assert.equal(result.failClosed, true);
  assert.equal(result.portfolio.length, 0);
  assert.equal(contradiction?.suppliedEvidenceCount, 60000);
  assert.equal(contradiction?.maximumCount, 50000);
});

for (const topLevelKey of ['proofHeadShas', 'proofReceipts', 'proofRefs']) {
  test(`aggregate bound gates ${topLevelKey} entry access before normalization`, () => {
    let reads = 0;
    const hostileEvidence = new Array(10000);
    Object.defineProperty(hostileEvidence, 0, {
      configurable:true,
      enumerable:true,
      get() {
        reads += 1;
        throw new Error('aggregate rejection must not read proof entries');
      },
    });
    const goals = Array.from({ length:5 }, (_, goalIndex) => goal(goalIndex + 1, {
      resourceIds:new Array(10000),
    }));

    const result = buildMissionScheduler({ now: NOW, goals, [topLevelKey]:hostileEvidence });
    const contradiction = result.contradictions.find(({ code }) => code === 'TOTAL_EVIDENCE_BOUND_EXCEEDED');

    assert.equal(reads, 0);
    assert.equal(result.failClosed, true);
    assert.equal(result.portfolio.length, 0);
    assert.equal(contradiction?.suppliedEvidenceCount, 60000);
    assert.equal(contradiction?.maximumCount, 50000);
  });
}

for (const goalEvidenceKey of ['resourceIds', 'resultProofRefs', 'structuralReviewProofRefs', 'modelTestProofRefs']) {
  test(`aggregate bound gates ${goalEvidenceKey} entry access before goal normalization`, () => {
    let reads = 0;
    const goals = Array.from({ length:6 }, (_, goalIndex) => {
      const hostileEvidence = new Array(10000);
      if (goalIndex === 0) Object.defineProperty(hostileEvidence, 0, {
        configurable:true,
        enumerable:true,
        get() {
          reads += 1;
          throw new Error('aggregate rejection must not read goal evidence entries');
        },
      });
      return goal(goalIndex + 1, { [goalEvidenceKey]:hostileEvidence });
    });

    const result = buildMissionScheduler({ now: NOW, goals });
    const contradiction = result.contradictions.find(({ code }) => code === 'TOTAL_EVIDENCE_BOUND_EXCEEDED');

    assert.equal(reads, 0);
    assert.equal(result.failClosed, true);
    assert.equal(result.portfolio.length, 0);
    assert.equal(contradiction?.suppliedEvidenceCount, 60000);
  });
}

test('aggregate counts aliased arrays once per semantic evidence occurrence', () => {
  const sharedResources = new Array(10000);
  const goals = Array.from({ length:6 }, (_, index) => goal(index + 1, { resourceIds:sharedResources }));
  const result = buildMissionScheduler({ now: NOW, goals });
  const contradiction = result.contradictions.find(({ code }) => code === 'TOTAL_EVIDENCE_BOUND_EXCEEDED');

  assert.equal(result.failClosed, true);
  assert.equal(contradiction?.suppliedEvidenceCount, 60000);
});

test('evidence container accessors fail closed without invocation', () => {
  let reads = 0;
  const input = { now:NOW, goals:[goal(1)] };
  Object.defineProperty(input, 'proofRefs', {
    configurable:true,
    enumerable:true,
    get() {
      reads += 1;
      throw new Error('evidence container getter must not run');
    },
  });

  const result = buildMissionScheduler(input);

  assert.equal(reads, 0);
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
});

test('goal entry accessors fail closed without invocation', () => {
  let reads = 0;
  const goals = [goal(1)];
  Object.defineProperty(goals, 0, {
    configurable:true,
    enumerable:true,
    get() {
      reads += 1;
      throw new Error('goal entry getter must not run');
    },
  });

  const result = buildMissionScheduler({ now:NOW, goals });

  assert.equal(reads, 0);
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
});

for (const topLevelKey of ['proofHeadShas', 'proofReceipts', 'proofRefs']) {
  test(`in-bound ${topLevelKey} entry accessors fail closed without invocation`, () => {
    let reads = 0;
    const evidence = new Array(1);
    Object.defineProperty(evidence, 0, {
      configurable:true,
      enumerable:true,
      get() {
        reads += 1;
        throw new Error('in-bound evidence getter must not run');
      },
    });
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1)], [topLevelKey]:evidence });

    assert.equal(reads, 0);
    assert.equal(result.failClosed, true);
    assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
  });
}

for (const goalEvidenceKey of ['resourceIds', 'resultProofRefs', 'structuralReviewProofRefs', 'modelTestProofRefs']) {
  test(`in-bound ${goalEvidenceKey} entry accessors fail closed without invocation`, () => {
    let reads = 0;
    const evidence = new Array(1);
    Object.defineProperty(evidence, 0, {
      configurable:true,
      enumerable:true,
      get() {
        reads += 1;
        throw new Error('in-bound goal evidence getter must not run');
      },
    });
    const result = buildMissionScheduler({ now:NOW, goals:[goal(1, { [goalEvidenceKey]:evidence })] });

    assert.equal(reads, 0);
    assert.equal(result.failClosed, true);
    assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
  });
}

test('revoked evidence proxies return a fail-closed result', () => {
  const revocable = Proxy.revocable([], {});
  revocable.revoke();

  const result = buildMissionScheduler({ now:NOW, goals:[goal(1)], proofRefs:revocable.proxy });

  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
});

test('uninspectable top-level scheduler proxies return fail closed', () => {
  const revocable = Proxy.revocable({}, {});
  revocable.revoke();

  const revokedResult = buildMissionScheduler(revocable.proxy);
  const throwingResult = buildMissionScheduler(new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('top-level descriptor trap');
    },
  }));

  for (const result of [revokedResult, throwingResult]) {
    assert.equal(result.failClosed, true);
    assert.ok(result.contradictions.some(({ code }) => code === 'SCHEDULER_INPUT_INSPECTION_FAILED'));
  }
});

test('accepted evidence and goal proxies are never re-entered through get traps', () => {
  let reads = 0;
  const proofRefs = new Proxy(['proofs/exact-head'], {
    get() {
      reads += 1;
      throw new Error('array get trap must not run');
    },
  });
  const proxiedGoal = new Proxy(goal(1), {
    get() {
      reads += 1;
      throw new Error('goal get trap must not run');
    },
  });

  const result = buildMissionScheduler({ now:NOW, goals:[proxiedGoal], proofRefs });

  assert.equal(reads, 0);
  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#1');
});

test('stateful goal descriptors cannot add evidence after aggregate preflight', () => {
  const goals = Array.from({ length:6 }, (_, goalIndex) => {
    const target = goal(goalIndex + 1, { resourceIds:[] });
    let resourceDescriptorReads = 0;
    return new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        if (key !== 'resourceIds') return Reflect.getOwnPropertyDescriptor(object, key);
        resourceDescriptorReads += 1;
        return {
          configurable:true,
          enumerable:true,
          writable:true,
          value:resourceDescriptorReads === 1
            ? []
            : Array.from({ length:10000 }, (_, resourceIndex) =>
                `drift:${goalIndex + 1}:resource:${String(resourceIndex).padStart(5, '0')}`),
        };
      },
    });
  });

  const result = buildMissionScheduler({ now:NOW, goals });

  assert.equal(result.failClosed, true);
  assert.equal(result.portfolio.length, 0);
  assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
});

test('own __proto__ evidence cannot manufacture inherited scheduling authority', () => {
  const hostileGoal = JSON.parse('{"__proto__":{"issue":31337,"state":"READY","prerequisites":[],"priority":999,"criticalPathWeight":999,"reversibility":"HIGH","route":"CHATGPT_GITHUB","evidenceAt":"2026-07-24T20:55:00.000Z"}}');

  const result = buildMissionScheduler({ now:NOW, goals:[hostileGoal] });

  assert.equal(result.failClosed, true);
  assert.equal(result.selectedGoal, null);
  assert.ok(result.contradictions.some(({ code }) => code === 'INVALID_GOAL_IDENTITY'));
});

test('five canonical maximum resource scopes remain within the aggregate evidence bound', () => {
  const goals = Array.from({ length:5 }, (_, goalIndex) => goal(goalIndex + 1, {
    resourceIds:Array.from({ length:10000 }, (_, resourceIndex) =>
      `goal:${goalIndex + 1}:resource:${String(resourceIndex).padStart(5, '0')}`),
  }));
  const result = buildMissionScheduler({ now: NOW, goals });

  assert.equal(result.failClosed, false);
  assert.equal(result.parallelCandidateDetails.length, 5);
  assert.ok(result.parallelCandidateDetails.every(({ resourceIds }) => resourceIds.length === 10000));
});

test('mixed top-level and goal evidence remains accepted at exactly the aggregate bound', () => {
  const proofHeadShas = new Array(10000).fill('a'.repeat(40));
  const goals = Array.from({ length:4 }, (_, goalIndex) => goal(goalIndex + 1, {
    resourceIds:Array.from({ length:10000 }, (_, resourceIndex) =>
      `mixed:${goalIndex + 1}:resource:${String(resourceIndex).padStart(5, '0')}`),
  }));
  const result = buildMissionScheduler({ now:NOW, goals, proofHeadShas });

  assert.equal(result.failClosed, false);
  assert.equal(result.parallelCandidateDetails.length, 4);
});

test('exact-bound entry accessors still return fail closed without invocation', () => {
  let reads = 0;
  const proofHeadShas = new Array(10000).fill('a'.repeat(40));
  Object.defineProperty(proofHeadShas, 0, {
    configurable:true,
    enumerable:true,
    get() {
      reads += 1;
      throw new Error('exact-bound getter must not run');
    },
  });
  const goals = Array.from({ length:4 }, (_, goalIndex) => goal(goalIndex + 1, {
    resourceIds:Array.from({ length:10000 }, (_, resourceIndex) =>
      `exact:${goalIndex + 1}:resource:${String(resourceIndex).padStart(5, '0')}`),
  }));

  const result = buildMissionScheduler({ now:NOW, goals, proofHeadShas });

  assert.equal(reads, 0);
  assert.equal(result.failClosed, true);
  assert.ok(result.contradictions.some(({ code }) => code === 'EVIDENCE_PREFLIGHT_INSPECTION_FAILED'));
});

test('hostile numeric advisory scores degrade safely without coercion', () => {
  const hostile = { valueOf() { throw new Error('must not coerce'); } };
  const result = buildMissionScheduler({
    now: NOW,
    goals: [
      goal(1, { priority: Symbol('priority'), criticalPathWeight: hostile }),
      goal(2, { priority: 1, criticalPathWeight: 1 }),
    ],
  });

  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#2');
  assert.equal(result.portfolio.find(({ issue }) => issue === 1).priority, 0);
  assert.equal(result.portfolio.find(({ issue }) => issue === 1).criticalPathWeight, 0);
});

test('hostile presentation titles degrade without blocking scheduling authority', () => {
  const result = buildMissionScheduler({
    now:NOW,
    goals:[goal(1, { title:Symbol('presentation-only') })],
  });

  assert.equal(result.failClosed, false);
  assert.equal(result.selectedGoal, '#1');
  assert.equal(result.portfolio[0].title, 'Goal #1');
});
