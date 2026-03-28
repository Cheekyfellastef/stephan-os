import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const SCRIPT_EXTENSIONS = new Set(['.ps1', '.cmd', '.bat']);
const TARGET_DIRECTORIES = ['windows', 'scripts'];

function getFileExtension(filePath) {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot === -1 ? '' : filePath.slice(lastDot).toLowerCase();
}

function collectScriptFilesRecursively(directoryPath, collectedFiles = []) {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const resolvedPath = resolve(directoryPath, entry.name);

    if (entry.isDirectory()) {
      collectScriptFilesRecursively(resolvedPath, collectedFiles);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (SCRIPT_EXTENSIONS.has(getFileExtension(resolvedPath))) {
      collectedFiles.push(resolvedPath);
    }
  }

  return collectedFiles;
}

function getDoubleQuotedSegments(line) {
  const matches = [];
  const regex = /"(?:[^"`]|`.)*"/g;
  let match = regex.exec(line);
  while (match) {
    matches.push({ value: match[0], index: match.index });
    match = regex.exec(line);
  }
  return matches;
}

function findPowerShellInterpolationHazards(line, lineNumber) {
  const hazards = [];
  const stringSegments = getDoubleQuotedSegments(line);

  for (const segment of stringSegments) {
    const content = segment.value.slice(1, -1);

    const colonPattern = /\$([A-Za-z_][\w]*)\:(?=\s|$|["'])/g;
    let colonMatch = colonPattern.exec(content);
    while (colonMatch) {
      hazards.push({
        line: lineNumber,
        rule: 'ps-interpolation-colon',
        detail: `Unsafe PowerShell interpolation near "${colonMatch[0]}". Use \"\${${colonMatch[1]}}:\" when punctuation follows a variable.`,
      });
      colonMatch = colonPattern.exec(content);
    }

    const punctuationPattern = /\$([A-Za-z_][\w]*)([;,.!?])(?![\w])/g;
    let punctuationMatch = punctuationPattern.exec(content);
    while (punctuationMatch) {
      hazards.push({
        line: lineNumber,
        rule: 'ps-interpolation-punctuation',
        detail: `Risky PowerShell interpolation near "${punctuationMatch[0]}". Prefer \"\${${punctuationMatch[1]}}${punctuationMatch[2]}\" to avoid parser ambiguity.`,
      });
      punctuationMatch = punctuationPattern.exec(content);
    }
  }

  return hazards;
}

function isEchoLine(trimmedLine) {
  return /^echo(?:\.|\s|$)/i.test(trimmedLine);
}

function isSafeEchoParenCommand(trimmedLine) {
  return /^echo\s*\(\s*$/i.test(trimmedLine);
}

function getUnescapedParenMatches(line) {
  const matches = [];
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '(' || char === ')') && line[i - 1] !== '^') {
      matches.push({ char, index: i });
    }
  }
  return matches;
}

function findBatchBlockHazards(lines) {
  const hazards = [];
  let blockDepth = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (!trimmed || /^\s*(?:rem\b|::)/i.test(trimmed)) {
      const parens = getUnescapedParenMatches(line);
      for (const match of parens) {
        blockDepth += match.char === '(' ? 1 : -1;
      }
      blockDepth = Math.max(0, blockDepth);
      continue;
    }

    if (blockDepth > 0 && isEchoLine(trimmed) && !isSafeEchoParenCommand(trimmed)) {
      const unsafeParens = getUnescapedParenMatches(line).filter((match) => match.char === '(' || match.char === ')');
      if (unsafeParens.length > 0) {
        const firstUnsafe = unsafeParens[0];
        hazards.push({
          line: lineNumber,
          rule: 'batch-block-unescaped-parenthesis',
          detail: `Unescaped '${firstUnsafe.char}' in echo/log line inside a parenthesized block. Escape literal parentheses as ^( and ^) to prevent cmd parser breaks.`,
        });
      }
    }

    const parens = getUnescapedParenMatches(line);
    for (const match of parens) {
      blockDepth += match.char === '(' ? 1 : -1;
    }
    blockDepth = Math.max(0, blockDepth);
  }

  return hazards;
}

export function analyzeLauncherScriptSource(source, filePath = '<inline>') {
  const ext = getFileExtension(filePath);
  const lines = source.split(/\r?\n/);

  if (ext === '.ps1') {
    return lines.flatMap((line, index) => findPowerShellInterpolationHazards(line, index + 1));
  }

  if (ext === '.cmd' || ext === '.bat') {
    return findBatchBlockHazards(lines);
  }

  return [];
}

export function scanLauncherScriptFiles(baseDirectory = process.cwd()) {
  const files = [];

  for (const target of TARGET_DIRECTORIES) {
    const fullPath = resolve(baseDirectory, target);
    if (!statSync(fullPath, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    collectScriptFilesRecursively(fullPath, files);
  }

  return files;
}

export function runLauncherScriptGuard(baseDirectory = process.cwd()) {
  const files = scanLauncherScriptFiles(baseDirectory);
  const violations = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const fileViolations = analyzeLauncherScriptSource(source, file).map((violation) => ({
      ...violation,
      file: relative(baseDirectory, file),
    }));
    violations.push(...fileViolations);
  }

  for (const violation of violations) {
    console.error('[LAUNCHER SCRIPT GUARD FAIL]');
    console.error(`file: ${violation.file}`);
    console.error(`line: ${violation.line}`);
    console.error(`rule: ${violation.rule}`);
    console.error(`detail: ${violation.detail}`);
  }

  return {
    clean: violations.length === 0,
    violations,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { clean } = runLauncherScriptGuard(process.cwd());
  process.exit(clean ? 0 : 1);
}
