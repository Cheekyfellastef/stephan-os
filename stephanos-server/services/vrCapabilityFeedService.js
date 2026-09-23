import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { CONCEPT_CATALOG } from '../../apps/vr-capability-atlas/atlas-concepts.mjs';
import { VR_CAPABILITY_LIVE_FEED_SCHEMA } from '../../shared/agents/vrCapabilityLiveProjectionV1.mjs';
import { projectVrCapabilityLiveTruth } from '../../shared/agents/vrCapabilityLiveTruthV2.mjs';
import {
  readSharedWorkspaceDashboardFeed,
  SHARED_WORKSPACE_FEED_RECORD_SCOPES,
} from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

export const VR_CAPABILITY_FEED_ROUTE = '/api/shared-workspace/vr-capability-feed';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function emptyRecords() {
  return { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [], receiptRecords: [] };
}

export async function readVrCapabilityFeed({ env = process.env, repoRoot = process.cwd(), nowMs = Date.now(), staleAfterMs } = {}) {
  const baseLedger = await readJson(resolve(repoRoot, 'VR-Research-Lab', 'capability-readiness.json'));
  const workspace = await readJson(resolve(repoRoot, 'VR-Research-Lab', 'lab-workspace.json'));
  const runtimeConfig = await validateExistingSharedWorkspaceRuntimeConfig({ env, repoRoot });

  let workspaceFeed = null;
  let records = emptyRecords();
  let workspaceState = 'unavailable';
  let workspaceReason = runtimeConfig.reason || 'SHARED_WORKSPACE_UNAVAILABLE';
  if (runtimeConfig.ok) {
    workspaceFeed = await readSharedWorkspaceDashboardFeed({
      root: runtimeConfig.root,
      repoRoot,
      nowMs,
      staleAfterMs,
      recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE,
    });
    records = workspaceFeed.records || records;
    workspaceState = workspaceFeed.state;
    workspaceReason = workspaceFeed.reason;
  }

  const projection = projectVrCapabilityLiveTruth({
    baseLedger,
    baseConcepts: CONCEPT_CATALOG,
    records,
    workspaceConceptCandidates: workspace.conceptCandidates || workspace.vrConceptCandidates || [],
    nowMs,
  });

  return Object.freeze({
    ...projection,
    schemaVersion: VR_CAPABILITY_LIVE_FEED_SCHEMA,
    route: VR_CAPABILITY_FEED_ROUTE,
    readOnly: true,
    workspace: Object.freeze({
      state: workspaceState,
      reason: workspaceReason,
      live: Boolean(runtimeConfig.ok),
      safeWorkspaceRoot: runtimeConfig.safeDisplayPath || 'UNKNOWN',
    }),
  });
}
