import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAiActionContext } from './aiActionContext.js';

test('buildAiActionContext composes mission/workspace/runtime summaries', () => {
  const context = buildAiActionContext({
    missionState: {
      overallSummary: { projectHealth: 'review', completionEstimate: 44, missionNote: 'Keep routing truthful.' },
      milestones: [
        {
          id: 'runtime-truth',
          title: 'Runtime Truth',
          status: 'blocked',
          percentComplete: 41,
          blockerFlag: true,
          blockerDetails: 'Route mismatch',
          dependencies: ['serve-truth'],
          notes: 'Check verify output',
          nextAction: 'Fix route source',
          updatedAt: '2026-03-30T00:00:00.000Z',
        },
      ],
    },
    uiLayout: { missionDashboardPanel: true, toolsPanel: false, commandDeck: true },
    paneLayout: { order: ['aiConsole', 'missionDashboardPanel'] },
    runtimeStatusModel: {
      appLaunchState: 'ready',
      selectedProvider: 'mock',
      routeMode: 'auto',
      finalRoute: {
        routeKind: 'provider',
        requestedProvider: 'mock',
        selectedProvider: 'mock',
        executedProvider: 'mock',
        backendReachable: true,
        preferredTarget: 'http://localhost:4173',
        actualTarget: 'http://localhost:4173',
        source: 'unit-test',
        usable: true,
      },
    },
    commandHistory: [{ id: 'cmd_1', raw_input: '/status', output_text: 'ok', success: true, route: 'system' }],
  });

  assert.equal(context.missingContext.missionState, false);
  assert.equal(context.workspace.openPanelCount, 2);
  assert.equal(context.mission.activeBlockers.length, 1);
  assert.equal(context.recentDiagnostics.commands.length, 1);
});

test('buildAiActionContext reports missing mission/runtime context honestly', () => {
  const context = buildAiActionContext({
    missionState: null,
    uiLayout: null,
    runtimeStatusModel: null,
  });

  assert.equal(context.missingContext.missionState, true);
  assert.equal(context.missingContext.workspaceState, true);
  assert.equal(context.missingContext.runtimeState, true);
  assert.equal(context.mission, null);
});
