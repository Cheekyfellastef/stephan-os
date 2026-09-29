#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createPRPublicationVerifierResult } from '../shared/agents/verificationHarness.mjs';

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tryRun(command, args) {
  try { return run(command, args); } catch { return ''; }
}

function parseCommits(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    return Array.isArray(parsed?.commits) ? parsed.commits.map((commit) => commit?.oid).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const prNumber = flag('--pr') || process.env.PR_NUMBER;
const headBranch = flag('--branch') || process.env.PR_HEAD_BRANCH || tryRun('git', ['branch', '--show-current']);
const expectedCommit = flag('--expected') || process.env.EXPECTED_COMMIT || tryRun('git', ['rev-parse', 'HEAD']);
const remotePrHeadSha = flag('--remote-pr-head') || process.env.REMOTE_PR_HEAD_SHA || (prNumber ? tryRun('gh', ['pr', 'view', prNumber, '--json', 'headRefOid', '--jq', '.headRefOid']) : '');
const fetchedOriginBranchSha = flag('--origin-branch-head') || process.env.ORIGIN_BRANCH_SHA || (headBranch ? tryRun('git', ['rev-parse', `origin/${headBranch}`]) : '');
const localHeadSha = flag('--local-head') || process.env.LOCAL_HEAD_SHA || tryRun('git', ['rev-parse', 'HEAD']);
const testedHeadSha = flag('--tested-head') || process.env.TESTED_HEAD_SHA || localHeadSha;
const prCommitsJson = prNumber ? tryRun('gh', ['pr', 'view', prNumber, '--json', 'commits']) : '';

const result = createPRPublicationVerifierResult({
  prNumber,
  headBranch,
  expectedCommit,
  remotePrHeadSha,
  fetchedOriginBranchSha,
  localHeadSha,
  testedHeadSha,
  prCommits: parseCommits(prCommitsJson),
}, { timestampUtc: new Date().toISOString() });

console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'PASS' ? 0 : 1);
