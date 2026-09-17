import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const OC9_BRANCH = 'agent/1415-openclaw-update-preflight-v1';
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const PATH = 'scripts/windows/restart-approved-stephanos-runtime.ps1';

function analysis() {
  return {
    findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
  };
}

function oc9Analysis() {
  return {
    findings: OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}

function lineage(overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository: REPOSITORY,
    sourceHead: HEAD,
    sourceCommitSha: HEAD,
    baseSha: BASE,
    liveMainBeforeSha: BASE,
    liveMainAfterSha: BASE,
    parents: [BASE],
    comparison: {
      status: 'ahead',
      aheadBy: 1,
      behindBy: 0,
      baseCommitSha: BASE,
      mergeBaseCommitSha: BASE,
    },
    ...overrides,
  };
}

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function oc9Sources(overrides = {}) {
  const contents = {
    '.github/workflows/openclaw-update-preflight-proof.yml': [
      'permissions:',
      '  contents: read',
      'node --check shared/agents/openClawUpdatePreflightV1.mjs',
      'node --check scripts/openclaw-update-preflight.mjs',
      'node --test shared/agents/openClawUpdatePreflightV1.test.mjs scripts/openclaw-update-preflight.test.mjs',
      'git diff --check',
    ].join('\n'),
    'scripts/openclaw-update-preflight.mjs': [
      'const MAX_INPUT_BYTES = 256 * 1024;',
      'buildOpenClawUpdatePreflightV1(input)',
      'OPENCLAW_UPDATE_PREFLIGHT_ERROR=',
      'BLOCKED_WITH_RESTORE_PATH ? 2 : 0',
    ].join('\n'),
    'scripts/openclaw-update-preflight.test.mjs': [
      'CLI reads one bounded JSON observation from stdin and writes no mutation claim',
      'CLI exits 2 for a blocked preflight while still returning the rollback packet',
      'CLI rejects malformed JSON without emitting a packet',
      'CLI entrypoint detection handles Windows paths without depending on file URL spelling',
    ].join('\n'),
    'shared/agents/openClawUpdatePreflightV1.mjs': [
      "APPROVAL_REQUIRED: 'APPROVAL_REQUIRED'",
      "BLOCKED_WITH_RESTORE_PATH: 'BLOCKED_WITH_RESTORE_PATH'",
      "MANUAL_ONLY: 'MANUAL_ONLY'",
      'SECRET_PATH_PATTERN',
      'OPENCLAW_GATEWAY_APPROVED_ENDPOINT',
      'OPENCLAW_GATEWAY_STARTUP_SOURCE',
      'getOpenClawGatewayStartupCommand()',
      'mutationAllowed: false',
      'updateAttempted: false',
      'absolutePathsPublished: false',
      'REQUEST_EXACT_OPERATOR_APPROVAL',
      'RESTORE_PREVIOUS_PINNED_OPENCLAW_PACKAGE',
      'RESTORE_PROTECTED_CONFIG_SOURCE_AND_RUNTIME_IDENTITIES',
    ].join('\n'),
    'shared/agents/openClawUpdatePreflightV1.test.mjs': [
      'builds a deterministic approval-required manifest without publishing absolute paths',
      'blocks unknown and secret-bearing inventory paths while retaining a rollback plan',
      'fails closed on gateway identity drift and unpinned update packets',
      'requires digests for protected identities but not rebuildable generated output',
      'rejects conflicting duplicate path identities with order-independent blocked evidence',
      'fails closed on links, malformed existence evidence, invalid sizes and stale absent digests',
      'reports no update needed when the pinned target version already matches',
    ].join('\n'),
    ...overrides,
  };
  return OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => source(path, contents[path]));
}

test('successor specialist owns only the exact #2048 authority-bearing path', () => {
  assert.deepEqual(OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1, [PATH]);
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 2048,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.findings[0].code, 'battle-bridge-hardlink-exact-source-proof-invalid');
});

test('successor specialist refuses a different PR, branch, finding estate, or lineage', () => {
  for (const input of [
    { prNumber: 2049 },
    { branch: 'fix/other' },
    { analysis: { findings: [] } },
  ]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
      repository: REPOSITORY,
      prNumber: 2048,
      branch: BRANCH,
      sourceHead: HEAD,
      baseSha: BASE,
      lineageEvidence: lineage(),
      analysis: analysis(),
      sources: [],
      ...input,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.clean, false);
  }

  const stale = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 2048,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage({ liveMainAfterSha: '3333333333333333333333333333333333333333' }),
    analysis: analysis(),
    sources: [],
  });
  assert.equal(stale.eligible, true);
  assert.equal(stale.clean, false);
  assert.equal(stale.findings[0].code, 'battle-bridge-hardlink-reconciliation-lineage-invalid');
});

test('OC9 successor specialist reviews only the exact five-file #1654 estate and can return clean', () => {
  assert.deepEqual(OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1, [
    '.github/workflows/openclaw-update-preflight-proof.yml',
    'scripts/openclaw-update-preflight.mjs',
    'scripts/openclaw-update-preflight.test.mjs',
    'shared/agents/openClawUpdatePreflightV1.mjs',
    'shared/agents/openClawUpdatePreflightV1.test.mjs',
  ]);
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: oc9Analysis(),
    sources: oc9Sources(),
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths, OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1);
  assert.equal(result.findings.length, 0);
  assert.equal(result.proofRefs.length, 5);
});

test('OC9 successor specialist fails closed on stale lineage, widened source estate, or hidden authority', () => {
  const stale = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage({ comparison: { ...lineage().comparison, behindBy: 1 } }),
    analysis: oc9Analysis(),
    sources: oc9Sources(),
  });
  assert.equal(stale.eligible, true);
  assert.equal(stale.clean, false);
  assert.equal(stale.findings[0].code, 'oc9-update-preflight-reconciliation-lineage-invalid');

  const widened = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: oc9Analysis(),
    sources: [...oc9Sources(), source('extra.txt', 'extra')],
  });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'oc9-update-preflight-source-evidence-estate-mismatch'));

  const hiddenAuthority = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: oc9Analysis(),
    sources: oc9Sources({
      'shared/agents/openClawUpdatePreflightV1.mjs': `${oc9Sources().find((item) => item.path === 'shared/agents/openClawUpdatePreflightV1.mjs').content}\nspawn('powershell.exe')`,
    }),
  });
  assert.equal(hiddenAuthority.clean, false);
  assert.ok(hiddenAuthority.findings.some((item) => item.code === 'oc9-model-dynamic-execution-forbidden'));
});
