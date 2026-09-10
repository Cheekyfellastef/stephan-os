import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1,
  analyzeWindowsAuthorityMailboxRolloverReviewV1,
} from './windowsAuthorityMailboxRolloverReviewV1.mjs';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 2164;
const branch = 'fix/canonical-mailbox-rollover-2158-v1';
const head = '7acff57ddff6a506244af99d518b9b73bf1208f6';
const baseSha = 'e31861d2d74e564cd7e15434774a3a0313721baa';
const [installerPath, recoveryPath] = WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1;
const targetBlobs = Object.freeze({
  [installerPath]: '91a1ee081465236dc2bf509c4ccff1836eab5cd4',
  [recoveryPath]: '4a9318654405855cba5b1e15aaf2e4a587530f7f',
});

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function targetInstallerSource() {
  const path = new URL('../../scripts/windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url);
  let source = readFileSync(path, 'utf8');
  source = source.replace(
    'Consumes only owner-authored, expiring, allowlisted Stephanos commands from issue 1507 and publishes',
    'Consumes only owner-authored, expiring, allowlisted Stephanos commands from the canonical mailbox authority issue and publishes',
  );
  return source;
}

function targetRecoverySource() {
  const path = new URL('../../scripts/windows/request-battle-bridge-recovery.ps1', import.meta.url);
  let source = readFileSync(path, 'utf8');
  const functionMarker = [
    '    return "_request-$digest.json"',
    '}',
    '',
    'Assert-NoReparseAncestor -TargetPath $workspaceRoot',
  ].join('\n');
  const replacement = [
    '    return "_request-$digest.json"',
    '}',
    '',
    'function Get-CanonicalMailboxIssue {',
    "    $authorityPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'shared\\agents\\canonicalMailboxAuthorityV1.mjs'))",
    '    Assert-NoReparseAncestor -TargetPath $authorityPath',
    "    if (-not (Test-Path -LiteralPath $authorityPath -PathType Leaf)) { throw 'RECOVERY_CANONICAL_MAILBOX_AUTHORITY_INVALID' }",
    '    $authorityBaseline = Get-PathIdentityBaseline -TargetPaths @($authorityPath)',
    '    $authoritySource = Get-Content -LiteralPath $authorityPath -Raw',
    '    Assert-StablePathBaseline -Baseline $authorityBaseline',
    "    $declarations = [regex]::Matches($authoritySource, '(?m)^\\s*export\\s+const\\s+CANONICAL_MAILBOX_ISSUE\\b')",
    "    $assignments = [regex]::Matches($authoritySource, '(?m)^\\s*export\\s+const\\s+CANONICAL_MAILBOX_ISSUE\\s*=\\s*([0-9]+)\\s*;\\s*$')",
    '    $canonicalIssue = 0',
    '    if ($declarations.Count -ne 1 -or $assignments.Count -ne 1',
    '        -or -not [int]::TryParse($assignments[0].Groups[1].Value, [ref]$canonicalIssue)',
    "        -or $canonicalIssue -le 0) { throw 'RECOVERY_CANONICAL_MAILBOX_AUTHORITY_INVALID' }",
    '    return $canonicalIssue',
    '}',
    '',
    'Assert-NoReparseAncestor -TargetPath $workspaceRoot',
  ].join('\n');
  assert.ok(source.includes(functionMarker), 'current-main recovery function marker changed');
  source = source.replace(functionMarker, replacement);

  const receiptMarker = [
    '    $canonicalReceiptFilename = Get-CanonicalMailboxReceiptFilename -RequestId ([string]$mailboxReceipt.requestId)',
    "    $sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'",
  ].join('\n');
  const receiptReplacement = [
    '    $canonicalReceiptFilename = Get-CanonicalMailboxReceiptFilename -RequestId ([string]$mailboxReceipt.requestId)',
    '    $canonicalMailboxIssue = Get-CanonicalMailboxIssue',
    "    $sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'",
  ].join('\n');
  assert.ok(source.includes(receiptMarker), 'current-main recovery receipt marker changed');
  source = source.replace(receiptMarker, receiptReplacement);

  const issueMarker = "-or [string]$mailboxReceipt.repository -ne 'Cheekyfellastef/stephan-os' -or [int]$mailboxReceipt.issueNumber -ne 1507";
  const issueReplacement = "-or [string]$mailboxReceipt.repository -ne 'Cheekyfellastef/stephan-os' -or [int]$mailboxReceipt.issueNumber -ne $canonicalMailboxIssue";
  assert.ok(source.includes(issueMarker), 'current-main recovery issue marker changed');
  return source.replace(issueMarker, issueReplacement);
}

function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref: head,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function findings() {
  return WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.map((path) => ({
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    summary: 'This high-risk surface requires a separate qualified specialist reviewer.',
    path,
  }));
}

function input(overrides = {}) {
  const installer = targetInstallerSource();
  const recovery = targetRecoverySource();
  return {
    repository,
    prNumber,
    branch,
    sourceHead: head,
    baseSha,
    analysis: { findings: findings() },
    sources: [
      source(installerPath, installer),
      source(recoveryPath, recovery),
    ],
    ...overrides,
  };
}

test('target synthesis remains exactly bound to PR #2164 immutable reviewed blobs', () => {
  assert.equal(blobSha(targetInstallerSource()), targetBlobs[installerPath]);
  assert.equal(blobSha(targetRecoverySource()), targetBlobs[recoveryPath]);
});

test('mailbox rollover specialist accepts only the exact two-surface #2164 profile', () => {
  const result = analyzeWindowsAuthorityMailboxRolloverReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1);

  assert.equal(analyzeWindowsAuthorityMailboxRolloverReviewV1(input({ prNumber: 2163 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMailboxRolloverReviewV1(input({ branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityMailboxRolloverReviewV1(input({
    analysis: { findings: findings().slice(0, 1) },
  })).eligible, false);
});

test('specialist fails closed on source-byte drift or extra source evidence', () => {
  const drifted = input();
  drifted.sources[0] = source(installerPath, `${targetInstallerSource()}# drift\n`);
  const driftResult = analyzeWindowsAuthorityMailboxRolloverReviewV1(drifted);
  assert.equal(driftResult.eligible, true);
  assert.equal(driftResult.clean, false);
  assert.ok(driftResult.findings.some((item) => item.code === 'windows-authority-mailbox-rollover-source-evidence-invalid'));

  const extra = input();
  extra.sources.push(source('scripts/windows/other.ps1', 'Write-Output nope\n'));
  const extraResult = analyzeWindowsAuthorityMailboxRolloverReviewV1(extra);
  assert.equal(extraResult.clean, false);
  assert.ok(extraResult.findings.some((item) => item.code === 'windows-authority-mailbox-rollover-source-estate-invalid'));
});

test('top-level Windows specialist routes the exact #2164 pair through the composite', () => {
  const result = analyzeWindowsAuthoritySpecialistReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_SPECIALIST_CLEAN');
});
