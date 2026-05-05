import test from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ARCHITECTURE_MAP, deriveAffectedSubsystemsForMission, buildRepoArchitectureContext } from './repoArchitectureMapModel.js';

test('architecture map contains key stephanos subsystems and generated dist truth', () => {
  const ids = REPO_ARCHITECTURE_MAP.subsystems.map((s) => s.id);
  ['mission-console','intent-to-build','mission-memory','openclaw-delegation','mission-finish-authority','codex-handoff','support-snapshot','generated-dist'].forEach((id)=>assert.equal(ids.includes(id), true));
  assert.equal(REPO_ARCHITECTURE_MAP.sourceTruthRules.some((rule) => /generated output, not source truth/i.test(rule)), true);
});

test('mission matching maps openclaw memory and merge intents deterministically', () => {
  const openclaw = deriveAffectedSubsystemsForMission({ operatorIntent: 'OpenClaw delegated authority and codex handoff only.' });
  ['openclaw-delegation','mission-console','intent-to-build','codex-handoff','support-snapshot','verification-return'].forEach((id)=>assert.equal(openclaw.includes(id), true));
  const memory = deriveAffectedSubsystemsForMission({ operatorIntent: 'Improve mission memory context.' });
  ['mission-memory','intent-to-build','mission-console','support-snapshot'].forEach((id)=>assert.equal(memory.includes(id), true));
  const merge = deriveAffectedSubsystemsForMission({ operatorIntent: 'merge authority should remain operator-controlled' });
  ['mission-finish-authority','mission-console','codex-handoff','support-snapshot'].forEach((id)=>assert.equal(merge.includes(id), true));
});

test('architecture context surfaces likely tests and verification commands', () => {
  const context = buildRepoArchitectureContext({ operatorIntent: 'OpenClaw delegated authority with verification and mission console updates.' });
  assert.equal(context.testsLikelyRequired.length > 0, true);
  assert.equal(context.verificationCommandsLikelyRequired.length > 0, true);
});
