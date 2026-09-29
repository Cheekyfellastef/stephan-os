import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1,
  analyzeWindowsAuthoritySovereignCommanderReviewV1,
} from './windowsAuthoritySovereignCommanderReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'a'.repeat(40);
const FIXTURE_BY_PATH = new Map([
  ['scripts/windows/configure-sovereign-commander-tailscale.ps1', readFileSync(new URL('./fixtures/sovereignCommanderTailnetV1.fixture.txt', import.meta.url), 'utf8')],
  ['scripts/windows/install-sovereign-commander.ps1', readFileSync(new URL('./fixtures/sovereignCommanderInstallerV1.fixture.txt', import.meta.url), 'utf8')],
  ['scripts/windows/run-sovereign-commander-hidden.ps1', readFileSync(new URL('./fixtures/sovereignCommanderRunnerV1.fixture.txt', import.meta.url), 'utf8')],
  ['scripts/windows/run-stephanos-scheduled-task-windowless.vbs', readFileSync(new URL('./fixtures/sovereignCommanderWindowlessLauncherV1.fixture.txt', import.meta.url), 'utf8')],
]);
const EXPECTED_BLOB_BY_PATH = new Map([
  ['scripts/windows/configure-sovereign-commander-tailscale.ps1', 'f101d1075037d2ac1ddd58e1b330b9bb32256c74'],
  ['scripts/windows/install-sovereign-commander.ps1', '177eed5464088586c0863180653821284e559c59'],
  ['scripts/windows/run-sovereign-commander-hidden.ps1', '9c9d9fb39997482da1ebe8bbe17b731db87df6d0'],
  ['scripts/windows/run-stephanos-scheduled-task-windowless.vbs', '0fccdb4a2415ed33bf5e6ea0c147711c31499274'],
]);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function analysis(paths = WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1) {
  return {
    counts: { P0: paths.length, P1: 0, P2: 0 },
    findings: paths.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      summary: 'Separate specialist review required.',
      path,
    })),
  };
}

function source(path, content = FIXTURE_BY_PATH.get(path), overrides = {}) {
  const bytes = Buffer.byteLength(content, 'utf8');
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: SOURCE_HEAD,
    exists: true,
    size: bytes,
    blobSha: gitBlobSha(content),
    content,
    ...overrides,
  };
}

test('fixtures are byte-identical to the four Sovereign Commander authority blobs', () => {
  for (const path of WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1) {
    assert.equal(gitBlobSha(FIXTURE_BY_PATH.get(path)), EXPECTED_BLOB_BY_PATH.get(path), path);
  }
});

test('exact four-path escalation is clean and grants no wider authority', () => {
  const result = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => source(path)),
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1);
  assert.deepEqual(result.findings, []);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
  assert.equal(result.arbitraryShellAuthority, false);
  assert.equal(result.pcRestartAuthority, false);
  assert.equal(result.publicInternetExposureAuthority, false);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_SPECIALIST_CLEAN');
});

test('finding order may vary but the exact four-path estate may not widen or shrink', () => {
  const reversed = [...WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1].reverse();
  const accepted = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(reversed),
    sources: WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => source(path)),
  });
  assert.equal(accepted.eligible, true);

  const missing = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.slice(0, 3)),
    sources: WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => source(path)),
  });
  assert.equal(missing.eligible, false);

  const widenedPaths = [...WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1, 'scripts/windows/evil.ps1'];
  const widened = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(widenedPaths),
    sources: WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => source(path)),
  });
  assert.equal(widened.eligible, false);
});

test('any authority-file byte drift fails closed before semantic clearance', () => {
  const target = WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1[1];
  const sources = WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => (
    path === target ? source(path, FIXTURE_BY_PATH.get(path) + '\nStart-Process cmd.exe\n') : source(path)
  ));
  const result = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => (
    item.path === target && item.code === 'sovereign-specialist-exact-source-invalid'
  )));
});

test('duplicate, missing, wrong-ref or wrong-blob source evidence fails closed', () => {
  const exact = WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => source(path));
  const duplicate = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: [...exact, exact[0]],
  });
  assert.equal(duplicate.clean, false);
  assert.ok(duplicate.findings.some((item) => item.code === 'sovereign-specialist-source-inventory-invalid'));

  const wrongRef = exact.map((item, index) => index === 0 ? { ...item, ref: 'b'.repeat(40) } : item);
  const refResult = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: wrongRef,
  });
  assert.equal(refResult.clean, false);
  assert.ok(refResult.findings.some((item) => item.code === 'sovereign-specialist-exact-source-invalid'));

  const wrongBlob = exact.map((item, index) => index === 1 ? { ...item, blobSha: 'b'.repeat(40) } : item);
  const blobResult = analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources: wrongBlob,
  });
  assert.equal(blobResult.clean, false);
  assert.ok(blobResult.findings.some((item) => item.code === 'sovereign-specialist-exact-source-invalid'));
});

test('wrong repository or malformed source head is never eligible', () => {
  const sources = WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.map((path) => source(path));
  assert.equal(analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: 'other/repo',
    sourceHead: SOURCE_HEAD,
    analysis: analysis(),
    sources,
  }).eligible, false);
  assert.equal(analyzeWindowsAuthoritySovereignCommanderReviewV1({
    repository: REPOSITORY,
    sourceHead: 'abc',
    analysis: analysis(),
    sources,
  }).eligible, false);
});
