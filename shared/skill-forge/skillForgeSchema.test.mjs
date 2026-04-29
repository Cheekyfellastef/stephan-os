import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_SKILL_CANDIDATES } from './seedSkillCandidates.mjs';
import { buildSkillReviewHandoff, filterSkillCandidates, getSkillPermissionLabel, getSkillRiskLabel, getSkillStatusLabel } from './skillForgeSchema.mjs';

test('seed candidates load', () => {
  assert.ok(SEED_SKILL_CANDIDATES.length >= 3);
});

test('labels resolve', () => {
  assert.equal(getSkillStatusLabel('DRAFT'), 'Draft');
  assert.match(getSkillPermissionLabel('READ_ONLY'), /Read-only/);
  assert.equal(getSkillRiskLabel('HIGH'), 'High');
});

test('handoff includes guardrail line', () => {
  const handoff = buildSkillReviewHandoff(SEED_SKILL_CANDIDATES[0]);
  assert.match(handoff, /Do not activate, execute, or grant new permissions without operator approval/);
});

test('filter by awaiting review returns expected candidates', () => {
  const filtered = filterSkillCandidates(SEED_SKILL_CANDIDATES, 'awaiting-review');
  assert.ok(filtered.every((candidate) => candidate.status === 'AWAITING_REVIEW'));
});
