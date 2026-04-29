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
  assert.equal(projection.operatorSurface.openClawAdapterMode, 'design_only');
  assert.equal(projection.operatorSurface.openClawAdapterCanExecute, false);
  assert.equal(projection.readinessSummary.status, 'started');
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

test('agent task projection advances to adapter contract when kill switch is available but adapter contract is missing', () => {
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
      openClawAdapter: {
        adapterMode: 'design_only',
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

  assert.match(projection.readinessSummary.nextAgentTaskAction, /adapter contract/i);
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
      openClawAdapter: {
        adapterMode: 'connected',
        adapterConnectionState: 'connected',
        adapterExecutionMode: 'approval_required',
        adapterRequiredApprovals: ['approve_openclaw_adapter_enable', 'approve_command_execution'],
        adapterSatisfiedApprovals: ['approve_openclaw_adapter_enable'],
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


test('agent task projection exposes openclaw adapter readiness fields', () => {
  const projection = buildAgentTaskProjection({
    model: {
      openClawPolicy: {
        integrationMode: 'local_adapter',
        adapterPresent: true,
        localAdapterAvailable: true,
        requiredApprovals: ['approve_handoff'],
        satisfiedApprovals: ['approve_handoff'],
        killSwitchState: 'disengaged',
        blockers: [],
      },
      openClawAdapter: {
        adapterMode: 'local_stub',
        adapterConnectionState: 'not_connected',
        adapterExecutionMode: 'disabled',
      },
    },
    context: { agentTileProjectionConnected: true },
  });

  assert.equal(projection.readinessSummary.openClawAdapterMode, 'local_stub');
  assert.equal(projection.readinessSummary.openClawAdapterConnectionState, 'not_connected');
  assert.equal(projection.readinessSummary.openClawAdapterCanExecute, false);
});


test('agent task projection exposes OpenClaw adapter stub fields on operator surface', () => {
  const projection = buildAgentTaskProjection({
    model: {
      openClawPolicy: {
        integrationMode: 'local_adapter',
        adapterPresent: true,
        localAdapterAvailable: true,
        requiredApprovals: ['approve_handoff'],
        satisfiedApprovals: ['approve_handoff'],
        killSwitchState: 'disengaged',
        blockers: [],
      },
      openClawAdapter: {
        adapterStub: {
          stubMode: 'local_stub',
          stubStatus: 'health_check_only',
          stubConnectionState: 'local_only',
          stubHealth: 'healthy',
        },
      },
    },
    context: { agentTileProjectionConnected: true },
  });

  assert.equal(projection.operatorSurface.openClawAdapterStubStatus, 'health_check_only');
  assert.equal(projection.operatorSurface.openClawAdapterStubCanExecute, false);
  assert.equal(projection.readinessSummary.openClawAdapterStubConnectionState, 'local_only');
});


test('agent task projection readiness summary exposes OpenClaw stage evidence', () => {
  const projection = buildAgentTaskProjection({
    model: {
      openClawPolicy: {
        integrationMode: 'policy_only',
        killSwitchState: 'available',
        blockers: [],
      },
      openClawAdapter: {
        adapterMode: 'local_stub',
        adapterReadiness: 'contract_defined',
        adapterConnectionState: 'not_connected',
        adapterExecutionMode: 'disabled',
        adapterStub: {
          stubStatus: 'present_disabled',
          stubHealth: 'healthy',
        },
      },
    },
  });

  assert.equal(projection.readinessSummary.openClawStageEvidence.killSwitchState, 'available');
  assert.equal(projection.readinessSummary.openClawStageEvidence.adapterContractPresent, true);
  assert.equal(projection.readinessSummary.openClawStageEvidence.stubPresent, true);
  assert.equal(projection.readinessSummary.openClawStageEvidence.connectionState, 'not_connected');
  assert.equal(projection.readinessSummary.openClawStageEvidence.executionAllowed, false);
  assert.equal(projection.readinessSummary.openClawStageEvidence['openclaw-validation'], 'idle');
});


test('app-style nested healthHandshake endpoint projects openclaw-validation-endpoint available evidence', () => {
  const projection = buildAgentTaskProjection({
    model: {
      openClawAdapter: {
        adapterConnection: {
          healthHandshake: {
            readonlyValidationEndpoint: {
              available: true,
              path: '/api/openclaw/health-handshake/validate-readonly',
              mode: 'local_readonly_probe',
              canExecute: false,
            },
          },
        },
      },
    },
  });

  assert.equal(projection.operatorSurface.openClawReadonlyValidationEndpointAvailable, true);
  assert.equal(projection.operatorSurface.openClawReadonlyValidationEndpointPath, '/api/openclaw/health-handshake/validate-readonly');
  assert.equal(projection.operatorSurface.openClawReadonlyValidationEndpointMode, 'local_readonly_probe');
  assert.equal(projection.operatorSurface.openClawReadonlyValidationEndpointCanExecute, false);
  assert.equal(projection.readinessSummary.openClawStageEvidence['openclaw-validation-endpoint'], 'available');
});
test('agent task projection keeps readonly endpoint missing evidence when canonical nested and flat endpoint fields are absent', () => {
  const projection = buildAgentTaskProjection({
    model: {
      openClawAdapter: {
        adapterConnection: {
          healthHandshake: {},
        },
      },
    },
  });

  assert.equal(projection.operatorSurface.openClawReadonlyValidationEndpointAvailable, false);
  assert.equal(projection.readinessSummary.openClawStageEvidence['openclaw-validation-endpoint'], 'missing');
});
