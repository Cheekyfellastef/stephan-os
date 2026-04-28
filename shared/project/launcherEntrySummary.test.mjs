import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLauncherEntrySummary } from './launcherEntrySummary.mjs';

test('launcherEntrySummary detects compact landing tile summary as present and healthy', () => {
  const summary = buildLauncherEntrySummary({
    landingTileSummary: {
      overallStatus: 'Mission systems: Active',
      nextAction: 'Review mission task truth',
      topBlocker: '',
      safetyLabel: 'Policy-only',
      lines: ['Mission systems: Active', 'Next: Review mission task truth', 'Status: Policy-only'],
      summary: 'Mission systems: Active · Next: Review mission task truth · Status: Policy-only',
    },
    shortcutSurfaces: [
      { id: 'stephanos-tile-entry', label: 'Stephanos Tile', present: true, statusSummaryAvailable: true, evidence: 'Landing tile summary wired.' },
      { id: 'agent-tile-entry', label: 'Agent Tile', present: true, statusSummaryAvailable: true, evidence: 'Agent launcher summary wired.' },
    ],
  });

  assert.equal(summary.systemId, 'launcher-entry');
  assert.equal(summary.landingTilePresent, true);
  assert.equal(summary.compactSummaryAvailable, true);
  assert.equal(summary.landingTileCompact, true);
  assert.equal(summary.diagnosticOverloadRisk, false);
  assert.equal(summary.status, 'ready');
});

test('launcherEntrySummary flags diagnostic overload when verbose diagnostic fields are present', () => {
  const summary = buildLauncherEntrySummary({
    landingTileSummary: {
      overallStatus: 'Mission systems: Active',
      nextAction: 'Review mission task truth',
      topBlocker: '',
      safetyLabel: 'Execution guarded',
      lines: ['Mission systems: Active', 'Next: Review mission task truth', 'Status: Execution guarded'],
      summary: 'Mission systems: Active · Next: Review mission task truth · Status: Execution guarded',
      openclawAdapterMode: 'connected',
      diagnosticTrace: 'verbose dump',
      routeForensics: 'raw diagnostics block',
    },
  });

  assert.equal(summary.diagnosticOverloadRisk, true);
  assert.equal(summary.status, 'degraded');
  assert.match(summary.nextAction, /declutter landing tile/i);
});

test('missing shortcut status creates targeted launcher next action and warning', () => {
  const summary = buildLauncherEntrySummary({
    landingTileSummary: {
      overallStatus: 'Mission systems: Active',
      nextAction: 'Review mission task truth',
      topBlocker: '',
      safetyLabel: 'Policy-only',
      lines: ['Mission systems: Active', 'Next: Review mission task truth', 'Status: Policy-only'],
      summary: 'Mission systems: Active · Next: Review mission task truth · Status: Policy-only',
    },
    shortcutSurfaces: [
      { id: 'stephanos-tile-entry', label: 'Stephanos Tile', present: true, statusSummaryAvailable: true },
      { id: 'agent-tile-entry', label: 'Agent Tile', present: true, statusSummaryAvailable: false },
    ],
  });

  assert.equal(summary.status, 'partial');
  assert.match(summary.nextAction, /agent tile/i);
  assert.ok(summary.warnings.some((entry) => /shortcut status missing/i.test(entry)));
});
