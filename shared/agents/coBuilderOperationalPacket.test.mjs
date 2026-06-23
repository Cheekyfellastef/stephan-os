import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoBuilderOperationalPacket, DEFAULT_OPERATIONAL_FORBIDDEN_FILES } from './coBuilderOperationalPacket.mjs';

const base = {
  missionId: 'mission-1',
  operatorIntent: 'Implement a bounded source-side packet builder.',
  intendedOutcome: 'Source module and tests are complete.',
  missionStatus: 'active',
  missionBrainNextAction: { missionObjective: 'Implement packet builder', nextBestAction: 'Implement bounded source module', proofRequiredBeforeMerge: [] },
  missionIntelligenceSummary: { missionIntelligenceStatus: 'active', nextBestAction: 'Implement bounded source module' },
  harnessAgentProjection: {
    allowedFileScopes: ['shared/agents/**', 'tests/**'],
    forbiddenFileScopes: ['apps/stephanos/dist/**'],
    requiredTests: ['node --test shared/agents/coBuilderOperationalPacket.test.mjs'],
    definitionOfDone: ['tests-pass'],
    browserProofRequired: false,
  },
  agentWorkRoutingProjection: { requiredProof: ['focused test output'], requiredTests: ['npm run stephanos:verify'] },
  verificationReturnIntake: { missingEvidence: [] },
};

test('normal implementation mission assigns Codex as sole writer and OpenClaw as verifier', () => {
  const packet = buildCoBuilderOperationalPacket(base);
  assert.equal(packet.primaryOwner, 'Codex');
  assert.equal(packet.supportingAgent, 'OpenClaw');
  assert.equal(packet.activeWriter, 'Codex');
  assert.equal(packet.operatorApprovalRequired, true);
  assert.equal(packet.finalVerdict, 'READY_FOR_OPERATOR_APPROVAL');
});

test('live-browser investigation assigns OpenClaw as primary inspector without write authority', () => {
  const packet = buildCoBuilderOperationalPacket({
    ...base,
    operatorIntent: 'Run live browser investigation and collect UI proof.',
    supportSnapshot: { taskKind: 'live-browser-investigation' },
  });
  assert.equal(packet.primaryOwner, 'OpenClaw');
  assert.equal(packet.supportingAgent, 'Codex');
  assert.equal(packet.activeWriter, 'none');
  assert.deepEqual(packet.allowedActions, ['read-only-discovery', 'live-runtime-inspection', 'browser-verification', 'report-evidence']);
  assert.equal(packet.browserProofRequired, true);
});

test('no packet permits both agents to write concurrently', () => {
  for (const supportSnapshot of [{ taskKind: 'implementation' }, { taskKind: 'live-browser-investigation' }, { taskKind: 'unknown' }]) {
    const packet = buildCoBuilderOperationalPacket({ ...base, supportSnapshot });
    assert.notEqual(packet.activeWriter, 'Codex+OpenClaw');
    assert.ok(['Codex', 'none'].includes(packet.activeWriter));
    assert.ok(packet.disallowedActions.includes('simultaneous-agent-writes'));
  }
});

test('unknown or sensitive scope blocks safely', () => {
  const unknown = buildCoBuilderOperationalPacket({ ...base, operatorIntent: 'Do something useful', supportSnapshot: { taskKind: 'unknown' } });
  assert.equal(unknown.finalVerdict, 'BLOCKED');
  assert.equal(unknown.activeWriter, 'none');

  const sensitive = buildCoBuilderOperationalPacket({
    ...base,
    operatorIntent: 'Edit .env and deploy policy',
    harnessAgentProjection: { ...base.harnessAgentProjection, allowedFileScopes: ['.env', 'shared/agents/**'] },
  });
  assert.equal(sensitive.finalVerdict, 'BLOCKED');
  assert.match(sensitive.blockingReasons.join(' '), /forbidden|secret|policy/i);
});

test('forbidden paths cannot enter allowedFiles and defaults include generated runtime and secret paths', () => {
  const packet = buildCoBuilderOperationalPacket({
    ...base,
    harnessAgentProjection: { ...base.harnessAgentProjection, allowedFileScopes: ['shared/agents/**', 'apps/stephanos/dist/**', 'node_modules/x', '.env', 'secret.key'] },
  });
  assert.deepEqual(packet.allowedFiles, ['shared/agents/**']);
  for (const forbidden of ['apps/stephanos/dist/**', 'stephanos-server/data/**', 'data/**', 'tmp/**', '.git/**', 'node_modules/**', '.env', '.env.*', '**/*.pem', '**/*.pfx', '**/*.key']) {
    assert.ok(DEFAULT_OPERATIONAL_FORBIDDEN_FILES.includes(forbidden));
    assert.ok(packet.forbiddenFiles.includes(forbidden));
  }
});

test('missing evidence cannot produce a passing verdict', () => {
  const packet = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: ['browser proof missing'] } });
  assert.equal(packet.finalVerdict, 'BLOCKED');
  assert.match(packet.blockingReasons.join(' '), /missing/i);
});

test('repair rounds cannot exceed 3', () => {
  const packet = buildCoBuilderOperationalPacket({ ...base, supportSnapshot: { coBuilderLoopRound: 9 } });
  assert.equal(packet.maximumRepairRounds, 3);
  assert.equal(packet.currentRound, 3);
  assert.equal(packet.finalVerdict, 'BLOCKED');
});
