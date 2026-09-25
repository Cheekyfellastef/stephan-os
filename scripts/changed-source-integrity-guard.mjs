#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHANGED_SOURCE_INTEGRITY_SCHEMA = 'stephanos.changed-source-integrity.v1';

const SOURCE_EXTENSION = /\.(?:cjs|js|mjs)$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function bounded(value, max = 12000) {
  const normalized = typeof value === 'string' ? value : String(value ?? '');
  return normalized.length <= max ? normalized : normalized.slice(0, max);
}

export function collectChangedJavaScriptFiles({
  baseRef = 'origin/main',
  cwd = process.cwd(),
  execGit = execFileSync,
} = {}) {
  const output = execGit(
    'git',
    ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return Object.freeze(
    [...new Set(
      String(output)
        .split(/\r?\n/)
        .map(text)
        .filter((path) => path && SOURCE_EXTENSION.test(path)),
    )].sort(),
  );
}

export function validateJavaScriptFiles(files = [], {
  cwd = process.cwd(),
  runNodeCheck = (path) => spawnSync(
    process.execPath,
    ['--check', path],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ),
  stat = (path) => lstatSync(path),
} = {}) {
  const checked = [];
  const failures = [];

  for (const path of files) {
    let fileStat;
    try {
      fileStat = stat(path);
    } catch (error) {
      failures.push(Object.freeze({
        path,
        blocker: 'CHANGED_SOURCE_FILE_MISSING',
        detail: bounded(error?.message || error),
      }));
      continue;
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      failures.push(Object.freeze({
        path,
        blocker: 'CHANGED_SOURCE_FILE_NOT_REGULAR',
        detail: 'Changed JavaScript source must be a regular non-symlink file.',
      }));
      continue;
    }

    const result = runNodeCheck(path);
    checked.push(path);
    if (result?.status !== 0) {
      failures.push(Object.freeze({
        path,
        blocker: 'CHANGED_SOURCE_SYNTAX_INVALID',
        detail: bounded(result?.stderr || result?.stdout || `node --check exited ${result?.status}`),
      }));
    }
  }

  return Object.freeze({
    ok: failures.length === 0,
    blocker: failures.length ? 'CHANGED_SOURCE_INTEGRITY_FAILED' : '',
    schemaVersion: CHANGED_SOURCE_INTEGRITY_SCHEMA,
    checked: Object.freeze(checked),
    failures: Object.freeze(failures),
    finalVerdict: failures.length
      ? 'CHANGED_SOURCE_INTEGRITY_BLOCKED'
      : 'CHANGED_SOURCE_INTEGRITY_PASS',
  });
}

export function runChangedSourceIntegrityGuard(options = {}) {
  let files;
  try {
    files = collectChangedJavaScriptFiles(options);
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: 'CHANGED_SOURCE_DIFF_READ_FAILED',
      schemaVersion: CHANGED_SOURCE_INTEGRITY_SCHEMA,
      checked: Object.freeze([]),
      failures: Object.freeze([Object.freeze({
        path: '',
        blocker: 'CHANGED_SOURCE_DIFF_READ_FAILED',
        detail: bounded(error?.stderr || error?.message || error),
      })]),
      finalVerdict: 'CHANGED_SOURCE_INTEGRITY_BLOCKED',
    });
  }
  return validateJavaScriptFiles(files, options);
}

function printResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    for (const failure of result.failures) {
      process.stderr.write(
        `[source-integrity] ${failure.path || '<diff>'}: ${failure.blocker}\n${failure.detail}\n`,
      );
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = runChangedSourceIntegrityGuard();
  printResult(result);
  process.exitCode = result.ok ? 0 : 1;
}
