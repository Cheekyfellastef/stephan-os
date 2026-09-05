import { createHash } from 'node:crypto';

export const OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1 = Object.freeze([
  'integrations/openclaw/stephanos-builder-provider/index.js',
  'integrations/openclaw/stephanos-builder-provider/lib/oc1-gateway-provider.mjs',
  'integrations/openclaw/stephanos-builder-provider/lib/oc1-repository-scout.mjs',
  'integrations/openclaw/stephanos-builder-provider/oc1-gateway-provider.test.mjs',
  'integrations/openclaw/stephanos-builder-provider/oc1-repository-scout.test.mjs',
  'integrations/openclaw/stephanos-builder-provider/openclaw.plugin.json',
  'integrations/openclaw/stephanos-builder-provider/package.json',
]);

export const OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1 = Object.freeze([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs',
  'shared/agents/openClawTaskClassPromotionCandidateV1.mjs',
  'shared/agents/openClawTaskClassPromotionCandidateV1.test.mjs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const OC1_PR = 1910;
const PROVIDER_POOL_PR = 1905;
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

const PROFILES = Object.freeze({
  [OC1_PR]: Object.freeze({ id: 'oc1', paths: OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1 }),
  [PROVIDER_POOL_PR]: Object.freeze({ id: 'provider-pool', paths: OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1 }),
});

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function escalationPaths(analysis, expectedPaths) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== expectedPaths.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  ))) return [];
  const paths = unique(findings.map((item) => text(item?.path))).sort();
  const expected = [...expectedPaths].sort();
  return JSON.stringify(paths) === JSON.stringify(expected) ? paths : [];
}

function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function exactLineage(lineage, repository, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents : [];
  return lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && lineage?.repository === repository
    && lineage?.sourceHead === sourceHead
    && lineage?.sourceCommitSha === sourceHead
    && lineage?.baseSha === baseSha
    && lineage?.liveMainBeforeSha === baseSha
    && lineage?.liveMainAfterSha === baseSha
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage?.comparison?.behindBy === 0
    && lineage?.comparison?.baseCommitSha === baseSha
    && lineage?.comparison?.mergeBaseCommitSha === baseSha;
}

function requireLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code, path));
}
function requirePatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (!pattern.test(source)) findings.push(finding(code, path));
}
function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewIndex(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["api.registerGatewayMethod(", 'openclaw-oc1-gateway-method-registration-missing'],
    ["executeOpenClawOc1GatewayRequest", 'openclaw-oc1-gateway-executor-missing'],
    ["executingInsideOpenClawGateway: true", 'openclaw-oc1-gateway-context-missing'],
    ["pluginId: 'stephanos-builder-provider'", 'openclaw-oc1-plugin-id-not-fixed'],
    ["providerInstance: `openclaw-gateway:${process.pid}`", 'openclaw-oc1-provider-instance-not-host-bound'],
    ["{ scope: 'operator.write' }", 'openclaw-oc1-gateway-scope-not-explicit'],
    ["requireAuth: true", 'openclaw-oc1-diagnostic-auth-missing'],
    ["QUALIFICATION_ELIGIBLE=false", 'openclaw-oc1-manual-command-not-explicitly-nonqualifying'],
    ["PRODUCTION_ELIGIBLE=false", 'openclaw-oc1-manual-command-production-denial-missing'],
    ["SOURCE_MUTATION=false", 'openclaw-oc1-manual-command-source-denial-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/\b(?:exec|execSync|spawn|spawnSync|fork)\s*\(/, 'openclaw-oc1-index-dynamic-process-forbidden'],
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc1-index-dynamic-code-forbidden'],
  ]);
}

function reviewGateway(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC1_GATEWAY_METHOD = 'stephanos-builder-provider.oc1Qualification';", 'openclaw-oc1-method-not-fixed'],
    ["const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);", 'openclaw-oc1-request-shape-not-closed'],
    ["const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc1-repository-not-fixed'],
    ["grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'", 'openclaw-oc1-grant-schema-gate-missing'],
    ["grant?.boundedActionCount !== 1", 'openclaw-oc1-bounded-action-gate-missing'],
    ["grant?.mergeAuthority !== false", 'openclaw-oc1-merge-authority-denial-missing'],
    ["grant?.leaseSeizureAllowed !== false", 'openclaw-oc1-lease-denial-missing'],
    ["text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'", 'openclaw-oc1-adapter-gate-missing'],
    ["FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())", 'openclaw-oc1-source-head-gate-missing'],
    ["path.resolve(queueRoot, 'openclaw-readonly', 'processing')", 'openclaw-oc1-processing-root-not-fixed'],
    ["item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'", 'openclaw-oc1-claim-schema-gate-missing'],
    ["text(item?.missionId).toLowerCase() !== missionId", 'openclaw-oc1-mission-binding-missing'],
    ["text(item?.actionId).toLowerCase() !== taskId", 'openclaw-oc1-task-binding-missing'],
    ["executeClaimedOpenClawOc1RepositoryScout", 'openclaw-oc1-claimed-executor-missing'],
    ["executionSurface: 'openclaw-gateway-plugin'", 'openclaw-oc1-execution-surface-not-bound'],
    ["providerVersion: OPENCLAW_OC1_PROVIDER_VERSION", 'openclaw-oc1-provider-version-binding-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/executingInsideOpenClawGateway === true[\s\S]*pluginId === 'stephanos-builder-provider'[\s\S]*method === OPENCLAW_OC1_GATEWAY_METHOD/, 'openclaw-oc1-gateway-runtime-gate-incomplete'],
    [/schemaVersion:\s*OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA[\s\S]*qualificationEligible:\s*false/, 'openclaw-oc1-blocked-result-not-nonqualifying'],
  ]);
  forbidPatterns(findings, source, path, [
    [/from ['"]node:child_process['"]|require\(['"]child_process['"]\)/, 'openclaw-oc1-gateway-process-authority-forbidden'],
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc1-gateway-dynamic-code-forbidden'],
  ]);
}

function reviewScout(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC1_TASK_CLASS = 'OC1_REPOSITORY_SCOUT';", 'openclaw-oc1-task-class-not-fixed'],
    ["export const OPENCLAW_OC1_PROVIDER = 'openclaw-standalone';", 'openclaw-oc1-provider-not-fixed'],
    ["export const OPENCLAW_OC1_PROVIDER_VERSION = '1.0.0';", 'openclaw-oc1-provider-version-not-fixed'],
    ["export const OPENCLAW_OC1_ISSUE = 1725;", 'openclaw-oc1-goal-not-fixed'],
    ["const CANONICAL_BRANCH = 'main';", 'openclaw-oc1-branch-not-fixed'],
    ["spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, args", 'openclaw-oc1-git-executable-not-fixed'],
    ["shell: false", 'openclaw-oc1-shell-denial-missing'],
    ["windowsHide: true", 'openclaw-oc1-windowless-execution-missing'],
    ["timeout: 15_000", 'openclaw-oc1-git-timeout-not-bounded'],
    ["grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'", 'openclaw-oc1-qualification-grant-gate-missing'],
    ["grant?.mergeAuthority !== false", 'openclaw-oc1-qualification-merge-denial-missing'],
    ["grant?.leaseSeizureAllowed !== false", 'openclaw-oc1-qualification-lease-denial-missing'],
    ["claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'", 'openclaw-oc1-persisted-claim-gate-missing'],
    ["action?.schemaVersion !== 'stephanos.mission-worker-action.v1'", 'openclaw-oc1-action-schema-gate-missing'],
    ["action?.actionKind !== 'agent-handoff'", 'openclaw-oc1-action-kind-gate-missing'],
    ["claim.item.payload !== action", 'openclaw-oc1-claim-payload-identity-gate-missing'],
    ["createExecutionReceipt", 'openclaw-oc1-execution-receipt-missing'],
    ["toSharedWorkspaceExecutionReceipt", 'openclaw-oc1-shared-workspace-receipt-missing'],
    ["createSharedWorkspaceMessageRecord", 'openclaw-oc1-provider-proof-record-missing'],
    ["writeAtomicJson", 'openclaw-oc1-atomic-proof-write-missing'],
    ["qualificationEligible: false", 'openclaw-oc1-diagnostic-nonqualification-missing'],
    ["sourceMutationPerformed: false", 'openclaw-oc1-source-mutation-denial-missing'],
    ["arbitraryShellAllowed: false", 'openclaw-oc1-arbitrary-shell-denial-missing'],
    ["arbitraryCommandAllowed: false", 'openclaw-oc1-arbitrary-command-denial-missing'],
    ["mergeAllowed: false", 'openclaw-oc1-result-merge-denial-missing'],
    ["deploymentAllowed: false", 'openclaw-oc1-result-deployment-denial-missing'],
    ["selfQualificationAllowed: false", 'openclaw-oc1-self-qualification-denial-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/identity\?\.product === 'OpenClaw'[\s\S]*SAFE_RUNTIME_ID\.test\(runtimeId\)/, 'openclaw-oc1-runtime-identity-gate-missing'],
    [/requestedSourceHead !== text\(grant\?\.sourceRevision\)\.toLowerCase\(\)/, 'openclaw-oc1-requested-head-binding-missing'],
    [/text\(claim\?\.item\?\.missionId\)\.toLowerCase\(\) !== missionId[\s\S]*text\(claim\?\.item\?\.actionId\)\.toLowerCase\(\) !== taskId/, 'openclaw-oc1-claim-mission-task-binding-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc1-dynamic-code-forbidden'],
    [/\bgit(?:\.exe)?\b[^\r\n]*(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'openclaw-oc1-git-mutation-forbidden'],
    [/\b(?:exec|execSync|execFile|fork)\s*\(/, 'openclaw-oc1-dynamic-process-forbidden'],
  ]);
}

function reviewGatewayTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["qualification runs inside OpenClaw Gateway and reopens the exact canonical processing claim", 'openclaw-oc1-gateway-positive-proof-missing'],
    ["a direct module call without the OpenClaw Gateway runtime marker cannot qualify", 'openclaw-oc1-direct-call-negative-proof-missing'],
    ["caller-selected claim paths and extra request fields are rejected before claim access", 'openclaw-oc1-caller-path-negative-proof-missing'],
    ["wrong task or source-head grant cannot redirect Gateway qualification", 'openclaw-oc1-lineage-negative-proof-missing'],
    ["assert.equal(result.executionSurface, 'openclaw-gateway-plugin')", 'openclaw-oc1-execution-surface-test-missing'],
    ["assert.deepEqual(result.result.changedFiles, [])", 'openclaw-oc1-zero-diff-test-missing'],
  ]);
}

function reviewScoutTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["QUALIFICATION_ELIGIBLE=false", 'openclaw-oc1-manual-nonqualification-test-missing'],
    ["OPENCLAW_OC1_QUALIFICATION", 'openclaw-oc1-qualification-test-estate-missing'],
    ["sourceMutation", 'openclaw-oc1-source-mutation-test-estate-missing'],
  ]);
  forbidPatterns(findings, source, path, [[/shell\s*:\s*true/i, 'openclaw-oc1-test-shell-widening-forbidden']]);
}

function reviewPluginManifest(source, path, findings) {
  try {
    const manifest = JSON.parse(source);
    if (manifest?.id !== 'stephanos-builder-provider') findings.push(finding('openclaw-oc1-plugin-id-mismatch', path));
    if (manifest?.activation?.onStartup !== true) findings.push(finding('openclaw-oc1-plugin-startup-activation-missing', path));
    if (manifest?.configSchema?.type !== 'object' || manifest?.configSchema?.additionalProperties !== false) findings.push(finding('openclaw-oc1-plugin-config-not-closed', path));
    if (JSON.stringify(manifest?.configSchema?.properties) !== '{}') findings.push(finding('openclaw-oc1-plugin-config-accepts-caller-input', path));
  } catch {
    findings.push(finding('openclaw-oc1-plugin-manifest-invalid-json', path));
  }
}

function reviewPackageManifest(source, path, findings) {
  try {
    const manifest = JSON.parse(source);
    if (manifest?.name !== '@stephanos/openclaw-builder-provider') findings.push(finding('openclaw-oc1-package-name-mismatch', path));
    if (manifest?.version !== '1.0.0' || manifest?.private !== true || manifest?.type !== 'module') findings.push(finding('openclaw-oc1-package-identity-mismatch', path));
    if (JSON.stringify(manifest?.openclaw?.extensions) !== JSON.stringify(['./index.js'])) findings.push(finding('openclaw-oc1-package-entrypoint-not-fixed', path));
    if (manifest?.openclaw?.compat?.pluginApi !== '>=2026.3.24-beta.2' || manifest?.openclaw?.compat?.minGatewayVersion !== '>=2026.6.11') findings.push(finding('openclaw-oc1-package-compatibility-boundary-mismatch', path));
  } catch {
    findings.push(finding('openclaw-oc1-package-manifest-invalid-json', path));
  }
}

function reviewProviderPool(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';", 'openclaw-provider-pool-canonical-router-missing'],
    ["validateExecutionReceipt", 'openclaw-provider-pool-execution-validator-missing'],
    ["toSharedWorkspaceExecutionReceipt", 'openclaw-provider-pool-workspace-projection-missing'],
    ["validateSharedWorkspaceRecord", 'openclaw-provider-pool-workspace-validator-missing'],
    ["const OPENCLAW_QUALIFICATION_ISSUE = 1725;", 'openclaw-provider-pool-goal-not-fixed'],
    ["export function validateOpenClawQualificationAuthorityChain", 'openclaw-provider-pool-authority-chain-gate-missing'],
    ["issueNumber: OPENCLAW_QUALIFICATION_ISSUE", 'openclaw-provider-pool-execution-goal-binding-missing'],
    ["execution.workerType !== 'openclaw'", 'openclaw-provider-pool-worker-type-binding-missing'],
    ["execution.state !== 'completed'", 'openclaw-provider-pool-completed-execution-gate-missing'],
    ["execution.operatorActionRequired !== false", 'openclaw-provider-pool-operator-action-gate-missing'],
    ["canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)", 'openclaw-provider-pool-canonical-workspace-gate-missing'],
    ["authority.participantId !== 'stephanos'", 'openclaw-provider-pool-stephanos-authority-gate-missing'],
    ["authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)", 'openclaw-provider-pool-authority-goal-binding-missing'],
    ["authority.receivedRecordId !== execution.receiptId", 'openclaw-provider-pool-authority-execution-binding-missing'],
    ["authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION", 'openclaw-provider-pool-production-disposition-gate-missing'],
    ["candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId", 'openclaw-provider-pool-capacity-authority-binding-missing'],
    ["const host = snapshot(trustedHostContext);", 'openclaw-provider-pool-trusted-host-only-gate-missing'],
    ["const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;", 'openclaw-provider-pool-complete-chain-gate-missing'],
    ["mergeAuthority: false", 'openclaw-provider-pool-merge-denial-missing'],
    ["leaseSeizureAllowed: false", 'openclaw-provider-pool-lease-denial-missing'],
    ["duplicateDispatchAllowed: false", 'openclaw-provider-pool-duplicate-dispatch-denial-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/from ['"]node:(?:child_process|fs|fs\/promises)['"]|require\(['"](?:child_process|fs)['"]\)/, 'openclaw-provider-pool-local-execution-authority-forbidden'],
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-provider-pool-dynamic-execution-forbidden'],
  ]);
}

function reviewProviderPoolTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt", 'openclaw-provider-pool-authority-chain-positive-test-missing'],
    ["capacity is unusable without the exact validated qualification authority, worker and task class", 'openclaw-provider-pool-capacity-binding-test-missing'],
    ["caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw", 'openclaw-provider-pool-caller-forgery-test-missing'],
    ["syntactically valid trusted qualification without canonical authority cannot route", 'openclaw-provider-pool-syntax-only-forgery-test-missing'],
    ["existing mutation owner is preserved even when OpenClaw is canonically qualified", 'openclaw-provider-pool-owner-preservation-test-missing'],
    ["normal AUTO routing does not silently replace a healthy existing provider policy", 'openclaw-provider-pool-no-silent-route-replacement-test-missing'],
    ["assert.equal(result.mergeAuthority, false)", 'openclaw-provider-pool-merge-denial-test-missing'],
    ["assert.equal(result.leaseSeizureAllowed, false)", 'openclaw-provider-pool-lease-denial-test-missing'],
    ["assert.equal(result.duplicateDispatchAllowed, false)", 'openclaw-provider-pool-duplicate-dispatch-test-missing'],
  ]);
}

function reviewPromotionCandidate(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["const ISSUE_NUMBER = 1725;", 'openclaw-promotion-goal-not-fixed'],
    ["OC1_REPOSITORY_SCOUT: Object.freeze({", 'openclaw-promotion-oc1-policy-missing'],
    ["OC2_DETERMINISTIC_TEST_BUILD: Object.freeze({", 'openclaw-promotion-oc2-policy-missing'],
    ["validateExecutionReceipt(execution", 'openclaw-promotion-execution-validator-missing'],
    ["execution?.workerType !== 'openclaw'", 'openclaw-promotion-worker-type-gate-missing'],
    ["execution?.operatorActionRequired !== false", 'openclaw-promotion-operator-action-gate-missing'],
    ["proof.record.timestampUtc !== execution.timestampUtc", 'openclaw-promotion-proof-time-lineage-missing'],
    ["proof.record.messageId !== execution.executionId", 'openclaw-promotion-proof-execution-lineage-missing'],
    ["text(result.observedSourceHead).toLowerCase() !== text(execution.sourceHead).toLowerCase()", 'openclaw-promotion-source-head-binding-missing'],
    ["canonicalResultDigest(result) !== text(result.exactOutputIdentity).toLowerCase()", 'openclaw-promotion-result-digest-gate-missing'],
    ["result.selfQualificationAllowed !== false", 'openclaw-promotion-self-qualification-denial-missing'],
    ["createSharedWorkspaceReceiptRecord({", 'openclaw-promotion-stephanos-receipt-missing'],
    ["participantId: 'stephanos'", 'openclaw-promotion-stephanos-authority-missing'],
    ["providerPoolAdmissionAllowed: false", 'openclaw-promotion-pool-admission-denial-missing'],
    ["providerQualificationAuthority: false", 'openclaw-promotion-qualification-authority-denial-missing'],
    ["sourceMutationAllowed: false", 'openclaw-promotion-source-denial-missing'],
    ["mergeAllowed: false", 'openclaw-promotion-merge-denial-missing'],
    ["deploymentAllowed: false", 'openclaw-promotion-deployment-denial-missing'],
    ["runtimeMutationAllowed: false", 'openclaw-promotion-runtime-denial-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/from ['"]node:(?:child_process|fs|fs\/promises|http|https|net)['"]|require\(['"](?:child_process|fs|http|https|net)['"]\)/, 'openclaw-promotion-execution-or-network-authority-forbidden'],
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork|fetch)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-promotion-dynamic-execution-forbidden'],
  ]);
}

function reviewPromotionCandidateTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["turns canonical OC1 execution plus provider proof into a gate-compatible Stephanos promotion candidate without routing authority", 'openclaw-promotion-oc1-positive-test-missing'],
    ["supports OC2 only after a completed fixed test/build execution and matching canonical provider proof", 'openclaw-promotion-oc2-positive-test-missing'],
    ["fails closed on failed execution, unsupported class, mutation, self-qualification, worker/head drift, test failure or stale proof", 'openclaw-promotion-hostile-lineage-test-missing'],
    ["rejects result digest drift, extra authority fields and proof-record lineage drift", 'openclaw-promotion-digest-authority-test-missing'],
    ["rejects accessor-bearing, sparse and revoked proof records without executing accessors", 'openclaw-promotion-hostile-object-test-missing'],
    ["assert.equal(candidate.providerPoolAdmissionAllowed, false)", 'openclaw-promotion-pool-admission-denial-test-missing'],
    ["assert.equal(candidate.providerQualificationAuthority, false)", 'openclaw-promotion-qualification-authority-denial-test-missing'],
  ]);
}

function reviewPath(profile, source, path, findings) {
  if (profile.id === 'oc1') {
    if (path.endsWith('/index.js')) reviewIndex(source, path, findings);
    else if (path.endsWith('/lib/oc1-gateway-provider.mjs')) reviewGateway(source, path, findings);
    else if (path.endsWith('/lib/oc1-repository-scout.mjs')) reviewScout(source, path, findings);
    else if (path.endsWith('/oc1-gateway-provider.test.mjs')) reviewGatewayTests(source, path, findings);
    else if (path.endsWith('/oc1-repository-scout.test.mjs')) reviewScoutTests(source, path, findings);
    else if (path.endsWith('/openclaw.plugin.json')) reviewPluginManifest(source, path, findings);
    else if (path.endsWith('/package.json')) reviewPackageManifest(source, path, findings);
    return;
  }
  if (path.endsWith('/openClawProviderPoolQualificationV1.mjs')) reviewProviderPool(source, path, findings);
  else if (path.endsWith('/openClawProviderPoolQualificationV1.test.mjs')) reviewProviderPoolTests(source, path, findings);
  else if (path.endsWith('/openClawTaskClassPromotionCandidateV1.mjs')) reviewPromotionCandidate(source, path, findings);
  else if (path.endsWith('/openClawTaskClassPromotionCandidateV1.test.mjs')) reviewPromotionCandidateTests(source, path, findings);
}

export function analyzeOpenClawBuilderProviderSpecialistReviewV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const profile = PROFILES[prNumber] || null;
  const paths = profile ? escalationPaths(input.analysis, profile.paths) : [];
  const eligible = repository === CANONICAL_REPOSITORY
    && profile !== null
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && paths.length === profile.paths.length;
  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_NOT_APPLICABLE',
  });

  const codePrefix = profile.id === 'oc1' ? 'openclaw-oc1' : 'openclaw-provider-pool';
  if (!exactLineage(input.lineageEvidence, repository, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze([finding(`${codePrefix}-reconciliation-lineage-invalid`, paths[0])]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of profile.paths) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding(`${codePrefix}-source-evidence-invalid`, path));
      continue;
    }
    reviewPath(profile, candidates[0].content, path, findings);
    proofRefs.push(`proofs/openclaw-builder-provider-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== profile.paths.length) findings.push(finding(`${codePrefix}-source-evidence-estate-mismatch`, profile.paths[0]));
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: Object.freeze([...profile.paths]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length === 0
      ? 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN'
      : 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
  });
}
