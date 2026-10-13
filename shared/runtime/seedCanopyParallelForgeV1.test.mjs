import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PARALLEL_SEED_REQUEST_SCHEMA,
  listParallelSeedCandidatesV1,
  draftParallelSeedGoalV1,
  validateParallelSeedBuildRequestV1,
  parallelSeedBranchNameV1,
  parseParallelSeedModelResponseV1,
  makeParallelSeedReceiptV1,
} from './seedCanopyParallelForgeV1.mjs';

const seeds = [{
  seedId: 'openclaw-local-standalone-continuous-excellence',
  title: 'OpenClaw continuous excellence',
  issue: '#3094',
  source: 'shared/runtime/openClawExcellenceSeedV1.mjs',
  growthRungs: ['INVENTORY_BOTH_AGENTS', 'VERIFY_SKILLS'],
}];
const request = {
  schemaVersion: PARALLEL_SEED_REQUEST_SCHEMA,
  seedId: seeds[0].seedId,
  ownerIssue: '#3094',
  contractSource: seeds[0].source,
  taskId: 'first-inventory-proof',
  intent: 'Create a scoped source-backed first inventory acceptance contract and associated evidence fields.',
  targetPath: 'docs/architecture/openclaw-inventory-acceptance.md',
  expectedTargetSha256: null,
  baseSha: 'a'.repeat(40),
  testPaths: ['shared/runtime/seedCanopyParallelForgeV1.test.mjs'],
  reviewAuthority: 'PROTECTED_REVIEW_REQUIRED',
  sourceScopeApproval: 'EXACT_TARGET_ONLY',
  mergeAllowed: false,
  deployAllowed: false,
};

test('parallel proposal selects canonical seeds without manufacturing live proof', () => {
  const candidates = listParallelSeedCandidatesV1(seeds);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].firstRung, 'INVENTORY_BOTH_AGENTS');
  assert.equal(candidates[0].routeTruth, 'SOURCE_BACKED_PROPOSAL_ONLY');
  assert.equal(candidates[0].requiresIndependentOwnerAndLiveEvidence, true);
});

test('direct seed goal drafts are source-backed but not admitted or built', () => {
  const draft = draftParallelSeedGoalV1(seeds[0]);
  assert.equal(draft.ownerIssue, '#3094');
  assert.equal(draft.nextRung, 'INVENTORY_BOTH_AGENTS');
  assert.equal(draft.sourceTruth, 'DECLARED_CONTRACT_NOT_LIVE_PRESSURE');
  assert.equal(draft.workAuthorized, false);
  assert.equal(draft.implementationCompleted, false);
  assert.equal(draft.existingOwnerMustBeChecked, true);
  assert.throws(() => draftParallelSeedGoalV1({ ...seeds[0], growthRungs: ['../unsafe'] }));
});

test('exact seed owner, issue, contract, path, tests, SHA and authority are mandatory', () => {
  assert.deepEqual(validateParallelSeedBuildRequestV1(request, seeds).errors, []);
  assert.equal(parallelSeedBranchNameV1(request),
    'seed-parallel/openclaw-local-standalone-continuous-excellence/first-inventory-proof');
  const invalid = [
    [{ seedId: 'invented' }, 'UNKNOWN_SEED'],
    [{ ownerIssue: '#123' }, 'OWNER_MUST_MATCH_CANONICAL_SEED'],
    [{ contractSource: '../wrong-source' }, 'CONTRACT_SOURCE_MISMATCH'],
    [{ baseSha: '' }, 'MISSING_EXACT_BASE'],
    [{ sourceScopeApproval: '' }, 'EXPLICIT_SOURCE_SCOPE_REQUIRED'],
    [{ reviewAuthority: 'NONE' }, 'REVIEW_CANNOT_BE_WAIVED'],
    [{ mergeAllowed: true }, 'AUTHORITY_ESCALATION'],
    [{ runtimeMutationAllowed: true }, 'AUTHORITY_ESCALATION'],
    [{ workerCommand: 'powershell' }, 'UNTRUSTED_EXECUTION_OVERRIDE'],
    [{ modelEndpoint: 'https://external.invalid/' }, 'UNTRUSTED_EXECUTION_OVERRIDE'],
    [{ existingLeaseBypass: true }, 'UNTRUSTED_EXECUTION_OVERRIDE'],
    [{ testPaths: [] }, 'INVALID_TEST_PATHS'],
    [{ testPaths: ['scripts/bad-test.mjs'] }, 'INVALID_TEST_PATHS'],
    [{ expectedTargetSha256: 'old' }, 'INVALID_EXACT_TARGET_HASH'],
  ];
  for (const [mutation, reason] of invalid) {
    const result = validateParallelSeedBuildRequestV1({ ...request, ...mutation }, seeds);
    assert.equal(result.ok, false, reason);
    assert.ok(result.errors.includes(reason), JSON.stringify(mutation));
  }
});

test('reject traversal, Windows escape, protected paths, exotic paths and arbitrary test execution', () => {
  for (const targetPath of [
    '../shared/runtime/hack.mjs',
    'docs/architecture/../../main.js',
    'C:\\windows\\system.ini',
    'docs\\architecture\\bad.md',
    '.github/workflows/trigger.yml',
    'AGENTS.md',
    'scripts/windows/disable-protection.ps1',
    'shared/runtime/approvalBypass.mjs',
    'stephanos-server/services/operatorMergeDanger.js',
    'docs/architecture/with space.md',
  ]) {
    assert.ok(validateParallelSeedBuildRequestV1({ ...request, targetPath }, seeds).errors
      .includes('UNSAFE_TARGET_PATH'), targetPath);
  }
  assert.equal(validateParallelSeedBuildRequestV1({
    ...request, testPaths: ['tests/../scripts/run.js'],
  }, seeds).ok, false);
});

test('local model may propose only one exact file with size bounds, not additional edits', () => {
  const data = JSON.stringify({ path: request.targetPath, content: '# Source-backed inventory\n' });
  assert.equal(parseParallelSeedModelResponseV1(data, request.targetPath).path, request.targetPath);
  for (const bad of [
    'markdown fence\n' + data,
    JSON.stringify({ path: '../outside', content: 'x' }),
    JSON.stringify({ path: request.targetPath, content: 'x', command: 'curl secret' }),
    JSON.stringify({ path: request.targetPath, content: '' }),
    JSON.stringify({ path: request.targetPath, content: 'x'.repeat(66000) }),
    JSON.stringify([ { path: request.targetPath, content: 'x' } ]),
  ]) assert.throws(() => parseParallelSeedModelResponseV1(bad, request.targetPath));
});

test('all receipts explicitly deny merge/deploy/goal-completion even with malicious extras', () => {
  for (const stage of ['SELECTED', 'CLAIMED', 'EDITED', 'TESTED', 'COMMITTED', 'BLOCKED']) {
    const receipt = makeParallelSeedReceiptV1(request, stage, {
      merged: true, deployed: true, goalCompleted: true,
      commitSha: stage === 'COMMITTED' ? 'b'.repeat(40) : '',
    });
    assert.equal(receipt.merged, false);
    assert.equal(receipt.deployed, false);
    assert.equal(receipt.goalCompleted, false);
    assert.equal(receipt.stage, stage);
    assert.equal(receipt.exactBaseSha, request.baseSha);
  }
  assert.throws(() => makeParallelSeedReceiptV1(request, 'DEPLOYED'), /INVALID_RECEIPT_STAGE/);
});
