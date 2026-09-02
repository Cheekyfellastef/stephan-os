import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VR_RESEARCH_AGENT_ACTIONS,
  VR_RESEARCH_AGENT_ID,
  VR_RESEARCH_AGENT_ROUTES,
  VR_RESEARCH_AGENT_VERDICTS,
  VR_RESEARCH_PUBLICATION_STATES,
  buildVrResearchAgentReadModel,
  createVrResearchAgentCapabilityRecord,
  createVrResearchAgentWorkspaceRecords,
  planVrResearchAgentCycle,
  selectVrResearchPublicationRoute,
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
    runtimeEvidenceRequests: [],
    ...overrides,
  };
}

function registry() {
  return {
    schema_version: '1.6',
    sources: [
      { source_id: 'halo', licence: 'MIT' },
      { source_id: 'openxr', licence: 'Apache-2.0' },
      { source_id: 'virtual-desktop', licence: 'Commercial proprietary' },
      { source_id: 'higgs', licence: 'GPL-3.0' },
    ],
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
  assert.equal(cycle.proposal.publication.required, true);
  assert.equal(cycle.proposal.publication.targetIssue, '#1596');
  assert.equal(cycle.proposal.publication.state, VR_RESEARCH_PUBLICATION_STATES.ROUTABLE);
  assert.equal(cycle.proposal.publication.route, VR_RESEARCH_AGENT_ROUTES.GITHUB_FIRST);
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

test('blocked ChatGPT GitHub writes fail over to qualified non-OpenAI publication routes', () => {
  const blocked = { chatgptGithubCommentWrite: false };
  assert.equal(
    selectVrResearchPublicationRoute({ availableSurfaces: { ...blocked, githubNativePublisher: true } }),
    VR_RESEARCH_AGENT_ROUTES.GITHUB_NATIVE,
  );
  assert.equal(
    selectVrResearchPublicationRoute({ availableSurfaces: { ...blocked, openClawPublisher: true } }),
    VR_RESEARCH_AGENT_ROUTES.OPENCLAW_LOCAL,
  );
  assert.equal(
    selectVrResearchPublicationRoute({ availableSurfaces: { ...blocked, forgePublisher: true } }),
    VR_RESEARCH_AGENT_ROUTES.FORGE,
  );
  assert.equal(
    selectVrResearchPublicationRoute({ availableSurfaces: { ...blocked, stephanosNativePublisher: true } }),
    VR_RESEARCH_AGENT_ROUTES.STEPHANOS_NATIVE,
  );
});

test('blocked ChatGPT GitHub write with no qualified publisher preserves discovery for later publication', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: freshProjection({ discoveryCandidates: [{ id: 'candidate-uevr-d3d12-state' }] }),
    sourceRegistry: registry(),
    availableSurfaces: { chatgptGithubCommentWrite: false },
  });
  assert.equal(cycle.proposal.action, VR_RESEARCH_AGENT_ACTIONS.TRIAGE_DISCOVERY);
  assert.equal(cycle.proposal.publication.required, true);
  assert.equal(cycle.proposal.publication.route, VR_RESEARCH_AGENT_ROUTES.SHARED_WORKSPACE_PENDING);
  assert.equal(cycle.proposal.publication.state, VR_RESEARCH_PUBLICATION_STATES.PRESERVED_PENDING_WRITER);
  assert.equal(cycle.proposal.publication.candidatePreserved, true);
  assert.deepEqual(cycle.proposal.publication.candidateIds, ['candidate-uevr-d3d12-state']);
  assert.equal(cycle.proposal.publication.targetIssue, '#1596');
  assert.equal(cycle.proposal.publication.mergeAuthority, false);
  assert.equal(cycle.proposal.publication.sourceMutationAuthority, false);
  assert.equal(cycle.proposal.publication.runtimeAuthority, false);
});

test('publication deduplication identity survives provider failover', () => {
  const base = {
    nowMs: NOW,
    workspaceProjection: freshProjection({
      discoveryCandidates: [
        { id: 'candidate-a' },
        { id: 'candidate-b' },
      ],
    }),
    sourceRegistry: registry(),
  };
  const githubNative = planVrResearchAgentCycle({
    ...base,
    availableSurfaces: { chatgptGithubCommentWrite: false, githubNativePublisher: true },
  });
  const openClaw = planVrResearchAgentCycle({
    ...base,
    availableSurfaces: { chatgptGithubCommentWrite: false, openClawPublisher: true },
  });
  assert.equal(githubNative.proposal.publication.route, VR_RESEARCH_AGENT_ROUTES.GITHUB_NATIVE);
  assert.equal(openClaw.proposal.publication.route, VR_RESEARCH_AGENT_ROUTES.OPENCLAW_LOCAL);
  assert.equal(
    githubNative.proposal.publication.deduplicationKey,
    openClaw.proposal.publication.deduplicationKey,
  );
});

test('workspace records retain publication state for another participant to pick up', () => {
  const cycle = planVrResearchAgentCycle({
    nowMs: NOW,
    workspaceProjection: freshProjection({ discoveryCandidates: [{ id: 'research-1' }] }),
    sourceRegistry: registry(),
    availableSurfaces: { chatgptGithubCommentWrite: false },
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
  assert.match(records.status.summary, /PROPOSE_DISCOVERY_TRIAGE/);
  const body = JSON.parse(records.status.body);
  assert.equal(body.publication.state, VR_RESEARCH_PUBLICATION_STATES.PRESERVED_PENDING_WRITER);
  assert.equal(body.publication.targetIssue, '#1596');
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
