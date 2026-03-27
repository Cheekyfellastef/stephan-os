import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const IMPORT_START_PATTERN = /^\s*import(?:\s+|\{|'|")/;
const IMPORT_FROM_PATTERN = /^\s*import\s+([\s\S]+?)\s+from\s+['"][^'"]+['"]\s*;?\s*$/;
const SIDE_EFFECT_IMPORT_PATTERN = /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/;

const TARGET_DIRECTORIES = ['modules', 'system', 'shared', 'scripts'];

function splitTopLevelByComma(input) {
  const parts = [];
  let current = '';
  let braceDepth = 0;

  for (const char of input) {
    if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (char === ',' && braceDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function normalizeIdentifier(candidate) {
  const match = candidate.trim().match(/[A-Za-z_$][\w$]*/);
  return match ? match[0] : null;
}

function extractNamedImports(namedClause) {
  const inner = namedClause.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!inner) {
    return [];
  }

  const bindings = [];
  for (const token of inner.split(',')) {
    const cleaned = token.trim();
    if (!cleaned) {
      continue;
    }

    const aliasMatch = cleaned.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (aliasMatch) {
      bindings.push(aliasMatch[2]);
      continue;
    }

    const normalized = normalizeIdentifier(cleaned);
    if (normalized) {
      bindings.push(normalized);
    }
  }

  return bindings;
}

export function extractImportedIdentifiers(importStatement) {
  const compact = importStatement.replace(/\s+/g, ' ').trim();

  if (SIDE_EFFECT_IMPORT_PATTERN.test(compact)) {
    return [];
  }

  const fromMatch = compact.match(IMPORT_FROM_PATTERN);
  if (!fromMatch) {
    return [];
  }

  const clause = fromMatch[1].trim();
  const parts = splitTopLevelByComma(clause);
  const identifiers = [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      identifiers.push(...extractNamedImports(trimmed));
      continue;
    }

    const namespaceMatch = trimmed.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (namespaceMatch) {
      identifiers.push(namespaceMatch[1]);
      continue;
    }

    const normalized = normalizeIdentifier(trimmed);
    if (normalized) {
      identifiers.push(normalized);
    }
  }

  return identifiers;
}

function isIgnorableLine(trimmedLine, state) {
  if (!trimmedLine) {
    return { ignorable: true, state };
  }

  if (state.inBlockComment) {
    if (trimmedLine.includes('*/')) {
      const afterComment = trimmedLine.slice(trimmedLine.indexOf('*/') + 2).trim();
      return {
        ignorable: afterComment.length === 0,
        state: { inBlockComment: false },
      };
    }
    return { ignorable: true, state };
  }

  if (trimmedLine.startsWith('//')) {
    return { ignorable: true, state };
  }

  if (trimmedLine.startsWith('/*')) {
    if (trimmedLine.includes('*/')) {
      const afterComment = trimmedLine.slice(trimmedLine.indexOf('*/') + 2).trim();
      return {
        ignorable: afterComment.length === 0,
        state,
      };
    }
    return { ignorable: true, state: { inBlockComment: true } };
  }

  return { ignorable: false, state };
}

function formatViolation(pathToFile, reason, detail) {
  return {
    file: pathToFile,
    reason,
    detail,
  };
}

function isImportStatementComplete(statement) {
  const compact = statement.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return false;
  }

  if (compact.endsWith(';')) {
    return true;
  }

  return IMPORT_FROM_PATTERN.test(compact) || SIDE_EFFECT_IMPORT_PATTERN.test(compact);
}

export function analyzeImportStructureInSource(source, filePath = '<inline>') {
  const lines = source.split(/\r?\n/);
  const importBindings = new Map();
  const violations = [];
  let firstNonImportLineIndex = null;
  let state = { inBlockComment: false };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const lineNumber = index + 1;

    const ignoreResult = isIgnorableLine(trimmed, state);
    state = ignoreResult.state;

    if (ignoreResult.ignorable) {
      continue;
    }

    const isImport = IMPORT_START_PATTERN.test(trimmed);
    if (isImport) {
      const importLines = [trimmed];
      let importEndIndex = index;
      while (importEndIndex + 1 < lines.length && !isImportStatementComplete(importLines.join('\n'))) {
        importEndIndex += 1;
        importLines.push(lines[importEndIndex].trim());
      }

      const importStatement = importLines.join(' ');

      if (firstNonImportLineIndex !== null) {
        violations.push(formatViolation(
          filePath,
          'import not at top',
          `line ${lineNumber}: ${importStatement}`,
        ));
      }

      const identifiers = extractImportedIdentifiers(importStatement);
      for (const identifier of identifiers) {
        if (importBindings.has(identifier)) {
          const previous = importBindings.get(identifier);
          violations.push(formatViolation(
            filePath,
            'duplicate import',
            `line ${previous.line} and line ${lineNumber}: ${identifier}\n  ${previous.raw}\n  ${importStatement}`,
          ));
        } else {
          importBindings.set(identifier, { line: lineNumber, raw: importStatement });
        }
      }
      index = importEndIndex;
      continue;
    }

    if (firstNonImportLineIndex === null) {
      firstNonImportLineIndex = lineNumber;
    }
  }

  return violations;
}

function collectJsFilesRecursively(directoryPath, collectedFiles = []) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const resolvedPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      collectJsFilesRecursively(resolvedPath, collectedFiles);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (resolvedPath.endsWith('.js') || resolvedPath.endsWith('.mjs')) {
      collectedFiles.push(resolvedPath);
    }
  }

  return collectedFiles;
}

export function scanTargetDirectories(baseDirectory = process.cwd()) {
  const files = [];

  for (const target of TARGET_DIRECTORIES) {
    const fullPath = resolve(baseDirectory, target);
    if (!statSync(fullPath, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    collectJsFilesRecursively(fullPath, files);
  }

  return files;
}

export function runImportGuard(baseDirectory = process.cwd()) {
  const files = scanTargetDirectories(baseDirectory);
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const fileViolations = analyzeImportStructureInSource(source, relative(baseDirectory, file));
    violations.push(...fileViolations);
  }

  for (const violation of violations) {
    console.error('[IMPORT GUARD FAIL]');
    console.error(`file: ${violation.file}`);
    console.error(`reason: ${violation.reason}`);
    console.error(`detail: ${violation.detail}`);
  }

  return {
    clean: violations.length === 0,
    violations,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { clean } = runImportGuard(process.cwd());
  process.exit(clean ? 0 : 1);
}
