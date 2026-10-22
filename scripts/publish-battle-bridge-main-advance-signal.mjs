#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { readMergedMainAdvanceSignalV1 } from '../shared/agents/battleBridgeMainAdvanceSignalV1.mjs';

const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const token = String(process.env.GITHUB_TOKEN || '').trim();
const mainHead = String(process.env.GITHUB_SHA || '').trim();
const workflowRunId = String(process.env.GITHUB_RUN_ID || '').trim();

if (!token) throw new Error('MAIN_ADVANCE_GITHUB_TOKEN_REQUIRED');

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath || statSync(eventPath).size > 256 * 1024) throw new Error('MAIN_ADVANCE_EVENT_FILE_INVALID');
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const headers = {
  Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stephanos-main-advance-signal-v1',
};
async function readJson(path) {
  const response = await fetch('https://api.github.com' + path, {
    headers, redirect: 'error', signal: AbortSignal.timeout(10_000),
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
  console.log(JSON.stringify({ ok: true, finalVerdict: observed.disposition, signalSent: false,
    syncAuthorityGranted: false, runtimeMutationAuthorityGranted: false }));
  process.exit(0);
}
const signal = observed.signal;

const marker = '<!-- stephanos-battle-bridge-main-advance-signal -->';
const fence = '```';
const body = `${marker}\n${fence}json\n${JSON.stringify(signal, null, 2)}\n${fence}`;
const endpoint = `https://api.github.com/repos/${signal.repository}/issues/${signal.issueNumber}/comments`;
const response = await fetch(endpoint, {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(10_000),
  headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'stephanos-main-advance-signal-v1',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ body }),
});

if (!response.ok) {
  throw new Error(`MAIN_ADVANCE_SIGNAL_PUBLISH_FAILED:${response.status}`);
}

const published = await response.json();
console.log(JSON.stringify({
  ok: true,
  finalVerdict: 'BATTLE_BRIDGE_MAIN_ADVANCE_SIGNAL_SENT',
  repository: signal.repository,
  prNumber: signal.prNumber,
  mainHead: signal.mainHead,
  issueNumber: signal.issueNumber,
  commentId: Number(published.id || 0),
  syncIntervalMinutes: signal.syncIntervalMinutes,
  signalOnly: true,
  syncAuthorityGranted: false,
  runtimeMutationAuthorityGranted: false,
}, null, 2));
