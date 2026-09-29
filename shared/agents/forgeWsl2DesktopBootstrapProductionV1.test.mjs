import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1,
  analyzeWindowsAuthorityForgeWsl2PrerequisiteReview,
} from './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function sourceRecord(path) {
  const content = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  return Object.freeze({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: gitBlobSha(content),
    content,
  });
}

test('production old-Forge WSL2 desktop handoff passes the closed two-file Windows authority specialist', () => {
  const sources = WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1.map(sourceRecord);
  const result = analyzeWindowsAuthorityForgeWsl2PrerequisiteReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: {
      findings: [{
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path: 'scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1',
      }],
    },
    sources,
  });

  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings, null, 2));
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_FORGE_WSL2_SPECIALIST_CLEAN');
});
