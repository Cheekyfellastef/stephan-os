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
const FORBIDDEN_GLOBAL_CALLS = new Set(['fetch']);

function readJavaScriptEscapeSequence(source, start) {
  let index = start + 1;
  if (index >= source.length) return { valid: false, end: source.length, value: '' };
  const escaped = source[index];
  if (escaped === '\r' || escaped === '\n') {
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
    if (current === '\r' || current === '\n') return { valid: false, end: source.length, value: '' };
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
      if (current === '\r' || current === '\n') lineTerminatorBeforeNextToken = true;
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
      if (/\r|\n/.test(source.slice(index, close + 2))) lineTerminatorBeforeNextToken = true;
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
    const number = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0] || '';
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

function canPrecedeComputedMember(token) {
  return token?.type === 'identifier'
    || token?.type === 'number'
    || token?.type === 'string'
    || token?.type === 'template'
    || (token?.type === 'punctuator' && new Set([')', ']', '}', '.']).has(token.value));
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
    if (token?.type === 'identifier' || token?.type === 'number') {
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

function computedAuthorityStrings(tokens) {
  const values = [];
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.type !== 'punctuator' || tokens[index].value !== '[') continue;
    if (!canPrecedeComputedMember(tokens[index - 1])) continue;
    const expression = tokens[index + 1];
    const folded = foldConstantStringExpression(tokens, index + 1);
    if (folded && tokens[folded.end]?.type === 'punctuator' && tokens[folded.end].value === ']') {
      values.push(folded.value);
    }
    let depth = 1;
    let closeIndex = -1;
    for (let cursor = index + 1; cursor < tokens.length && depth > 0; cursor += 1) {
      const candidate = tokens[cursor];
      if (candidate?.type === 'template') values.push(...candidate.authorityValues);
      if (candidate?.type !== 'punctuator') continue;
      if (candidate.value === '[') depth += 1;
      if (candidate.value === ']') {
        depth -= 1;
        if (depth === 0) closeIndex = cursor;
      }
    }
    if (closeIndex > index) {
      const memberTokens = tokens.slice(index + 1, closeIndex);
      const aggregateTemplate = memberTokens.at(-1);
      const templateOwnsExpression = aggregateTemplate?.type === 'template'
        && aggregateTemplate.expressionTokenCount === memberTokens.length - 1;
      const pattern = templateOwnsExpression
        ? aggregateTemplate.authorityPatternParts
        : parseComputedAuthorityPattern(tokens, index + 1, closeIndex);
      const authorityNames = [...DANGEROUS_AUTHORITY_TOKENS, ...FORBIDDEN_LOCAL_MODULES];
      if (!pattern) values.push('spawn');
      else for (const authorityName of authorityNames) {
        if (authorityPatternCanResolve(pattern, authorityName)) values.push(authorityName);
      }
    }
    if (expression?.type === 'template') values.push(...expression.authorityValues);
  }
  return Object.freeze(unique(values));
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

function requireFunctionReturnPolicy(findings, tokens, path, options) {
  const body = functionBodyTokens(tokens, options.functionName);
  if (body.length === 0) return;
  const dominancePositions = options.requiredBeforeSuccess.map((source) => (
    tokenSequenceIndex(body, tokenSequence(source))
  ));
  if (dominancePositions.some((index) => index < 0)) return;

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
      if (dominancePositions.some((index) => index > statement.index)) {
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

function staticImportDeclarations(tokens) {
  const declarations = [];
  let valid = true;
  let dynamicLoader = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.type !== 'identifier' || token.value !== 'import') continue;
    const next = tokens[index + 1];
    if (next?.type === 'punctuator' && next.value === '(') {
      dynamicLoader = true;
      continue;
    }
    if (next?.type === 'string') {
      valid = false;
      continue;
    }
    let from = -1;
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor]?.type === 'punctuator' && tokens[cursor].value === ';') break;
      if (tokens[cursor]?.type === 'identifier' && tokens[cursor].value === 'from') {
        from = cursor;
        break;
      }
    }
    const specifier = tokens[from + 1];
    const bindings = from > index + 1 ? parseImportBindings(tokens.slice(index + 1, from)) : null;
    if (!bindings || bindings.length === 0 || specifier?.type !== 'string') {
      valid = false;
      continue;
    }
    declarations.push(Object.freeze({ specifier: specifier.value, bindings }));
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
  const dangerousToken = lexical.tokens.some((token) => (
    token.type === 'identifier'
    && DANGEROUS_AUTHORITY_TOKENS.has(token.value)
  )) || authorityStrings.some((value) => DANGEROUS_AUTHORITY_TOKENS.has(value));
  const forbiddenGlobalReference = lexical.tokens.some((token, index, tokens) => (
    token.type === 'identifier'
    && FORBIDDEN_GLOBAL_CALLS.has(token.value)
    && !(tokens[index - 1]?.type === 'punctuator' && new Set(['.', '?.']).has(tokens[index - 1].value))
    && !(tokens[index - 1]?.type === 'identifier' && tokens[index - 1].value === 'function')
  ));
  const imports = staticImportDeclarations(lexical.tokens);
  const unapprovedCapability = imports.declarations.some(({ specifier, bindings }) => {
    const allowedBindings = importPolicy[specifier];
    return !allowedBindings || bindings.some(({ imported }) => !allowedBindings.has(imported));
  });
  if (forbiddenModule || dangerousToken || forbiddenGlobalReference || imports.dynamicLoader || !imports.valid || unapprovedCapability) {
    findings.push(finding('openclaw-provider-pool-local-execution-authority-forbidden', path));
  }
  return lexical;
}

function reviewProviderPool(source, path, findings) {
  const lexical = reviewLocalModuleAuthority(source, path, findings, IMPLEMENTATION_IMPORT_POLICY);
  if (!lexical.valid) return;
  requireExecutableSequences(findings, lexical.tokens, path, [
    ["import { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';", 'openclaw-provider-pool-canonical-router-missing'],
    ['validateExecutionReceipt', 'openclaw-provider-pool-execution-validator-missing'],
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
      'issueNumber: OPENCLAW_QUALIFICATION_ISSUE',
      "execution.workerType !== 'openclaw'",
      "execution.state !== 'completed'",
      'execution.operatorActionRequired !== false',
      'canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)',
      "authority.participantId !== 'stephanos'",
      'authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)',
      'authority.receivedRecordId !== execution.receiptId',
      'authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION',
    ],
    allowBlockedAuthority: true,
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
