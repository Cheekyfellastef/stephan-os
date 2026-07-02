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
        proofPacketSummary: { status: 'not_started', commandCount: 1, browserProof: 'blocked_unavailable', browserProofPacket: { browserProofStatus: 'blocked_unavailable', screenshotUnavailableReason: 'Browser proof runner/runtime unavailable; browser proof was not captured.', checklistStatus: 'unknown', proofUnavailableBlocker: 'Browser proof runner/runtime unavailable; browser proof was not captured.', caveats: ['Runtime not launched.'], consoleErrors: ['console unavailable'] } },
        mergeHoldState: 'HELD_BLOCKED_OR_UNKNOWN',
        nextOperatorAction: 'Clean or stash intentionally first.',
      },
    }));
    for (const value of ['Build Concierge Status / Next-Action Rail', 'Concierge rail candidate', 'blocked_or_unknown', 'dirty', 'Clean or stash intentionally first.', 'V4', 'Browser Proof Capture', 'V5', 'Auto Pick Next Safe Work', 'V6', 'Operator Approval Surface', 'V7', 'Post-Merge Sync and Reproof', 'V8', 'Multi-Goal Queue', 'implemented_guarded', 'blocked_unavailable', 'Browser proof runner/runtime unavailable; browser proof was not captured.', 'planned_guarded']) {
      assert.equal(markup.includes(value), true, `missing rendered value: ${value}`);
    }
  } finally {
    await vite.close();
  }
});
