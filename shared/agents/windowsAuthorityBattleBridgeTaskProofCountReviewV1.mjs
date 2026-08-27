import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthorityNoFaffRescueReviewV2.mjs';
const BASE_BLOB_SHA = 'f6c2a92f4e2ffebb57e197e72ed0279a896c9ffe';
const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';

const RESCUE_PATH = 'scripts/windows/repair-battle-bridge-control-plane-now.ps1';
const TEST_PATH = 'scripts/windows/repair-battle-bridge-control-plane-now.test.mjs';
const SUPERSEDED_CODE = 'no-faff-rescue-task-set-failclosed-missing';

export const WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_PATHS_V1 = Object.freeze([
  RESCUE_PATH,
  TEST_PATH,
]);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function provePinnedBase() {
  const url = new URL(BASE_PATH, import.meta.url);
  const observed = gitBlobSha(readFileSync(url, 'utf8'));
  if (observed !== BASE_BLOB_SHA) {
    throw new Error(`WINDOWS_AUTHORITY_TASK_PROOF_COUNT_BASE_PIN_MISMATCH:${observed}`);
  }
  return url;
}

const base = await import(provePinnedBase().href);

const finding = (code, path) =>
  Object.freeze({ severity: 'P0', code, summary: code, path });

function sourceContent(input, path) {
  const sources = Array.isArray(input?.sources) ? input.sources : [];
  const matches = sources.filter((source) => String(source?.path ?? '').trim() === path);
  return matches.length === 1 && typeof matches[0]?.content === 'string'
    ? matches[0].content
    : '';
}

function baseSourceInvalid(baseResult, path) {
  return (Array.isArray(baseResult?.findings) ? baseResult.findings : [])
    .some((item) => item?.path === path && item?.code === 'windows-authority-source-evidence-invalid');
}

function requireLiteral(findings, source, path, literal, code) {
  if (!source.includes(literal)) findings.push(finding(code, path));
}

function forbidLiteral(findings, source, path, literal, code) {
  if (source.includes(literal)) findings.push(finding(code, path));
}

export function upgradeWindowsAuthorityBattleBridgeTaskProofCountReviewV1(baseResult, input = {}) {
  if (!baseResult?.eligible) return baseResult;

  const reviewedPaths = Array.isArray(baseResult.reviewedPaths)
    ? baseResult.reviewedPaths
    : [];
  if (JSON.stringify([...reviewedPaths].sort())
      !== JSON.stringify([...WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_PATHS_V1].sort())) {
    return baseResult;
  }

  const findings = (Array.isArray(baseResult.findings) ? baseResult.findings : [])
    .filter((item) => !(item?.path === RESCUE_PATH && item?.code === SUPERSEDED_CODE));

  if (!baseSourceInvalid(baseResult, RESCUE_PATH)) {
    const rescue = sourceContent(input, RESCUE_PATH);
    requireLiteral(
      findings,
      rescue,
      RESCUE_PATH,
      'if (@($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)',
      'task-proof-count-collection-guard-missing',
    );
    forbidLiteral(
      findings,
      rescue,
      RESCUE_PATH,
      'if (($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)',
      'task-proof-count-scalar-unsafe-guard-present',
    );
  }

  if (!baseSourceInvalid(baseResult, TEST_PATH)) {
    const regression = sourceContent(input, TEST_PATH);
    for (const [literal, code] of [
      [
        "test('task proof counting is collection-safe under Windows PowerShell strict mode'",
        'task-proof-count-regression-name-missing',
      ],
      [
        "assert.ok(ps1.includes('if (@($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)'))",
        'task-proof-count-safe-regression-missing',
      ],
      [
        "assert.ok(!ps1.includes('if (($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0)'))",
        'task-proof-count-unsafe-regression-missing',
      ],
    ]) requireLiteral(findings, regression, TEST_PATH, literal, code);
  }

  const deduped = [...new Map(findings.map((item) => [`${item.path}\n${item.code}`, item])).values()];
  const clean = deduped.length === 0;
  return Object.freeze({
    schemaVersion: baseResult.schemaVersion || SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([...reviewedPaths]),
    findings: Object.freeze(deduped),
    proofRefs: Object.freeze([
      ...(Array.isArray(baseResult.proofRefs) ? baseResult.proofRefs : []),
      ...(clean ? [
        `proofs/windows-authority-battle-bridge-task-proof-count/${RESCUE_PATH}`,
        `proofs/windows-authority-battle-bridge-task-proof-count/${TEST_PATH}`,
      ] : []),
    ]),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_BATTLE_BRIDGE_TASK_PROOF_COUNT_SPECIALIST_FINDINGS',
  });
}

export function analyzeWindowsAuthorityBattleBridgeTaskProofCountReviewV1(input = {}) {
  return upgradeWindowsAuthorityBattleBridgeTaskProofCountReviewV1(
    base.analyzeWindowsAuthorityNoFaffRescueReview(input),
    input,
  );
}
