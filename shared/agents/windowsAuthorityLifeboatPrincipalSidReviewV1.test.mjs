import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1,
  analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1,
} from './windowsAuthorityLifeboatPrincipalSidReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function analysis() {
  return {
    findings: [{
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path: 'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
    }],
    counts: { P0: 1, P1: 0, P2: 0 },
  };
}

async function currentSources() {
  const rows = [];
  for (const path of WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1) {
    const content = await readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
    rows.push({
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
  return rows;
}

test('Lifeboat principal SID specialist requests exactly the installer and static regression proof', () => {
  const result = analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_SOURCE_REQUIRED');
});

test('exact SID-based principal repair is clean and grants no mutation or merge authority', async () => {
  const result = analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: await currentSources(),
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_PASS');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('raw principal name equality and widened source estates fail closed', async () => {
  const sources = await currentSources();
  const installerIndex = sources.findIndex((entry) => entry.path.endsWith('install-battle-bridge-recovery-lifeboat-v1.ps1'));
  const weakenedContent = sources[installerIndex].content
    .replace('if ($taskPrincipalSid -ne $CurrentUserSid)', 'if ([string]$task.Principal.UserId -ne $CurrentUser)');
  sources[installerIndex] = {
    ...sources[installerIndex],
    content: weakenedContent,
    size: Buffer.byteLength(weakenedContent, 'utf8'),
    blobSha: gitBlobSha(weakenedContent),
  };
  const weakened = analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources,
  });
  assert.equal(weakened.clean, false);
  assert.ok(weakened.findings.length > 0);

  const widened = analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: analysis(),
    sources: [...await currentSources(), { path: 'extra' }],
  });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'windows-authority-source-estate-widened'));
});

test('unrelated Windows escalation cannot enter the SID principal repair profile', () => {
  const result = analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }],
    },
    sources: [],
  });
  assert.equal(result.eligible, false);
});
