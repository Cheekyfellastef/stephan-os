#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
  PROTECTED_WORKFLOW_DISPATCH_AUTHOR,
  PROTECTED_WORKFLOW_DISPATCH_ISSUE,
  PROTECTED_WORKFLOW_DISPATCH_MARKER,
  PROTECTED_WORKFLOW_DISPATCH_PATH,
  PROTECTED_WORKFLOW_DISPATCH_REPOSITORY,
  buildProtectedWorkflowDispatchReceipt,
  buildProtectedWorkflowDispatchRequest,
  extractProtectedWorkflowDispatch,
  validateProtectedWorkflowDispatch,
} from '../shared/agents/protectedWorkflowDispatchMailboxV1.mjs';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-protected-workflow-dispatch-mailbox-v1';

function text(value) { return String(value ?? '').trim(); }
function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function github(path, { method = 'GET', body = null, expectedStatus = 200 } = {}) {
  const token = text(process.env.GITHUB_TOKEN);
  if (!token) fail('GITHUB_TOKEN_REQUIRED');
  const response = await fetch(`${API}${path}`, {
    method,
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(body === null ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  if (response.status !== expectedStatus) {
    fail('GITHUB_API_REQUEST_FAILED', { path, method, status: response.status, body: raw.slice(0, 500) });
  }
  return raw ? JSON.parse(raw) : null;
}

async function main() {
  const eventPath = text(process.env.GITHUB_EVENT_PATH);
  if (!eventPath) fail('GITHUB_EVENT_PATH_REQUIRED');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const issueNumber = Number(event?.issue?.number || 0);
  const authorLogin = text(event?.comment?.user?.login);
  const body = text(event?.comment?.body);
  const authoredAt = new Date(event?.comment?.created_at || 0);
  const now = new Date();

  if (issueNumber !== PROTECTED_WORKFLOW_DISPATCH_ISSUE
    || authorLogin !== PROTECTED_WORKFLOW_DISPATCH_AUTHOR
    || !body.includes(PROTECTED_WORKFLOW_DISPATCH_MARKER)) {
    console.log(JSON.stringify({ ok: true, verdict: 'PROTECTED_WORKFLOW_DISPATCH_IGNORED' }));
    return;
  }

  const extracted = extractProtectedWorkflowDispatch(body);
  if (!extracted.ok) fail(extracted.blocker, extracted.details);
  const validation = validateProtectedWorkflowDispatch(extracted.command, {
    authorLogin,
    issueNumber,
    now,
    authoredAt,
  });
  if (!validation.ok) fail(validation.blocker, validation.details);
  const command = validation.command;

  const [pull, branch, headCommit] = await Promise.all([
    github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/pulls/${command.prNumber}`),
    github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/branches/main`),
    github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/git/commits/${command.expectedHead}`),
  ]);

  if (pull?.state !== 'open' || pull?.draft !== false || pull?.merged === true) fail('PROTECTED_WORKFLOW_DISPATCH_PR_NOT_READY');
  if (Number(pull?.number) !== command.prNumber) fail('PROTECTED_WORKFLOW_DISPATCH_PR_NUMBER_CHANGED');
  if (pull?.head?.ref !== command.expectedBranch || pull?.head?.sha !== command.expectedHead) {
    fail('PROTECTED_WORKFLOW_DISPATCH_PR_HEAD_CHANGED');
  }
  if (pull?.base?.ref !== 'main' || pull?.base?.sha !== command.expectedBase) fail('PROTECTED_WORKFLOW_DISPATCH_PR_BASE_CHANGED');
  if (branch?.commit?.sha !== command.expectedBase) fail('PROTECTED_WORKFLOW_DISPATCH_MAIN_CHANGED');
  if (headCommit?.tree?.sha !== command.expectedHeadTree) fail('PROTECTED_WORKFLOW_DISPATCH_HEAD_TREE_CHANGED');

  const request = buildProtectedWorkflowDispatchRequest(command);
  if (!request.ok) fail(request.blocker, request.details);
  await github(request.path, { method: request.method, body: request.body, expectedStatus: 204 });

  const receipt = buildProtectedWorkflowDispatchReceipt(command, new Date());
  await github(`/repos/${PROTECTED_WORKFLOW_DISPATCH_REPOSITORY}/issues/${PROTECTED_WORKFLOW_DISPATCH_ISSUE}/comments`, {
    method: 'POST',
    body: {
      body: `<!-- stephanos-protected-workflow-dispatch-receipt -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
    },
    expectedStatus: 201,
  });

  console.log(JSON.stringify({ ok: true, verdict: 'PROTECTED_WORKFLOW_DISPATCHED', receipt }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    verdict: 'PROTECTED_WORKFLOW_DISPATCH_BLOCKED',
    blocker: error?.message || String(error),
    details: error?.details || {},
  }));
  process.exitCode = 1;
});
