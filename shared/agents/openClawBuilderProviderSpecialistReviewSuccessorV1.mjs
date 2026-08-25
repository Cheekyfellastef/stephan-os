import { createHash } from 'node:crypto';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,255}$/;
const LEGACY_PROFILE_PRS = new Set([1910, 1905]);
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function safeSuccessorBranch(value) {
  const branch = text(value);
  return SAFE_BRANCH.test(branch)
    && !branch.startsWith('/')
    && !branch.endsWith('/')
    && !branch.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  ))) return [];
  const paths = unique(findings.map((item) => text(item?.path))).sort();
  const expected = [...OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1].sort();
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

function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}

const FORBIDDEN_LOCAL_MODULES = new Set([
  'child_process',
  'fs',
  'fs/promises',
  'module',
  'node:child_process',
  'node:fs',
  'node:fs/promises',
  'node:module',
]);
const ALLOWED_STATIC_MODULES = new Set([
  './executionReceiptV1.mjs',
  './missionControllerCapacityRouterV1.mjs',
  './sharedAgentWorkspaceStore.mjs',
  'node:crypto',
]);
const DANGEROUS_AUTHORITY_TOKENS = new Set([
  'AsyncFunction',
  'Bun',
  'Deno',
  'Function',
  'WebAssembly',
  '_linkedBinding',
  'binding',
  'constructor',
  'createRequire',
  'dlopen',
  'eval',
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'fork',
  'getBuiltinModule',
  'global',
  'globalThis',
  'module',
  'process',
  'require',
  'spawn',
  'spawnSync',
]);
const MAX_FOLDED_AUTHORITY_STRING_LENGTH = 128;
const MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH = 32;

function readJavaScriptString(source, start) {
  const quote = source[start];
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const current = source[index];
    if (current === quote) return { valid: true, end: index + 1, value };
    if (current === '\r' || current === '\n') return { valid: false, end: source.length, value: '' };
    if (current !== '\\') {
      value += current;
      index += 1;
      continue;
    }
    index += 1;
    if (index >= source.length) return { valid: false, end: source.length, value: '' };
    const escaped = source[index];
    if (escaped === '\r' || escaped === '\n') {
      if (escaped === '\r' && source[index + 1] === '\n') index += 1;
      index += 1;
      continue;
    }
    const simple = Object.freeze({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0', "'": "'", '"': '"', '\\': '\\' });
    if (Object.hasOwn(simple, escaped)) {
      value += simple[escaped];
      index += 1;
      continue;
    }
    if (escaped === 'x') {
      const hex = source.slice(index + 1, index + 3);
      if (!/^[a-f0-9]{2}$/i.test(hex)) return { valid: false, end: source.length, value: '' };
      value += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    if (escaped === 'u') {
      if (source[index + 1] === '{') {
        const close = source.indexOf('}', index + 2);
        const hex = close < 0 ? '' : source.slice(index + 2, close);
        const point = /^[a-f0-9]{1,6}$/i.test(hex) ? Number.parseInt(hex, 16) : -1;
        if (point < 0 || point > 0x10ffff) return { valid: false, end: source.length, value: '' };
        value += String.fromCodePoint(point);
        index = close + 1;
        continue;
      }
      const hex = source.slice(index + 1, index + 5);
      if (!/^[a-f0-9]{4}$/i.test(hex)) return { valid: false, end: source.length, value: '' };
      value += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    return { valid: false, end: source.length, value: '' };
  }
  return { valid: false, end: source.length, value: '' };
}

function readJavaScriptRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const current = source[index];
    if (current === '\r' || current === '\n') return { valid: false, end: source.length };
    if (current === '\\') {
      index += 2;
      continue;
    }
    if (current === '[') inClass = true;
    else if (current === ']') inClass = false;
    else if (current === '/' && !inClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] || '')) index += 1;
      return { valid: true, end: index };
    }
    index += 1;
  }
  return { valid: false, end: source.length };
}

function canStartJavaScriptRegex(tokens) {
  const previous = tokens.at(-1);
  if (!previous) return true;
  if (previous.type === 'identifier') {
    return new Set(['await', 'case', 'delete', 'in', 'instanceof', 'of', 'return', 'throw', 'typeof', 'void', 'yield']).has(previous.value);
  }
  if (previous.type === 'number' || previous.type === 'string' || previous.type === 'regex') return false;
  return !new Set([')', ']', '}']).has(previous.value);
}

function tokenizeJavaScriptAuthority(source) {
  const tokens = [];
  const contexts = [{ kind: 'code', templateExpression: false, braceDepth: 0 }];
  let index = 0;
  while (index < source.length) {
    const context = contexts.at(-1);
    const current = source[index];
    const next = source[index + 1];
    if (context.kind === 'template') {
      if (current === '\\') {
        index += 2;
      } else if (current === '`') {
        contexts.pop();
        index += 1;
      } else if (current === '$' && next === '{') {
        contexts.push({ kind: 'code', templateExpression: true, braceDepth: 1 });
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\r' && source[index] !== '\n') index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) return { valid: false, tokens: Object.freeze(tokens) };
      index = close + 2;
      continue;
    }
    if (current === '/' && canStartJavaScriptRegex(tokens)) {
      const regexToken = readJavaScriptRegex(source, index);
      if (!regexToken.valid) return { valid: false, tokens: Object.freeze(tokens) };
      tokens.push(Object.freeze({ type: 'regex', value: '' }));
      index = regexToken.end;
      continue;
    }
    if (current === "'" || current === '"') {
      const stringToken = readJavaScriptString(source, index);
      if (!stringToken.valid) return { valid: false, tokens: Object.freeze(tokens) };
      tokens.push(Object.freeze({ type: 'string', value: stringToken.value }));
      index = stringToken.end;
      continue;
    }
    if (current === '`') {
      contexts.push({ kind: 'template' });
      index += 1;
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0] || '';
    if (identifier) {
      tokens.push(Object.freeze({ type: 'identifier', value: identifier }));
      index += identifier.length;
      continue;
    }
    const number = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0] || '';
    if (number) {
      tokens.push(Object.freeze({ type: 'number', value: number }));
      index += number.length;
      continue;
    }
    if (current === '\\') return { valid: false, tokens: Object.freeze(tokens) };
    if (context.templateExpression && current === '{') context.braceDepth += 1;
    if (context.templateExpression && current === '}') {
      context.braceDepth -= 1;
      index += 1;
      if (context.braceDepth === 0) contexts.pop();
      else tokens.push(Object.freeze({ type: 'punctuator', value: current }));
      continue;
    }
    tokens.push(Object.freeze({ type: 'punctuator', value: current }));
    index += 1;
  }
  return { valid: contexts.length === 1, tokens: Object.freeze(tokens) };
}

function foldConstantStringExpression(tokens, start, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH) return null;
  const first = tokens[start];
  let value = '';
  let cursor = start;
  if (first?.type === 'string') {
    value = first.value;
    cursor += 1;
  } else if (first?.type === 'punctuator' && first.value === '(') {
    const nested = foldConstantStringExpression(tokens, start + 1, depth + 1);
    if (!nested || tokens[nested.end]?.type !== 'punctuator' || tokens[nested.end].value !== ')') return null;
    value = nested.value;
    cursor = nested.end + 1;
  } else {
    return null;
  }
  if (value.length > MAX_FOLDED_AUTHORITY_STRING_LENGTH) return null;

  while (tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === '+') {
    const right = foldConstantStringExpression(tokens, cursor + 1, depth + 1);
    if (!right) break;
    value += right.value;
    if (value.length > MAX_FOLDED_AUTHORITY_STRING_LENGTH) return null;
    cursor = right.end;
  }
  return Object.freeze({ value, end: cursor });
}

function constantAuthorityStrings(tokens) {
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== 'string' && tokens[index]?.value !== '(') continue;
    const folded = foldConstantStringExpression(tokens, index);
    if (folded) values.push(folded.value);
  }
  return Object.freeze(values);
}

function reviewLocalModuleAuthority(source, path, findings) {
  const lexical = tokenizeJavaScriptAuthority(source);
  if (!lexical.valid) {
    findings.push(finding('openclaw-provider-pool-javascript-lexical-invalid', path));
    return;
  }
  const authorityStrings = constantAuthorityStrings(lexical.tokens);
  const forbiddenModule = authorityStrings.some((value) => FORBIDDEN_LOCAL_MODULES.has(value));
  const dangerousToken = lexical.tokens.some((token) => (
    token.type === 'identifier'
    && DANGEROUS_AUTHORITY_TOKENS.has(token.value)
  )) || authorityStrings.some((value) => DANGEROUS_AUTHORITY_TOKENS.has(value));
  const staticModules = [];
  let invalidImport = false;
  let dynamicLoader = false;
  for (let tokenIndex = 0; tokenIndex < lexical.tokens.length; tokenIndex += 1) {
    const token = lexical.tokens[tokenIndex];
    if (token.type !== 'identifier' || token.value !== 'import') continue;
    const nextToken = lexical.tokens[tokenIndex + 1];
    if (nextToken?.type === 'punctuator' && nextToken.value === '(') {
      dynamicLoader = true;
      continue;
    }
    if (nextToken?.type === 'string') {
      staticModules.push(nextToken.value);
      continue;
    }
    let foundFrom = false;
    for (let cursor = tokenIndex + 1; cursor < lexical.tokens.length; cursor += 1) {
      const candidate = lexical.tokens[cursor];
      if (candidate?.type === 'punctuator' && candidate.value === ';') break;
      if (candidate?.type === 'identifier' && candidate.value === 'from') {
        foundFrom = true;
        const specifier = lexical.tokens[cursor + 1];
        if (specifier?.type === 'string') staticModules.push(specifier.value);
        else invalidImport = true;
        break;
      }
    }
    if (!foundFrom) invalidImport = true;
  }
  const unapprovedStaticModule = staticModules.some((specifier) => !ALLOWED_STATIC_MODULES.has(specifier));
  if (forbiddenModule || dangerousToken || dynamicLoader || invalidImport || unapprovedStaticModule) {
    findings.push(finding('openclaw-provider-pool-local-execution-authority-forbidden', path));
  }
}

function reviewProviderPool(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';", 'openclaw-provider-pool-canonical-router-missing'],
    ['validateExecutionReceipt', 'openclaw-provider-pool-execution-validator-missing'],
    ['toSharedWorkspaceExecutionReceipt', 'openclaw-provider-pool-workspace-projection-missing'],
    ['validateSharedWorkspaceRecord', 'openclaw-provider-pool-workspace-validator-missing'],
    ['const OPENCLAW_QUALIFICATION_ISSUE = 1725;', 'openclaw-provider-pool-goal-not-fixed'],
    ['export function validateOpenClawQualificationAuthorityChain', 'openclaw-provider-pool-authority-chain-gate-missing'],
    ['issueNumber: OPENCLAW_QUALIFICATION_ISSUE', 'openclaw-provider-pool-execution-goal-binding-missing'],
    ["execution.workerType !== 'openclaw'", 'openclaw-provider-pool-worker-type-binding-missing'],
    ["execution.state !== 'completed'", 'openclaw-provider-pool-completed-execution-gate-missing'],
    ['execution.operatorActionRequired !== false', 'openclaw-provider-pool-operator-action-gate-missing'],
    ['canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)', 'openclaw-provider-pool-canonical-workspace-gate-missing'],
    ["authority.participantId !== 'stephanos'", 'openclaw-provider-pool-stephanos-authority-gate-missing'],
    ['authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)', 'openclaw-provider-pool-authority-goal-binding-missing'],
    ['authority.receivedRecordId !== execution.receiptId', 'openclaw-provider-pool-authority-execution-binding-missing'],
    ['authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION', 'openclaw-provider-pool-production-disposition-gate-missing'],
    ['candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId', 'openclaw-provider-pool-capacity-authority-binding-missing'],
    ['const host = snapshot(trustedHostContext);', 'openclaw-provider-pool-trusted-host-only-gate-missing'],
    ['const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;', 'openclaw-provider-pool-complete-chain-gate-missing'],
    ['mergeAuthority: false', 'openclaw-provider-pool-merge-denial-missing'],
    ['leaseSeizureAllowed: false', 'openclaw-provider-pool-lease-denial-missing'],
    ['duplicateDispatchAllowed: false', 'openclaw-provider-pool-duplicate-dispatch-denial-missing'],
  ]);
  reviewLocalModuleAuthority(source, path, findings);
  forbidPatterns(findings, source, path, [
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-provider-pool-dynamic-execution-forbidden'],
  ]);
}

function reviewProviderPoolTests(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', 'openclaw-provider-pool-authority-chain-positive-test-missing'],
    ['capacity is unusable without the exact validated qualification authority, worker and task class', 'openclaw-provider-pool-capacity-binding-test-missing'],
    ['caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw', 'openclaw-provider-pool-caller-forgery-test-missing'],
    ['syntactically valid trusted qualification without canonical authority cannot route', 'openclaw-provider-pool-syntax-only-forgery-test-missing'],
    ['existing mutation owner is preserved even when OpenClaw is canonically qualified', 'openclaw-provider-pool-owner-preservation-test-missing'],
    ['normal AUTO routing does not silently replace a healthy existing provider policy', 'openclaw-provider-pool-no-silent-route-replacement-test-missing'],
    ['assert.equal(result.mergeAuthority, false)', 'openclaw-provider-pool-merge-denial-test-missing'],
    ['assert.equal(result.leaseSeizureAllowed, false)', 'openclaw-provider-pool-lease-denial-test-missing'],
    ['assert.equal(result.duplicateDispatchAllowed, false)', 'openclaw-provider-pool-duplicate-dispatch-test-missing'],
  ]);
}

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = repository === CANONICAL_REPOSITORY
    && Number.isSafeInteger(prNumber)
    && prNumber > 0
    && !LEGACY_PROFILE_PRS.has(prNumber)
    && safeSuccessorBranch(branch)
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && paths.length === OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length;

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_NOT_APPLICABLE',
  });

  if (!exactLineage(input.lineageEvidence, repository, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze([finding('openclaw-provider-pool-reconciliation-lineage-invalid', paths[0])]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('openclaw-provider-pool-source-evidence-invalid', path));
      continue;
    }
    if (path.endsWith('/openClawProviderPoolQualificationV1.mjs')) {
      reviewProviderPool(candidates[0].content, path, findings);
    } else {
      reviewProviderPoolTests(candidates[0].content, path, findings);
    }
    proofRefs.push(`proofs/openclaw-builder-provider-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  if (sources.length !== OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length) {
    findings.push(finding('openclaw-provider-pool-source-evidence-estate-mismatch', OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1[0]));
  }

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: findings.length === 0,
    reviewedPaths: Object.freeze([...OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: findings.length === 0
      ? 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN'
      : 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
  });
}
