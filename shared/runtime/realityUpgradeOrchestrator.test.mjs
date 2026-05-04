import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRealityUpgradeOrchestrator } from './realityUpgradeOrchestrator.mjs';

test('high-level intent produces staged mission plan and keeps approvals explicit', () => {
  const model = buildRealityUpgradeOrchestrator({
    runtimeContext: {
      realityUpgradeIntent: {
        upgradeIntent: 'Upgrade routing truth and codex handoff quality.',
        affectedSystemArea: 'runtime-routing',
        capabilityGaps: ['verification automation', 'mind selection'],
      },
    },
    aiMindRegistry: { minds: [], externalMindSourcesProjection: [{ sourceId: 'x', approvalState: 'recommended', privacyClass: 'cloud' }] },
  });
  assert.equal(model.orchestrationStatus, 'draft_plan_ready');
  assert.equal(model.missionStages[0].stageId, 'interpret_intent');
  assert.equal(model.intentToMissionProjection.approvalsNeeded.includes('approve_external_mind_onboarding'), true);
  assert.equal(model.candidateMindSources[0].approvalState, 'recommended');
});

test('orchestrator never auto-approves openclaw or external mind actions by default', () => {
  const model = buildRealityUpgradeOrchestrator({ runtimeContext: {}, aiMindRegistry: {} });
  assert.equal(model.approvalCheckpoints.includes('approve_openclaw_mind_access'), true);
  assert.equal(model.guardrailChecks.includes('no_openclaw_access_to_unapproved_minds'), true);
});
