import { createHash } from 'node:crypto';

export const OPENCLAW_OC2_SPECIALIST_PATHS_V1 = Object.freeze([
  'integrations/openclaw/stephanos-builder-provider/index.js',
  'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs',
  'integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs',
  'integrations/openclaw/stephanos-builder-provider/oc2-deterministic-test-build.test.mjs',
  'integrations/openclaw/stephanos-builder-provider/oc2-gateway-provider.test.mjs',
  'integrations/openclaw/stephanos-builder-provider/openclaw.plugin.json',
]);

export const OPENCLAW_OC2_SPECIALIST_SCHEMA_V1 = 'stephanos.openclaw-oc2-specialist-review.v1';

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const OC2_PR = 1931;
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== OPENCLAW_OC2_SPECIALIST_PATHS_V1.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  ))) return [];
  const paths = unique(findings.map((item) => text(item?.path))).sort();
  const expected = [...OPENCLAW_OC2_SPECIALIST_PATHS_V1].sort();
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
    ["OPENCLAW_OC2_GATEWAY_METHOD", 'openclaw-oc2-index-method-import-missing'],
    ["executeOpenClawOc2GatewayRequest", 'openclaw-oc2-index-executor-import-missing'],
    ["executingInsideOpenClawGateway: true", 'openclaw-oc2-index-gateway-context-missing'],
    ["pluginId: 'stephanos-builder-provider'", 'openclaw-oc2-index-plugin-id-not-fixed'],
    ["providerInstance: `openclaw-gateway:${process.pid}`", 'openclaw-oc2-index-provider-instance-not-host-bound'],
    ["api.registerGatewayMethod(", 'openclaw-oc2-index-gateway-registration-missing'],
    ["gatewayContext(OPENCLAW_OC2_GATEWAY_METHOD)", 'openclaw-oc2-index-gateway-binding-missing'],
    ["{ scope: 'operator.write' }", 'openclaw-oc2-index-gateway-scope-not-explicit'],
    ["Qualification is reserved for canonical Mission Worker claims executed by the OpenClaw Gateway plugin.", 'openclaw-oc2-index-manual-qualification-denial-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/registerGatewayMethod\([\s\S]*OPENCLAW_OC2_GATEWAY_METHOD[\s\S]*executeOpenClawOc2GatewayRequest/, 'openclaw-oc2-index-registration-binding-incomplete'],
  ]);
  forbidPatterns(findings, source, path, [
    [/\b(?:exec|execSync|spawn|spawnSync|fork)\s*\(/, 'openclaw-oc2-index-dynamic-process-forbidden'],
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-index-dynamic-code-forbidden'],
  ]);
}

function reviewDeterministicExecutor(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC2_TASK_CLASS = 'OC2_DETERMINISTIC_TEST_BUILD';", 'openclaw-oc2-task-class-not-fixed'],
    ["export const OPENCLAW_OC2_OPERATION = 'oc2-provider-regression-v1';", 'openclaw-oc2-operation-not-fixed'],
    ["export const OPENCLAW_OC2_PROVIDER = 'openclaw-standalone';", 'openclaw-oc2-provider-not-fixed'],
    ["export const OPENCLAW_OC2_PROVIDER_VERSION = '1.0.0';", 'openclaw-oc2-provider-version-not-fixed'],
    ["export const OPENCLAW_OC2_ISSUE = 1725;", 'openclaw-oc2-goal-not-fixed'],
    ["const REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc2-repository-not-fixed'],
    ["const BRANCH = 'main';", 'openclaw-oc2-branch-not-fixed'],
    ["const MAX_OUTPUT_BYTES = 1024 * 1024;", 'openclaw-oc2-output-bound-missing'],
    ["testId: 'OC2_PROVIDER_SOURCE_PARSE_V1'", 'openclaw-oc2-fixed-source-parse-plan-missing'],
    ["'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs'", 'openclaw-oc2-source-parse-target-not-fixed'],
    ["testId: 'OC2_PROVIDER_REGRESSION_V1'", 'openclaw-oc2-fixed-regression-plan-missing'],
    ["'integrations/openclaw/stephanos-builder-provider/oc2-deterministic-test-build.test.mjs'", 'openclaw-oc2-deterministic-test-target-not-fixed'],
    ["'integrations/openclaw/stephanos-builder-provider/oc2-gateway-provider.test.mjs'", 'openclaw-oc2-gateway-test-target-not-fixed'],
    ["'scripts/mission-orchestrator-worker.oc2.test.mjs'", 'openclaw-oc2-worker-test-target-not-fixed'],
    ["BATTLE_BRIDGE_WINDOWS_HOST.git", 'openclaw-oc2-git-executable-not-fixed'],
    ["BATTLE_BRIDGE_WINDOWS_HOST.node", 'openclaw-oc2-node-executable-not-fixed'],
    ["shell: false", 'openclaw-oc2-shell-denial-missing'],
    ["windowsHide: true", 'openclaw-oc2-windowless-execution-missing'],
    ["timeout = 120_000", 'openclaw-oc2-test-timeout-not-bounded'],
    ["15_000", 'openclaw-oc2-git-timeout-not-bounded'],
    ["grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'", 'openclaw-oc2-grant-schema-gate-missing'],
    ["grant?.boundedActionCount !== 1", 'openclaw-oc2-bounded-action-gate-missing'],
    ["grant?.mergeAuthority !== false", 'openclaw-oc2-merge-authority-denial-missing'],
    ["grant?.leaseSeizureAllowed !== false", 'openclaw-oc2-lease-denial-missing'],
    ["text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'", 'openclaw-oc2-adapter-gate-missing'],
    ["text(grant?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION", 'openclaw-oc2-operation-gate-missing'],
    ["text(grant?.repository) !== REPOSITORY", 'openclaw-oc2-repository-gate-missing'],
    ["FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())", 'openclaw-oc2-source-head-gate-missing'],
    ["claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'", 'openclaw-oc2-claim-schema-gate-missing'],
    ["action?.schemaVersion !== 'stephanos.mission-worker-action.v1'", 'openclaw-oc2-action-schema-gate-missing'],
    ["action?.actionKind !== 'agent-handoff'", 'openclaw-oc2-action-kind-gate-missing'],
    ["claim.item.payload !== action", 'openclaw-oc2-claim-payload-identity-gate-missing'],
    ["JSON.stringify(persisted) !== JSON.stringify(claim.item)", 'openclaw-oc2-persisted-claim-equality-gate-missing'],
    ["classifyDirt", 'openclaw-oc2-dirt-policy-missing'],
    ["if (sourceHead !== task.requestedSourceHead)", 'openclaw-oc2-pre-test-head-binding-missing'],
    ["if (finalHead !== sourceHead)", 'openclaw-oc2-post-test-head-binding-missing'],
    ["if (statusAfter !== statusBefore)", 'openclaw-oc2-post-test-state-binding-missing'],
    ["if (platform !== 'win32')", 'openclaw-oc2-windows-runtime-gate-missing'],
    ["createExecutionReceipt", 'openclaw-oc2-execution-receipt-missing'],
    ["toSharedWorkspaceExecutionReceipt", 'openclaw-oc2-workspace-receipt-missing'],
    ["createSharedWorkspaceMessageRecord", 'openclaw-oc2-provider-proof-missing'],
    ["writeAtomicJson", 'openclaw-oc2-atomic-proof-write-missing'],
    ["sourceMutationPerformed: false", 'openclaw-oc2-source-mutation-denial-missing'],
    ["arbitraryShellAllowed: false", 'openclaw-oc2-arbitrary-shell-denial-missing'],
    ["arbitraryCommandAllowed: false", 'openclaw-oc2-arbitrary-command-denial-missing'],
    ["mergeAllowed: false", 'openclaw-oc2-result-merge-denial-missing'],
    ["deploymentAllowed: false", 'openclaw-oc2-result-deployment-denial-missing'],
    ["selfQualificationAllowed: false", 'openclaw-oc2-self-qualification-denial-missing'],
    ["workerType: 'openclaw'", 'openclaw-oc2-receipt-worker-type-not-fixed'],
    ["channel: 'openclaw-provider-qualification'", 'openclaw-oc2-proof-channel-not-fixed'],
  ]);
  requirePatterns(findings, source, path, [
    [/for \(const plan of OPENCLAW_OC2_FIXED_PLAN\)[\s\S]*BATTLE_BRIDGE_WINDOWS_HOST\.node[\s\S]*\[\.\.\.plan\.args\]/, 'openclaw-oc2-fixed-plan-execution-binding-missing'],
    [/requestedSourceHead !== text\(grant\.sourceRevision\)\.toLowerCase\(\)/, 'openclaw-oc2-requested-head-binding-missing'],
    [/qualificationEligible:\s*true[\s\S]*providerInstance[\s\S]*exactInputIdentity[\s\S]*exactOutputIdentity/, 'openclaw-oc2-success-result-binding-incomplete'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-dynamic-code-forbidden'],
    [/\b(?:exec|execSync|execFile|fork)\s*\(/, 'openclaw-oc2-unbounded-process-authority-forbidden'],
    [/\bgit(?:\.exe)?\b[^\r\n]*(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'openclaw-oc2-git-mutation-forbidden'],
  ]);
}

function reviewGateway(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC2_GATEWAY_METHOD = 'stephanos-builder-provider.oc2Qualification';", 'openclaw-oc2-gateway-method-not-fixed'],
    ["export const OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc2-gateway-request.v1';", 'openclaw-oc2-gateway-request-schema-not-fixed'],
    ["export const OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc2-gateway-result.v1';", 'openclaw-oc2-gateway-result-schema-not-fixed'],
    ["const REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc2-gateway-repository-not-fixed'],
    ["const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);", 'openclaw-oc2-gateway-request-shape-not-closed'],
    ["context?.executingInsideOpenClawGateway === true", 'openclaw-oc2-gateway-runtime-marker-missing'],
    ["context?.pluginId === 'stephanos-builder-provider'", 'openclaw-oc2-gateway-plugin-binding-missing'],
    ["context?.method === OPENCLAW_OC2_GATEWAY_METHOD", 'openclaw-oc2-gateway-method-binding-missing'],
    ["GATEWAY_INSTANCE.test(providerInstance)", 'openclaw-oc2-gateway-instance-binding-missing'],
    ["grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'", 'openclaw-oc2-gateway-grant-schema-gate-missing'],
    ["grant?.boundedActionCount !== 1", 'openclaw-oc2-gateway-bounded-action-gate-missing'],
    ["grant?.mergeAuthority !== false", 'openclaw-oc2-gateway-merge-denial-missing'],
    ["grant?.leaseSeizureAllowed !== false", 'openclaw-oc2-gateway-lease-denial-missing'],
    ["text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'", 'openclaw-oc2-gateway-adapter-gate-missing'],
    ["text(grant?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION", 'openclaw-oc2-gateway-operation-gate-missing'],
    ["path.resolve(queueRoot, 'openclaw-readonly', 'processing')", 'openclaw-oc2-gateway-processing-root-not-fixed'],
    ["item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'", 'openclaw-oc2-gateway-item-schema-gate-missing'],
    ["text(item?.missionId).toLowerCase() !== missionId", 'openclaw-oc2-gateway-mission-binding-missing'],
    ["text(item?.actionId).toLowerCase() !== taskId", 'openclaw-oc2-gateway-task-binding-missing'],
    ["text(item?.payload?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION", 'openclaw-oc2-gateway-item-operation-gate-missing'],
    ["executeClaimedOpenClawOc2DeterministicTestBuild", 'openclaw-oc2-gateway-executor-binding-missing'],
    ["taskClass: OPENCLAW_OC2_TASK_CLASS", 'openclaw-oc2-gateway-task-class-not-fixed'],
    ["providerVersion: OPENCLAW_OC2_PROVIDER_VERSION", 'openclaw-oc2-gateway-provider-version-not-fixed'],
    ["executionSurface: 'openclaw-gateway-plugin'", 'openclaw-oc2-gateway-surface-not-fixed'],
    ["qualificationEligible: result.success === true && result.qualificationEligible === true", 'openclaw-oc2-gateway-result-not-bound'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-gateway-dynamic-code-forbidden'],
    [/\b(?:exec|execSync|spawn|spawnSync|execFile|fork)\s*\(/, 'openclaw-oc2-gateway-process-authority-forbidden'],
  ]);
}

function reviewExecutorTest(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['OC2 admits only the exact canonical claimed action and fixed operation', 'openclaw-oc2-test-canonical-grant-regression-missing'],
    ['OC2 executes only fixed node test IDs and proves source state unchanged', 'openclaw-oc2-test-fixed-plan-regression-missing'],
    ['OC2 fails closed if a fixed test changes repository source state', 'openclaw-oc2-test-source-drift-regression-missing'],
    ['assert.equal(valid.task.arbitraryCommandAuthority, false)', 'openclaw-oc2-test-arbitrary-command-denial-regression-missing'],
    ['assert.deepEqual(result.changedFiles, [])', 'openclaw-oc2-test-changed-files-regression-missing'],
    ['assert.ok(nodeCalls.every((call) => call.options.shell === false))', 'openclaw-oc2-test-shell-false-regression-missing'],
    ["assert.equal(result.error, 'OPENCLAW_OC2_SOURCE_STATE_CHANGED')", 'openclaw-oc2-test-source-drift-error-regression-missing'],
  ]);
}

function reviewGatewayTest(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['OC2 gateway rejects execution outside the actual OpenClaw Gateway plugin', 'openclaw-oc2-gateway-test-runtime-binding-regression-missing'],
    ['OC2 gateway rejects caller-selected operation or extra request fields', 'openclaw-oc2-gateway-test-request-shape-regression-missing'],
    ['OC2 gateway binds the persisted claimed item and executes the fixed plan', 'openclaw-oc2-gateway-test-claim-binding-regression-missing'],
    ["assert.equal(result.executionSurface, 'openclaw-gateway-plugin')", 'openclaw-oc2-gateway-test-surface-regression-missing'],
    ['assert.equal(result.result.changedFiles.length, 0)', 'openclaw-oc2-gateway-test-changed-files-regression-missing'],
    ["assert.equal(extra.error, 'OPENCLAW_OC2_GATEWAY_REQUEST_SHAPE_INVALID')", 'openclaw-oc2-gateway-test-request-shape-error-regression-missing'],
  ]);
}

function reviewPlugin(source, path, findings) {
  let parsed;
  try { parsed = JSON.parse(source); } catch { findings.push(finding('openclaw-oc2-plugin-json-invalid', path)); return; }
  if (parsed?.id !== 'stephanos-builder-provider') findings.push(finding('openclaw-oc2-plugin-id-not-fixed', path));
  if (parsed?.activation?.onStartup !== true) findings.push(finding('openclaw-oc2-plugin-startup-activation-missing', path));
  if (!text(parsed?.description).includes('OC2 deterministic test/build')) findings.push(finding('openclaw-oc2-plugin-description-missing-task-bound', path));
  if (parsed?.configSchema?.type !== 'object' || parsed?.configSchema?.additionalProperties !== false
    || !parsed?.configSchema?.properties || Object.keys(parsed.configSchema.properties).length !== 0) {
    findings.push(finding('openclaw-oc2-plugin-config-not-closed', path));
  }
}

const REVIEWERS = Object.freeze([
  reviewIndex,
  reviewDeterministicExecutor,
  reviewGateway,
  reviewExecutorTest,
  reviewGatewayTest,
  reviewPlugin,
]);

export function analyzeOpenClawOc2SpecialistReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const escalation = escalationPaths(input.analysis);
  const eligible = repository === CANONICAL_REPOSITORY
    && input.prNumber === OC2_PR
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && escalation.length === OPENCLAW_OC2_SPECIALIST_PATHS_V1.length;
  if (!eligible) return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), proofRefs: Object.freeze([]) });

  const reviewedPaths = Object.freeze([...OPENCLAW_OC2_SPECIALIST_PATHS_V1]);
  const findings = [];
  if (!exactLineage(input.lineageEvidence, repository, sourceHead, baseSha)) {
    findings.push(finding('openclaw-oc2-exact-lineage-invalid', reviewedPaths[0]));
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const sourceByPath = new Map(sources.map((item) => [text(item?.path), item]));
  for (let index = 0; index < reviewedPaths.length; index += 1) {
    const path = reviewedPaths[index];
    const evidence = sourceByPath.get(path);
    if (!exactSource(evidence, repository, sourceHead, path)) {
      findings.push(finding('openclaw-oc2-source-evidence-invalid', path));
      continue;
    }
    REVIEWERS[index](evidence.content, path, findings);
  }

  const proofRefs = Object.freeze(reviewedPaths.map((path) => `proofs/openclaw-oc2-specialist/${path}`));
  return Object.freeze({
    schemaVersion: OPENCLAW_OC2_SPECIALIST_SCHEMA_V1,
    eligible: true,
    clean: findings.length === 0,
    findings: Object.freeze(findings),
    reviewedPaths,
    proofRefs,
    finalVerdict: findings.length === 0 ? 'OPENCLAW_OC2_SPECIALIST_CLEAN' : 'OPENCLAW_OC2_SPECIALIST_FINDINGS',
  });
}
