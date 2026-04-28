import test from 'node:test';
import assert from 'node:assert/strict';

import { buildShortcutStatusSummary } from './shortcutStatusSummary.mjs';

test('shortcutStatusSummary marks compact status as available when provided', () => {
  const shortcuts = buildShortcutStatusSummary([
    {
      id: 'agent-tile-entry',
      label: 'Agent Tile',
      targetSurface: 'agent-tile',
      present: true,
      statusSummaryAvailable: true,
      compactStatus: 'OpenClaw stub health: healthy',
      evidence: ['Agent tile compact summary wired.'],
    },
  ]);

  assert.equal(shortcuts[0].status, 'present_with_summary');
  assert.equal(shortcuts[0].statusSummaryAvailable, true);
  assert.equal(shortcuts[0].compactStatus, 'OpenClaw stub health: healthy');
});
