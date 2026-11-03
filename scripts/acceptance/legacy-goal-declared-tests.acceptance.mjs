import test from 'node:test';
import { assertLegacyGoalDeclaredTestAcceptanceV1 } from '../../shared/agents/legacyGoalTestPlanAcceptanceV1.mjs';
import { planElasticGoalMissionAdmissions } from '../../stephanos-server/services/elasticGoalMissionAdmissionService.js';

// Owner-selected task acceptance, deliberately separate from general regressions.
// It must fail until the specified implementation exists. No skip or fallback.
test('legacy exact test-file scopes bind focused acceptance before a new grant', () => {
  assertLegacyGoalDeclaredTestAcceptanceV1(planElasticGoalMissionAdmissions);
});
