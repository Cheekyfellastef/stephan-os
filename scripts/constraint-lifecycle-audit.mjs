#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildConstraintLifecycleAudit,
  classifyConstraintCandidate,
} from '../shared/agents/constraintLifecycleAuditV1.mjs';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.ps1', '.md', '.json']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', 'coverage']);

async function walk(root, current = root, files = []) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, files);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

export async function scanConstraintLifecycleCandidates(repoRoot) {
  const files = await walk(repoRoot);
  const findings = [];

  for (const absolute of files) {
    const content = await fs.readFile(absolute, 'utf8').catch(() => '');
    const relativePath = path.relative(repoRoot, absolute).replaceAll('\\', '/');
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const excerpt = lines[index];
      const context = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3)).join('\n');
      findings.push(...classifyConstraintCandidate({
        file: relativePath,
        line: index + 1,
        excerpt,
        context,
      }));
    }
  }

  return findings;
}

export async function runConstraintLifecycleAudit({ repoRoot, generatedAt } = {}) {
  const findings = await scanConstraintLifecycleCandidates(repoRoot);
  return buildConstraintLifecycleAudit(findings, { generatedAt });
}

function parseArgs(argv) {
  const strict = argv.includes('--strict');
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  return { strict, repoRoot: positional[0] || null };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(args.repoRoot || path.join(scriptDir, '..'));
  const audit = await runConstraintLifecycleAudit({ repoRoot });
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  if (args.strict && audit.unclassifiedCount > 0) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
