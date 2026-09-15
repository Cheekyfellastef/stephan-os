import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_OC2_SPECIALIST_PATHS_V1,
  analyzeOpenClawOc2SpecialistReviewV1,
} from './openClawOc2SpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const CANONICAL_OC2_BRANCH = 'agent/openclaw-oc2-deterministic-test-build-v1';
const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

function escalation() {
  return {
    findings: OPENCLAW_OC2_SPECIALIST_PATHS_V1.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}

function probe(branch) {
  return analyzeOpenClawOc2SpecialistReviewV1({
    repository: REPOSITORY,
    prNumber: 1931,
    branch,
    sourceHead: HEAD,
    baseSha: BASE,
    analysis: escalation(),
  });
}

test('OC2 specialist eligibility rejects a renamed or replayed PR #1931 branch', () => {
  assert.equal(probe('replay/openclaw-oc2-deterministic-test-build-v1').eligible, false);
  assert.equal(probe('agent/openclaw-oc2-deterministic-test-build-v1-renamed').eligible, false);
});

test('OC2 specialist eligibility remains applicable to the exact canonical PR #1931 branch', () => {
  assert.equal(probe(CANONICAL_OC2_BRANCH).eligible, true);
});
