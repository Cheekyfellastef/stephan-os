#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { scanConstraintLifecycleCandidates } from './constraint-lifecycle-audit.mjs';

export async function buildFlywheelContinuityReport(repoRoot) {
  const findings = await scanConstraintLifecycleCandidates(repoRoot);
  const continuity = findings
    .filter((finding) => finding.constraintClass === 'FLYWHEEL_CONTINUITY')
    .map((finding) => Object.freeze({
      signalId: finding.signalId,
      file: finding.file,
      line: finding.line,
      description: finding.description,
      excerpt: finding.excerpt,
      lifecycleState: finding.lifecycleState,
      needsLifecycleReview: finding.needsLifecycleReview === true,
    }))
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

  return Object.freeze({
    schemaVersion: 'stephanos.flywheel-continuity-report.v1',
    repositoryRootKind: 'CANONICAL_SOURCE_TREE',
    findingCount: continuity.length,
    files: Object.freeze([...new Set(continuity.map((finding) => finding.file))]),
    findings: Object.freeze(continuity),
    authority: Object.freeze({
      sourceMutationAllowed: false,
      dispatchAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
    }),
  });
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(process.argv[2] || path.join(scriptDir, '..'));
  const report = await buildFlywheelContinuityReport(repoRoot);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
