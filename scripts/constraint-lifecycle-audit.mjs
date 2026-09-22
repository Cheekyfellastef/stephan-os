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
const PRODUCTION_CODE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.cache', 'dist', 'coverage']);
const FLYWHEEL_ENDPOINT_PATH_PREFIXES = ['shared/agents/', 'shared/runtime/', 'stephanos-server/services/'];
const FLYWHEEL_ENDPOINT_NAME_PATTERN = /(?:GapIntake|ImprovementProposal|ReflectiveMemory|MissionAdmission|ExecutionHandoff|Promotion|Admission|Flywheel|SharedLessons|MethodLibrary)/i;
const IMPORT_SPECIFIER_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const FLYWHEEL_TERMINAL_LEAF_PATTERN = /^\s*\/\/\s*FLYWHEEL-TERMINAL-LEAF:\s*([A-Z0-9][A-Z0-9_-]{2,95})\s*$/m;
const FLYWHEEL_OWNED_GAP_PATTERN = /^\s*\/\/\s*FLYWHEEL-OWNED-GAP:\s*(#[1-9]\d*)\s*->\s*(#[1-9]\d*)\s*$/m;

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

function normalizeRelativePath(value) {
  return value.replaceAll('\\', '/');
}

function isProductionCodeFile(relativePath) {
  if (!PRODUCTION_CODE_EXTENSIONS.has(path.extname(relativePath))) return false;
  return !/(?:^|\/)(?:test|tests|fixtures)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i.test(relativePath);
}

function importedRelativePaths(importerPath, content) {
  const imported = [];
  for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const resolved = normalizeRelativePath(path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier)));
    if (path.posix.extname(resolved)) {
      imported.push(resolved);
      continue;
    }
    for (const extension of PRODUCTION_CODE_EXTENSIONS) imported.push(`${resolved}${extension}`);
    for (const extension of PRODUCTION_CODE_EXTENSIONS) imported.push(`${resolved}/index${extension}`);
  }
  return imported;
}

function explicitFlywheelTerminalLeaf(content = '') {
  const match = FLYWHEEL_TERMINAL_LEAF_PATTERN.exec(String(content));
  return match?.[1] || '';
}

function explicitFlywheelOwnedGap(content = '') {
  const match = FLYWHEEL_OWNED_GAP_PATTERN.exec(String(content));
  if (!match) return null;
  return Object.freeze({
    canonicalOwner: match[1],
    downstreamOwner: match[2],
  });
}

export function detectOrphanFlywheelEndpoints(records = []) {
  const production = records.filter((record) => isProductionCodeFile(record.relativePath));
  const imported = new Set();

  for (const record of production) {
    for (const resolved of importedRelativePaths(record.relativePath, record.content)) imported.add(resolved);
  }

  return production
    .filter((record) => FLYWHEEL_ENDPOINT_PATH_PREFIXES.some((prefix) => record.relativePath.startsWith(prefix)))
    .filter((record) => FLYWHEEL_ENDPOINT_NAME_PATTERN.test(path.posix.basename(record.relativePath)))
    .filter((record) => /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\b/.test(record.content))
    .filter((record) => !imported.has(record.relativePath))
    .filter((record) => !explicitFlywheelTerminalLeaf(record.content))
    .map((record) => {
      const ownedGap = explicitFlywheelOwnedGap(record.content);
      return Object.freeze({
        signalId: ownedGap ? 'OWNED_FLYWHEEL_GAP_SIGNAL' : 'ORPHAN_FLYWHEEL_ENDPOINT_SIGNAL',
        constraintClass: 'FLYWHEEL_CONTINUITY',
        description: ownedGap
          ? 'A flywheel-facing capability is not live-connected yet, but its canonical capability owner and intended downstream owner are declared for governed repair routing.'
          : 'A flywheel-facing module exists and exports capability, but no production module imports it; verify the intended downstream consumer or explicitly mark it as a terminal leaf.',
        file: record.relativePath,
        line: 1,
        excerpt: ownedGap
          ? `Known flywheel gap routes ${ownedGap.canonicalOwner} -> ${ownedGap.downstreamOwner}; no production consumer imports ${path.posix.basename(record.relativePath)} yet.`
          : `No production consumer imports ${path.posix.basename(record.relativePath)}.`,
        lifecycleState: ownedGap ? 'CONDITIONAL_ACTIVE' : null,
        needsLifecycleReview: !ownedGap,
        canonicalOwner: ownedGap?.canonicalOwner || '',
        downstreamOwner: ownedGap?.downstreamOwner || '',
        ownerResolutionRequired: !ownedGap,
      });
    });
}

export async function scanConstraintLifecycleCandidates(repoRoot) {
  const files = await walk(repoRoot);
  const findings = [];
  const records = [];

  for (const absolute of files) {
    const content = await fs.readFile(absolute, 'utf8').catch(() => '');
    const relativePath = normalizeRelativePath(path.relative(repoRoot, absolute));
    records.push({ absolute, relativePath, content });
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

  findings.push(...detectOrphanFlywheelEndpoints(records));
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
