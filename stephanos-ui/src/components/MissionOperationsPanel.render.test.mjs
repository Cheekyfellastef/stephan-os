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

function missionFixture() {
  return {
    mission: {
      missionId: 'mission-operations-render-proof',
      title: 'Mission Operations render proof',
      intendedOutcome: 'Show deterministic mission progress without relying on operator trust.',
      state: 'AWAITING_APPROVAL',
      currentPhase: 'merge approval',
      nextAction: 'Approve the exact head-bound squash merge token.',
      startedAt: '2026-06-24T19:00:00.000Z',
      updatedAt: '2026-06-24T20:05:00.000Z',
      elapsedSeconds: 3900,
    },
    agent: {
      activeAgentLabel: 'OpenClaw Standalone',
      role: 'github-operator',
      status: 'waiting-for-approval',
      supportingAgents: [
        { agentId: 'codex', label: 'Codex', role: 'builder-reviewer', status: 'complete' },
      ],
    },
    git: {
      branch: 'feature/mission-operations-dashboard-v1',
      baseBranch: 'main',
      headSha: '1'.repeat(40),
      worktreePath: 'configured-isolated-worktree',
      changedFiles: [
        'stephanos-ui/src/components/MissionOperationsPanel.jsx',
        'shared/runtime/missionOperationsProjection.mjs',
      ],
      clean: true,
    },
    pullRequest: {
      number: 1262,
      url: 'https://github.com/Cheekyfellastef/stephan-os/pull/1262',
      state: 'open',
      mergeable: true,
      passingCheckCount: 3,
      requiredCheckCount: 3,
      checks: [
        { id: 'check-build', name: 'Build Stephanos UI', status: 'success', completedAt: '2026-06-24T20:04:00.000Z' },
        { id: 'check-windows', name: 'Signed Windows acceptance', status: 'success', completedAt: '2026-06-24T20:05:00.000Z' },
      ],
    },
    repair: {
      currentRound: 1,
      maximumRounds: 3,
      history: [{ round: 1 }],
    },
    deployment: {
      sync: { status: 'success' },
      build: { status: 'success' },
      verify: { status: 'success' },
      restart: { status: 'pending' },
    },
    approvals: [
      {
        approvalId: 'merge-test',
        kind: 'squash-merge',
        status: 'pending',
        approvalRequired: true,
        requiredToken: privateToken,
      },
    ],
    receipts: [
      {
        receiptId: 'receipt-acceptance',
        receiptType: 'signed-windows-acceptance',
        status: 'PASS',
        source: 'openclaw-standalone',
        sha256: 'a'.repeat(64),
        path: 'receipt://acceptance.json',
        createdAt: '2026-06-24T20:05:00.000Z',
      },
    ],
    blockers: ['Exact operator approval is still required.'],
    warnings: ['A previous approval token was bound to a stale head SHA.'],
  };
}

test('MissionSummary renders operational truth and a private approval input without exposing the token', async () => {
  const vite = await createServer({
    root: uiRoot,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });

  try {
    const { MissionSummary } = await vite.ssrLoadModule('/src/components/MissionOperationsPanel.jsx');
    const markup = renderToStaticMarkup(React.createElement(MissionSummary, { mission: missionFixture() }));

    for (const visibleValue of [
      'Mission Operations render proof',
      'mission-operations-render-proof',
      'Show deterministic mission progress without relying on operator trust.',
      'AWAITING_APPROVAL',
      'merge approval',
      'OpenClaw Standalone',
      'github-operator',
      'Codex',
      'feature/mission-operations-dashboard-v1',
      'main',
      '1111111111111111111111111111111111111111',
      'configured-isolated-worktree',
      'MissionOperationsPanel.jsx',
      '#1262',
      'Build Stephanos UI',
      'Signed Windows acceptance',
      '3/3',
      '1/3',
      'sync:success',
      'build:success',
      'verify:success',
      'restart:pending',
      'Private head-bound approval token',
      'Approve exact PR head',
      'signed-windows-acceptance',
      'receipt://acceptance.json',
      'Approve the exact head-bound squash merge token.',
      'Exact operator approval is still required.',
      'A previous approval token was bound to a stale head SHA.',
    ]) {
      assert.equal(markup.includes(visibleValue), true, `missing rendered value: ${visibleValue}`);
    }

    assert.match(markup, /type="password"/);
    assert.match(markup, /href="https:\/\/github\.com\/Cheekyfellastef\/stephan-os\/pull\/1262"/);
    assert.match(markup, /data-mission-state="AWAITING_APPROVAL"/);
    assert.equal(markup.includes(privateToken), false);
    assert.doesNotMatch(markup, /javascript:/i);
  } finally {
    await vite.close();
  }
});
