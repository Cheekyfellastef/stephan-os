import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

function createStore(overrides = {}) {
  return {
    uiLayout: { missionPacketQueuePanel: true },
    togglePanel: () => {},
    missionPacketWorkflow: {
      schemaVersion: 1,
      decisions: [],
      proposalQueue: [],
      roadmapQueue: [],
      activity: [],
    },
    applyMissionPacketWorkflowAction: () => {},
    lastExecutionMetadata: null,
    ...overrides,
  };
}

test('MissionPacketQueuePanel renders partial packet truth without crashing', async () => {
  const storeModulePath = path.join(srcRoot, 'test/mockAIStore.js');
  const aliases = {
    '../state/aiStore': storeModulePath,
  };
  const { renderMissionPacketQueuePanel } = await importBundledModule(
    path.join(srcRoot, 'test/renderMissionPacketQueuePanelEntry.jsx'),
    aliases,
    'mission-packet-panel',
  );

  globalThis.__STEPHANOS_TEST_AI_STORE__ = createStore({
    lastExecutionMetadata: {
      proposal_packet_active: true,
      proposal_packet_mode: 'self-build-mission-synthesis',
      proposal_packet_confidence: 'medium',
      proposed_move_id: 'proposal-execution-bridge',
      proposed_move_title: 'Proposal execution bridge',
      proposed_move_rationale: 'High leverage handoff boundary.',
      planning_evidence_sources: ['runtime-status', 'context-assembly'],
      proposal_packet_warnings: ['planning confidence medium'],
      operator_approval_required: true,
      execution_eligible: false,
      codex_handoff_available: false,
    },
  });

  const rendered = renderMissionPacketQueuePanel();
  assert.match(rendered, /Mission Packet \/ Build Queue/);
  assert.match(rendered, /Recommended Move: Proposal execution bridge/);
  assert.match(rendered, /Evidence: runtime-status · context-assembly/);
  assert.match(rendered, /Execution Eligible: false/);
});
