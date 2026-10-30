#!/usr/bin/env node
// Trusted-main Actions observation. No comment mailbox POST, host command,
// additional worker, scheduler or source-mutation authority.
import { readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readMergedMainAdvanceSignalV1 } from '../shared/agents/battleBridgeMainAdvanceSignalV1.mjs';
import {
  BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_FILE,
  createBattleBridgeMainAdvanceArtifactV1,
} from '../shared/agents/battleBridgeMainAdvanceArtifactV1.mjs';

const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const token = String(process.env.GITHUB_TOKEN || '').trim();
const mainHead = String(process.env.GITHUB_SHA || '').trim();
const workflowRunId = String(process.env.GITHUB_RUN_ID || '').trim();

if (process.env.GITHUB_ACTIONS !== 'true'
    || process.env.GITHUB_REF !== 'refs/heads/main'
    || repository !== 'Cheekyfellastef/stephan-os'
    || !['push', 'workflow_run'].includes(process.env.GITHUB_EVENT_NAME)) {
  throw new Error('MAIN_ADVANCE_TRUSTED_ACTIONS_CONTEXT_REQUIRED');
}
if (!token) throw new Error('MAIN_ADVANCE_GITHUB_TOKEN_REQUIRED');
const checkoutHead = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.env.GITHUB_WORKSPACE,
  encoding: 'utf8',
  timeout: 3000,
  windowsHide: true,
}).trim();
if (checkoutHead !== mainHead) throw new Error('MAIN_ADVANCE_CHECKOUT_SOURCE_MISMATCH');

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || statSync(eventPath).size > 256 * 1024) {
  throw new Error('MAIN_ADVANCE_EVENT_FILE_INVALID');
}
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const headers = {
  Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stephanos-main-advance-signal-v1',
};
async function readJson(path) {
  const response = await fetch('https://api.github.com' + path, {
    method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('MAIN_ADVANCE_GITHUB_READ_REJECTED:' + response.status);
  if (!response.body) throw new Error('MAIN_ADVANCE_GITHUB_BODY_MISSING');
  const reader = response.body.getReader(), chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('MAIN_ADVANCE_GITHUB_BODY_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const observed = await readMergedMainAdvanceSignalV1({
  repository, eventName: process.env.GITHUB_EVENT_NAME, event, mainHead, workflowRunId, readJson,
});
if (!observed.signal) {
  console.log(JSON.stringify({
    ok: true, finalVerdict: observed.disposition, artifactStaged: false,
    commentMailboxPublicationPerformed: false, hostDeliveryState: 'UNKNOWN',
    nativeSyncReceived: false, physicalHostPickupProven: false,
    syncAuthorityGranted: false, runtimeMutationAuthorityGranted: false,
  }));
  process.exit(0);
}

const artifact = createBattleBridgeMainAdvanceArtifactV1(observed.signal);
if (!process.env.RUNNER_TEMP || !process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) {
  throw new Error('MAIN_ADVANCE_ACTIONS_ARTIFACT_OUTPUT_UNAVAILABLE');
}
writeFileSync(resolve(process.env.RUNNER_TEMP, BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_FILE),
  JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '### Stephanos main advanced: mailbox-free GitHub evidence\n\n' +
  'GitHub verified the merged PR and protected main. This is **NOT** proof of Battle Bridge delivery, host sync or executable authority.\n\n' +
  '- PR: #' + artifact.prNumber + '\n' +
  '- Main: `' + artifact.verifiedMainHead + '`\n' +
  '- Host delivery: **UNKNOWN**; existing separately installed one-minute GitHub Sync must supply independent receipt.\n');
appendFileSync(process.env.GITHUB_OUTPUT, 'observation_ready=true\n');
console.log(JSON.stringify({
  ok: true,
  finalVerdict: 'BATTLE_BRIDGE_MAIN_ADVANCE_ARTIFACT_STAGED',
  publicationCarrier: artifact.publicationCarrier,
  repository: artifact.repository,
  prNumber: artifact.prNumber,
  mainHead: artifact.verifiedMainHead,
  workflowRunId: artifact.authenticatedWorkflowRunId,
  artifactStaged: true,
  commentMailboxPublicationPerformed: false,
  hostDeliveryState: 'UNKNOWN',
  nativeSyncReceived: false,
  physicalHostPickupProven: false,
  syncAuthorityGranted: false,
  runtimeMutationAuthorityGranted: false,
}, null, 2));
