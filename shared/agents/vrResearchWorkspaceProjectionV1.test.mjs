import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VR_RESEARCH_DOMAIN_ID,
  VR_RESEARCH_WORKSPACE_SCHEMA_VERSION,
  buildVrResearchWorkspaceProjection,
  createVrResearchProjectionStatusRecord,
} from './vrResearchWorkspaceProjectionV1.mjs';

const UPDATED_AT = '2026-08-03T14:45:00.000Z';

function sourceRegistry() {
  return {
    schema_version: '1.6',
    sources: [
      {
        source_id: 'halo-mcc-vr',
        title: 'Halo MCC VR',
        priority: 'P0',
        status: 'registered-pinned-snapshot',
        licence: 'MIT',
        snapshot_commit: 'abc123',
        refresh_owner: 1596,
        programme_links: [1593, 1596, 1597],
      },
      {
        source_id: 'virtual-desktop',
        title: 'Virtual Desktop',
        priority: 'P0',
        status: 'registered-commercial-operational-evidence',
        licence: 'Commercial proprietary',
        snapshot_version: '1.34.18',
        refresh_owner: 1596,
        programme_links: [1592, 1595, 1596],
      },
      {
        source_id: 'higgs',
        title: 'HIGGS',
        priority: 'P0',
        status: 'registered-native-parity-benchmark',
        licence: 'GPL-3.0',
        snapshot_commit: 'def456',
        refresh_owner: 1596,
        programme_links: [1591, 1593],
      },
    ],
  };
}

function workspaceModel() {
  return {
    schemaVersion: 'stephanos.vr-research-lab.workspace.v2',
    targets: [{ name: 'Starfield' }],
    experiments: [
      {
        id: 'exp-cutscene-theatre',
        title: 'Cutscene theatre adaptation',
        status: 'testing',
        hypothesis: 'Room-fixed stereo theatre preserves comfort.',
        relatedTechniques: ['Presentation Controller'],
      },
      {
        id: 'exp-complete',
        title: 'Finished experiment',
        status: 'validated',
        hypothesis: 'A completed experiment does not remain in the queue.',
      },
    ],
  };
}

test('projection combines the canonical source registry and workspace without private agent state', () => {
  const projection = buildVrResearchWorkspaceProjection({
    sourceRegistry: sourceRegistry(),
    workspaceModel: workspaceModel(),
    updatedAt: UPDATED_AT,
    currentTarget: 'Starfield VR',
    facts: [{ id: 'fact-air-link', evidencePlane: 'OBSERVED_RUNTIME_OR_HEADSET_PROOF' }],
  });

  assert.equal(projection.schemaVersion, VR_RESEARCH_WORKSPACE_SCHEMA_VERSION);
  assert.equal(projection.domainId, VR_RESEARCH_DOMAIN_ID);
  assert.equal(projection.sourceRegistry.sourceCount, 3);
  assert.equal(projection.sourceRegistry.licenceHealth.PERMISSIVE, 1);
  assert.equal(projection.sourceRegistry.licenceHealth.RESTRICTED_OR_ANALYSIS_ONLY, 1);
  assert.equal(projection.sourceRegistry.licenceHealth.COPYLEFT, 1);
  assert.equal(projection.writePolicy.privateAgentStateForbidden, true);
  assert.equal(projection.writePolicy.agentMaySelfPromoteClaims, false);
  assert.equal(projection.writePolicy.mergeAuthority, false);
});

test('only unfinished experiments are projected into the research queue', () => {
  const projection = buildVrResearchWorkspaceProjection({
    sourceRegistry: sourceRegistry(),
    workspaceModel: workspaceModel(),
    updatedAt: UPDATED_AT,
  });
  assert.deepEqual(projection.researchQueue.map((entry) => entry.id), ['exp-cutscene-theatre']);
  assert.equal(projection.researchQueue[0].owner, 'vr-research-agent');
});

test('source health and licence boundaries remain visible', () => {
  const projection = buildVrResearchWorkspaceProjection({
    sourceRegistry: sourceRegistry(),
    workspaceModel: workspaceModel(),
    updatedAt: UPDATED_AT,
  });
  const virtualDesktop = projection.sourceRegistry.sources.find((entry) => entry.sourceId === 'virtual-desktop');
  const halo = projection.sourceRegistry.sources.find((entry) => entry.sourceId === 'halo-mcc-vr');
  assert.equal(virtualDesktop.health, 'REGISTERED_WITH_BOUNDARY');
  assert.equal(virtualDesktop.licenceClass, 'RESTRICTED_OR_ANALYSIS_ONLY');
  assert.equal(halo.health, 'REGISTERED');
  assert.equal(halo.licenceClass, 'PERMISSIVE');
});

test('equivalent canonical inputs produce a stable projection identity', () => {
  const input = {
    sourceRegistry: sourceRegistry(),
    workspaceModel: workspaceModel(),
    updatedAt: UPDATED_AT,
  };
  const first = buildVrResearchWorkspaceProjection(input);
  const second = buildVrResearchWorkspaceProjection(input);
  assert.equal(first.projectionId, second.projectionId);
});

test('projection status record validates against Shared Agent Workspace V1', () => {
  const projection = buildVrResearchWorkspaceProjection({
    sourceRegistry: sourceRegistry(),
    workspaceModel: workspaceModel(),
    updatedAt: UPDATED_AT,
  });
  const result = createVrResearchProjectionStatusRecord({
    projection,
    timestampUtc: UPDATED_AT,
    correlationId: 'vr-research-workspace-projection-test',
    validationOptions: { nowMs: Date.parse(UPDATED_AT) },
  });
  assert.equal(result.validation.valid, true);
  assert.equal(result.record.domainId, VR_RESEARCH_DOMAIN_ID);
  assert.equal(result.record.projectionId, projection.projectionId);
  assert.match(result.record.summary, /3 VR sources/);
});
