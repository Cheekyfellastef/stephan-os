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
  verificationReturnIntake: {
    missingEvidence: [],
    suppliedEvidence: [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0 }],
  },
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
  for (const forbidden of ['apps/stephanos/dist/**', 'stephanos-server/data/**', 'runtime/**', 'runtime-data/**', 'root-data/**', 'root data/**', 'data/**', 'tmp/**', '.git/**', 'node_modules/**', '.env', '.env.*', '**/*.pem', '**/*.pfx', '**/*.key']) {
    assert.ok(DEFAULT_OPERATIONAL_FORBIDDEN_FILES.includes(forbidden));
    assert.ok(packet.forbiddenFiles.includes(forbidden));
  }
});


test('canonical path validation rejects backslash generated runtime absolute UNC and traversal variants', () => {
  const forbiddenVariants = [
    'apps\\stephanos\\dist\\index.js',
    'stephanos-server\\data\\memory.json',
    'data\\runtime.json',
    'C:\\Users\\Stephan\\secret.txt',
    '\\\\server\\share\\file.js',
    '..\\outside.js',
    '../outside.js',
  ];
  const packet = buildCoBuilderOperationalPacket({
    ...base,
    harnessAgentProjection: { ...base.harnessAgentProjection, allowedFileScopes: ['shared/agents/**', ...forbiddenVariants] },
  });
  assert.deepEqual(packet.allowedFiles, ['shared/agents/**']);
  for (const forbidden of ['apps/stephanos/dist/index.js', 'stephanos-server/data/memory.json', 'data/runtime.json', 'C:/Users/Stephan/secret.txt', '//server/share/file.js', '../outside.js']) {
    assert.ok(packet.forbiddenFiles.includes(forbidden), `missing forbidden normalized path: ${forbidden}`);
  }
});


test('runtime paths using forward or backslashes cannot enter allowedFiles', () => {
  const packet = buildCoBuilderOperationalPacket({
    ...base,
    harnessAgentProjection: { ...base.harnessAgentProjection, allowedFileScopes: ['shared/agents/**', 'runtime/session.json', 'runtime\\session.json', 'runtime-data\\cache.json', 'root-data/state.json'] },
  });
  assert.deepEqual(packet.allowedFiles, ['shared/agents/**']);
  for (const forbidden of ['runtime/session.json', 'runtime-data/cache.json', 'root-data/state.json']) {
    assert.ok(packet.forbiddenFiles.includes(forbidden));
  }
});

test('allowed scopes overlapping caller forbidden scopes block exact parent nested and windows variants', () => {
  const cases = [
    { allowedFileScopes: ['src/generated/**'], forbiddenFileScopes: ['src/generated/**'] },
    { allowedFileScopes: ['src/**'], forbiddenFileScopes: ['src/generated/**'] },
    { allowedFileScopes: ['src/generated/widgets/**'], forbiddenFileScopes: ['src/generated/**'] },
    { allowedFileScopes: ['src\\**'], forbiddenFileScopes: ['src\\generated\\**'] },
  ];
  for (const harnessAgentProjection of cases) {
    const packet = buildCoBuilderOperationalPacket({ ...base, harnessAgentProjection: { ...base.harnessAgentProjection, ...harnessAgentProjection } });
    assert.equal(packet.finalVerdict, 'BLOCKED');
    assert.match(packet.blockingReasons.join(' '), /overlaps/);
    assert.ok(packet.scopeOverlaps.length > 0);
  }
});

test('required evidence definitions alone cannot produce a passing verdict', () => {
  const packet = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: [] } });
  assert.equal(packet.finalVerdict, 'BLOCKED');
  assert.deepEqual(packet.unsatisfiedEvidence, ['focused test output']);
  assert.equal(packet.evidenceSatisfied, false);
  assert.match(packet.blockingReasons.join(' '), /verified proof/i);
});

test('missing unknown or unverified evidence cannot produce a passing verdict', () => {
  for (const suppliedEvidence of [[], ['focused test output'], [{ requirement: 'focused test output', status: 'verified' }], [{ requirement: 'focused test output', verified: true }], [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true }], [{ label: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0 }], [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, sha256: 'ABC' }], [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, commandOutputHash: 'f'.repeat(63) }], [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0.5 }], [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, receiptPath: '../receipt.json' }]]) {
    const packet = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: [], suppliedEvidence } });
    assert.equal(packet.finalVerdict, 'BLOCKED');
    assert.equal(packet.evidenceSatisfied, false);
  }
  const missing = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: ['browser proof missing'], suppliedEvidence: [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0 }] } });
  assert.equal(missing.finalVerdict, 'BLOCKED');
  assert.match(missing.blockingReasons.join(' '), /missing/i);
});

test('valid hash exit-code and receipt-path evidence can satisfy matching requirements', () => {
  const validEvidence = [
    { requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, sha256: 'a'.repeat(64) },
    { requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, commandOutputHash: 'f'.repeat(64) },
    { requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0 },
    { requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, receiptPath: 'proof/receipts/focused-test.json' },
  ];
  for (const evidence of validEvidence) {
    const packet = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: [], suppliedEvidence: [evidence] } });
    assert.equal(packet.finalVerdict, 'READY_FOR_OPERATOR_APPROVAL');
    assert.equal(packet.evidenceSatisfied, true);
    assert.deepEqual(packet.unsatisfiedEvidence, []);
  }
});


test('nonzero exit codes do not satisfy evidence requirements', () => {
  const packet = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: [], suppliedEvidence: [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 1 }] } });
  assert.equal(packet.finalVerdict, 'BLOCKED');
  assert.equal(packet.evidenceSatisfied, false);
});

test('evidence requirement identity must match exactly after normalization', () => {
  const buildCannotSatisfyBuildVerification = buildCoBuilderOperationalPacket({
    ...base,
    agentWorkRoutingProjection: { ...base.agentWorkRoutingProjection, requiredProof: ['build verification output'] },
    verificationReturnIntake: { missingEvidence: [], suppliedEvidence: [{ requirement: 'build', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0 }] },
  });
  assert.equal(buildCannotSatisfyBuildVerification.finalVerdict, 'BLOCKED');
  assert.deepEqual(buildCannotSatisfyBuildVerification.unsatisfiedEvidence, ['build verification output']);

  const buildVerificationCannotSatisfyBuild = buildCoBuilderOperationalPacket({
    ...base,
    agentWorkRoutingProjection: { ...base.agentWorkRoutingProjection, requiredProof: ['build'] },
    verificationReturnIntake: { missingEvidence: [], suppliedEvidence: [{ requirement: 'build verification output', source: 'node-test', evidenceType: 'test-output', verified: true, exitCode: 0 }] },
  });
  assert.equal(buildVerificationCannotSatisfyBuild.finalVerdict, 'BLOCKED');
  assert.deepEqual(buildVerificationCannotSatisfyBuild.unsatisfiedEvidence, ['build']);
});

test('receipt paths must stay in bounded proof families and avoid forbidden roots', () => {
  const invalidReceiptPaths = [
    '/proof/receipts/out.json',
    'C:\\proof\\receipts\\out.json',
    '..\\proof\\receipts\\out.json',
    'proof/receipts/../out.json',
    'proof/receipts/secret.key',
    'apps/stephanos/dist/receipt.json',
    'runtime/receipt.json',
    'data/receipt.json',
    'tmp/receipt.json',
    'node_modules/pkg/receipt.json',
    '.git/receipt.json',
    'misc/receipt.json',
  ];
  for (const receiptPath of invalidReceiptPaths) {
    const packet = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: [], suppliedEvidence: [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'receipt', verified: true, receiptPath }] } });
    assert.equal(packet.finalVerdict, 'BLOCKED', `unexpected ready receiptPath=${receiptPath}`);
  }
  const valid = buildCoBuilderOperationalPacket({ ...base, verificationReturnIntake: { missingEvidence: [], suppliedEvidence: [{ requirement: 'focused test output', source: 'node-test', evidenceType: 'receipt', verified: true, receiptPath: 'proof/receipts/focused-test.json' }] } });
  assert.equal(valid.finalVerdict, 'READY_FOR_OPERATOR_APPROVAL');
});

test('missing empty placeholder or unresolved mission id blocks safely', () => {
  for (const missionId of [undefined, '', 'mission-unresolved', 'unknown', 'placeholder', 'tbd']) {
    const packet = buildCoBuilderOperationalPacket({ ...base, missionId });
    assert.equal(packet.finalVerdict, 'BLOCKED');
    assert.equal(packet.activeWriter, 'none');
    assert.match(packet.blockingReasons.join(' '), /Mission id/i);
  }
});

test('repair rounds cannot exceed 3', () => {
  const packet = buildCoBuilderOperationalPacket({ ...base, supportSnapshot: { coBuilderLoopRound: 9 } });
  assert.equal(packet.maximumRepairRounds, 3);
  assert.equal(packet.currentRound, 3);
  assert.equal(packet.finalVerdict, 'BLOCKED');
});
