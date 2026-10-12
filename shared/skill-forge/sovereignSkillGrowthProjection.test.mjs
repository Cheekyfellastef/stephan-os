import assert from 'node:assert/strict';
import test from 'node:test';
import { projectSovereignSkillGrowth } from './sovereignSkillGrowthProjection.mjs';

const NOW = '2026-10-12T11:35:00.000Z';
function feed(overrides = {}) {
  const draft = {
    schemaVersion: 'stephanos.sovereign-capability-skill-packet.v1',
    id: 'sovereign-skill-windows-service-ownership',
    name: 'Sovereign capability: windows-service-ownership',
    plainEnglishSummary: 'Explain the ownership of a Windows service.',
    whySuggested: 'An existing validated Sovereign Commander learning event reported a missing ability.',
    status: 'DRAFT', canonicalOwnerGoal: '#2573',
    riskLevel: 'HIGH', permissionLevel: 'NEEDS_OPERATOR_APPROVAL',
    constructionAdmissionAllowed: false, activationAllowed: false,
    executionAllowed: false, mergeAuthority: false,
    recipeSteps: [{ step: 'REUSE_CANONICAL_PRIMITIVES' }],
    privatePath: 'C:/Users/private',
  };
  return {
    state: 'ready',
    records: { statusRecords: [{
      schemaVersion: 'shared-agent-workspace-record.v1',
      kind: 'stephanos.shared_workspace.status',
      statusId: 'sovereign-commander-capability-parity-current',
      timestampUtc: '2026-10-12T11:34:00.000Z',
      canonicalOwnerGoal: '#2573',
      capabilityParity: { buildableGapCount: 1 },
      nativeGapIntake: { sourceHealth: 'VALIDATED' },
      capabilityCompiler: {
        schemaVersion: 'stephanos.sovereign-commander-capability-compiler.v1',
        skillConjurerSchema: 'stephanos.sovereign-commander-skill-conjurer.v1',
        skillForgeActivationAllowed: false,
        automaticCapabilityConstructionAllowed: false,
        nativeGapCandidateCount: 1,
        skillForgeCandidateTotalCount: 1,
        skillForgeCandidatesTruncated: false,
        skillForgeCandidates: [draft],
      },
    }] },
    ...overrides,
  };
}

test('live Skill Forge projection shows native and remote gap truth without self-approval', () => {
  const result = projectSovereignSkillGrowth(feed(), { nowUtc: NOW });
  assert.equal(result.state, 'CURRENT');
  assert.equal(result.nativeGapCount, 1);
  assert.equal(result.remoteGapCount, 1);
  assert.equal(result.visibleDraftCount, 1);
  assert.equal(result.drafts[0].origin, 'SOVEREIGN_SELF_DISCOVERY');
  assert.equal(result.drafts[0].status, 'DRAFT');
  assert.equal(result.constructionActive, false);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.readOnly, true);
  assert.equal(JSON.stringify(result).includes('C:/Users/private'), false);
});

test('missing, stale, wrong-owner and self-activating feeds are never shown as current', () => {
  assert.equal(projectSovereignSkillGrowth(null).state, 'UNAVAILABLE');
  assert.equal(projectSovereignSkillGrowth(feed({ records: { statusRecords: [] } }), {nowUtc: NOW}).state, 'UNKNOWN');
  assert.equal(projectSovereignSkillGrowth(feed(), { nowUtc: '2026-10-13T11:35:00.000Z' }).state, 'STALE');
  assert.equal(projectSovereignSkillGrowth(feed({state:'stale'}), {nowUtc:NOW}).state, 'DEGRADED');
  const forged = structuredClone(feed());
  forged.records.statusRecords[0].capabilityCompiler.skillForgeActivationAllowed = true;
  assert.equal(projectSovereignSkillGrowth(forged, {nowUtc:NOW}).state, 'INVALID');
  const unsafe = structuredClone(feed());
  unsafe.records.statusRecords[0].capabilityCompiler.skillForgeCandidates[0].activationAllowed = true;
  const result = projectSovereignSkillGrowth(unsafe, {nowUtc:NOW});
  assert.equal(result.visibleDraftCount, 0);
});
