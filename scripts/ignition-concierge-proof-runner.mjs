#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const DEFAULT_CHECKS = [
  ['ignition concierge contract', 'node', ['--test', 'shared/agents/ignitionConciergeStatusRouting.test.mjs']],
  ['tmp runtime-state classifier', 'node', ['--test', 'scripts/ignite-stephanos-local.test.mjs', '--test-name-pattern', 'tmp|runtime state']],
  ['launcher PowerShell wall guard', 'node', ['--test', 'scripts/windows-launcher-defaults.test.mjs']],
];

function runCheck([label, command, args]) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false });
  return {
    label,
    command: [command, ...args].join(' '),
    status: result.status,
    signal: result.signal || '',
    ok: result.status === 0,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

export function buildProofComment({ headSha = '', checks = [], generatedAt = new Date().toISOString() } = {}) {
  const pass = checks.every((check) => check.ok);
  const lines = [
    '# Ignition Concierge Proof Runner Transcript',
    '',
    `Generated: ${generatedAt}`,
    `HEAD: ${headSha || 'unknown'}`,
    `Verdict: ${pass ? 'PASS' : 'FAIL'}`,
    '',
    '## Exact-head merge approval boundary',
    '',
    '- Merge remains blocked until the operator runs the Windows exact-head local proof helper against this exact HEAD SHA.',
    '- The helper does not merge, push, unlock OpenClaw, or bypass operator approval.',
    '',
    '## Checks',
    '',
  ];

  for (const check of checks) {
    lines.push(`### ${check.ok ? 'PASS' : 'FAIL'} — ${check.label}`);
    lines.push('');
    lines.push(`Command: \`${check.command}\``);
    lines.push(`Exit: ${check.status}${check.signal ? ` (${check.signal})` : ''}`);
    if (check.stdout.trim()) {
      lines.push('', '<details><summary>stdout</summary>', '', '```text', check.stdout.trimEnd(), '```', '</details>');
    }
    if (check.stderr.trim()) {
      lines.push('', '<details><summary>stderr</summary>', '', '```text', check.stderr.trimEnd(), '```', '</details>');
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

export function runIgnitionConciergeProof({ env = process.env } = {}) {
  const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  const checks = DEFAULT_CHECKS.map(runCheck);
  const comment = buildProofComment({ headSha, checks });
  const artifactPath = env.STEPHANOS_IGNITION_PROOF_COMMENT || 'tmp/ignition-concierge-proof-comment.md';
  mkdirSync(artifactPath.slice(0, artifactPath.lastIndexOf('/')) || '.', { recursive: true });
  writeFileSync(artifactPath, comment, 'utf8');
  console.log(`[IGNITION CONCIERGE PROOF] comment artifact: ${artifactPath}`);
  console.log(`[IGNITION CONCIERGE PROOF] verdict: ${checks.every((check) => check.ok) ? 'PASS' : 'FAIL'}`);
  return { artifactPath, headSha, checks };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runIgnitionConciergeProof();
  process.exitCode = result.checks.every((check) => check.ok) ? 0 : 1;
}
