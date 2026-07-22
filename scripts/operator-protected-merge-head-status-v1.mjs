#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  buildOperatorMergeHeadStatusPayload,
  validateOperatorMergeHeadStatusExecution,
  validateOperatorMergeHeadStatusReadback,
} from '../shared/agents/operatorMergeHeadStatusV1.mjs';

function emit(packet, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  process.exit(exitCode);
}

function fail(message, details = {}) {
  emit({ finalStatus: 'BLOCKED', message, ...details }, 1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    fail('GitHub API command failed.', {
      command: [command, ...args].join(' '),
      exitCode: result.status ?? 1,
      stderr: String(result.stderr || result.error?.message || '').slice(0, 1200),
    });
  }
  return String(result.stdout || '');
}

function parseJson(value, message) {
  try {
    return value.trim() ? JSON.parse(value) : null;
  } catch (error) {
    fail(message, { error: error.message });
  }
}

function api(endpoint, { method = 'GET', fields = [] } = {}) {
  const args = ['api', endpoint, '--method', method];
  for (const [name, value] of fields) args.push('-f', `${name}=${value}`);
  return parseJson(run('gh', args), `GitHub API returned invalid JSON: ${endpoint}`);
}

const mode = String(process.argv[2] || '').trim().toLowerCase();
if (!['pending', 'success'].includes(mode)) fail('Mode must be pending or success.');
if (process.env.GITHUB_ACTIONS !== 'true') fail('Head-status publisher may run only inside GitHub Actions.');
if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_RUN_ID || !process.env.GITHUB_RUN_ATTEMPT) {
  fail('GitHub event and run identity are required.');
}
if (!process.env.GH_TOKEN) fail('GitHub Actions token is required.');

const event = parseJson(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'), 'GitHub event payload was invalid.');
const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const [owner, repo] = repository.split('/');
const prNumber = Number.parseInt(event?.pull_request?.number, 10);
const sourceHead = String(event?.pull_request?.head?.sha || '').trim().toLowerCase();
const runId = Number.parseInt(process.env.GITHUB_RUN_ID, 10);
const runAttempt = Number.parseInt(process.env.GITHUB_RUN_ATTEMPT, 10);
const runUrl = `${String(process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '')}/${repository}/actions/runs/${runId}`;
if (!owner || !repo || !Number.isInteger(prNumber) || prNumber <= 0 || !/^[a-f0-9]{40}$/.test(sourceHead)) {
  fail('Repository or pull-request identity is incomplete.');
}

const pullRequest = api(`repos/${owner}/${repo}/pulls/${prNumber}`);
const mainRef = api(`repos/${owner}/${repo}/git/ref/heads/main`);
const jobs = mode === 'success'
  ? (api(`repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100`)?.jobs || [])
  : [];
const validation = validateOperatorMergeHeadStatusExecution({
  mode,
  job: process.env.GITHUB_JOB,
  eventName: process.env.GITHUB_EVENT_NAME,
  repository,
  runId,
  runAttempt,
  event,
  pullRequest,
  mainRef,
  jobs,
});
if (!validation.ok) fail('Exact-head status publication was rejected.', { validation });

const payload = buildOperatorMergeHeadStatusPayload({ mode, runUrl });
if (!payload.ok) fail('Exact-head status payload was rejected.', { payload });
api(`repos/${owner}/${repo}/statuses/${sourceHead}`, {
  method: 'POST',
  fields: [
    ['state', payload.state],
    ['context', payload.context],
    ['description', payload.description],
    ['target_url', payload.target_url],
  ],
});

const statuses = api(`repos/${owner}/${repo}/commits/${sourceHead}/statuses?per_page=100`);
const readback = validateOperatorMergeHeadStatusReadback(statuses, {
  expectedState: mode,
  expectedSha: sourceHead,
  expectedRunUrl: runUrl,
});
if (!readback.ok) fail('Exact-head status readback was rejected.', { readback });

emit({
  schemaVersion: 'stephanos.operator-merge-head-status.v1',
  finalStatus: mode === 'pending' ? 'EXACT_HEAD_OPERATOR_STATUS_PENDING' : 'EXACT_HEAD_OPERATOR_STATUS_SUCCESS',
  repository,
  prNumber,
  sourceHead,
  baseSha: validation.baseSha,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  status: readback,
});
