import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSourceArtifactEscrowV1 } from '../../shared/agents/sourceArtifactEscrowContinuityV1.mjs';
import {
  SOURCE_ARTIFACT_COMPLETE_FILE_BUNDLE_V1_SCHEMA,
  persistSourceArtifactEscrowV1,
} from './sourceArtifactEscrowStore.js';

const NOW = '2026-09-11T08:30:00.000Z';
const TEST_COMMAND = 'node --test shared/agents/example.test.mjs';
const CONTENT = Buffer.from('export const example = 1;\n', 'utf8');
const SHA256 = createHash('sha256').update(CONTENT).digest('hex');
const BLOB_SHA = createHash('sha1').update(Buffer.from(`blob ${CONTENT.length}\0`, 'utf8')).update(CONTENT).digest('hex');

function input(overrides = {}) {
  const changed = {
    path: 'shared/agents/example.mjs',
    beforeBlobSha: '1'.repeat(40),
    afterBlobSha: BLOB_SHA,
    sha256: SHA256,
  };
  return {
    missionId: 'critical-1567-elastic-goal',
    actionId: 'agent-critical-1567-source-1',
    repository: 'Cheekyfellastef/stephan-os',
    canonicalIssue: 1567,
    canonicalPr: null,
    canonicalBranch: 'openclaw/elastic-goal-1567',
    exactParentHead: 'a'.repeat(40),
    exactParentTree: 'b'.repeat(40),
    exactResultTree: 'c'.repeat(40),
    executorIdentity: 'mission-worker:codex:run-1567',
    changedFiles: [changed],
    artifactFiles: [{ ...changed, mode: '100644', deleted: false, contentBase64: CONTENT.toString('base64') }],
    requiredTests: [TEST_COMMAND],
    evidenceReceipts: [{
      receiptId: 'codex-test-example',
      requirement: 'source deterministic test',
      testCommand: TEST_COMMAND,
      source: 'codex-cli',
      evidenceType: 'source-test-command',
      verified: true,
      commandOutputHash: 'd'.repeat(64),
      createdAt: NOW,
    }],
    completedAt: NOW,
    commitMessage: 'Persist tested pre-PR source work',
    ...overrides,
  };
}

async function roots() {
  const parent = await mkdtemp(join(tmpdir(), 'source-artifact-store-'));
  const repoRoot = join(parent, 'repo');
  const sharedWorkspaceRoot = join(parent, 'shared-workspace');
  await mkdir(repoRoot, { recursive: true });
  await mkdir(sharedWorkspaceRoot, { recursive: true });
  return { repoRoot, sharedWorkspaceRoot };
}

test('persists a content-addressed externally-readable pre-PR complete-file bundle', async () => {
  const options = await roots();
  const escrow = await persistSourceArtifactEscrowV1(input(), options);
  assert.ok(escrow);
  assert.equal(escrow.canonicalIssue, 1567);
  assert.equal(escrow.canonicalPr, null);
  assert.equal(escrow.externallyReadable, true);
  assert.equal(validateSourceArtifactEscrowV1(escrow, NOW).valid, true);

  const artifactName = escrow.artifactRef.split('/').at(-1);
  const bytes = await readFile(join(options.sharedWorkspaceRoot, 'source-artifacts', artifactName));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), escrow.completeArtifactSha256);
  const bundle = JSON.parse(bytes.toString('utf8'));
  assert.equal(bundle.schemaVersion, SOURCE_ARTIFACT_COMPLETE_FILE_BUNDLE_V1_SCHEMA);
  assert.equal(bundle.missionId, 'critical-1567-elastic-goal');
  assert.equal(bundle.actionId, 'agent-critical-1567-source-1');
  assert.equal(bundle.changedFiles[0].contentBase64, CONTENT.toString('base64'));
  assert.deepEqual(bundle.testsRun, [TEST_COMMAND]);
});

test('refuses escrow when an exact required test command is not grounded', async () => {
  const options = await roots();
  const result = await persistSourceArtifactEscrowV1(input({
    evidenceReceipts: [{
      receiptId: 'wrong-test', requirement: 'source deterministic test', testCommand: 'node --test some-other.test.mjs',
      source: 'codex-cli', evidenceType: 'source-test-command', verified: true, commandOutputHash: 'e'.repeat(64), createdAt: NOW,
    }],
  }), options);
  assert.equal(result, null);
});

test('refuses escrow when complete-file bytes do not match the claimed Git blob identity', async () => {
  const options = await roots();
  const altered = Buffer.from('export const example = 2;\n', 'utf8');
  const base = input();
  const result = await persistSourceArtifactEscrowV1({
    ...base,
    artifactFiles: [{ ...base.artifactFiles[0], contentBase64: altered.toString('base64') }],
  }, options);
  assert.equal(result, null);
});
