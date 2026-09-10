#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  DREAM_RUNTIME_MIGRATION_APPROVAL,
  executeDreamRuntimeMigration,
  planDreamRuntimeMigration,
} from '../shared/agents/dreamRuntimeBoundary.mjs';

const execFileAsync = promisify(execFile);

export async function resolveDreamMigrationSourceHead(repoRoot, execFileFn = execFileAsync) {
  const gitOptions = {
    encoding: 'utf8',
    windowsHide: true,
  };
  const headResult = await execFileFn('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], gitOptions);
  const sourceHead = String(headResult?.stdout || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) throw new Error('DREAM_VERSIONED_SOURCE_HEAD_UNAVAILABLE');
  const statusResult = await execFileFn('git', [
    '-C', repoRoot,
    'status',
    '--porcelain=v2',
    '--untracked-files=no',
    '--ignore-submodules=none',
    '--',
    '.',
    ':(exclude)memory/.dreams/**',
    ':(exclude)memory/dreaming/**',
  ], gitOptions);
  if (String(statusResult?.stdout || '').trim()) throw new Error('DREAM_VERSIONED_SOURCE_DIRTY');
  const verifiedHeadResult = await execFileFn('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], gitOptions);
  const verifiedSourceHead = String(verifiedHeadResult?.stdout || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(verifiedSourceHead) || verifiedSourceHead !== sourceHead) {
    throw new Error('DREAM_VERSIONED_SOURCE_HEAD_CHANGED_DURING_CLEANLINESS_CHECK');
  }
  return sourceHead;
}

export function parseDreamMigrationArgs(argv = []) {
  const mode = argv.includes('--copy') ? 'copy' : 'plan';
  const operatorApproved = argv.includes('--operator-approved');
  const repoArg = argv.find((value) => value.startsWith('--repo-root='));
  return Object.freeze({
    mode,
    operatorApproved,
    repoRoot: repoArg ? path.resolve(repoArg.slice('--repo-root='.length)) : '',
  });
}

export function serializeDreamMigrationCliResult(result) {
  const serializableResult = result && typeof result === 'object'
    ? { ...result }
    : result;
  if (serializableResult?.ok === false) delete serializableResult.receipt;
  return `${JSON.stringify(serializableResult, null, 2)}\n`;
}

export async function runDreamMigrationCli(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseDreamMigrationArgs(argv);
  const repoRoot = parsed.repoRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (parsed.mode === 'copy') {
    const sourceHeadFn = dependencies.sourceHeadFn || resolveDreamMigrationSourceHead;
    const sourceHead = parsed.operatorApproved
      ? await sourceHeadFn(repoRoot)
      : '';
    return (dependencies.executeFn || executeDreamRuntimeMigration)({
      repoRoot,
      operatorApproval: parsed.operatorApproved ? DREAM_RUNTIME_MIGRATION_APPROVAL : '',
      sourceHead,
      sourceHeadVerifierFn: sourceHeadFn,
    });
  }
  return (dependencies.planFn || planDreamRuntimeMigration)({ repoRoot });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDreamMigrationCli()
    .then((result) => {
      process.stdout.write(serializeDreamMigrationCliResult(result));
      process.exitCode = result?.ok === false ? 1 : 0;
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
