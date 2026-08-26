import { createHash } from 'node:crypto';

import { independentReviewFindingsArtifactPayloadSha256 } from './operatorMergeReviewArtifactV1.mjs';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
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
    && parents.length >= 1
    && parents.length <= 2
    && parents.every((parent) => SHA.test(text(parent)) && text(parent) !== sourceHead)
    && unique(parents).length === parents.length
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage?.comparison?.behindBy === 0
    && lineage?.comparison?.baseCommitSha === baseSha
    && lineage?.comparison?.mergeBaseCommitSha === baseSha;
}

function exactFindingsArtifactIdentity(artifact, analysis, repository, prNumber, branch, sourceHead, baseSha) {
  return artifact?.schemaVersion === 'stephanos.independent-review-findings-artifact.v1'
    && artifact?.kind === 'stephanos.independent-review.findings-artifact'
    && artifact?.artifactFile === 'independent-review-result.json'
    && artifact?.repository === repository
    && artifact?.prNumber === prNumber
    && artifact?.branch === branch
    && artifact?.sourceHead === sourceHead
    && artifact?.baseSha === baseSha
    && artifact?.analysis === analysis
    && SHA256.test(text(artifact?.payloadSha256))
    && artifact.payloadSha256 === independentReviewFindingsArtifactPayloadSha256(artifact);
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
const IMPLEMENTATION_IMPORT_POLICY = Object.freeze({
  './executionReceiptV1.mjs': new Set([
    'toSharedWorkspaceExecutionReceipt',
    'validateExecutionReceipt',
  ]),
  './missionControllerCapacityRouterV1.mjs': new Set([
    'MISSION_CONTROLLER_ROUTE',
    'routeMissionControllerCapacity',
  ]),
  './sharedAgentWorkspaceStore.mjs': new Set([
    'SHARED_WORKSPACE_RECORD_KINDS',
    'SHARED_WORKSPACE_RECORD_SCHEMA_VERSION',
    'createSharedWorkspaceReceiptRecord',
    'createSharedWorkspaceStatusRecord',
    'validateSharedWorkspaceRecord',
  ]),
  'node:crypto': new Set([
    'createHash',
    'createPublicKey',
    'sign',
    'verify',
  ]),
});
const TEST_IMPORT_POLICY = Object.freeze({
  './executionReceiptV1.mjs': new Set([
    'createExecutionReceipt',
    'toSharedWorkspaceExecutionReceipt',
  ]),
  './openClawProviderPoolQualificationV1.mjs': new Set([
    'OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION',
    'OPENCLAW_PROVIDER_CAPACITY_SCHEMA',
    'OPENCLAW_PROVIDER_POOL_COMPONENT_FILES',
    'OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA',
    'OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA',
    'OPENCLAW_PROVIDER_ROUTE',
    'prepareOpenClawProviderPoolPublication',
    'routeWithQualifiedOpenClawProvider',
    'validateOpenClawProviderCapacity',
    'validateOpenClawProviderPoolStatusRecord',
    'validateOpenClawProviderQualification',
    'validateOpenClawQualificationAuthorityChain',
  ]),
  './sharedAgentWorkspaceStore.mjs': new Set([
    'createSharedWorkspaceReceiptRecord',
  ]),
  'node:assert/strict': new Set(['default']),
  'node:crypto': new Set(['generateKeyPairSync']),
  'node:test': new Set(['default']),
});
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
const JAVASCRIPT_MULTI_PUNCTUATORS = Object.freeze([
  '>>>=', '===', '!==', '>>>', '**=', '&&=', '||=', '??=', '...', '=>', '++', '--',
  '**', '&&', '||', '??', '==', '!=', '<=', '>=', '<<', '>>', '+=', '-=', '*=',
  '/=', '%=', '&=', '|=', '^=', '?.',
]);
const REGEX_DISALLOWED_AFTER_PUNCTUATORS = new Set([')', ']', '}', '++', '--']);
const FORBIDDEN_GLOBAL_CAPABILITIES = new Set(['EventSource', 'WebSocket', 'fetch']);
const CALLBACK_PREFIX_CONTROL_FLOW = new Set([
  'break',
  'continue',
  'do',
  'for',
  'if',
  'return',
  'switch',
  'throw',
  'try',
  'while',
  'with',
]);
const REFLECTIVE_PROPERTY_KEY_METHODS = new Set([
  'defineProperty',
  'deleteProperty',
  'get',
  'getOwnPropertyDescriptor',
  'has',
  'set',
]);

function isJavaScriptLineTerminator(value) {
  return value === '\r' || value === '\n' || value === '\u2028' || value === '\u2029';
}

function readJavaScriptEscapeSequence(source, start) {
  let index = start + 1;
  if (index >= source.length) return { valid: false, end: source.length, value: '' };
  const escaped = source[index];
  if (isJavaScriptLineTerminator(escaped)) {
    if (escaped === '\r' && source[index + 1] === '\n') index += 1;
    return { valid: true, end: index + 1, value: '' };
  }
  const simple = Object.freeze({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0', "'": "'", '"': '"', '\\': '\\', '`': '`', '$': '$' });
  if (Object.hasOwn(simple, escaped)) return { valid: true, end: index + 1, value: simple[escaped] };
  if (escaped === 'x') {
    const hex = source.slice(index + 1, index + 3);
    if (!/^[a-f0-9]{2}$/i.test(hex)) return { valid: false, end: source.length, value: '' };
    return { valid: true, end: index + 3, value: String.fromCodePoint(Number.parseInt(hex, 16)) };
  }
  if (escaped === 'u') {
    if (source[index + 1] === '{') {
      const close = source.indexOf('}', index + 2);
      const hex = close < 0 ? '' : source.slice(index + 2, close);
      const point = /^[a-f0-9]{1,6}$/i.test(hex) ? Number.parseInt(hex, 16) : -1;
      if (point < 0 || point > 0x10ffff) return { valid: false, end: source.length, value: '' };
      return { valid: true, end: close + 1, value: String.fromCodePoint(point) };
    }
    const hex = source.slice(index + 1, index + 5);
    if (!/^[a-f0-9]{4}$/i.test(hex)) return { valid: false, end: source.length, value: '' };
    return { valid: true, end: index + 5, value: String.fromCodePoint(Number.parseInt(hex, 16)) };
  }
  return { valid: false, end: source.length, value: '' };
}

function readJavaScriptString(source, start) {
  const quote = source[start];
  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const current = source[index];
    if (current === quote) return { valid: true, end: index + 1, value };
    if (isJavaScriptLineTerminator(current)) return { valid: false, end: source.length, value: '' };
    if (current !== '\\') {
      value += current;
      index += 1;
      continue;
    }
    const escape = readJavaScriptEscapeSequence(source, index);
    if (!escape.valid) return { valid: false, end: source.length, value: '' };
    value += escape.value;
    index = escape.end;
  }
  return { valid: false, end: source.length, value: '' };
}

function readJavaScriptRegex(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const current = source[index];
    if (isJavaScriptLineTerminator(current)) return { valid: false, end: source.length };
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
  if (previous.type === 'number' || previous.type === 'string' || previous.type === 'template' || previous.type === 'regex') return false;
  return !REGEX_DISALLOWED_AFTER_PUNCTUATORS.has(previous.value);
}

function tokenizeJavaScriptAuthority(source) {
  const tokens = [];
  const contexts = [{ kind: 'code', templateExpression: false, braceDepth: 0, localTokens: [] }];
  let lineTerminatorBeforeNextToken = false;
  const pushToken = (token) => {
    const frozen = Object.freeze({
      ...token,
      lineTerminatorBefore: token.lineTerminatorBefore ?? lineTerminatorBeforeNextToken,
    });
    lineTerminatorBeforeNextToken = false;
    tokens.push(frozen);
    const codeContext = contexts.at(-1);
    if (codeContext?.kind === 'code') codeContext.localTokens.push(frozen);
  };
  let index = 0;
  while (index < source.length) {
    const context = contexts.at(-1);
    const current = source[index];
    const next = source[index + 1];
    if (context.kind === 'template') {
      if (current === '\\') {
        const escape = readJavaScriptEscapeSequence(source, index);
        if (!escape.valid) return { valid: false, tokens: Object.freeze(tokens) };
        context.currentChunk += escape.value;
        index = escape.end;
      } else if (current === '`') {
        context.chunks.push(context.currentChunk);
        contexts.pop();
        index += 1;
        const collapsed = context.chunks.join('');
        let constantValue = '';
        for (let part = 0; part < context.chunks.length; part += 1) {
          constantValue += context.chunks[part];
          if (part < context.expressionValues.length) {
            if (context.expressionValues[part] === null) {
              constantValue = null;
              break;
            }
            constantValue += context.expressionValues[part];
          }
        }
        const bounded = (value) => typeof value === 'string' && value.length <= MAX_FOLDED_AUTHORITY_STRING_LENGTH;
        const authorityValues = unique([
          ...context.chunks.filter(bounded),
          bounded(collapsed) ? collapsed : '',
          bounded(constantValue) ? constantValue : '',
        ].filter(Boolean));
        const authorityPatternParts = [];
        for (let part = 0; part < context.chunks.length; part += 1) {
          if (context.chunks[part]) authorityPatternParts.push(Object.freeze({ kind: 'fixed', value: context.chunks[part] }));
          if (part < context.expressionValues.length) {
            const expressionValue = context.expressionValues[part];
            authorityPatternParts.push(Object.freeze(expressionValue === null
              ? { kind: 'unknown' }
              : { kind: 'fixed', value: expressionValue }));
          }
        }
        pushToken({
          type: 'template',
          value: constantValue || '',
          constant: constantValue !== null,
          authorityValues: Object.freeze(authorityValues),
          authorityPatternParts: Object.freeze(authorityPatternParts),
          expressionTokenCount: context.expressionTokenCounts.reduce((sum, count) => sum + count, 0),
          lineTerminatorBefore: context.lineTerminatorBefore,
        });
      } else if (current === '$' && next === '{') {
        context.chunks.push(context.currentChunk);
        context.currentChunk = '';
        contexts.push({ kind: 'code', templateExpression: true, braceDepth: 1, localTokens: [] });
        index += 2;
      } else {
        context.currentChunk += current;
        index += 1;
      }
      continue;
    }
    if (/\s/.test(current)) {
      if (isJavaScriptLineTerminator(current)) lineTerminatorBeforeNextToken = true;
      index += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      index += 2;
      while (index < source.length && !isJavaScriptLineTerminator(source[index])) index += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) return { valid: false, tokens: Object.freeze(tokens) };
      if (/[\r\n\u2028\u2029]/u.test(source.slice(index, close + 2))) lineTerminatorBeforeNextToken = true;
      index = close + 2;
      continue;
    }
    if (current === '/' && canStartJavaScriptRegex(context.localTokens)) {
      const regexToken = readJavaScriptRegex(source, index);
      if (!regexToken.valid) return { valid: false, tokens: Object.freeze(tokens) };
      pushToken({ type: 'regex', value: '' });
      index = regexToken.end;
      continue;
    }
    if (current === "'" || current === '"') {
      const stringToken = readJavaScriptString(source, index);
      if (!stringToken.valid) return { valid: false, tokens: Object.freeze(tokens) };
      pushToken({ type: 'string', value: stringToken.value });
      index = stringToken.end;
      continue;
    }
    if (current === '`') {
      contexts.push({
        kind: 'template',
        chunks: [],
        currentChunk: '',
        expressionValues: [],
        expressionTokenCounts: [],
        lineTerminatorBefore: lineTerminatorBeforeNextToken,
      });
      lineTerminatorBeforeNextToken = false;
      index += 1;
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0] || '';
    if (identifier) {
      pushToken({ type: 'identifier', value: identifier });
      index += identifier.length;
      continue;
    }
    const number = source.slice(index).match(/^(?:0[xX][0-9a-fA-F](?:_?[0-9a-fA-F])*n?|0[bB][01](?:_?[01])*n?|0[oO][0-7](?:_?[0-7])*n?|\d(?:_?\d)*n|(?:(?:\d(?:_?\d)*)\.(?:\d(?:_?\d)*)?|\.(?:\d(?:_?\d)*)|\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?)/)?.[0] || '';
    if (number) {
      pushToken({ type: 'number', value: number });
      index += number.length;
      continue;
    }
    if (current === '\\') return { valid: false, tokens: Object.freeze(tokens) };
    if (context.templateExpression && current === '{') context.braceDepth += 1;
    if (context.templateExpression && current === '}') {
      context.braceDepth -= 1;
      index += 1;
      if (context.braceDepth === 0) {
        const folded = foldConstantStringExpression(context.localTokens, 0);
        const constantValue = folded && folded.end === context.localTokens.length ? folded.value : null;
        contexts.pop();
        contexts.at(-1).expressionValues.push(constantValue);
        contexts.at(-1).expressionTokenCounts.push(context.localTokens.length);
      } else pushToken({ type: 'punctuator', value: current });
      continue;
    }
    const multiPunctuator = JAVASCRIPT_MULTI_PUNCTUATORS.find((candidate) => source.startsWith(candidate, index));
    pushToken({ type: 'punctuator', value: multiPunctuator || current });
    index += (multiPunctuator || current).length;
  }
  return { valid: contexts.length === 1, tokens: Object.freeze(tokens) };
}

function foldConstantStringExpression(tokens, start, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH) return null;
  const first = tokens[start];
  let value = '';
  let cursor = start;
  if (first?.type === 'string' || (first?.type === 'template' && first.constant === true)) {
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

function canEndMemberReceiver(token) {
  return token?.type === 'identifier'
    || token?.type === 'number'
    || token?.type === 'string'
    || token?.type === 'template'
    || (token?.type === 'punctuator' && new Set([')', ']', '}']).has(token.value));
}

function matchingPunctuator(tokens, start, openValue, closeValue) {
  if (tokens[start]?.type !== 'punctuator' || tokens[start].value !== openValue) return -1;
  let depth = 0;
  for (let index = start; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== 'punctuator') continue;
    if (tokens[index].value === openValue) depth += 1;
    if (tokens[index].value === closeValue) depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function isComputedMemberAccess(tokens, openIndex) {
  const previous = tokens[openIndex - 1];
  if (previous?.type === 'punctuator' && previous.value === '?.') {
    return canEndMemberReceiver(tokens[openIndex - 2]);
  }
  return canEndMemberReceiver(previous);
}

function isComputedPropertyAccess(tokens, closeIndex) {
  return tokens[closeIndex + 1]?.type === 'punctuator'
    && tokens[closeIndex + 1].value === ':';
}

function callArgumentRange(tokens, openIndex, requestedIndex) {
  let argumentIndex = 0;
  let start = openIndex + 1;
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type === 'punctuator') {
      if (token.value === '(') depth.round += 1;
      else if (token.value === ')' && depth.round > 0) depth.round -= 1;
      else if (token.value === '[') depth.square += 1;
      else if (token.value === ']') depth.square -= 1;
      else if (token.value === '{') depth.curly += 1;
      else if (token.value === '}') depth.curly -= 1;
      const atArgumentBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
      if (atArgumentBoundary && (token.value === ',' || token.value === ')')) {
        if (argumentIndex === requestedIndex) {
          return index === start ? null : Object.freeze({ start, end: index });
        }
        if (token.value === ')') return null;
        argumentIndex += 1;
        start = index + 1;
      }
    }
  }
  return null;
}

function arrayElementRange(tokens, expressionRange, requestedIndex) {
  return arrayLiteralElementRanges(tokens, expressionRange)[requestedIndex] ?? null;
}

function callOpenAfterCallee(tokens, calleeStart, calleeEnd) {
  const bounds = transparentCalleeBounds(tokens, calleeStart, calleeEnd);
  const { end } = bounds;
  if (tokens[end + 1]?.type === 'punctuator' && tokens[end + 1].value === '(') return end + 1;
  if (tokens[end + 1]?.type === 'punctuator'
    && tokens[end + 1].value === '?.'
    && tokens[end + 2]?.type === 'punctuator'
    && tokens[end + 2].value === '(') return end + 2;
  return -1;
}

function transparentCalleeBounds(tokens, calleeStart, calleeEnd) {
  let start = calleeStart;
  let end = calleeEnd;
  while (tokens[start - 1]?.type === 'punctuator'
    && tokens[start - 1].value === '('
    && matchingPunctuator(tokens, start - 1, '(', ')') === end + 1) {
    start -= 1;
    end += 1;
  }
  return Object.freeze({ start, end });
}

function reflectiveMethodReferenceEnd(tokens, start, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH) return -1;
  if (tokens[start]?.type === 'punctuator' && tokens[start].value === '(') {
    const close = matchingPunctuator(tokens, start, '(', ')');
    if (close <= start + 1) return -1;
    const innerEnd = reflectiveMethodReferenceEnd(tokens, start + 1, depth + 1);
    return innerEnd === close - 1 ? close : -1;
  }
  const receiver = tokens[start];
  const access = tokens[start + 1];
  if (receiver?.type !== 'identifier' || !new Set(['Object', 'Reflect']).has(receiver.value)) return -1;
  if (access?.type === 'punctuator' && new Set(['.', '?.']).has(access.value)) {
    const method = tokens[start + 2];
    return method?.type === 'identifier' && REFLECTIVE_PROPERTY_KEY_METHODS.has(method.value)
      ? start + 2
      : -1;
  }
  if (access?.type !== 'punctuator' || access.value !== '[') return -1;
  const methodClose = matchingPunctuator(tokens, start + 1, '[', ']');
  if (methodClose <= start + 1) return -1;
  const methodPattern = parseComputedAuthorityPattern(tokens, start + 2, methodClose);
  const couldSelectReflectiveMethod = !methodPattern
    || [...REFLECTIVE_PROPERTY_KEY_METHODS].some((method) => authorityPatternCanResolve(methodPattern, method));
  return couldSelectReflectiveMethod ? methodClose : -1;
}

function callArgumentRanges(tokens, openIndex) {
  const ranges = [];
  for (let index = 0; index < 32; index += 1) {
    const range = callArgumentRange(tokens, openIndex, index);
    if (!range) break;
    ranges.push(range);
  }
  return Object.freeze(ranges);
}

function reflectiveBindDescriptor(tokens, calleeStart, calleeEnd, propertyIndex) {
  const bounds = transparentCalleeBounds(tokens, calleeStart, calleeEnd);
  const access = tokens[bounds.end + 1];
  const method = tokens[bounds.end + 2];
  if (access?.type !== 'punctuator'
    || !new Set(['.', '?.']).has(access.value)
    || method?.type !== 'identifier'
    || method.value !== 'bind') return null;
  const bindOpen = callOpenAfterCallee(tokens, bounds.start, bounds.end + 2);
  const bindClose = matchingPunctuator(tokens, bindOpen, '(', ')');
  if (bindOpen < 0 || bindClose < 0) return null;
  const arguments_ = callArgumentRanges(tokens, bindOpen);
  const uncertain = arguments_.some(({ start, end }) => tokens.slice(start, end).some((token) => (
    token?.type === 'punctuator' && token.value === '...'
  )));
  if (uncertain) {
    return Object.freeze({
      end: bindClose,
      propertyIndex: null,
      boundPropertyRange: Object.freeze({ start: bindOpen + 1, end: bindClose }),
    });
  }
  const boundOriginalArgumentCount = Math.max(0, arguments_.length - 1);
  if (boundOriginalArgumentCount > propertyIndex) {
    return Object.freeze({
      end: bindClose,
      propertyIndex: null,
      boundPropertyRange: arguments_[propertyIndex + 1],
    });
  }
  return Object.freeze({
    end: bindClose,
    propertyIndex: propertyIndex - boundOriginalArgumentCount,
    boundPropertyRange: null,
  });
}

function assignmentExpressionEnd(tokens, start) {
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    const atBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
    if (atBoundary && new Set([')', ',', ';']).has(token.value)) return index;
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']') depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}') depth.curly -= 1;
    if (depth.round < 0 || depth.square < 0 || depth.curly < 0) return -1;
  }
  return -1;
}

function topLevelComma(tokens, start, end) {
  const depth = { round: 0, square: 0, curly: 0 };
  let last = -1;
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']') depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}') depth.curly -= 1;
    else if (token.value === ',' && depth.round === 0 && depth.square === 0 && depth.curly === 0) last = index;
  }
  return last;
}

function reflectiveExpressionDescriptors(tokens, start, end, aliases, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH || start >= end) return Object.freeze([]);
  while (tokens[start]?.type === 'punctuator'
    && tokens[start].value === '('
    && matchingPunctuator(tokens, start, '(', ')') === end - 1) {
    start += 1;
    end -= 1;
  }
  const comma = topLevelComma(tokens, start, end);
  if (comma >= start) return reflectiveExpressionDescriptors(tokens, comma + 1, end, aliases, depth + 1);

  const referenceEnd = reflectiveMethodReferenceEnd(tokens, start);
  if (referenceEnd >= 0) {
    const bound = reflectiveBindDescriptor(tokens, start, referenceEnd, 1);
    const descriptor = bound ?? Object.freeze({ end: referenceEnd, propertyIndex: 1, boundPropertyRange: null });
    if (descriptor.end === end - 1) return Object.freeze([descriptor]);
  }
  if (end === start + 1 && tokens[start]?.type === 'identifier') {
    return aliases.get(tokens[start].value) ?? Object.freeze([]);
  }
  const possible = [];
  for (let cursor = start; cursor < end; cursor += 1) {
    const nestedReferenceEnd = reflectiveMethodReferenceEnd(tokens, cursor);
    if (nestedReferenceEnd >= 0 && nestedReferenceEnd < end) {
      const bound = reflectiveBindDescriptor(tokens, cursor, nestedReferenceEnd, 1);
      const descriptor = bound ?? Object.freeze({
        end: nestedReferenceEnd,
        propertyIndex: 1,
        boundPropertyRange: null,
      });
      const invocationOpen = callOpenAfterCallee(tokens, cursor, descriptor.end);
      const bounds = transparentCalleeBounds(tokens, cursor, nestedReferenceEnd);
      const borrowMethod = tokens[bounds.end + 2];
      const borrowedInvocation = tokens[bounds.end + 1]?.type === 'punctuator'
        && new Set(['.', '?.']).has(tokens[bounds.end + 1].value)
        && borrowMethod?.type === 'identifier'
        && new Set(['apply', 'call']).has(borrowMethod.value)
        && callOpenAfterCallee(tokens, bounds.start, bounds.end + 2) >= 0;
      if (invocationOpen < 0 && !borrowedInvocation) possible.push(descriptor);
      cursor = Math.max(cursor, descriptor.end);
      continue;
    }
    const nestedAlias = tokens[cursor];
    if (nestedAlias?.type === 'identifier' && aliases.has(nestedAlias.value)) {
      possible.push(...aliases.get(nestedAlias.value));
    }
  }
  if (possible.length > 0) return Object.freeze(possible);
  return Object.freeze([]);
}

function stripTransparentRange(tokens, start, end) {
  while (tokens[start]?.type === 'punctuator'
    && tokens[start].value === '('
    && matchingPunctuator(tokens, start, '(', ')') === end - 1) {
    start += 1;
    end -= 1;
  }
  return Object.freeze({ start, end });
}

function reflectiveReceiverExpression(tokens, start, end, receiverAliases, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH || start >= end) return false;
  const range = stripTransparentRange(tokens, start, end);
  start = range.start;
  end = range.end;
  const comma = topLevelComma(tokens, start, end);
  if (comma >= start) {
    return reflectiveReceiverExpression(tokens, comma + 1, end, receiverAliases, depth + 1);
  }
  if (end === start + 1
    && tokens[start]?.type === 'identifier'
    && receiverAliases.has(tokens[start].value)) return true;
  if (tokens.slice(start, end).some((token) => (
    token?.type === 'punctuator' && token.value === '{'
  ))) return false;
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'identifier' || !receiverAliases.has(token.value)) continue;
    const next = tokens[index + 1];
    if (next?.type === 'punctuator' && new Set(['.', '?.', '[']).has(next.value)) continue;
    return true;
  }
  return false;
}

function topLevelAssignment(tokens, start, end) {
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    const atBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
    if (atBoundary && token.value === '=') return index;
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']') depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}') depth.curly -= 1;
  }
  return -1;
}

function topLevelColon(tokens, start, end) {
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    const atBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
    if (atBoundary && token.value === ':') return index;
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']') depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}') depth.curly -= 1;
  }
  return -1;
}

function objectEntryRanges(tokens, objectRange) {
  const object = stripTransparentRange(tokens, objectRange.start, objectRange.end);
  if (tokens[object.start]?.type !== 'punctuator'
    || tokens[object.start].value !== '{'
    || matchingPunctuator(tokens, object.start, '{', '}') !== object.end - 1) return Object.freeze([]);
  const ranges = [];
  let start = object.start + 1;
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < object.end; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']' && depth.square > 0) depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}' && depth.curly > 0) depth.curly -= 1;
    const atBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
    const closesObject = token.value === '}' && index === object.end - 1;
    if (atBoundary && (token.value === ',' || closesObject)) {
      if (start < index) ranges.push(Object.freeze({ start, end: index }));
      start = index + 1;
    }
  }
  return Object.freeze(ranges);
}

function fixedObjectKey(tokens, start, end) {
  if (end !== start + 1) return null;
  const token = tokens[start];
  return token?.type === 'identifier' || token?.type === 'string' ? token.value : null;
}

function objectLiteralDefinesMember(tokens, receiverName, propertyName, memberReadIndex) {
  let definingObject = null;
  let assignmentCount = 0;
  let receiverRemainsClosed = true;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== 'identifier'
      || tokens[index].value !== receiverName) continue;
    const declarationBinding = tokens[index + 1]?.type === 'punctuator'
      && tokens[index + 1].value === '='
      && tokens[index - 1]?.type === 'identifier'
      && tokens[index - 1].value === 'const';
    if (index !== memberReadIndex && !declarationBinding) receiverRemainsClosed = false;
    if (tokens[index + 1]?.type !== 'punctuator' || tokens[index + 1].value !== '=') continue;
    assignmentCount += 1;
    if (!declarationBinding) continue;
    const end = assignmentExpressionEnd(tokens, index + 2);
    const range = end < 0 ? null : stripTransparentRange(tokens, index + 2, end);
    if (range
      && tokens[range.start]?.type === 'punctuator'
      && tokens[range.start].value === '{'
      && matchingPunctuator(tokens, range.start, '{', '}') === range.end - 1) definingObject = range;
  }
  if (assignmentCount !== 1 || !receiverRemainsClosed || !definingObject) return false;
  return objectEntryRanges(tokens, definingObject).some((entry) => {
    const colon = topLevelColon(tokens, entry.start, entry.end);
    const keyEnd = colon >= 0 ? colon : entry.start + 1;
    if (fixedObjectKey(tokens, entry.start, keyEnd) !== propertyName) return false;
    if (colon < 0) {
      return tokens[entry.start + 1]?.type === 'punctuator'
        && tokens[entry.start + 1].value === '(';
    }
    return !expressionMayBeUndefined(tokens, Object.freeze({ start: colon + 1, end: entry.end }));
  });
}

function fixedArrayIndex(tokens, start, end) {
  if (end !== start + 1) return null;
  const token = tokens[start];
  if (token?.type === 'string' && /^(?:0|[1-9]\d*)$/.test(token.value)) {
    const index = Number(token.value);
    return Number.isSafeInteger(index) ? index : null;
  }
  if (token?.type !== 'number') return null;
  const raw = token.value.replaceAll('_', '');
  try {
    const index = raw.endsWith('n') ? Number(BigInt(raw.slice(0, -1))) : Number(raw);
    return Number.isSafeInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
}

function uniqueRanges(ranges) {
  const seen = new Set();
  return Object.freeze(ranges.filter((range) => {
    if (!range) return false;
    const key = `${range.start}:${range.end}:${range.offset ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function arrayLiteralElementRanges(tokens, arrayRange) {
  const array = stripTransparentRange(tokens, arrayRange?.start ?? -1, arrayRange?.end ?? -1);
  if (tokens[array.start]?.type !== 'punctuator'
    || tokens[array.start].value !== '['
    || matchingPunctuator(tokens, array.start, '[', ']') !== array.end - 1) return Object.freeze([]);
  const ranges = [];
  let elementStart = array.start + 1;
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = elementStart; index < array.end; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']' && depth.square > 0) depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}') depth.curly -= 1;
    const atElementBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
    const closesOuterArray = token.value === ']' && index === array.end - 1;
    if (!atElementBoundary) continue;
    if (token.value === ',') {
      ranges.push(Object.freeze({ start: elementStart, end: index }));
      elementStart = index + 1;
    } else if (closesOuterArray && elementStart < index) {
      ranges.push(Object.freeze({ start: elementStart, end: index }));
    }
    if (closesOuterArray) break;
  }
  return Object.freeze(ranges);
}

function arrayRuntimeMinimumLength(tokens, arrayRange, arrayAliases, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH) return 0;
  let length = 0;
  for (const element of arrayLiteralElementRanges(tokens, arrayRange)) {
    if (tokens[element.start]?.type !== 'punctuator' || tokens[element.start].value !== '...') {
      length += 1;
      continue;
    }
    const spreadArrays = reflectiveArrayExpressionRanges(
      tokens,
      element.start + 1,
      element.end,
      arrayAliases,
      depth + 1,
    );
    if (spreadArrays.length > 0) {
      length += Math.min(...spreadArrays.map((spreadArray) => (
        arrayRuntimeMinimumLength(tokens, spreadArray, arrayAliases, depth + 1)
      )));
    }
  }
  return Math.max(0, length - (arrayRange?.offset ?? 0));
}

function arrayElementPossibility(tokens, arrayRange, requestedIndex, arrayAliases, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH) return Object.freeze({
    ranges: Object.freeze([]),
    mayBeAbsent: true,
    mayBeUndefined: true,
    mayBeReflectiveMethod: true,
    mayBeReflectiveReceiver: true,
  });
  const offset = arrayRange?.offset ?? 0;
  const absoluteRequestedIndex = requestedIndex === null ? null : requestedIndex + offset;
  const elements = arrayLiteralElementRanges(tokens, arrayRange);
  const firstSpread = elements.findIndex((element) => (
    tokens[element.start]?.type === 'punctuator' && tokens[element.start].value === '...'
  ));
  const selected = absoluteRequestedIndex === null
    ? firstSpread < 0 || offset < firstSpread
      ? elements.slice(offset)
      : elements.slice(firstSpread)
    : firstSpread < 0 || absoluteRequestedIndex < firstSpread
      ? elements.slice(absoluteRequestedIndex, absoluteRequestedIndex + 1)
      : elements.slice(firstSpread);
  const possible = [];
  let mayBeUndefined = false;
  let mayBeReflectiveMethod = false;
  let mayBeReflectiveReceiver = false;
  for (const element of selected) {
    if (element.start >= element.end) {
      mayBeUndefined = true;
      continue;
    }
    if (tokens[element.start]?.type !== 'punctuator' || tokens[element.start].value !== '...') {
      possible.push(element);
      continue;
    }
    const spreadStart = element.start + 1;
    const spreadArrays = reflectiveArrayExpressionRanges(
      tokens,
      spreadStart,
      element.end,
      arrayAliases,
      depth + 1,
    );
    if (spreadArrays.length === 0) {
      possible.push(Object.freeze({ start: spreadStart, end: element.end }));
      mayBeUndefined = true;
      mayBeReflectiveMethod = true;
      mayBeReflectiveReceiver = true;
      continue;
    }
    for (const spreadArray of spreadArrays) {
      const spread = arrayElementPossibility(
        tokens,
        spreadArray,
        null,
        arrayAliases,
        depth + 1,
      );
      possible.push(...spread.ranges);
      mayBeUndefined ||= spread.mayBeUndefined;
      mayBeReflectiveMethod ||= spread.mayBeReflectiveMethod;
      mayBeReflectiveReceiver ||= spread.mayBeReflectiveReceiver;
    }
  }
  const mayBeAbsent = absoluteRequestedIndex !== null
    && arrayRuntimeMinimumLength(
      tokens,
      Object.freeze({ start: arrayRange.start, end: arrayRange.end }),
      arrayAliases,
      depth + 1,
    ) <= absoluteRequestedIndex;
  return Object.freeze({
    ranges: uniqueRanges(possible),
    mayBeAbsent,
    mayBeUndefined,
    mayBeReflectiveMethod,
    mayBeReflectiveReceiver,
  });
}

function arrayElementPossibleRanges(tokens, arrayRange, requestedIndex, arrayAliases, depth = 0) {
  return arrayElementPossibility(tokens, arrayRange, requestedIndex, arrayAliases, depth).ranges;
}

function reflectiveArrayElementPossibility(tokens, start, end, arrayAliases, depth = 0) {
  const empty = Object.freeze({
    ranges: Object.freeze([]),
    mayBeAbsent: true,
    mayBeUndefined: true,
    mayBeReflectiveMethod: false,
    mayBeReflectiveReceiver: false,
  });
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH || start >= end) return empty;
  const range = stripTransparentRange(tokens, start, end);
  start = range.start;
  end = range.end;
  if (tokens[end - 1]?.type !== 'punctuator' || tokens[end - 1].value !== ']') return empty;
  let accessOpen = -1;
  for (let index = start + 1; index < end - 1; index += 1) {
    if (tokens[index]?.type === 'punctuator'
      && tokens[index].value === '['
      && matchingPunctuator(tokens, index, '[', ']') === end - 1) {
      accessOpen = index;
      break;
    }
  }
  if (accessOpen < 0) return empty;
  const baseEnd = tokens[accessOpen - 1]?.type === 'punctuator' && tokens[accessOpen - 1].value === '?.'
    ? accessOpen - 1
    : accessOpen;
  const arrayRanges = reflectiveArrayExpressionRanges(tokens, start, baseEnd, arrayAliases, depth + 1);
  if (arrayRanges.length === 0) return empty;
  const fixedIndex = fixedArrayIndex(tokens, accessOpen + 1, end - 1);
  const possible = [];
  let mayBeAbsent = false;
  let mayBeUndefined = false;
  let mayBeReflectiveMethod = false;
  let mayBeReflectiveReceiver = false;
  for (const arrayRange of arrayRanges) {
    const element = arrayElementPossibility(
      tokens,
      arrayRange,
      fixedIndex,
      arrayAliases,
      depth + 1,
    );
    possible.push(...element.ranges);
    mayBeAbsent ||= element.mayBeAbsent;
    mayBeUndefined ||= element.mayBeUndefined;
    mayBeReflectiveMethod ||= element.mayBeReflectiveMethod;
    mayBeReflectiveReceiver ||= element.mayBeReflectiveReceiver;
  }
  return Object.freeze({
    ranges: uniqueRanges(possible),
    mayBeAbsent,
    mayBeUndefined,
    mayBeReflectiveMethod,
    mayBeReflectiveReceiver,
  });
}

function reflectiveArrayElementRanges(tokens, start, end, arrayAliases, depth = 0) {
  return reflectiveArrayElementPossibility(tokens, start, end, arrayAliases, depth).ranges;
}

function reflectiveArrayExpressionRanges(tokens, start, end, arrayAliases, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH || start >= end) return Object.freeze([]);
  const range = stripTransparentRange(tokens, start, end);
  start = range.start;
  end = range.end;
  const comma = topLevelComma(tokens, start, end);
  if (comma >= start) {
    return reflectiveArrayExpressionRanges(tokens, comma + 1, end, arrayAliases, depth + 1);
  }
  if (tokens[start]?.type === 'punctuator'
    && tokens[start].value === '['
    && matchingPunctuator(tokens, start, '[', ']') === end - 1) return Object.freeze([range]);
  if (end === start + 1 && tokens[start]?.type === 'identifier') {
    return arrayAliases.get(tokens[start].value) ?? Object.freeze([]);
  }
  const elementRanges = reflectiveArrayElementRanges(tokens, start, end, arrayAliases, depth + 1);
  const arrays = [];
  for (const elementRange of elementRanges) {
    arrays.push(...reflectiveArrayExpressionRanges(
      tokens,
      elementRange.start,
      elementRange.end,
      arrayAliases,
      depth + 1,
    ));
  }
  return uniqueRanges(arrays);
}

function expressionMayBeUndefined(tokens, range) {
  if (!range || range.start >= range.end) return true;
  const expression = stripTransparentRange(tokens, range.start, range.end);
  const first = tokens[expression.start];
  if (expression.end === expression.start + 1) {
    if (first?.type !== 'identifier') return false;
    return !new Set(['false', 'null', 'true']).has(first.value);
  }
  if (first?.type === 'identifier' && first.value === 'void') return true;
  if (first?.type === 'punctuator' && new Set(['[', '{']).has(first.value)) return false;
  if (first?.type !== 'identifier') return true;
  if (expression.end === expression.start + 3
    && tokens[expression.start + 1]?.type === 'punctuator'
    && tokens[expression.start + 1].value === '.'
    && tokens[expression.start + 2]?.type === 'identifier') {
    return !objectLiteralDefinesMember(
      tokens,
      first.value,
      tokens[expression.start + 2].value,
      expression.start,
    );
  }
  return true;
}

function recordReflectiveObjectPatternAliases(tokens, open, close, addAlias) {
  let cursor = open + 1;
  while (cursor < close) {
    let couldSelect = false;
    if (tokens[cursor]?.type === 'identifier') {
      couldSelect = REFLECTIVE_PROPERTY_KEY_METHODS.has(tokens[cursor].value);
      if (couldSelect
        && !(tokens[cursor + 1]?.type === 'punctuator' && tokens[cursor + 1].value === ':')) {
        addAlias(tokens[cursor].value, Object.freeze({
          end: cursor,
          propertyIndex: 1,
          boundPropertyRange: null,
        }));
        cursor += 1;
        continue;
      }
    } else if (tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === '[') {
      const keyClose = matchingPunctuator(tokens, cursor, '[', ']');
      if (keyClose < 0 || keyClose >= close) break;
      const pattern = parseComputedAuthorityPattern(tokens, cursor + 1, keyClose);
      couldSelect = !pattern
        || [...REFLECTIVE_PROPERTY_KEY_METHODS].some((method) => authorityPatternCanResolve(pattern, method));
      cursor = keyClose;
    }
    if (couldSelect
      && tokens[cursor + 1]?.type === 'punctuator'
      && tokens[cursor + 1].value === ':'
      && tokens[cursor + 2]?.type === 'identifier') {
      addAlias(tokens[cursor + 2].value, Object.freeze({
        end: cursor + 2,
        propertyIndex: 1,
        boundPropertyRange: null,
      }));
    }
    while (cursor < close
      && !(tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === ',')) cursor += 1;
    cursor += 1;
  }
}

function objectPatternEntry(tokens, entryRange) {
  const entry = stripTransparentRange(tokens, entryRange.start, entryRange.end);
  if (tokens[entry.start]?.type === 'punctuator' && tokens[entry.start].value === '...') return null;
  const colon = topLevelColon(tokens, entry.start, entry.end);
  if (colon >= 0) {
    return Object.freeze({
      key: fixedObjectKey(tokens, entry.start, colon),
      target: Object.freeze({ start: colon + 1, end: entry.end }),
    });
  }
  const assignment = topLevelAssignment(tokens, entry.start, entry.end);
  const keyEnd = assignment >= 0 ? assignment : entry.end;
  return Object.freeze({
    key: fixedObjectKey(tokens, entry.start, keyEnd),
    target: entry,
  });
}

function objectLiteralPropertyPossibility(tokens, sourceRange, key) {
  const source = stripTransparentRange(tokens, sourceRange.start, sourceRange.end);
  if (tokens[source.start]?.type !== 'punctuator'
    || tokens[source.start].value !== '{'
    || matchingPunctuator(tokens, source.start, '{', '}') !== source.end - 1) {
    return Object.freeze({
      entries: Object.freeze([]),
      mayBeAbsent: true,
      mayBeReflectiveMethod: false,
      mayBeReflectiveReceiver: false,
    });
  }
  const entries = [];
  let mayBeAbsent = key === null;
  let mayBeReflectiveMethod = false;
  let mayBeReflectiveReceiver = false;
  for (const entry of objectEntryRanges(tokens, source)) {
    if (tokens[entry.start]?.type === 'punctuator' && tokens[entry.start].value === '...') {
      mayBeAbsent = true;
      mayBeReflectiveMethod = true;
      mayBeReflectiveReceiver = true;
      continue;
    }
    const colon = topLevelColon(tokens, entry.start, entry.end);
    const entryKey = fixedObjectKey(tokens, entry.start, colon >= 0 ? colon : entry.start + 1);
    if (key === null || entryKey === key) {
      if (colon >= 0) {
        const range = Object.freeze({ start: colon + 1, end: entry.end });
        entries.push(Object.freeze({ range, mayBeUndefined: expressionMayBeUndefined(tokens, range) }));
      } else if (tokens[entry.start + 1]?.type === 'punctuator'
        && tokens[entry.start + 1].value === '(') {
        entries.push(Object.freeze({ range: entry, mayBeUndefined: false }));
      } else {
        entries.push(Object.freeze({ range: entry, mayBeUndefined: true }));
      }
    }
  }
  if (entries.length === 0) mayBeAbsent = true;
  return Object.freeze({
    entries: Object.freeze(entries),
    mayBeAbsent,
    mayBeReflectiveMethod,
    mayBeReflectiveReceiver,
  });
}

function recordObjectPatternDefaultAliases(
  tokens,
  pattern,
  value,
  aliases,
  receiverAliases,
  arrayAliases,
  addAlias,
  addReceiverAlias,
  addArrayAlias,
  depth,
) {
  for (const entryRange of objectEntryRanges(tokens, pattern)) {
    const entry = objectPatternEntry(tokens, entryRange);
    if (!entry) continue;
    const sourceEntries = [];
    let mayBeAbsent = false;
    let mayBeReflectiveMethod = false;
    let mayBeReflectiveReceiver = false;
    const sourceIsReflectiveReceiver = reflectiveReceiverExpression(
      tokens,
      value.start,
      value.end,
      receiverAliases,
    );
    const couldSelectReflectiveMethod = entry.key === null
      || REFLECTIVE_PROPERTY_KEY_METHODS.has(entry.key);
    if (sourceIsReflectiveReceiver && couldSelectReflectiveMethod) {
      mayBeReflectiveMethod = true;
    } else {
      const property = objectLiteralPropertyPossibility(tokens, value, entry.key);
      sourceEntries.push(...property.entries);
      mayBeAbsent = property.mayBeAbsent;
      mayBeReflectiveMethod ||= property.mayBeReflectiveMethod;
      mayBeReflectiveReceiver ||= property.mayBeReflectiveReceiver;
    }

    const target = stripTransparentRange(tokens, entry.target.start, entry.target.end);
    const fallback = topLevelAssignment(tokens, target.start, target.end);
    const targetEnd = fallback >= 0 ? fallback : target.end;
    const nestedTarget = Object.freeze({ start: target.start, end: targetEnd });
    const fallbackReachable = fallback >= 0 && (
      mayBeAbsent || sourceEntries.some((source) => source.mayBeUndefined)
    );
    const sourceRanges = sourceEntries.map((source) => source.range);
    const candidateRanges = fallbackReachable
      ? [...sourceRanges, Object.freeze({ start: fallback + 1, end: target.end })]
      : sourceRanges;

    if (tokens[target.start]?.type === 'identifier' && targetEnd === target.start + 1) {
      if (mayBeReflectiveMethod) {
        addAlias(tokens[target.start].value, Object.freeze({
          end: target.start,
          propertyIndex: 1,
          boundPropertyRange: null,
        }));
      }
      if (mayBeReflectiveReceiver) addReceiverAlias(tokens[target.start].value);
      for (const range of candidateRanges) {
        for (const descriptor of reflectiveExpressionDescriptors(tokens, range.start, range.end, aliases)) {
          addAlias(tokens[target.start].value, descriptor);
        }
        if (reflectiveReceiverExpression(tokens, range.start, range.end, receiverAliases)) {
          addReceiverAlias(tokens[target.start].value);
        }
        for (const nestedArray of reflectiveArrayExpressionRanges(
          tokens,
          range.start,
          range.end,
          arrayAliases,
        )) addArrayAlias(tokens[target.start].value, nestedArray);
      }
      continue;
    }

    for (const range of sourceRanges) {
      recordDestructuringAssignmentAliases(
        tokens,
        nestedTarget,
        range,
        aliases,
        receiverAliases,
        arrayAliases,
        addAlias,
        addReceiverAlias,
        addArrayAlias,
        depth + 1,
      );
    }
    if (fallbackReachable && fallback + 1 < target.end) {
      recordDestructuringAssignmentAliases(
        tokens,
        nestedTarget,
        Object.freeze({ start: fallback + 1, end: target.end }),
        aliases,
        receiverAliases,
        arrayAliases,
        addAlias,
        addReceiverAlias,
        addArrayAlias,
        depth + 1,
      );
    }
  }
}

function recordDestructuringAssignmentAliases(
  tokens,
  patternRange,
  valueRange,
  aliases,
  receiverAliases,
  arrayAliases,
  addAlias,
  addReceiverAlias,
  addArrayAlias,
  depth = 0,
  arrayValueOverrides = null,
) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH) return;
  const pattern = stripTransparentRange(tokens, patternRange.start, patternRange.end);
  const value = stripTransparentRange(tokens, valueRange.start, valueRange.end);
  if (tokens[pattern.start]?.type === 'punctuator'
    && tokens[pattern.start].value === '{'
    && matchingPunctuator(tokens, pattern.start, '{', '}') === pattern.end - 1) {
    if (reflectiveReceiverExpression(tokens, value.start, value.end, receiverAliases)) {
      recordReflectiveObjectPatternAliases(tokens, pattern.start, pattern.end - 1, addAlias);
    }
    recordObjectPatternDefaultAliases(
      tokens,
      pattern,
      value,
      aliases,
      receiverAliases,
      arrayAliases,
      addAlias,
      addReceiverAlias,
      addArrayAlias,
      depth,
    );
    return;
  }
  const arrayValues = arrayValueOverrides
    ?? reflectiveArrayExpressionRanges(tokens, value.start, value.end, arrayAliases);
  if (tokens[pattern.start]?.type !== 'punctuator'
    || tokens[pattern.start].value !== '['
    || matchingPunctuator(tokens, pattern.start, '[', ']') !== pattern.end - 1) return;

  const targetRanges = arrayLiteralElementRanges(tokens, pattern);
  for (let elementIndex = 0; elementIndex < targetRanges.length; elementIndex += 1) {
    const targetRange = targetRanges[elementIndex];
    const sourcePossibilities = arrayValues.length > 0
      ? arrayValues.map((arrayValue) => (
        arrayElementPossibility(tokens, arrayValue, elementIndex, arrayAliases, depth + 1)
      ))
      : [Object.freeze({
        ranges: Object.freeze([]),
        mayBeAbsent: true,
        mayBeUndefined: true,
        mayBeReflectiveMethod: false,
        mayBeReflectiveReceiver: false,
      })];
    const sourceRangeGroups = sourcePossibilities.map((possibility) => possibility.ranges);
    const sourceRanges = uniqueRanges(sourceRangeGroups.flat());
    if (targetRange.start >= targetRange.end) continue;
    const target = stripTransparentRange(tokens, targetRange.start, targetRange.end);
    if (tokens[target.start]?.type === 'punctuator' && tokens[target.start].value === '...') {
      const restTarget = stripTransparentRange(tokens, target.start + 1, target.end);
      const restArrays = arrayValues.map((arrayValue) => Object.freeze({
        start: arrayValue.start,
        end: arrayValue.end,
        offset: (arrayValue.offset ?? 0) + elementIndex,
      }));
      if (tokens[restTarget.start]?.type === 'identifier'
        && restTarget.end === restTarget.start + 1) {
        for (const restArray of restArrays) {
          addArrayAlias(tokens[restTarget.start].value, restArray);
        }
      } else if (restArrays.length > 0) {
        recordDestructuringAssignmentAliases(
          tokens,
          restTarget,
          value,
          aliases,
          receiverAliases,
          arrayAliases,
          addAlias,
          addReceiverAlias,
          addArrayAlias,
          depth + 1,
          restArrays,
        );
      }
      continue;
    }

    const fallback = topLevelAssignment(tokens, target.start, target.end);
    const targetEnd = fallback >= 0 ? fallback : target.end;
    const nestedTarget = Object.freeze({ start: target.start, end: targetEnd });
    const fallbackReachable = fallback >= 0 && (
      sourcePossibilities.some((possibility) => possibility.mayBeAbsent)
      || sourcePossibilities.some((possibility) => possibility.mayBeUndefined)
      || sourceRanges.some((range) => expressionMayBeUndefined(tokens, range))
    );
    if (tokens[target.start]?.type === 'identifier' && targetEnd === target.start + 1) {
      if (sourcePossibilities.some((possibility) => possibility.mayBeReflectiveMethod)) {
        addAlias(tokens[target.start].value, Object.freeze({
          end: target.start,
          propertyIndex: 1,
          boundPropertyRange: null,
        }));
      }
      if (sourcePossibilities.some((possibility) => possibility.mayBeReflectiveReceiver)) {
        addReceiverAlias(tokens[target.start].value);
      }
      const candidateRanges = fallbackReachable
        ? [...sourceRanges, { start: fallback + 1, end: target.end }]
        : sourceRanges;
      for (const range of candidateRanges) {
        if (!range || range.start >= range.end) continue;
        for (const descriptor of reflectiveExpressionDescriptors(tokens, range.start, range.end, aliases)) {
          addAlias(tokens[target.start].value, descriptor);
        }
        if (reflectiveReceiverExpression(tokens, range.start, range.end, receiverAliases)) {
          addReceiverAlias(tokens[target.start].value);
        }
        for (const nestedArray of reflectiveArrayExpressionRanges(
          tokens,
          range.start,
          range.end,
          arrayAliases,
        )) addArrayAlias(tokens[target.start].value, nestedArray);
      }
      continue;
    }
    if (sourcePossibilities.some((possibility) => possibility.mayBeReflectiveReceiver)
      && tokens[nestedTarget.start]?.type === 'punctuator'
      && tokens[nestedTarget.start].value === '{') {
      recordReflectiveObjectPatternAliases(
        tokens,
        nestedTarget.start,
        nestedTarget.end - 1,
        addAlias,
      );
    }
    for (const sourceRange of sourceRanges) {
      recordDestructuringAssignmentAliases(
        tokens,
        nestedTarget,
        sourceRange,
        aliases,
        receiverAliases,
        arrayAliases,
        addAlias,
        addReceiverAlias,
        addArrayAlias,
        depth + 1,
      );
    }
    if (fallbackReachable && fallback + 1 < target.end) {
      recordDestructuringAssignmentAliases(
        tokens,
        nestedTarget,
        Object.freeze({ start: fallback + 1, end: target.end }),
        aliases,
        receiverAliases,
        arrayAliases,
        addAlias,
        addReceiverAlias,
        addArrayAlias,
        depth + 1,
      );
    }
  }
}

function reflectiveMethodAliases(tokens) {
  const aliases = new Map();
  const receiverAliases = new Set(['Object', 'Reflect']);
  const arrayAliases = new Map();
  const boundPropertyRanges = [];
  const addAlias = (name, descriptor) => {
    const current = aliases.get(name) ?? [];
    const duplicate = current.some((item) => (
      item.propertyIndex === descriptor.propertyIndex
      && JSON.stringify(item.boundPropertyRange) === JSON.stringify(descriptor.boundPropertyRange)
    ));
    if (duplicate) return false;
    aliases.set(name, Object.freeze([...current, descriptor]));
    if (descriptor.boundPropertyRange) boundPropertyRanges.push(descriptor.boundPropertyRange);
    return true;
  };
  const addArrayAlias = (name, arrayRange) => {
    const current = arrayAliases.get(name) ?? Object.freeze([]);
    if (current.some((range) => (
      range.start === arrayRange.start
      && range.end === arrayRange.end
      && (range.offset ?? 0) === (arrayRange.offset ?? 0)
    ))) return false;
    arrayAliases.set(name, Object.freeze([...current, arrayRange]));
    return true;
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < tokens.length - 3; index += 1) {
      const alias = tokens[index];
      if (alias?.type !== 'identifier'
        || tokens[index + 1]?.type !== 'punctuator'
        || tokens[index + 1].value !== '=') continue;
      const rhsStart = index + 2;
      const rhsEnd = assignmentExpressionEnd(tokens, rhsStart);
      const arrayRanges = rhsEnd < 0
        ? Object.freeze([])
        : reflectiveArrayExpressionRanges(tokens, rhsStart, rhsEnd, arrayAliases);
      for (const arrayRange of arrayRanges) {
        if (addArrayAlias(alias.value, arrayRange)) changed = true;
      }
    }
    for (let index = 0; index < tokens.length - 3; index += 1) {
      const alias = tokens[index];
      if (alias?.type !== 'identifier'
        || tokens[index + 1]?.type !== 'punctuator'
        || tokens[index + 1].value !== '=') continue;
      const rhsStart = index + 2;
      const rhsEnd = assignmentExpressionEnd(tokens, rhsStart);
      const receiverElement = rhsEnd < 0
        ? Object.freeze({ ranges: Object.freeze([]), mayBeReflectiveReceiver: false })
        : reflectiveArrayElementPossibility(tokens, rhsStart, rhsEnd, arrayAliases);
      if (rhsEnd < 0
        || reflectiveArrayExpressionRanges(tokens, rhsStart, rhsEnd, arrayAliases).length > 0
        || !(reflectiveReceiverExpression(tokens, rhsStart, rhsEnd, receiverAliases)
          || receiverElement.mayBeReflectiveReceiver
          || receiverElement.ranges.some((range) => (
            reflectiveReceiverExpression(tokens, range.start, range.end, receiverAliases)
          )))
        || receiverAliases.has(alias.value)) continue;
      receiverAliases.add(alias.value);
      changed = true;
    }
    for (let index = 0; index < tokens.length - 4; index += 1) {
      if (tokens[index]?.type !== 'punctuator' || tokens[index].value !== '[') continue;
      const previous = tokens[index - 1];
      const beginsPattern = index === 0
        || (previous?.type === 'identifier' && new Set(['const', 'let', 'var', 'return', 'yield']).has(previous.value))
        || (previous?.type === 'punctuator' && new Set(['(', '[', '{', '}', ',', ';', '=']).has(previous.value));
      if (!beginsPattern) continue;
      const close = matchingPunctuator(tokens, index, '[', ']');
      if (close < 0
        || tokens[close + 1]?.type !== 'punctuator'
        || tokens[close + 1].value !== '=') continue;
      const rhsStart = close + 2;
      const rhsEnd = assignmentExpressionEnd(tokens, rhsStart);
      if (rhsEnd < 0) continue;
      recordDestructuringAssignmentAliases(
        tokens,
        Object.freeze({ start: index, end: close + 1 }),
        Object.freeze({ start: rhsStart, end: rhsEnd }),
        aliases,
        receiverAliases,
        arrayAliases,
        (name, descriptor) => {
          if (addAlias(name, descriptor)) changed = true;
        },
        (name) => {
          if (!receiverAliases.has(name)) {
            receiverAliases.add(name);
            changed = true;
          }
        },
        (name, arrayRange) => {
          if (addArrayAlias(name, arrayRange)) changed = true;
        },
      );
    }
    for (let index = 0; index < tokens.length - 3; index += 1) {
      const alias = tokens[index];
      if (alias?.type !== 'identifier'
        || tokens[index + 1]?.type !== 'punctuator'
        || tokens[index + 1].value !== '=') continue;
      const rhsStart = index + 2;
      const rhsEnd = assignmentExpressionEnd(tokens, rhsStart);
      if (rhsEnd < 0
        || reflectiveArrayExpressionRanges(tokens, rhsStart, rhsEnd, arrayAliases).length > 0) continue;
      const element = reflectiveArrayElementPossibility(tokens, rhsStart, rhsEnd, arrayAliases);
      if (element.mayBeReflectiveMethod && addAlias(alias.value, Object.freeze({
        end: index,
        propertyIndex: 1,
        boundPropertyRange: null,
      }))) changed = true;
      const elementRanges = element.ranges;
      const ranges = elementRanges.length > 0
        ? elementRanges
        : [Object.freeze({ start: rhsStart, end: rhsEnd })];
      for (const range of ranges) {
        for (const descriptor of reflectiveExpressionDescriptors(tokens, range.start, range.end, aliases)) {
          if (addAlias(alias.value, descriptor)) changed = true;
        }
      }
    }
    for (let index = 0; index < tokens.length - 5; index += 1) {
      if (tokens[index]?.type !== 'punctuator' || tokens[index].value !== '{') continue;
      const close = matchingPunctuator(tokens, index, '{', '}');
      if (close < 0
        || tokens[close + 1]?.type !== 'punctuator'
        || tokens[close + 1].value !== '=') continue;
      const rhsStart = close + 2;
      const rhsEnd = assignmentExpressionEnd(tokens, rhsStart);
      if (rhsEnd < 0) continue;
      recordDestructuringAssignmentAliases(
        tokens,
        Object.freeze({ start: index, end: close + 1 }),
        Object.freeze({ start: rhsStart, end: rhsEnd }),
        aliases,
        receiverAliases,
        arrayAliases,
        (name, descriptor) => {
          if (addAlias(name, descriptor)) changed = true;
        },
        (name) => {
          if (!receiverAliases.has(name)) {
            receiverAliases.add(name);
            changed = true;
          }
        },
        (name, arrayRange) => {
          if (addArrayAlias(name, arrayRange)) changed = true;
        },
      );
    }
  }
  return Object.freeze({ aliases, boundPropertyRanges: Object.freeze(boundPropertyRanges) });
}

function reflectiveCallPropertyRange(tokens, calleeStart, calleeEnd, propertyIndex = 1) {
  const directOpen = callOpenAfterCallee(tokens, calleeStart, calleeEnd);
  if (directOpen >= 0) return callArgumentRange(tokens, directOpen, propertyIndex);
  const bounds = transparentCalleeBounds(tokens, calleeStart, calleeEnd);
  const access = tokens[bounds.end + 1];
  const method = tokens[bounds.end + 2];
  if (access?.type !== 'punctuator'
    || !new Set(['.', '?.']).has(access.value)
    || method?.type !== 'identifier'
    || !new Set(['apply', 'bind', 'call']).has(method.value)) return null;
  const borrowedOpen = callOpenAfterCallee(tokens, bounds.start, bounds.end + 2);
  if (borrowedOpen < 0) return null;
  if (method.value === 'call') return callArgumentRange(tokens, borrowedOpen, propertyIndex + 1);
  if (method.value === 'apply') {
    const argumentArray = callArgumentRange(tokens, borrowedOpen, 1);
    return arrayElementRange(tokens, argumentArray, propertyIndex) ?? argumentArray;
  }
  const bound = reflectiveBindDescriptor(tokens, calleeStart, calleeEnd, propertyIndex);
  if (!bound) return null;
  if (bound.boundPropertyRange) return bound.boundPropertyRange;
  const invocationOpen = callOpenAfterCallee(tokens, calleeStart, bound.end);
  return invocationOpen < 0 || bound.propertyIndex === null
    ? null
    : callArgumentRange(tokens, invocationOpen, bound.propertyIndex);
}

function reflectivePropertyKeyRanges(tokens) {
  const ranges = [];
  for (let index = 0; index < tokens.length - 3; index += 1) {
    const referenceEnd = reflectiveMethodReferenceEnd(tokens, index);
    if (referenceEnd < 0) continue;
    const range = reflectiveCallPropertyRange(tokens, index, referenceEnd);
    if (range) ranges.push(range);
    index = referenceEnd;
  }
  const aliasAnalysis = reflectiveMethodAliases(tokens);
  ranges.push(...aliasAnalysis.boundPropertyRanges);
  for (let index = 0; index < tokens.length; index += 1) {
    const alias = tokens[index];
    if (alias?.type !== 'identifier' || !aliasAnalysis.aliases.has(alias.value)) continue;
    for (const descriptor of aliasAnalysis.aliases.get(alias.value)) {
      if (descriptor.propertyIndex === null) continue;
      const range = reflectiveCallPropertyRange(tokens, index, index, descriptor.propertyIndex);
      if (range) ranges.push(range);
    }
  }
  return Object.freeze(ranges);
}

function parseComputedAuthorityPattern(tokens, start, end, depth = 0) {
  if (depth > MAX_FOLDED_AUTHORITY_EXPRESSION_DEPTH || start >= end) return null;
  const parts = [];
  let cursor = start;

  const append = (part) => {
    if (part.kind === 'fixed' && parts.at(-1)?.kind === 'fixed') parts.at(-1).value += part.value;
    else if (part.kind !== 'unknown' || parts.at(-1)?.kind !== 'unknown') parts.push(part);
  };
  const parsePrimary = () => {
    const token = tokens[cursor];
    if (token?.type === 'string' || (token?.type === 'template' && token.constant === true)) {
      append({ kind: 'fixed', value: token.value });
      cursor += 1;
      return true;
    }
    if (token?.type === 'template' && Array.isArray(token.authorityPatternParts)) {
      for (const part of token.authorityPatternParts) append({ ...part });
      cursor += 1;
      return true;
    }
    if (token?.type === 'number') {
      append({ kind: 'fixed', value: token.value });
      cursor += 1;
      return true;
    }
    if (token?.type === 'identifier') {
      append({ kind: 'unknown' });
      cursor += 1;
      return true;
    }
    if (token?.type === 'punctuator' && token.value === '(') {
      let close = cursor + 1;
      let roundDepth = 1;
      for (; close < end && roundDepth > 0; close += 1) {
        if (tokens[close]?.type !== 'punctuator') continue;
        if (tokens[close].value === '(') roundDepth += 1;
        if (tokens[close].value === ')') roundDepth -= 1;
      }
      if (roundDepth !== 0) return false;
      const nested = parseComputedAuthorityPattern(tokens, cursor + 1, close - 1, depth + 1);
      if (!nested) return false;
      for (const part of nested) append({ ...part });
      cursor = close;
      return true;
    }
    return false;
  };

  if (!parsePrimary()) return null;
  while (cursor < end) {
    if (tokens[cursor]?.type !== 'punctuator' || tokens[cursor].value !== '+') return null;
    cursor += 1;
    if (!parsePrimary()) return null;
  }
  return Object.freeze(parts.map((part) => Object.freeze(part)));
}

function authorityPatternCanResolve(parts, target) {
  const memo = new Map();
  const visit = (partIndex, targetIndex) => {
    const key = `${partIndex}:${targetIndex}`;
    if (memo.has(key)) return memo.get(key);
    let result = false;
    if (partIndex === parts.length) return targetIndex === target.length;
    const part = parts[partIndex];
    if (part.kind === 'fixed') {
      result = target.startsWith(part.value, targetIndex)
        && visit(partIndex + 1, targetIndex + part.value.length);
    } else {
      for (let cursor = targetIndex; cursor <= target.length && !result; cursor += 1) {
        result = visit(partIndex + 1, cursor);
      }
    }
    memo.set(key, result);
    return result;
  };
  return visit(0, 0);
}

function authorityStringsForExpression(tokens, start, end) {
  const values = [];
  const expressionTokens = tokens.slice(start, end);
  for (const token of expressionTokens) {
    if (token?.type === 'template') values.push(...token.authorityValues);
  }
  const aggregateTemplate = expressionTokens.at(-1);
  const templateOwnsExpression = aggregateTemplate?.type === 'template'
    && aggregateTemplate.expressionTokenCount === expressionTokens.length - 1;
  const pattern = templateOwnsExpression
    ? aggregateTemplate.authorityPatternParts
    : parseComputedAuthorityPattern(tokens, start, end);
  const staticallyNamedProperty = Array.isArray(pattern)
    && pattern.every((part) => part.kind === 'fixed');
  const authorityNames = [
    ...DANGEROUS_AUTHORITY_TOKENS,
    ...FORBIDDEN_LOCAL_MODULES,
    ...(staticallyNamedProperty ? FORBIDDEN_GLOBAL_CAPABILITIES : []),
  ];
  if (!pattern) values.push('spawn');
  else for (const authorityName of authorityNames) {
    if (authorityPatternCanResolve(pattern, authorityName)) values.push(authorityName);
  }
  return Object.freeze(values);
}

function computedAuthorityStrings(tokens) {
  const ranges = [];
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.type !== 'punctuator' || tokens[index].value !== '[') continue;
    const closeIndex = matchingPunctuator(tokens, index, '[', ']');
    if (closeIndex <= index) continue;
    if (isComputedMemberAccess(tokens, index) || isComputedPropertyAccess(tokens, closeIndex)) {
      ranges.push(Object.freeze({ start: index + 1, end: closeIndex }));
    }
  }
  ranges.push(...reflectivePropertyKeyRanges(tokens));
  return Object.freeze(unique(ranges.flatMap(({ start, end }) => (
    authorityStringsForExpression(tokens, start, end)
  ))));
}

function sameToken(left, right) {
  return left?.type === right?.type && left?.value === right?.value;
}

function tokenSequence(source) {
  const lexical = tokenizeJavaScriptAuthority(source);
  return lexical.valid ? lexical.tokens : Object.freeze([]);
}

function includesTokenSequence(tokens, expected) {
  if (expected.length === 0 || expected.length > tokens.length) return false;
  for (let start = 0; start <= tokens.length - expected.length; start += 1) {
    if (expected.every((token, offset) => sameToken(tokens[start + offset], token))) return true;
  }
  return false;
}

function tokenSequenceIndex(tokens, expected, start = 0) {
  if (expected.length === 0 || expected.length > tokens.length) return -1;
  for (let index = start; index <= tokens.length - expected.length; index += 1) {
    if (expected.every((token, offset) => sameToken(tokens[index + offset], token))) return index;
  }
  return -1;
}

function sameTokenSequence(tokens, source) {
  const expected = tokenSequence(source);
  return tokens.length === expected.length
    && expected.length > 0
    && expected.every((token, index) => sameToken(tokens[index], token));
}

function returnStatements(tokens) {
  const statements = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== 'identifier' || tokens[index].value !== 'return') continue;
    const returnIndex = index;
    const expression = [];
    const depth = { round: 0, square: 0, curly: 0 };
    let terminated = false;
    if (tokens[index + 1]?.lineTerminatorBefore === true) {
      statements.push(Object.freeze({
        index: returnIndex,
        expression: Object.freeze(expression),
        terminated: true,
      }));
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      if (token?.type === 'punctuator') {
        if (token.value === ';' && depth.round === 0 && depth.square === 0 && depth.curly === 0) {
          terminated = true;
          index = cursor;
          break;
        }
        if (token.value === '(') depth.round += 1;
        else if (token.value === ')') depth.round -= 1;
        else if (token.value === '[') depth.square += 1;
        else if (token.value === ']') depth.square -= 1;
        else if (token.value === '{') depth.curly += 1;
        else if (token.value === '}') depth.curly -= 1;
        if (depth.round < 0 || depth.square < 0 || depth.curly < 0) break;
      }
      expression.push(token);
    }
    statements.push(Object.freeze({
      index: returnIndex,
      expression: Object.freeze(expression),
      terminated,
    }));
  }
  return Object.freeze(statements);
}

function blockedAuthorityReturn(tokens) {
  return tokens.length === 4
    && tokens[0]?.type === 'identifier' && tokens[0].value === 'blockedAuthority'
    && tokens[1]?.type === 'punctuator' && tokens[1].value === '('
    && tokens[2]?.type === 'string'
    && tokens[3]?.type === 'punctuator' && tokens[3].value === ')';
}

function blockedAuthoritySemanticsValid(tokens) {
  const body = functionBodyTokens(tokens, 'blockedAuthority');
  return sameTokenSequence(body, `return Object.freeze({
    valid: false,
    reason,
    authorityReceiptId: '',
    realWorkReceiptId: '',
    proofRefs: Object.freeze([]),
  });`);
}

function topLevelReturnStatements(tokens) {
  const statementStarts = directStatementStarts(tokens);
  return Object.freeze(returnStatements(tokens).filter(({ index }) => statementStarts.has(index)));
}

function statementEnd(tokens, start) {
  if (start < 0 || start >= tokens.length) return -1;
  const token = tokens[start];
  if (token?.type === 'punctuator' && token.value === '{') {
    const close = matchingPunctuator(tokens, start, '{', '}');
    return close < 0 ? -1 : close + 1;
  }
  if (token?.type === 'identifier' && token.value === 'if') {
    const conditionOpen = start + 1;
    const conditionClose = matchingPunctuator(tokens, conditionOpen, '(', ')');
    if (conditionClose < 0) return -1;
    const consequentEnd = statementEnd(tokens, conditionClose + 1);
    if (consequentEnd < 0) return -1;
    if (tokens[consequentEnd]?.type === 'identifier' && tokens[consequentEnd].value === 'else') {
      return statementEnd(tokens, consequentEnd + 1);
    }
    return consequentEnd;
  }
  if (token?.type === 'identifier' && new Set(['for', 'while', 'with']).has(token.value)) {
    const conditionOpen = start + 1;
    const conditionClose = matchingPunctuator(tokens, conditionOpen, '(', ')');
    return conditionClose < 0 ? -1 : statementEnd(tokens, conditionClose + 1);
  }
  if (token?.type === 'identifier' && token.value === 'do') {
    const bodyEnd = statementEnd(tokens, start + 1);
    if (bodyEnd < 0
      || tokens[bodyEnd]?.type !== 'identifier'
      || tokens[bodyEnd].value !== 'while') return -1;
    const conditionClose = matchingPunctuator(tokens, bodyEnd + 1, '(', ')');
    if (conditionClose < 0) return -1;
    return tokens[conditionClose + 1]?.type === 'punctuator'
      && tokens[conditionClose + 1].value === ';'
      ? conditionClose + 2
      : conditionClose + 1;
  }
  const depth = { round: 0, square: 0, curly: 0 };
  for (let index = start; index < tokens.length; index += 1) {
    const current = tokens[index];
    if (current?.type !== 'punctuator') continue;
    if (current.value === '(') depth.round += 1;
    else if (current.value === ')') depth.round -= 1;
    else if (current.value === '[') depth.square += 1;
    else if (current.value === ']') depth.square -= 1;
    else if (current.value === '{') depth.curly += 1;
    else if (current.value === '}') depth.curly -= 1;
    if (depth.round < 0 || depth.square < 0 || depth.curly < 0) return -1;
    if (current.value === ';' && depth.round === 0 && depth.square === 0 && depth.curly === 0) return index + 1;
  }
  return -1;
}

function directStatementStarts(tokens) {
  const starts = new Set();
  let cursor = 0;
  while (cursor < tokens.length) {
    while (tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === ';') cursor += 1;
    if (cursor >= tokens.length) break;
    starts.add(cursor);
    const end = statementEnd(tokens, cursor);
    if (end <= cursor) return new Set();
    cursor = end;
  }
  return starts;
}

function directStatementSequenceIndex(tokens, expected) {
  if (expected.length === 0) return -1;
  const statementStarts = directStatementStarts(tokens);
  for (const start of statementStarts) {
    const end = statementEnd(tokens, start);
    if (end === start + expected.length
      && expected.every((token, offset) => sameToken(tokens[start + offset], token))) return start;
  }
  return -1;
}

function includesUnconditionallyReachableStatementSequence(tokens, expected) {
  if (expected.length === 0) return false;
  const statementStarts = directStatementStarts(tokens);
  for (const start of statementStarts) {
    const token = tokens[start];
    if (token?.type === 'identifier' && CALLBACK_PREFIX_CONTROL_FLOW.has(token.value)) break;
    const end = statementEnd(tokens, start);
    if (token?.type !== 'identifier' || token.value !== 'assert') continue;
    const match = tokenSequenceIndex(tokens, expected, start);
    if (match >= start && match + expected.length <= end) return true;
  }
  return false;
}

function conditionalExitGuard(tokens, conditionSource, safeReturns, allowBlockedAuthority = false) {
  const statementStarts = directStatementStarts(tokens);
  let curlyDepth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (curlyDepth === 0
      && statementStarts.has(index)
      && token?.type === 'identifier'
      && token.value === 'if') {
      const conditionOpen = index + 1;
      const conditionClose = matchingPunctuator(tokens, conditionOpen, '(', ')');
      if (conditionClose > conditionOpen
        && sameTokenSequence(tokens.slice(conditionOpen + 1, conditionClose), conditionSource)) {
        const blockOpen = conditionClose + 1;
        const blockClose = matchingPunctuator(tokens, blockOpen, '{', '}');
        if (blockClose > blockOpen) {
          const branch = tokens.slice(blockOpen + 1, blockClose);
          const branchReturns = topLevelReturnStatements(branch);
          const closesSafely = branchReturns.length === 1
            && branchReturns[0].terminated
            && (safeReturns.some((source) => sameTokenSequence(branchReturns[0].expression, source))
              || (allowBlockedAuthority && blockedAuthorityReturn(branchReturns[0].expression)));
          if (closesSafely) return Object.freeze({ start: index, end: blockClose });
        }
      }
    }
    if (token?.type !== 'punctuator') continue;
    if (token.value === '{') curlyDepth += 1;
    else if (token.value === '}') curlyDepth -= 1;
  }
  return null;
}

function topLevelLogicalRanges(tokens, operator) {
  const ranges = [];
  const depth = { round: 0, square: 0, curly: 0 };
  let start = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'punctuator') continue;
    const atBoundary = depth.round === 0 && depth.square === 0 && depth.curly === 0;
    if (atBoundary && token.value === operator) {
      ranges.push(Object.freeze({ start, end: index }));
      start = index + 1;
      continue;
    }
    if (token.value === '(') depth.round += 1;
    else if (token.value === ')') depth.round -= 1;
    else if (token.value === '[') depth.square += 1;
    else if (token.value === ']') depth.square -= 1;
    else if (token.value === '{') depth.curly += 1;
    else if (token.value === '}') depth.curly -= 1;
  }
  ranges.push(Object.freeze({ start, end: tokens.length }));
  return Object.freeze(ranges);
}

function dominatingFailureGuard(tokens, predicateSource, safeReturns, allowBlockedAuthority) {
  const statementStarts = directStatementStarts(tokens);
  let curlyDepth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (curlyDepth === 0 && statementStarts.has(index) && token?.type === 'identifier' && token.value === 'if') {
      const conditionOpen = index + 1;
      const conditionClose = matchingPunctuator(tokens, conditionOpen, '(', ')');
      const blockOpen = conditionClose + 1;
      const blockClose = matchingPunctuator(tokens, blockOpen, '{', '}');
      if (conditionClose > conditionOpen && blockClose > blockOpen) {
        const condition = tokens.slice(conditionOpen + 1, conditionClose);
        const predicateIsTopLevelDisjunct = topLevelLogicalRanges(condition, '||').some((range) => {
          const stripped = stripTransparentRange(condition, range.start, range.end);
          return sameTokenSequence(condition.slice(stripped.start, stripped.end), predicateSource);
        });
        const branchReturns = topLevelReturnStatements(tokens.slice(blockOpen + 1, blockClose));
        const closesSafely = branchReturns.length === 1
          && branchReturns[0].terminated
          && (safeReturns.some((source) => sameTokenSequence(branchReturns[0].expression, source))
            || (allowBlockedAuthority && blockedAuthorityReturn(branchReturns[0].expression)));
        if (predicateIsTopLevelDisjunct && closesSafely) return Object.freeze({ start: index, end: blockClose });
      }
    }
    if (token?.type !== 'punctuator') continue;
    if (token.value === '{') curlyDepth += 1;
    else if (token.value === '}') curlyDepth -= 1;
  }
  return null;
}

function requireFunctionReturnPolicy(findings, tokens, path, options) {
  const body = functionBodyTokens(tokens, options.functionName);
  if (body.length === 0) return;
  const dominancePositions = options.requiredBeforeSuccess.map((source) => (
    tokenSequenceIndex(body, tokenSequence(source))
  )).concat((options.requiredDirectBeforeSuccess || []).map((source) => (
    directStatementSequenceIndex(body, tokenSequence(source))
  )));
  if (dominancePositions.some((index) => index < 0)) return;
  const failureGuards = (options.requiredGuardPredicates || []).map((source) => (
    dominatingFailureGuard(body, source, options.safeReturns, options.allowBlockedAuthority === true)
  ));
  const successGuard = options.successGuard
    ? conditionalExitGuard(
        body,
        options.successGuard.condition,
        options.safeReturns,
        options.allowBlockedAuthority === true,
      )
    : null;
  const successGuardDominated = successGuard !== null
    && dominancePositions.every((index) => index < successGuard.start);

  const statements = returnStatements(body);
  let successfulReturnCount = 0;
  for (const statement of statements) {
    const allowedSafe = options.safeReturns.some((source) => sameTokenSequence(statement.expression, source))
      || (options.allowBlockedAuthority === true && blockedAuthorityReturn(statement.expression));
    const allowedSuccess = options.successReturns.some((source) => sameTokenSequence(statement.expression, source));
    if (!statement.terminated || (!allowedSafe && !allowedSuccess)) {
      findings.push(finding(options.invalidReturnCode, path));
      continue;
    }
    if (allowedSuccess) {
      successfulReturnCount += 1;
      if (dominancePositions.some((index) => index > statement.index)
        || failureGuards.some((guard) => guard === null || guard.end >= statement.index)
        || (options.successGuard && (!successGuardDominated || statement.index <= successGuard.end))) {
        findings.push(finding(options.undominatedSuccessCode, path));
      }
    }
  }
  if (successfulReturnCount !== options.successReturns.length) {
    findings.push(finding(options.successReturnCountCode, path));
  }
}

function functionBodyTokens(tokens, functionName) {
  let matchedBody = null;
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]?.type !== 'identifier' || tokens[index].value !== 'function') continue;
    if (tokens[index + 1]?.type !== 'identifier' || tokens[index + 1].value !== functionName) continue;
    let parametersOpen = index + 2;
    while (parametersOpen < tokens.length
      && !(tokens[parametersOpen]?.type === 'punctuator' && tokens[parametersOpen].value === '(')) parametersOpen += 1;
    if (parametersOpen >= tokens.length) return Object.freeze([]);
    let parameterDepth = 1;
    let parametersClose = parametersOpen + 1;
    for (; parametersClose < tokens.length && parameterDepth > 0; parametersClose += 1) {
      if (tokens[parametersClose]?.type !== 'punctuator') continue;
      if (tokens[parametersClose].value === '(') parameterDepth += 1;
      if (tokens[parametersClose].value === ')') parameterDepth -= 1;
    }
    if (parameterDepth !== 0) return Object.freeze([]);
    let open = parametersClose;
    while (open < tokens.length && !(tokens[open]?.type === 'punctuator' && tokens[open].value === '{')) open += 1;
    if (open >= tokens.length) return Object.freeze([]);
    let depth = 1;
    for (let close = open + 1; close < tokens.length; close += 1) {
      if (tokens[close]?.type !== 'punctuator') continue;
      if (tokens[close].value === '{') depth += 1;
      if (tokens[close].value === '}') depth -= 1;
      if (depth === 0) {
        if (matchedBody !== null) return Object.freeze([]);
        matchedBody = Object.freeze(tokens.slice(open + 1, close));
        index = close;
        break;
      }
    }
    if (depth !== 0) return Object.freeze([]);
  }
  return matchedBody ?? Object.freeze([]);
}

function namedTestBodyTokens(tokens, testName) {
  const bodies = [];
  for (let index = 0; index < tokens.length - 6; index += 1) {
    if (tokens[index]?.type !== 'identifier' || tokens[index].value !== 'test') continue;
    if (tokens[index + 1]?.type !== 'punctuator' || tokens[index + 1].value !== '(') continue;
    if (tokens[index + 2]?.type !== 'string' || tokens[index + 2].value !== testName) continue;
    const callClose = matchingPunctuator(tokens, index + 1, '(', ')');
    if (callClose < 0) continue;
    let arrow = index + 3;
    while (arrow < callClose && !(tokens[arrow]?.type === 'punctuator' && tokens[arrow].value === '=>')) arrow += 1;
    if (arrow >= callClose) continue;
    const bodyOpen = arrow + 1;
    const bodyClose = matchingPunctuator(tokens, bodyOpen, '{', '}');
    if (bodyClose < 0 || bodyClose > callClose) continue;
    bodies.push(Object.freeze(tokens.slice(bodyOpen + 1, bodyClose)));
  }
  return bodies.length === 1 ? bodies[0] : Object.freeze([]);
}

function requireNamedTestBehavior(findings, tokens, path, specifications) {
  for (const specification of specifications) {
    const body = namedTestBodyTokens(tokens, specification.name);
    if (body.length === 0) {
      findings.push(finding(specification.missingCode, path));
      continue;
    }
    for (const [source, code] of specification.assertions) {
      if (!includesUnconditionallyReachableStatementSequence(body, tokenSequence(source))) {
        findings.push(finding(code, path));
      }
    }
  }
}

function requireExecutableSequences(findings, tokens, path, rules) {
  for (const [source, code] of rules) {
    if (!includesTokenSequence(tokens, tokenSequence(source))) findings.push(finding(code, path));
  }
}

function requireFunctionSequences(findings, tokens, path, functionName, missingCode, rules) {
  const body = functionBodyTokens(tokens, functionName);
  if (body.length === 0) {
    findings.push(finding(missingCode, path));
    return;
  }
  requireExecutableSequences(findings, body, path, rules);
}

function parseNamedImportBindings(tokens) {
  const bindings = [];
  let cursor = 1;
  while (cursor < tokens.length - 1) {
    const imported = tokens[cursor];
    if (imported?.type !== 'identifier') return null;
    cursor += 1;
    let local = imported.value;
    if (tokens[cursor]?.type === 'identifier' && tokens[cursor].value === 'as') {
      if (tokens[cursor + 1]?.type !== 'identifier') return null;
      local = tokens[cursor + 1].value;
      cursor += 2;
    }
    bindings.push(Object.freeze({ imported: imported.value, local }));
    if (tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === ',') cursor += 1;
    else if (!(tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === '}')) return null;
  }
  return tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === '}'
    ? Object.freeze(bindings)
    : null;
}

function parseImportBindings(tokens) {
  if (tokens.length === 0) return null;
  const first = tokens[0];
  if (first?.type === 'punctuator' && first.value === '{') return parseNamedImportBindings(tokens);
  if (first?.type === 'punctuator' && first.value === '*') return null;
  if (first?.type !== 'identifier') return null;
  const bindings = [{ imported: 'default', local: first.value }];
  if (tokens.length === 1) return Object.freeze(bindings.map((binding) => Object.freeze(binding)));
  if (!(tokens[1]?.type === 'punctuator' && tokens[1].value === ',')) return null;
  if (tokens[2]?.type === 'punctuator' && tokens[2].value === '{') {
    const named = parseNamedImportBindings(tokens.slice(2));
    return named ? Object.freeze([...bindings.map((binding) => Object.freeze(binding)), ...named]) : null;
  }
  return null;
}

function staticModuleDeclarations(tokens) {
  const declarations = [];
  let valid = true;
  let dynamicLoader = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isImport = token?.type === 'identifier' && token.value === 'import';
    const isReExport = token?.type === 'identifier' && token.value === 'export';
    if (!isImport && !isReExport) continue;
    const next = tokens[index + 1];
    if (isImport && next?.type === 'punctuator' && next.value === '(') {
      dynamicLoader = true;
      continue;
    }
    if (isImport && next?.type === 'string') {
      valid = false;
      continue;
    }
    let from = -1;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === ';') break;
      if (tokens[cursor]?.type === 'identifier'
        && tokens[cursor].value === 'from'
        && tokens[cursor + 1]?.type === 'string') {
        from = cursor;
        break;
      }
    }
    if (isReExport && from < 0) continue;
    const specifier = tokens[from + 1];
    const bindings = from > index + 1
      ? (isImport
        ? parseImportBindings(tokens.slice(index + 1, from))
        : parseNamedImportBindings(tokens.slice(index + 1, from)))
      : null;
    const terminatedExactly = tokens[from + 2]?.type === 'punctuator'
      && tokens[from + 2].value === ';';
    if (!bindings || bindings.length === 0 || specifier?.type !== 'string' || !terminatedExactly) {
      valid = false;
      continue;
    }
    declarations.push(Object.freeze({ specifier: specifier.value, bindings }));
    index = from + 2;
  }
  return Object.freeze({ valid, dynamicLoader, declarations: Object.freeze(declarations) });
}

function reviewLocalModuleAuthority(source, path, findings, importPolicy) {
  const lexical = tokenizeJavaScriptAuthority(source);
  if (!lexical.valid) {
    findings.push(finding('openclaw-provider-pool-javascript-lexical-invalid', path));
    return lexical;
  }
  const authorityStrings = computedAuthorityStrings(lexical.tokens);
  const forbiddenModule = authorityStrings.some((value) => FORBIDDEN_LOCAL_MODULES.has(value));
  const forbiddenComputedGlobal = authorityStrings.some((value) => FORBIDDEN_GLOBAL_CAPABILITIES.has(value));
  const dangerousToken = lexical.tokens.some((token) => (
    token.type === 'identifier'
    && DANGEROUS_AUTHORITY_TOKENS.has(token.value)
  )) || authorityStrings.some((value) => DANGEROUS_AUTHORITY_TOKENS.has(value));
  const forbiddenGlobalReference = lexical.tokens.some((token, index, tokens) => {
    if (token.type !== 'identifier' || !FORBIDDEN_GLOBAL_CAPABILITIES.has(token.value)) return false;
    if (tokens[index - 1]?.type === 'identifier' && tokens[index - 1].value === 'function') return false;
    const objectMemberKey = tokens[index - 1]?.type === 'punctuator'
      && new Set(['{', ',']).has(tokens[index - 1].value)
      && tokens[index + 1]?.type === 'punctuator'
      && new Set([':', '(']).has(tokens[index + 1].value);
    if (objectMemberKey) return false;
    const qualified = tokens[index - 1]?.type === 'punctuator'
      && new Set(['.', '?.']).has(tokens[index - 1].value);
    if (!qualified) return true;
    const receiverIndex = index - 2;
    return tokens[receiverIndex]?.type !== 'identifier'
      || !objectLiteralDefinesMember(tokens, tokens[receiverIndex].value, token.value, receiverIndex);
  });
  const imports = staticModuleDeclarations(lexical.tokens);
  const unapprovedCapability = imports.declarations.some(({ specifier, bindings }) => {
    const allowedBindings = importPolicy[specifier];
    return !allowedBindings || bindings.some(({ imported }) => !allowedBindings.has(imported));
  });
  if (forbiddenModule
    || forbiddenComputedGlobal
    || dangerousToken
    || forbiddenGlobalReference
    || imports.dynamicLoader
    || !imports.valid
    || unapprovedCapability) {
    findings.push(finding('openclaw-provider-pool-local-execution-authority-forbidden', path));
  }
  return lexical;
}

function reviewProviderPool(source, path, findings) {
  const lexical = reviewLocalModuleAuthority(source, path, findings, IMPLEMENTATION_IMPORT_POLICY);
  if (!lexical.valid) return;
  const executionValidationBinding = `const executionValidation = validateExecutionReceipt(execution, {
    repository: expected.repository,
    issueNumber: OPENCLAW_QUALIFICATION_ISSUE,
    expectedHead: expected.sourceHead,
    executionId: qualification.receipt.realWorkTaskId,
  });`;
  const blockedAuthorityValid = blockedAuthoritySemanticsValid(lexical.tokens);
  if (!blockedAuthorityValid) {
    findings.push(finding('openclaw-provider-pool-blocked-authority-semantics-invalid', path));
  }
  requireExecutableSequences(findings, lexical.tokens, path, [
    ["import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';", 'openclaw-provider-pool-canonical-router-missing'],
    ['toSharedWorkspaceExecutionReceipt', 'openclaw-provider-pool-workspace-projection-missing'],
    ['validateSharedWorkspaceRecord', 'openclaw-provider-pool-workspace-validator-missing'],
    ['const OPENCLAW_QUALIFICATION_ISSUE = 1725;', 'openclaw-provider-pool-goal-not-fixed'],
    ['export function validateOpenClawQualificationAuthorityChain', 'openclaw-provider-pool-authority-chain-gate-missing'],
    ['export function validateOpenClawProviderCapacity', 'openclaw-provider-pool-capacity-gate-missing'],
    ['export function routeWithQualifiedOpenClawProvider', 'openclaw-provider-pool-route-gate-missing'],
  ]);
  requireFunctionSequences(findings, lexical.tokens, path,
    'validateOpenClawQualificationAuthorityChain',
    'openclaw-provider-pool-authority-chain-gate-missing', [
    ['issueNumber: OPENCLAW_QUALIFICATION_ISSUE', 'openclaw-provider-pool-execution-goal-binding-missing'],
    ["execution.workerType !== 'openclaw'", 'openclaw-provider-pool-worker-type-binding-missing'],
    ["execution.state !== 'completed'", 'openclaw-provider-pool-completed-execution-gate-missing'],
    ['execution.operatorActionRequired !== false', 'openclaw-provider-pool-operator-action-gate-missing'],
    ['canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)', 'openclaw-provider-pool-canonical-workspace-gate-missing'],
    ["authority.participantId !== 'stephanos'", 'openclaw-provider-pool-stephanos-authority-gate-missing'],
    ['authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)', 'openclaw-provider-pool-authority-goal-binding-missing'],
    ['authority.receivedRecordId !== execution.receiptId', 'openclaw-provider-pool-authority-execution-binding-missing'],
    ['authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION', 'openclaw-provider-pool-production-disposition-gate-missing'],
  ]);
  const authorityBody = functionBodyTokens(lexical.tokens, 'validateOpenClawQualificationAuthorityChain');
  if (directStatementSequenceIndex(authorityBody, tokenSequence(executionValidationBinding)) < 0) {
    findings.push(finding('openclaw-provider-pool-execution-validator-missing', path));
  }
  requireFunctionSequences(findings, lexical.tokens, path,
    'validateOpenClawProviderCapacity',
    'openclaw-provider-pool-capacity-gate-missing', [
    ['candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId', 'openclaw-provider-pool-capacity-authority-binding-missing'],
  ]);
  requireFunctionSequences(findings, lexical.tokens, path,
    'routeWithQualifiedOpenClawProvider',
    'openclaw-provider-pool-route-gate-missing', [
    ['const host = snapshot(trustedHostContext);', 'openclaw-provider-pool-trusted-host-only-gate-missing'],
    ['const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;', 'openclaw-provider-pool-complete-chain-gate-missing'],
    ['mergeAuthority: false', 'openclaw-provider-pool-merge-denial-missing'],
    ['leaseSeizureAllowed: false', 'openclaw-provider-pool-lease-denial-missing'],
    ['duplicateDispatchAllowed: false', 'openclaw-provider-pool-duplicate-dispatch-denial-missing'],
  ]);
  requireFunctionReturnPolicy(findings, lexical.tokens, path, {
    functionName: 'validateOpenClawQualificationAuthorityChain',
    requiredBeforeSuccess: [
      "execution.workerType !== 'openclaw'",
      "execution.state !== 'completed'",
      'execution.operatorActionRequired !== false',
      'canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)',
      "authority.participantId !== 'stephanos'",
      'authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)',
      'authority.receivedRecordId !== execution.receiptId',
      'authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION',
    ],
    requiredDirectBeforeSuccess: [executionValidationBinding],
    requiredGuardPredicates: [
      '!executionValidation.valid',
      "execution.workerType !== 'openclaw'",
      "execution.state !== 'completed'",
      'execution.operatorActionRequired !== false',
      'canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)',
      "authority.participantId !== 'stephanos'",
      'authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)',
      'authority.receivedRecordId !== execution.receiptId',
      'authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION',
    ],
    allowBlockedAuthority: blockedAuthorityValid,
    safeReturns: [],
    successReturns: [`Object.freeze({
      valid: true,
      reason: 'OPENCLAW_QUALIFICATION_AUTHORITY_CHAIN_VALID',
      authorityReceiptId: authority.receiptId,
      realWorkReceiptId: execution.receiptId,
      proofRefs,
    })`],
    invalidReturnCode: 'openclaw-provider-pool-authority-return-shape-invalid',
    undominatedSuccessCode: 'openclaw-provider-pool-authority-success-not-gate-dominated',
    successReturnCountCode: 'openclaw-provider-pool-authority-success-return-count-invalid',
  });
  requireFunctionReturnPolicy(findings, lexical.tokens, path, {
    functionName: 'routeWithQualifiedOpenClawProvider',
    requiredBeforeSuccess: [
      'const base = routeMissionControllerCapacity(input);',
      'const host = snapshot(trustedHostContext);',
      'const qualification = validateOpenClawProviderQualification(host?.qualificationReceipt, expected);',
      'const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;',
      'const selectOpenClaw = openClawPoolEligible && (explicitOpenClawPreference || baseUnavailable);',
    ],
    allowBlockedAuthority: false,
    safeReturns: [
      'Object.freeze({ ...base, providerPoolPreference: preference, openClawPoolEligible: false })',
      `Object.freeze({
        ...base,
        providerPoolPreference: preference,
        openClawPoolEligible,
        openClawQualification: qualification,
        openClawQualificationAuthority: authority,
        openClawCapacity: capacity,
        providerPoolBlockers: Object.freeze(blockers),
      })`,
    ],
    successReturns: [`Object.freeze({
      ...base,
      route: OPENCLAW_PROVIDER_ROUTE,
      adapter: OPENCLAW_PROVIDER_ADAPTER,
      workerId: capacity.receipt.workerId,
      dispatchAllowed: true,
      selectedCapacityReceiptId: capacity.receipt.receiptId,
      selectedQualificationReceiptId: qualification.receipt.qualificationId,
      selectedQualificationAuthorityReceiptId: authority.authorityReceiptId,
      proofRefs: Object.freeze([...new Set([
        ...authority.proofRefs,
        ...capacity.receipt.proofRefs,
      ])]),
      blockers: Object.freeze([]),
      providerPoolPreference: preference,
      openClawPoolEligible: true,
      openClawQualification: qualification,
      openClawQualificationAuthority: authority,
      openClawCapacity: capacity,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
      duplicateDispatchAllowed: false,
      finalVerdict: 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY',
    })`],
    successGuard: Object.freeze({ condition: '!selectOpenClaw' }),
    invalidReturnCode: 'openclaw-provider-pool-route-return-shape-invalid',
    undominatedSuccessCode: 'openclaw-provider-pool-route-success-not-gate-dominated',
    successReturnCountCode: 'openclaw-provider-pool-route-success-return-count-invalid',
  });
}

function reviewProviderPoolTests(source, path, findings) {
  const lexical = reviewLocalModuleAuthority(source, path, findings, TEST_IMPORT_POLICY);
  if (!lexical.valid) return;
  requireExecutableSequences(findings, lexical.tokens, path, [
    ["test('requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt'", 'openclaw-provider-pool-authority-chain-positive-test-missing'],
    ["test('capacity is unusable without the exact validated qualification authority, worker and task class'", 'openclaw-provider-pool-capacity-binding-test-missing'],
    ["test('caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw'", 'openclaw-provider-pool-caller-forgery-test-missing'],
    ["test('syntactically valid trusted qualification without canonical authority cannot route'", 'openclaw-provider-pool-syntax-only-forgery-test-missing'],
    ["test('existing mutation owner is preserved even when OpenClaw is canonically qualified'", 'openclaw-provider-pool-owner-preservation-test-missing'],
    ["test('normal AUTO routing does not silently replace a healthy existing provider policy'", 'openclaw-provider-pool-no-silent-route-replacement-test-missing'],
    ['assert.equal(result.mergeAuthority, false)', 'openclaw-provider-pool-merge-denial-test-missing'],
    ['assert.equal(result.leaseSeizureAllowed, false)', 'openclaw-provider-pool-lease-denial-test-missing'],
    ['assert.equal(result.duplicateDispatchAllowed, false)', 'openclaw-provider-pool-duplicate-dispatch-test-missing'],
  ]);
  requireNamedTestBehavior(findings, lexical.tokens, path, [
    {
      name: 'requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt',
      missingCode: 'openclaw-provider-pool-authority-chain-positive-test-missing',
      assertions: [
        ['assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext(), expected).valid, true)', 'openclaw-provider-pool-authority-chain-positive-assertion-missing'],
        ['expected).valid, false)', 'openclaw-provider-pool-authority-chain-negative-assertion-missing'],
      ],
    },
    {
      name: 'capacity is unusable without the exact validated qualification authority, worker and task class',
      missingCode: 'openclaw-provider-pool-capacity-binding-test-missing',
      assertions: [
        ['assert.equal(validateOpenClawProviderCapacity(capacity(), expected).valid, true)', 'openclaw-provider-pool-capacity-positive-assertion-missing'],
        ["assert.equal(validateOpenClawProviderCapacity(capacity({ qualificationIds: ['foreign-qualification'] }), expected).valid, false)", 'openclaw-provider-pool-capacity-negative-assertion-missing'],
      ],
    },
    {
      name: 'caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw',
      missingCode: 'openclaw-provider-pool-caller-forgery-test-missing',
      assertions: [
        ['assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE)', 'openclaw-provider-pool-caller-forgery-route-assertion-missing'],
        ['assert.equal(result.openClawPoolEligible, false)', 'openclaw-provider-pool-caller-forgery-eligibility-assertion-missing'],
      ],
    },
    {
      name: 'syntactically valid trusted qualification without canonical authority cannot route',
      missingCode: 'openclaw-provider-pool-syntax-only-forgery-test-missing',
      assertions: [
        ['assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE)', 'openclaw-provider-pool-syntax-only-route-assertion-missing'],
        ["assert.ok(result.providerPoolBlockers.includes('openclaw-qualification-authority-not-proven'))", 'openclaw-provider-pool-syntax-only-blocker-assertion-missing'],
      ],
    },
    {
      name: 'existing mutation owner is preserved even when OpenClaw is canonically qualified',
      missingCode: 'openclaw-provider-pool-owner-preservation-test-missing',
      assertions: [
        ['assert.equal(result.dispatchAllowed, false)', 'openclaw-provider-pool-owner-preservation-dispatch-assertion-missing'],
        ["assert.equal(result.adapter, 'chatgpt-github')", 'openclaw-provider-pool-owner-preservation-adapter-assertion-missing'],
      ],
    },
    {
      name: 'normal AUTO routing does not silently replace a healthy existing provider policy',
      missingCode: 'openclaw-provider-pool-no-silent-route-replacement-test-missing',
      assertions: [
        ["assert.equal(result.route, 'CODEX')", 'openclaw-provider-pool-no-silent-route-assertion-missing'],
        ['assert.equal(result.openClawPoolEligible, true)', 'openclaw-provider-pool-no-silent-route-eligibility-assertion-missing'],
      ],
    },
    {
      name: 'selects canonically qualified OpenClaw before Codex exhaustion when the scheduler prefers it',
      missingCode: 'openclaw-provider-pool-authority-denial-test-missing',
      assertions: [
        ['assert.equal(result.mergeAuthority, false)', 'openclaw-provider-pool-merge-denial-test-missing'],
        ['assert.equal(result.leaseSeizureAllowed, false)', 'openclaw-provider-pool-lease-denial-test-missing'],
        ['assert.equal(result.duplicateDispatchAllowed, false)', 'openclaw-provider-pool-duplicate-dispatch-test-missing'],
      ],
    },
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

  if (!exactFindingsArtifactIdentity(
    input.findingsArtifactEvidence,
    input.analysis,
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
  )) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze([finding('openclaw-provider-pool-review-artifact-identity-invalid', paths[0])]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_FINDINGS',
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
  const proofRefs = [
    `proofs/independent-review-artifact/pr-${prNumber}/${branch}@${sourceHead}#${input.findingsArtifactEvidence.payloadSha256}`,
  ];
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
