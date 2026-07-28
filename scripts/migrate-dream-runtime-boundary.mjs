#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DREAM_RUNTIME_MIGRATION_APPROVAL,
  executeDreamRuntimeMigration,
  planDreamRuntimeMigration,
} from '../shared/agents/dreamRuntimeBoundary.mjs';

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
    return (dependencies.executeFn || executeDreamRuntimeMigration)({
      repoRoot,
      operatorApproval: parsed.operatorApproved ? DREAM_RUNTIME_MIGRATION_APPROVAL : '',
    });
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
