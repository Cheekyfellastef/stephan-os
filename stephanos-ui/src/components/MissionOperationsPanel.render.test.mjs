import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(componentDirectory, '../..');
const privateToken = `APPROVE_OPENCLAW_SQUASH_MERGE:1262:${'1'.repeat(40)}`;

function fixture() {
  return {
    mission: { missionId: 'mission-operations-render-proof', title: 'Mission Operations render proof', intendedOutcome: 'Show deterministic mission progress without relying on operator trust.', state: 'AWAITING_APPROVAL', currentPhase: 'merge approval', nextAction: 'Approve the exact head-bound squash merge token.', startedAt: '2026-06-24T19:00:00.000Z', updatedAt: '2026-06-24T20:05:00.000Z', elapsedSeconds: 3900 },
    agent: { activeAgentLabel: 'OpenClaw Standalone', role: 'github-operator', status: 'waiting-for-approval', supportingAgents: [{ agentId: 'codex', label: 'Codex', role: 'builder-reviewer', status: 'complete' }] },
    git: { branch: 'feature/mission-operations-dashboard-v1', baseBranch: 'main', headSha: '1'.repeat(40), worktreePath: 'configured-isolated-worktree', changedFiles: ['stephanos-ui/src/components/MissionOperationsPanel.jsx'], clean: true },
    pullRequest: { number: 1262, url: 'https://github.com/Cheekyfellastef/stephan-os/pull/1262', state: 'open', mergeable: true, passingCheckCount: 3, requiredCheckCount: 3, checks: [{ id: 'check-build', name: 'Build Stephanos UI', status: 'success', completedAt: '2026-06-24T20:04:00.000Z' }] },
    approvals: [{ approvalId: 'merge-test', kind: 'squash-merge', status: 'pending', approvalRequired: true, requiredToken: privateToken }],
    receipts: [{ receiptId: 'receipt-acceptance', receiptType: 'signed-windows-acceptance', status: 'PASS', source: 'openclaw-standalone', sha256: 'a'.repeat(64), path: 'receipt://acceptance.json', createdAt: '2026-06-24T20:05:00.000Z' }],
    blockers: ['Exact operator approval is still required.'], warnings: ['A previous approval token was bound to a stale head SHA.'],
  };
}

test('MissionSummary renders operational truth and a private approval input without exposing the token', async () => {
  const vite = await createServer({ root: uiRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { MissionSummary } = await vite.ssrLoadModule('/src/components/MissionOperationsPanel.jsx');
    const markup = renderToStaticMarkup(React.createElement(MissionSummary, { mission: fixture() }));
    for (const value of ['Mission Operations render proof', 'mission-operations-render-proof', 'AWAITING_APPROVAL', 'merge approval', 'OpenClaw Standalone', 'Codex', 'feature/mission-operations-dashboard-v1', '#1262', 'Build Stephanos UI', '3/3', 'signed-windows-acceptance', 'receipt://acceptance.json', 'Private head-bound approval token', 'Approve exact PR head', 'Exact operator approval is still required.']) {
      assert.equal(markup.includes(value), true, `missing rendered value: ${value}`);
    }
    assert.match(markup, /type="password"/);
    assert.match(markup, /href="https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/pull\/1262"/);
    assert.match(markup, /data-mission-state="AWAITING_APPROVAL"/);
    assert.equal(markup.includes(privateToken), false);
    assert.doesNotMatch(markup, /javascript:/i);
  } finally { await vite.close(); }
});
