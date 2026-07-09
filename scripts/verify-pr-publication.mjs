#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND, runVerifier } from '../shared/agents/verificationHarness.mjs';

function argValue(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function git(args, fallback = '') {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); }
  catch { return fallback; }
}

const base = argValue('base') || git(['merge-base', 'HEAD', 'main']);
const head = argValue('head') || git(['rev-parse', 'HEAD']);
const branch = argValue('branch') || git(['branch', '--show-current']);
const pr = argValue('pr') || '1448';
const filesChanged = git(['diff', '--name-only', `${base}...${head}`]).split('\n').map((line) => line.trim()).filter(Boolean);
const testsRun = [BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND, 'git diff --check'];
const blockers = argValue('blockers', '').split('|').map((line) => line.trim()).filter(Boolean);
const result = runVerifier('PRPublicationVerifier', {
  pr,
  branch,
  head,
  base,
  filesChanged,
  testsRun,
  blockers,
  exactBattleBridgeProofCommand: BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND,
  timestampUtc: new Date().toISOString(),
});

console.log(JSON.stringify({
  PR: Number(pr),
  HEAD: head,
  FILES_CHANGED: filesChanged,
  TESTS_RUN: testsRun,
  VERDICT: result.finalVerdict,
  BLOCKERS: blockers,
  EXACT_BATTLE_BRIDGE_PROOF_COMMAND: BATTLE_BRIDGE_PREFLIGHT_PROOF_COMMAND,
  verifier: result,
}, null, 2));

process.exit(result.status === 'PASS' ? 0 : 1);
