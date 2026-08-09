import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const V1_PATH = './windowsAuthorityNoFaffRescueReviewV1.mjs';
const V1_BLOB_SHA = '06d3d9da13f930be1f907187d13e7f0df898b6a2';
const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';

const RESCUE_PATH = 'scripts/windows/repair-battle-bridge-control-plane-now.ps1';
const STATIC_TEST_PATH = 'scripts/windows/repair-battle-bridge-control-plane-now.test.mjs';
const STATUS_PATH = 'scripts/windows/status-stephanos-codex-dispatch-plugin.ps1';

const SUPERSEDED_V1_CODES = new Set([
  'no-faff-rescue-attachment-blocker-missing',
  'no-faff-rescue-attachment-verdict-missing',
  'no-faff-rescue-tree-binding-missing',
  'no-faff-static-test-attachment-guard-missing',
]);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function provePinnedV1() {
  const url = new URL(V1_PATH, import.meta.url);
  const content = readFileSync(url, 'utf8');
  const observed = gitBlobSha(content);
  if (observed !== V1_BLOB_SHA) {
    throw new Error(`WINDOWS_AUTHORITY_NO_FAFF_V1_PIN_MISMATCH:${observed}`);
  }
  return url;
}

const v1 = await import(provePinnedV1().href);

export const WINDOWS_AUTHORITY_NO_FAFF_RESCUE_PATHS_V1 =
  v1.WINDOWS_AUTHORITY_NO_FAFF_RESCUE_PATHS_V1;

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

function requireSingleAssignment(findings, source, path, pattern, code) {
  const matches = source.match(pattern) ?? [];
  if (matches.length !== 1) findings.push(finding(code, path));
}

function forbidPattern(findings, source, path, pattern, code) {
  if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewAuthenticatedTransportRescue(source, findings) {
  requireLiteral(findings, source, RESCUE_PATH,
    "if ($dispatchProof.readyForRemoteChatDispatch -ne $true)",
    'no-faff-v2-remote-readiness-gate-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    '$dispatchBlocker = [string]$dispatchProof.finalVerdict',
    'no-faff-v2-status-blocker-binding-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    '$dispatchProof.readyForCodexCliDispatch -eq $true',
    'no-faff-v2-local-codex-readiness-branch-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    'readyForCodexCliDispatch = ($dispatchProof.readyForCodexCliDispatch -eq $true)',
    'no-faff-v2-local-codex-readiness-receipt-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    'readyForRemoteChatDispatch = $false',
    'no-faff-v2-remote-readiness-failclosed-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    'blocker = $dispatchBlocker',
    'no-faff-v2-blocker-projection-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    'finalVerdict = $dispatchBlocker',
    'no-faff-v2-blocker-verdict-projection-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    'separately reviewed authenticated ChatGPT transport',
    'no-faff-v2-authenticated-transport-next-action-missing');
  requireLiteral(findings, source, RESCUE_PATH,
    "($observedHead + '^{tree}')",
    'no-faff-v2-tree-binding-missing');

  forbidPattern(findings, source, RESCUE_PATH,
    /CHATGPT_DESKTOP_PLUGIN_ATTACHMENT_REQUIRED/,
    'no-faff-v2-obsolete-plugin-attachment-blocker-forbidden');
  forbidPattern(findings, source, RESCUE_PATH,
    /BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_ATTACHMENT_REQUIRED/,
    'no-faff-v2-obsolete-attachment-verdict-forbidden');
  forbidPattern(findings, source, RESCUE_PATH,
    /\$observedHead`\$\{tree\}/,
    'no-faff-v2-literal-tree-placeholder-forbidden');
  forbidPattern(findings, source, RESCUE_PATH,
    /Restart ChatGPT desktop[\s\S]{0,160}tools\/list/i,
    'no-faff-v2-obsolete-restart-guidance-forbidden');
}

function reviewAuthenticatedTransportStatus(source, findings) {
  const requirements = [
    ['$remoteTransportAuthenticated = $false', 'dispatch-status-v2-remote-auth-default-missing'],
    ["[string]$attachmentProof.transport.kind -eq 'local-stdio'", 'dispatch-status-v2-local-stdio-binding-missing'],
    ['$attachmentProof.transport.clientIdentityAuthenticated -eq $false', 'dispatch-status-v2-client-auth-denial-missing'],
    ['$attachmentProof.transport.remoteTransportAuthenticated -eq $false', 'dispatch-status-v2-remote-auth-proof-denial-missing'],
    ['$attachmentProof.clientSession.initializeReceived -eq $true', 'dispatch-status-v2-initialize-proof-missing'],
    ['$attachmentProof.clientSession.initializedNotificationReceived -eq $true', 'dispatch-status-v2-initialized-notification-proof-missing'],
    ['$attachmentProof.clientSession.supportedClient -eq $true', 'dispatch-status-v2-supported-client-proof-missing'],
    ['$attachmentProof.clientSession.ready -eq $true', 'dispatch-status-v2-session-ready-proof-missing'],
    ['$status.readyForCodexCliDispatch = $status.localBridgeReady -and $attachmentProofValid', 'dispatch-status-v2-local-readiness-join-missing'],
    ['$status.readyForRemoteChatDispatch = $status.readyForRemoteChatDispatch -and $remoteTransportAuthenticated', 'dispatch-status-v2-remote-auth-join-missing'],
    ['BLOCKED_AUTHENTICATED_REMOTE_MCP_TRANSPORT_REQUIRED', 'dispatch-status-v2-authenticated-transport-blocker-missing'],
    ['clientIdentityAuthenticated = $false', 'dispatch-status-v2-handshake-client-auth-denial-missing'],
    ['remoteTransportAuthenticated = $remoteTransportAuthenticated', 'dispatch-status-v2-handshake-remote-auth-projection-missing'],
  ];
  for (const [literal, code] of requirements) requireLiteral(findings, source, STATUS_PATH, literal, code);

  requireSingleAssignment(
    findings,
    source,
    STATUS_PATH,
    /^\s*\$status\.readyForRemoteChatDispatch\s*=/gm,
    'dispatch-status-v2-remote-readiness-assignment-not-unique',
  );
}

function reviewAuthenticatedTransportStaticTest(source, findings) {
  const requirements = [
    ["test('rescue repairs the existing Codex dispatch plugin without creating another execution lane'", 'no-faff-static-test-v2-rescue-transport-guard-missing'],
    ["test('rescue resolves the exact commit tree without leaking a literal PowerShell placeholder to Git'", 'no-faff-static-test-v2-tree-guard-missing'],
    ["test('dispatch readiness requires a fresh exact-head Windows tools-list attachment proof and separates local Codex from remote transport'", 'no-faff-static-test-v2-attachment-guard-missing'],
    ['dispatchBlocker', 'no-faff-static-test-v2-dynamic-blocker-verdict-guard-missing'],
    ['separately reviewed authenticated ChatGPT transport', 'no-faff-static-test-v2-authenticated-transport-guidance-guard-missing'],
    ['BLOCKED_AUTHENTICATED_REMOTE_MCP_TRANSPORT_REQUIRED', 'no-faff-static-test-v2-authenticated-transport-blocker-guard-missing'],
    ['remoteTransportAuthenticated', 'no-faff-static-test-v2-remote-auth-denial-guard-missing'],
  ];
  for (const [literal, code] of requirements) requireLiteral(findings, source, STATIC_TEST_PATH, literal, code);
}

export function upgradeWindowsAuthorityNoFaffRescueReviewV2(baseResult, input = {}) {
  if (!baseResult?.eligible) return baseResult;

  const findings = (Array.isArray(baseResult.findings) ? baseResult.findings : [])
    .filter((item) => !SUPERSEDED_V1_CODES.has(item?.code));
  const reviewedPaths = new Set(Array.isArray(baseResult.reviewedPaths) ? baseResult.reviewedPaths : []);

  if (reviewedPaths.has(RESCUE_PATH) && !baseSourceInvalid(baseResult, RESCUE_PATH)) {
    reviewAuthenticatedTransportRescue(sourceContent(input, RESCUE_PATH), findings);
  }
  if (reviewedPaths.has(STATUS_PATH) && !baseSourceInvalid(baseResult, STATUS_PATH)) {
    reviewAuthenticatedTransportStatus(sourceContent(input, STATUS_PATH), findings);
  }
  if (reviewedPaths.has(STATIC_TEST_PATH) && !baseSourceInvalid(baseResult, STATIC_TEST_PATH)) {
    reviewAuthenticatedTransportStaticTest(sourceContent(input, STATIC_TEST_PATH), findings);
  }

  const deduped = [...new Map(findings.map((item) => [`${item.path}\n${item.code}`, item])).values()];
  const clean = deduped.length === 0;

  return Object.freeze({
    schemaVersion: baseResult.schemaVersion || SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([...(baseResult.reviewedPaths || [])]),
    findings: Object.freeze(deduped),
    proofRefs: Object.freeze([...(baseResult.proofRefs || [])]),
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS',
  });
}

export function analyzeWindowsAuthorityNoFaffRescueReview(input = {}) {
  return upgradeWindowsAuthorityNoFaffRescueReviewV2(
    v1.analyzeWindowsAuthorityNoFaffRescueReview(input),
    input,
  );
}
