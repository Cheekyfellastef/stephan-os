#!/usr/bin/env node
import { createBattleBridgeMainAdvanceSignal } from '../shared/agents/battleBridgeMainAdvanceSignalV1.mjs';

const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
const token = String(process.env.GITHUB_TOKEN || '').trim();
const prNumber = Number(process.env.STEPHANOS_MAIN_ADVANCE_PR || 0);
const mainHead = String(process.env.STEPHANOS_MAIN_ADVANCE_HEAD || '').trim();
const mergedAtUtc = String(process.env.STEPHANOS_MAIN_ADVANCE_MERGED_AT || '').trim();
const workflowRunId = String(process.env.GITHUB_RUN_ID || '').trim();

if (!token) throw new Error('MAIN_ADVANCE_GITHUB_TOKEN_REQUIRED');

const signal = createBattleBridgeMainAdvanceSignal({
  repository,
  branch: 'main',
  prNumber,
  mainHead,
  mergedAtUtc,
  workflowRunId,
});

const marker = '<!-- stephanos-battle-bridge-main-advance-signal -->';
const fence = '```';
const body = `${marker}\n${fence}json\n${JSON.stringify(signal, null, 2)}\n${fence}`;
const endpoint = 'https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/1507/comments';
const response = await fetch(endpoint, {
  method: 'POST',
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
  const failure = await response.text();
  throw new Error(`MAIN_ADVANCE_SIGNAL_PUBLISH_FAILED:${response.status}:${failure.slice(0, 300)}`);
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
