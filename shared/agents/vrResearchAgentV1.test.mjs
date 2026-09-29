import assert from 'node:assert/strict';
import './vrRuntimeRecoveryClassificationV1.test.mjs';
import test from 'node:test';

import {
  VR_RESEARCH_AGENT_ACTIONS,
  VR_RESEARCH_AGENT_ID,
  VR_RESEARCH_AGENT_ROUTES,
  VR_RESEARCH_AGENT_VERDICTS,
  buildVrResearchAgentReadModel,
  createVrResearchAgentCapabilityRecord,
  createVrResearchAgentWorkspaceRecords,
  planVrResearchAgentCycle,
} from './vrResearchAgentV1.mjs';

const NOW = Date.parse('2026-08-03T14:30:00.000Z');

function freshProjection(overrides = {}) {
  return {
    updatedAt: '2026-08-03T14:20:00.000Z',
    currentTarget: 'Starfield VR',
    programmeStage: 'research-intelligence-buildout',
    researchQueue: [],
    discoveryCandidates: [],
    capabilityGraphCandidates: [],
    methodLibrary: [],
    runtimeEvidenceRequests: [],
    proofRefs: [],
    ...overrides,
  };
}

function registry() {
  return {
    schema_version: '1.6',
    sources: [
      { source_id: 'halo', licence: 'MIT' },
      { source_id: 'openxr', licence: 'Apache-2.0', snapshot_version: '1.1.63' },
      { source_id: 'virtual-desktop', licence: 'Commercial proprietary' },
      { source_id: 'higgs', licence: 'GPL-3.0' },
    ],
  };
}

function teaching() {
  return {
    teachingKey: 'teach:openxr:spatial-container-v1',
    candidateKey: 'vrdisc:openxr:spatial-container-v1',
    sourceId: 'openxr',
    observedIdentity: '1.1.63',
    evidencePlanes: ['NORMATIVE_OR_OFFICIAL_SPECIFICATION', 'STEPHANOS_INFERENCE_OR_PROPOSAL'],
    confidence: 'high-specification; derived-method-bounded',
    licenceBoundary: 'Apache-2.0 specification/source boundary retained.',
    reusableMethod: 'Capability-discover spatial-container support and retain a reversible fallback.',
    applicability: 'Bounded immersive/spatial presentation when the runtime exposes the extension.',
    nonApplicability: 'Does not prove runtime, game or headset support.',
    proofRefs: ['proofs/vr/openxr-spatial-container-1.1.63'],
  };
}

test('capability record is read-first and cannot merge or run arbitrary shell', () => {
  const capability = createVrResearchAgentCapabilityRecord({
    timestampUtc: '2026-08-03T14:30:00.000Z',
  });
  assert.equal(capability.agentId, VR_RESEARCH_AGENT_ID);
  assert.equal(capability.mode, 'read_first');
  assert.equal(capability.trustedBuilder, false);
  assert.equal(capability.mergeAuthority, false);
  assert.equal(capability.arbitraryShellAllowed, false);
});

test('missing canonical projection blocks and proposes workspace refresh', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: true, battleBridge: true },
  });
  assert.equal(cycle.verdict, VR_RESEARCH_AGENT_VERDICTS.WORKSPACE_MISSING);
  assert.equal(cycle.proposal.action, VR_RESEARCH_AGENT_ACTIONS.REFRESH_WORKSPACE);
  assert.equal(cycle.proposal.route, VR_RESEARCH_AGENT_ROUTES.GITHUB_FIRST);
  assert.equal(cycle.proposal.executesRuntime, false);
});

test('stale canonical projection fails closed rather than inventing current research state', () => {
  const readModel = buildVrResearchAgentReadModel({
    nowMs: NOW,
    workspaceProjection: freshProjection({ updatedAt: '2026-08-01T10:00:00.000Z' }),
    sourceRegistry: registry(),
  });
  assert.equal(readModel.ready, false);
  assert.equal(readModel.verdict, VR_RESEARCH_AGENT_VERDICTS.WORKSPACE_STALE);
  assert.deepEqual(readModel.blockers, ['canonical-vr-research-projection-stale']);
});

test('discovery triage can use OpenClaw when available but remains proposal-only', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: freshProjection({ discoveryCandidates: [{ id: 'candidate-halo-theatre' }] }),
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: true, battleBridge: true },
  });
  assert.equal(cycle.proposal.action, VR_RESEARCH_AGENT_ACTIONS.TRIAGE_DISCOVERY);
  assert.equal(cycle.proposal.route, VR_RESEARCH_AGENT_ROUTES.OPENCLAW_LOCAL);
  assert.equal(cycle.proposal.mutatesSource, false);
  assert.equal(cycle.proposal.executesRuntime, false);
  assert.equal(cycle.proposal.mergeAuthority, false);
});

test('OpenClaw absence does not block ordinary GitHub-first research', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: freshProjection({ researchQueue: [{ id: 'research-dialogue-camera' }] }),
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: false, battleBridge: false },
  });
  assert.equal(cycle.proposal.action, VR_RESEARCH_AGENT_ACTIONS.PREPARE_RESEARCH);
  assert.equal(cycle.proposal.route, VR_RESEARCH_AGENT_ROUTES.GITHUB_FIRST);
});

test('runtime and headset proof routes only to the Battle Bridge and waits when unavailable', () => {
  const projection = freshProjection({ runtimeEvidenceRequests: [{ id: 'quest3-air-link-proof' }] });
  const waiting = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: projection,
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: true, battleBridge: false },
  });
  assert.equal(waiting.proposal.action, VR_RESEARCH_AGENT_ACTIONS.REQUEST_RUNTIME_EVIDENCE);
  assert.equal(waiting.proposal.route, VR_RESEARCH_AGENT_ROUTES.WAITING);
  assert.equal(waiting.proposal.requiresOperator, true);

  const routed = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: projection,
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: true, battleBridge: true },
  });
  assert.equal(routed.proposal.route, VR_RESEARCH_AGENT_ROUTES.BATTLE_BRIDGE);
});

test('equivalent research state produces a deterministic proposal identity', () => {
  const input = {
    nowMs: NOW,
    workspaceProjection: freshProjection({ capabilityGraphCandidates: [{ id: 'method-cutscene-theatre' }] }),
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: true, battleBridge: true },
  };
  const first = planVrResearchAgentCycle(input);
  const second = planVrResearchAgentCycle(input);
  assert.equal(first.proposal.actionId, second.proposal.actionId);
  assert.equal(first.proposal.action, VR_RESEARCH_AGENT_ACTIONS.UPDATE_CAPABILITY_GRAPH);
});

test('canonical agent cycle projects valid #1593 teaching into Shared Workspace knowledge and its read model', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    updatedAt: '2026-08-03T14:25:00.000Z',
    workspaceProjection: freshProjection({
      capabilityGraphCandidates: [{ candidateKey: 'existing-capability', reusableMethod: 'Existing capability' }],
      methodLibrary: [{ teachingKey: 'existing-method', reusableMethod: 'Existing method' }],
      proofRefs: ['proofs/vr/existing'],
    }),
    sourceRegistry: registry(),
    teachingRecords: [teaching()],
    availableSurfaces: { openClaw: true, battleBridge: false },
  });

  assert.equal(cycle.vrTeachingWorkspaceProjection.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
  assert.equal(cycle.vrTeachingWorkspaceProjection.projection.methodLibrary.length, 2);
  assert.equal(cycle.vrTeachingWorkspaceProjection.projection.capabilityGraphCandidates.length, 2);
  assert.ok(cycle.vrTeachingWorkspaceProjection.projection.proofRefs.includes('proofs/vr/openxr-spatial-container-1.1.63'));
  assert.ok(cycle.readModel.graphCandidates.some((entry) => entry.candidateKey === 'vrdisc:openxr:spatial-container-v1'));
  assert.equal(cycle.proposal.action, VR_RESEARCH_AGENT_ACTIONS.UPDATE_CAPABILITY_GRAPH);

  const records = createVrResearchAgentWorkspaceRecords({
    cycle,
    timestampUtc: '2026-08-03T14:30:00.000Z',
    correlationId: 'vr-teaching-production-cycle-test',
    validationOptions: { nowMs: NOW },
  });
  assert.equal(records.vrTeachingWorkspaceProjection.projectionReceipt.receiptId, cycle.vrTeachingWorkspaceProjection.projectionReceipt.receiptId);
  const statusBody = JSON.parse(records.status.body);
  assert.equal(statusBody.teachingProjectionVerdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
  assert.equal(statusBody.teachingProjectionReceiptId, cycle.vrTeachingWorkspaceProjection.projectionReceipt.receiptId);
});

test('blocked teaching receipt blocks the production agent cycle before downstream graph action', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    updatedAt: '2026-08-03T14:25:00.000Z',
    workspaceProjection: freshProjection({
      capabilityGraphCandidates: [{ candidateKey: 'existing-capability', reusableMethod: 'Existing capability' }],
      proofRefs: ['proofs/vr/existing'],
    }),
    sourceRegistry: registry(),
    teachingRecords: [{ ...teaching(), observedIdentity: 'not-registered' }],
    availableSurfaces: { openClaw: true, battleBridge: false },
  });

  assert.equal(cycle.vrTeachingWorkspaceProjection.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_BLOCKED');
  assert.equal(cycle.readModel.ready, true);
  assert.equal(cycle.verdict, VR_RESEARCH_AGENT_VERDICTS.INVALID_INPUT);
  assert.equal(cycle.proposal.action, VR_RESEARCH_AGENT_ACTIONS.REFRESH_WORKSPACE);
  assert.equal(cycle.proposal.reason, 'vr-teaching-workspace-projection-blocked');
});

test('workspace records validate against the canonical Shared Agent Workspace contract', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: freshProjection({ researchQueue: [{ id: 'research-1' }] }),
    sourceRegistry: registry(),
    availableSurfaces: { openClaw: false, battleBridge: false },
  });
  const records = createVrResearchAgentWorkspaceRecords({
    cycle,
    timestampUtc: '2026-08-03T14:30:00.000Z',
    correlationId: 'vr-research-agent-v1-test',
    validationOptions: { nowMs: NOW },
  });
  assert.equal(records.validations.capability.valid, true);
  assert.equal(records.validations.status.valid, true);
  assert.equal(records.status.participantId, VR_RESEARCH_AGENT_ID);
  assert.match(records.status.summary, /PROPOSE_RESEARCH_PACKET/);
});
