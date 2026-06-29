import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompletionPacket,
  buildPullRequestBody,
  mergeApprovalToken,
  publishApprovalToken,
  validatePublishLaneRequest,
  validatePublishSourceScope,
} from './repositoryNativePublishMergeLane.mjs';

test('source scope blocks runtime tmp memory node_modules dist env and secrets by default', () => {
  const verdict = validatePublishSourceScope({
    files: [
      'runtime/state.json',
      'tmp/a.txt',
      'memory/records.json',
      'node_modules/pkg/index.js',
      'apps/stephanos/dist/index.html',
      '.env.local',
      'docs/api-token.md',
      'secrets/prod.pem',
    ],
  });
  assert.equal(verdict.finalVerdict, 'SOURCE_SCOPE_BLOCKED');
  assert.equal(verdict.blockers.length, 8);
});

test('source scope can explicitly allow dist while still blocking secrets and env files', () => {
  const verdict = validatePublishSourceScope({
    allowDist: true,
    files: ['apps/example/dist/proof.txt', '.env', 'docs/credentials.md'],
  });
  assert.equal(verdict.finalVerdict, 'SOURCE_SCOPE_BLOCKED');
  assert.ok(!verdict.blockers.some((blocker) => blocker.includes('dist/proof')));
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('Environment files')));
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('Secrets')));
});

test('publish request is approval gated and deterministic', () => {
  const branch = 'publish/shared-workspace-v2';
  const verdict = validatePublishLaneRequest({
    branch,
    baseBranch: 'main',
    approvalToken: publishApprovalToken(branch),
    goal: 'Ship Shared Workspace V2',
    proofCommand: ['npm', 'test'],
    changedFiles: ['shared/workspace/model.mjs', 'shared/workspace/model.test.mjs'],
  });
  assert.equal(verdict.finalVerdict, 'PUBLISH_LANE_READY');
  assert.deepEqual(verdict.files, ['shared/workspace/model.mjs', 'shared/workspace/model.test.mjs']);
});

test('publish request rejects missing approval token and main branch', () => {
  const verdict = validatePublishLaneRequest({
    branch: 'main',
    baseBranch: 'main',
    approvalToken: 'APPROVE',
    goal: 'Unsafe',
    proofCommand: 'npm test',
    changedFiles: ['shared/example.mjs'],
  });
  assert.equal(verdict.finalVerdict, 'PUBLISH_LANE_BLOCKED');
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('non-main')));
  assert.ok(verdict.blockers.some((blocker) => blocker.includes('approval')));
});

test('PR body includes goal proof files and exact head SHA', () => {
  const headSha = 'a'.repeat(40);
  const body = buildPullRequestBody({
    goal: 'Publish lane V1',
    proofCommand: 'node --test shared/agents/repositoryNativePublishMergeLane.test.mjs',
    proofResult: 'PASS exitCode=0',
    filesChanged: ['shared/agents/repositoryNativePublishMergeLane.mjs'],
    headSha,
  });
  assert.match(body, /## Goal\nPublish lane V1/);
  assert.match(body, /## Proof/);
  assert.match(body, new RegExp(headSha));
});

test('merge approval token binds PR number and exact head SHA', () => {
  const headSha = 'b'.repeat(40);
  assert.equal(mergeApprovalToken(1313, headSha), `APPROVE_REPOSITORY_NATIVE_EXACT_HEAD_MERGE:1313:${headSha}`);
});

test('completion packet contains stable required fields', () => {
  const packet = buildCompletionPacket({
    branch: 'publish/lane-v1',
    prNumber: '1313',
    headSha: 'c'.repeat(40),
    mergeCommit: 'd'.repeat(40),
    proofCommand: ['npm', 'test'],
    proofResult: 'PASS exitCode=0',
    finalStatus: 'MERGED',
  });
  assert.deepEqual(Object.keys(packet), [
    'schemaVersion',
    'branch',
    'prNumber',
    'headSha',
    'mergeCommit',
    'proofCommand',
    'proofResult',
    'finalStatus',
  ]);
  assert.equal(packet.prNumber, 1313);
});
