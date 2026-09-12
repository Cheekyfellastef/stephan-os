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
const CANONICAL_OC2_BRANCH = 'agent/openclaw-oc2-deterministic-test-build-v1';
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

function stripComments(source) {
  let out = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) {
      if (ch === '\n') { lineComment = false; out += '\n'; } else out += ' ';
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; out += '  '; i += 1; }
      else out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; out += '  '; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; out += '  '; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') quote = ch;
    out += ch;
  }
  return out;
}

function executableOnly(source) {
  const uncommented = stripComments(source);
  let out = '';
  let quote = '';
  let escaped = false;
  for (const ch of uncommented) {
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; out += ' '; continue; }
    out += ch;
  }
  return out;
}

function requireLiterals(findings, source, path, rules) {
  const uncommented = stripComments(source);
  for (const [literal, code] of rules) if (!uncommented.includes(literal)) findings.push(finding(code, path));
}

function requireExecutablePatterns(findings, source, path, rules) {
  const executable = executableOnly(source);
  for (const [pattern, code] of rules) if (!pattern.test(executable)) findings.push(finding(code, path));
}

function forbidExecutablePatterns(findings, source, path, rules) {
  const executable = executableOnly(source);
  for (const [pattern, code] of rules) if (pattern.test(executable)) findings.push(finding(code, path));
}

function countMatches(source, pattern) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

function activeTestHas(source, title, assertionPattern) {
  const uncommented = stripComments(source);
  if (/\b(?:test|it|describe)\.(?:skip|todo|only)\s*\(/.test(uncommented)) return false;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opener = new RegExp(`\\btest\\s*\\(\\s*(['\"])${escapedTitle}\\1\\s*,`);
  const match = opener.exec(uncommented);
  if (!match) return false;
  const rest = uncommented.slice(match.index + match[0].length);
  const nextTest = rest.search(/\btest\s*\(/);
  const body = nextTest >= 0 ? rest.slice(0, nextTest) : rest;
  if (/\bif\s*\(\s*false\s*\)/.test(executableOnly(body))) return false;
  return assertionPattern.test(executableOnly(body));
}

function reviewIndex(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['OPENCLAW_OC1_GATEWAY_METHOD', 'openclaw-oc2-index-oc1-method-import-missing'],
    ['OPENCLAW_OC2_GATEWAY_METHOD', 'openclaw-oc2-index-method-import-missing'],
    ['executeOpenClawOc2GatewayRequest', 'openclaw-oc2-index-executor-import-missing'],
    ["pluginId: 'stephanos-builder-provider'", 'openclaw-oc2-index-plugin-id-not-fixed'],
    ['providerInstance: `openclaw-gateway:${process.pid}`', 'openclaw-oc2-index-provider-instance-not-host-bound'],
    ["{ scope: 'operator.write' }", 'openclaw-oc2-index-gateway-scope-not-explicit'],
    ['Qualification is reserved for canonical Mission Worker claims executed by the OpenClaw Gateway plugin.', 'openclaw-oc2-index-manual-qualification-denial-missing'],
  ]);
  const code = executableOnly(source);
  if (countMatches(code, /\bapi\.registerGatewayMethod\s*\(/g) !== 2) {
    findings.push(finding('openclaw-oc2-index-gateway-registration-set-not-closed', path));
  }
  requireExecutablePatterns(findings, source, path, [
    [/api\.registerGatewayMethod\s*\(\s*OPENCLAW_OC1_GATEWAY_METHOD\s*,/, 'openclaw-oc2-index-oc1-registration-missing'],
    [/api\.registerGatewayMethod\s*\(\s*OPENCLAW_OC2_GATEWAY_METHOD\s*,/, 'openclaw-oc2-index-registration-binding-incomplete'],
    [/executeOpenClawOc2GatewayRequest\s*\(\s*params\s*,/, 'openclaw-oc2-index-executor-binding-incomplete'],
    [/gatewayContext\s*\(\s*OPENCLAW_OC2_GATEWAY_METHOD\s*\)/, 'openclaw-oc2-index-gateway-binding-missing'],
  ]);
  forbidExecutablePatterns(findings, source, path, [
    [/\b(?:exec|execSync|spawn|spawnSync|fork)\s*\(/, 'openclaw-oc2-index-dynamic-process-forbidden'],
    [/\bshell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-index-dynamic-code-forbidden'],
  ]);
}

function reviewDeterministicExecutor(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC2_TASK_CLASS = 'OC2_DETERMINISTIC_TEST_BUILD';", 'openclaw-oc2-task-class-not-fixed'],
    ["export const OPENCLAW_OC2_OPERATION = 'oc2-provider-regression-v1';", 'openclaw-oc2-operation-not-fixed'],
    ["export const OPENCLAW_OC2_PROVIDER = 'openclaw-standalone';", 'openclaw-oc2-provider-not-fixed'],
    ["export const OPENCLAW_OC2_PROVIDER_VERSION = '1.0.0';", 'openclaw-oc2-provider-version-not-fixed'],
    ['export const OPENCLAW_OC2_ISSUE = 1725;', 'openclaw-oc2-goal-not-fixed'],
    ["const REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc2-repository-not-fixed'],
    ["const BRANCH = 'main';", 'openclaw-oc2-branch-not-fixed'],
    ['const MAX_OUTPUT_BYTES = 1024 * 1024;', 'openclaw-oc2-output-bound-missing'],
    ["testId: 'OC2_PROVIDER_SOURCE_PARSE_V1'", 'openclaw-oc2-fixed-source-parse-plan-missing'],
    ["testId: 'OC2_PROVIDER_REGRESSION_V1'", 'openclaw-oc2-fixed-regression-plan-missing'],
    ['BATTLE_BRIDGE_WINDOWS_HOST.git', 'openclaw-oc2-git-executable-not-fixed'],
    ['BATTLE_BRIDGE_WINDOWS_HOST.node', 'openclaw-oc2-node-executable-not-fixed'],
    ['shell: false', 'openclaw-oc2-shell-denial-missing'],
    ['windowsHide: true', 'openclaw-oc2-windowless-execution-missing'],
    ['timeout = 120_000', 'openclaw-oc2-test-timeout-not-bounded'],
    ['15_000', 'openclaw-oc2-git-timeout-not-bounded'],
    ['sourceMutationPerformed: false', 'openclaw-oc2-source-mutation-denial-missing'],
    ['arbitraryShellAllowed: false', 'openclaw-oc2-arbitrary-shell-denial-missing'],
    ['arbitraryCommandAllowed: false', 'openclaw-oc2-arbitrary-command-denial-missing'],
    ['mergeAllowed: false', 'openclaw-oc2-result-merge-denial-missing'],
    ['deploymentAllowed: false', 'openclaw-oc2-result-deployment-denial-missing'],
    ['selfQualificationAllowed: false', 'openclaw-oc2-self-qualification-denial-missing'],
    ["workerType: 'openclaw'", 'openclaw-oc2-receipt-worker-type-not-fixed'],
    ["channel: 'openclaw-provider-qualification'", 'openclaw-oc2-proof-channel-not-fixed'],
  ]);
  requireExecutablePatterns(findings, source, path, [
    [/grant\?\.schemaVersion\s*!==/, 'openclaw-oc2-grant-schema-gate-missing'],
    [/grant\?\.boundedActionCount\s*!==\s*1/, 'openclaw-oc2-bounded-action-gate-missing'],
    [/grant\?\.mergeAuthority\s*!==\s*false/, 'openclaw-oc2-merge-authority-denial-missing'],
    [/grant\?\.leaseSeizureAllowed\s*!==\s*false/, 'openclaw-oc2-lease-denial-missing'],
    [/grant\?\.adapter[\s\S]*OPENCLAW_OC2_OPERATION/, 'openclaw-oc2-operation-gate-missing'],
    [/grant\?\.repository[\s\S]*REPOSITORY/, 'openclaw-oc2-repository-gate-missing'],
    [/FULL_SHA\.test\s*\(\s*text\s*\(\s*grant\?\.sourceRevision/, 'openclaw-oc2-source-head-gate-missing'],
    [/claim\?\.item\?\.schemaVersion\s*!==/, 'openclaw-oc2-claim-schema-gate-missing'],
    [/action\?\.schemaVersion\s*!==/, 'openclaw-oc2-action-schema-gate-missing'],
    [/claim\.item\.payload\s*!==\s*action/, 'openclaw-oc2-claim-payload-identity-gate-missing'],
    [/JSON\.stringify\s*\(\s*persisted\s*\)\s*!==\s*JSON\.stringify\s*\(\s*claim\.item\s*\)/, 'openclaw-oc2-persisted-claim-equality-gate-missing'],
    [/platform\s*!==/, 'openclaw-oc2-windows-runtime-gate-missing'],
    [/sourceHead\s*!==\s*task\.requestedSourceHead/, 'openclaw-oc2-pre-test-head-binding-missing'],
    [/finalHead\s*!==\s*sourceHead/, 'openclaw-oc2-post-test-head-binding-missing'],
    [/statusAfter\s*!==\s*statusBefore/, 'openclaw-oc2-post-test-state-binding-missing'],
    [/for\s*\(\s*const\s+plan\s+of\s+OPENCLAW_OC2_FIXED_PLAN\s*\)/, 'openclaw-oc2-fixed-plan-execution-binding-missing'],
    [/runFixed\s*\(\s*spawnSyncFn\s*,\s*BATTLE_BRIDGE_WINDOWS_HOST\.node\s*,/, 'openclaw-oc2-fixed-node-execution-binding-missing'],
  ]);
  const code = executableOnly(source);
  if (countMatches(code, /\bspawnSyncFn\s*\(/g) !== 1) findings.push(finding('openclaw-oc2-unbounded-process-authority-forbidden', path));
  forbidExecutablePatterns(findings, source, path, [
    [/\b(?:exec|execSync|execFile|fork|spawn|spawnSync)\s*\(/, 'openclaw-oc2-unbounded-process-authority-forbidden'],
    [/\bshell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-dynamic-code-forbidden'],
    [/\bgit(?:\.exe)?\b[^\r\n]*(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'openclaw-oc2-git-mutation-forbidden'],
    [/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|createWriteStream)\s*\(/, 'openclaw-oc2-filesystem-authority-forbidden'],
    [/\bfetch\s*\(|\b(?:http|https|net|tls|dgram)\s*\./, 'openclaw-oc2-network-authority-forbidden'],
  ]);
  if (/from\s+['"]node:(?:http|https|net|tls|dgram|dns)['"]/.test(stripComments(source))) findings.push(finding('openclaw-oc2-network-authority-forbidden', path));
}

function reviewGateway(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC2_GATEWAY_METHOD = 'stephanos-builder-provider.oc2Qualification';", 'openclaw-oc2-gateway-method-not-fixed'],
    ["export const OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc2-gateway-request.v1';", 'openclaw-oc2-gateway-request-schema-not-fixed'],
    ["export const OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc2-gateway-result.v1';", 'openclaw-oc2-gateway-result-schema-not-fixed'],
    ["const REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc2-gateway-repository-not-fixed'],
    ["const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);", 'openclaw-oc2-gateway-request-shape-not-closed'],
    ["executionSurface: 'openclaw-gateway-plugin'", 'openclaw-oc2-gateway-surface-not-fixed'],
  ]);
  requireExecutablePatterns(findings, source, path, [
    [/context\?\.executingInsideOpenClawGateway\s*===\s*true/, 'openclaw-oc2-gateway-runtime-marker-missing'],
    [/context\?\.pluginId\s*===/, 'openclaw-oc2-gateway-plugin-binding-missing'],
    [/context\?\.method\s*===\s*OPENCLAW_OC2_GATEWAY_METHOD/, 'openclaw-oc2-gateway-method-binding-missing'],
    [/GATEWAY_INSTANCE\.test\s*\(\s*providerInstance\s*\)/, 'openclaw-oc2-gateway-instance-binding-missing'],
    [/grant\?\.boundedActionCount\s*!==\s*1/, 'openclaw-oc2-gateway-bounded-action-gate-missing'],
    [/grant\?\.mergeAuthority\s*!==\s*false/, 'openclaw-oc2-gateway-merge-denial-missing'],
    [/grant\?\.leaseSeizureAllowed\s*!==\s*false/, 'openclaw-oc2-gateway-lease-denial-missing'],
    [/executeClaimedOpenClawOc2DeterministicTestBuild\s*\(/, 'openclaw-oc2-gateway-executor-binding-missing'],
    [/result\.success\s*===\s*true\s*&&\s*result\.qualificationEligible\s*===\s*true/, 'openclaw-oc2-gateway-result-not-bound'],
  ]);
  if (!/path\.resolve\s*\(\s*queueRoot\s*,\s*['"]openclaw-readonly['"]\s*,\s*['"]processing['"]\s*\)/.test(stripComments(source))) {
    findings.push(finding('openclaw-oc2-gateway-processing-root-not-fixed', path));
  }
  forbidExecutablePatterns(findings, source, path, [
    [/\b(?:exec|execSync|spawn|spawnSync|execFile|fork)\s*\(/, 'openclaw-oc2-gateway-process-authority-forbidden'],
    [/\bshell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-gateway-dynamic-code-forbidden'],
    [/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|createWriteStream|fetch)\s*\(/, 'openclaw-oc2-gateway-authority-widening-forbidden'],
  ]);
}

function reviewExecutorTest(source, path, findings) {
  const checks = [
    ['OC2 admits only the exact canonical claimed action and fixed operation', /assert\.equal\s*\(\s*valid\.task\.arbitraryCommandAuthority\s*,\s*false\s*\)/],
    ['OC2 executes only fixed node test IDs and proves source state unchanged', /assert\.deepEqual\s*\(\s*result\.changedFiles\s*,\s*\[\s*\]\s*\)/],
    ['OC2 fails closed if a fixed test changes repository source state', /assert\.equal\s*\(\s*result\.error\s*,/],
  ];
  for (const [title, assertion] of checks) if (!activeTestHas(source, title, assertion)) findings.push(finding('openclaw-oc2-test-active-regression-missing', path));
}

function reviewGatewayTest(source, path, findings) {
  const checks = [
    ['OC2 gateway rejects execution outside the actual OpenClaw Gateway plugin', /assert\.equal\s*\(\s*result\.success\s*,\s*false\s*\)/],
    ['OC2 gateway rejects caller-selected operation or extra request fields', /assert\.equal\s*\(\s*extra\.error\s*,/],
    ['OC2 gateway binds the persisted claimed item and executes the fixed plan', /assert\.equal\s*\(\s*result\.executionSurface\s*,/],
  ];
  for (const [title, assertion] of checks) if (!activeTestHas(source, title, assertion)) findings.push(finding('openclaw-oc2-gateway-test-active-regression-missing', path));
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
    && text(input.branch) === CANONICAL_OC2_BRANCH
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && escalation.length === OPENCLAW_OC2_SPECIALIST_PATHS_V1.length;
  if (!eligible) return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), proofRefs: Object.freeze([]) });

  const reviewedPaths = Object.freeze([...OPENCLAW_OC2_SPECIALIST_PATHS_V1]);
  const findings = [];
  if (!exactLineage(input.lineageEvidence, repository, sourceHead, baseSha)) findings.push(finding('openclaw-oc2-exact-lineage-invalid', reviewedPaths[0]));

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const sourceByPath = new Map(sources.map((item) => [text(item?.path), item]));
  if (sourceByPath.size !== reviewedPaths.length || sources.length !== reviewedPaths.length) findings.push(finding('openclaw-oc2-source-estate-not-closed', reviewedPaths[0]));
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