import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV2.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const blobSha = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const sourceRecord = (path, content) => ({
  schemaVersion: 'stephanos.windows-authority-source.v1', repository, path, ref: head,
  exists: true, size: Buffer.byteLength(content, 'utf8'), blobSha: blobSha(content), content,
});
const inputFor = (path, content) => ({
  repository,
  sourceHead: head,
  analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }] },
  sources: [sourceRecord(path, content)],
});

test('V2 routes the OpenClaw recovery estate into its dedicated specialist', () => {
  const path = 'scripts/windows/request-battle-bridge-recovery-openclaw.ps1';
  const result = analyzeWindowsAuthoritySpecialistReview(inputFor(path, 'unsafe fixture'));
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reviewedPaths, [path]);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-proof-id-not-bounded'));
});

test('V2 preserves the pinned V1 reviewer for existing Recovery Mesh authority', () => {
  const path = 'scripts/windows/request-battle-bridge-recovery.ps1';
  const result = analyzeWindowsAuthoritySpecialistReview(inputFor(path, 'unsafe fixture'));
  assert.equal(result.eligible, true);
  assert.deepEqual(result.reviewedPaths, [path]);
  assert.ok(result.findings.length > 0);
});
