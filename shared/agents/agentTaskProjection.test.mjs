import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentTaskProjection } from './agentTaskProjection.mjs';

test('agent task projection defaults codex to manual handoff and openclaw to needs_policy', () => {
  const projection = buildAgentTaskProjection();
  assert.equal(projection.operatorSurface.codexReadiness, 'manual_handoff_only');
  assert.equal(projection.operatorSurface.openClawReadiness, 'needs_policy');
  assert.equal(projection.operatorSurface.openClawSafeToUse, false);
  assert.equal(projection.operatorSurface.openClawIntegrationMode, 'policy_only');
  assert.equal(projection.compactSurface.agentTaskLayerStatus, 'preparing');
  assert.equal(typeof projection.readinessSummary.readinessScore, 'number');
});

test('agent task projection exposes readiness summary payload for mission dashboard consumption', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskLifecycle: { state: 'in_progress' },
      agentReadiness: {
        stephanos: 'ready',
        codex: 'ready',
        openclaw: 'blocked',
        manual: 'available',
      },
      approvalGates: {
        required: ['approve_scope', 'approve_handoff'],
        approved: ['approve_scope'],
      },
      handoff: {
        handoffReady: false,
        handoffMode: 'manual_prompt',
        handoffBlockers: ['Waiting for approve_handoff.'],
      },
    },
  });

  assert.equal(projection.readinessSummary.agentTaskLayerStatus, 'in_progress');
  assert.equal(projection.readinessSummary.codexReadiness, 'ready');
  assert.equal(projection.readinessSummary.openClawReadiness, 'needs_policy');
  assert.equal(projection.readinessSummary.nextAgentTaskAction.length > 0, true);
  assert.equal(projection.readinessSummary.agentTaskLayerBlockers.length > 0, true);
});

test('agent task projection advances next action beyond policy harness when policy-only harness exists', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskLifecycle: { state: 'in_progress' },
      agentReadiness: {
        stephanos: 'ready',
        codex: 'manual_handoff_only',
        openclaw: 'needs_policy',
        manual: 'available',
      },
      openClawPolicy: {
        integrationMode: 'policy_only',
        requiredApprovals: ['approve_handoff'],
        satisfiedApprovals: ['approve_handoff'],
        killSwitchState: 'missing',
        blockers: [],
      },
      verification: {
        verificationStatus: 'passed',
      },
      verificationReturn: {
        returnStatus: 'verified',
      },
    },
    context: {
      agentTileProjectionConnected: true,
    },
  });

  assert.match(projection.readinessSummary.nextAgentTaskAction, /kill switch/i);
  assert.equal(projection.readinessSummary.openClawSafeToUse, false);
  assert.equal(projection.readinessSummary.openClawExecutionAllowed, false);
});

test('agent task projection advances to adapter when kill switch is available but adapter is missing', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskLifecycle: { state: 'in_progress' },
      openClawPolicy: {
        integrationMode: 'local_adapter',
        adapterPresent: false,
        localAdapterAvailable: false,
        requiredApprovals: ['approve_handoff'],
        satisfiedApprovals: ['approve_handoff'],
        killSwitchState: 'available',
        blockers: [],
      },
      verification: {
        verificationStatus: 'passed',
      },
      verificationReturn: {
        returnStatus: 'verified',
      },
    },
    context: { agentTileProjectionConnected: true },
  });

  assert.match(projection.readinessSummary.nextAgentTaskAction, /local adapter/i);
});

test('agent task projection advances to approvals when adapter exists but approvals are missing', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskLifecycle: { state: 'in_progress' },
      openClawPolicy: {
        integrationMode: 'local_adapter',
        adapterPresent: true,
        localAdapterAvailable: true,
        requiredApprovals: ['approve_handoff', 'approve_command_execution'],
        satisfiedApprovals: ['approve_handoff'],
        killSwitchState: 'available',
        blockers: [],
      },
      verification: {
        verificationStatus: 'passed',
      },
      verificationReturn: {
        returnStatus: 'verified',
      },
    },
    context: { agentTileProjectionConnected: true },
  });

  assert.match(projection.readinessSummary.nextAgentTaskAction, /approval gates/i);
  assert.equal(projection.readinessSummary.openClawExecutionAllowed, false);
});

test('agent task projection exposes codex manual handoff packet summary and packet text', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskIdentity: {
        title: 'Manual handoff',
        operatorIntent: 'Prepare Codex packet.',
      },
      taskLifecycle: { state: 'in_progress' },
      approvalGates: {
        required: ['approve_scope', 'approve_handoff'],
        approved: ['approve_scope', 'approve_handoff'],
      },
      handoff: {
        handoffReady: true,
        handoffTarget: 'codex',
        handoffMode: 'manual_prompt',
      },
    },
  });

  assert.equal(projection.operatorSurface.codexHandoffPacketMode, 'manual_prompt');
  assert.equal(projection.operatorSurface.codexHandoffPacketReady, true);
  assert.match(projection.operatorSurface.codexHandoffPacketSummary, /ready/i);
  assert.match(projection.operatorSurface.codexHandoffPacketText, /Codex Manual Handoff Packet \(v1\)/i);
  assert.equal(projection.readinessSummary.codexManualHandoffReady, true);
});

test('agent task projection exposes verification return summary and missing checks', () => {
  const projection = buildAgentTaskProjection({
    model: {
      taskLifecycle: { state: 'sent_to_agent' },
      approvalGates: {
        required: ['approve_handoff'],
        approved: ['approve_handoff'],
      },
      handoff: {
        handoffTarget: 'codex',
        handoffMode: 'manual_prompt',
        handoffReady: true,
      },
      verificationReturn: {
        returnStatus: 'received',
        returnSource: 'codex_manual',
        returnedSummary: 'Implemented changes.',
        returnedFilesChanged: ['shared/agents/agentTaskProjection.mjs'],
        returnedChecksRun: ['npm run stephanos:build'],
        verificationChecksRequired: ['npm run stephanos:build', 'npm run stephanos:verify'],
        verificationChecksPassed: ['npm run stephanos:build'],
      },
    },
  });

  assert.equal(projection.operatorSurface.verificationReturnStatus, 'verification_required');
  assert.equal(projection.operatorSurface.verificationDecision, 'needs_review');
  assert.equal(projection.operatorSurface.mergeReadiness, 'review_required');
  assert.equal(projection.operatorSurface.missingRequiredChecks.length, 1);
  assert.equal(projection.readinessSummary.verificationReturnReady, true);
});
