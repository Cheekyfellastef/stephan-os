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
  const result = await execFileFn('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  const sourceHead = String(result?.stdout || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) throw new Error('DREAM_VERSIONED_SOURCE_HEAD_UNAVAILABLE');
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

export async function runDreamMigrationCli(argv = process.argv.slice(2), dependencies = {}) {
  const parsed = parseDreamMigrationArgs(argv);
  const repoRoot = parsed.repoRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (parsed.mode === 'copy') {
    const sourceHeadFn = dependencies.sourceHeadFn || resolveDreamMigrationSourceHead;
    const sourceHead = parsed.operatorApproved
      ? await sourceHeadFn(repoRoot)
      : '';
    const result = await (dependencies.executeFn || executeDreamRuntimeMigration)({
      repoRoot,
      operatorApproval: parsed.operatorApproved ? DREAM_RUNTIME_MIGRATION_APPROVAL : '',
      sourceHead,
    });
    if (!parsed.operatorApproved || result?.ok !== true) return result;
    const sourceHeadAfter = await sourceHeadFn(repoRoot);
    if (sourceHeadAfter !== sourceHead) {
      return Object.freeze({
        ...result,
        ok: false,
        finalVerdict: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
        blocker: 'DREAM_MIGRATION_SOURCE_HEAD_CHANGED',
        sourceHeadBefore: sourceHead,
        sourceHeadAfter,
      });
    }
    return result;
  }
  return (dependencies.planFn || planDreamRuntimeMigration)({ repoRoot });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDreamMigrationCli()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result?.ok === false ? 1 : 0;
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
