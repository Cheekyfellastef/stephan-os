import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const componentDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(componentDirectory, '../..');

test('Goal Dashboard renders Build Concierge status and next-action rail', async () => {
  const vite = await createServer({ root: uiRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { BuildConciergeRail } = await vite.ssrLoadModule('/src/components/MissionDashboardPanel.jsx');
    const markup = renderToStaticMarkup(React.createElement(BuildConciergeRail, {
      buildConcierge: {
        selectedCandidate: { prNumber: 1391, title: 'Concierge rail candidate', headSha: 'c'.repeat(40), proofCommands: ['npm test'] },
        proofReadiness: 'blocked_or_unknown',
        dirtyTreeStatus: 'dirty',
        exactHeadApproval: { status: 'required', token: 'APPROVE_BATTLE_BRIDGE_EXACT_HEAD_MERGE:1391:' + 'c'.repeat(40) },
        approvalDecision: { approvalToken: 'APPROVE_BATTLE_BRIDGE_EXACT_HEAD_MERGE:1391:' + 'c'.repeat(40), approvalStatus: 'awaiting_operator_token', rejectionStatus: 'not_rejected', uiMergeClaim: false, nextOperatorAction: 'Review proof and provide exact token.' },
        proofPacketSummary: { status: 'not_started', commandCount: 1, browserProof: 'blocked_unavailable', browserProofPacket: { browserProofStatus: 'blocked_unavailable', screenshotUnavailableReason: 'Browser proof runner/runtime unavailable; browser proof was not captured.', checklistStatus: 'unknown', proofUnavailableBlocker: 'Browser proof runner/runtime unavailable; browser proof was not captured.', caveats: ['Runtime not launched.'], consoleErrors: ['console unavailable'] } },
        mergeHoldState: 'HELD_BLOCKED_OR_UNKNOWN',
        postMergeSync: { status: 'implemented_guarded', mergeReceiptObserved: true, pullMain: { status: 'required' }, restartRefresh: { status: 'blocked', pcRestartAllowed: false }, backendFreshnessProof: { status: 'blocked' }, refreshState: { missionOperations: 'blocked', goalDashboard: 'blocked' }, nextOperatorAction: 'Pull main with receipt before claiming sync.' },
        nextOperatorAction: 'Clean or stash intentionally first.',
      },
    }));
    for (const value of ['Build Concierge Status / Next-Action Rail', 'Concierge rail candidate', 'blocked_or_unknown', 'dirty', 'V4', 'Browser Proof Capture', 'V5', 'Auto Pick Next Safe Work', 'V6', 'Operator Approval Surface', 'V6 approval surface', 'awaiting_operator_token', 'not_rejected', 'no UI merge claim', 'V7', 'Post-Merge Sync and Reproof', 'V8', 'Multi-Goal Queue', 'implemented_guarded', 'blocked_unavailable', 'Browser proof runner/runtime unavailable; browser proof was not captured.', 'V7 post-merge sync', 'merge receipt observed', 'V7 pull main', 'required', 'V7 restart/refresh', 'PC restart prohibited', 'V7 backend freshness proof', 'V7 surface refresh', 'Mission Operations blocked', 'Goal Dashboard blocked', 'V8 queue', 'V8 one-active-lane guardrail', 'V8 anti-stall fallback truth', 'implemented_guarded']) {
      assert.equal(markup.includes(value), true, `missing rendered value: ${value}`);
    }
  } finally {
    await vite.close();
  }
});

test('Mission Dashboard shows live Mission Control projection summary', async () => {
  const vite = await createServer({ root: uiRoot, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { BuildConciergeRail } = await vite.ssrLoadModule('/src/components/MissionDashboardPanel.jsx');
    const markup = renderToStaticMarkup(React.createElement(BuildConciergeRail, { buildConcierge: {
      liveGoalProjection: {
        schemaVersion: 'stephanos.live-goal-projection.v1',
        sourceTruth: 'live',
        queuedGoalCount: 2,
        blockedGoalCount: 1,
        completedGoalCount: 1,
        activeProofLane: [{ candidateId: 'bc-goal-live' }],
        currentAgentStates: { operator: { state: 'approval_authority' }, stephanos: { state: 'backend_reachable' }, codex: { state: 'not_dispatched' }, openclaw: { state: 'unknown' }, github: { state: 'unknown' }, battleBridge: { state: 'satisfied' } },
        nextOperatorAction: 'Review live projection.',
      },
    } }));
    for (const value of ['Mission Control Live Projection', 'LIVE', 'Operator state', 'approval_authority', 'Stephanos state', 'backend_reachable', 'Codex state', 'not_dispatched', 'OpenClaw state', 'GitHub state', 'Battle Bridge state', 'Active proof lane', 'bc-goal-live', 'Queued goals', '2', 'Blocked goals', '1', 'Completed goals', 'Review live projection.']) {
      assert.equal(markup.includes(value), true, `missing live Mission Dashboard value: ${value}`);
    }
  } finally {
    await vite.close();
  }
});
