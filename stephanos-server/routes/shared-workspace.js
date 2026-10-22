import express from 'express';
import { readCanonicalVrResearchAnswer, VR_RESEARCH_QA_ROUTE } from '../services/vrResearchCanonicalQaService.js';
import { readBackendSharedWorkspaceDashboardFeed } from '../services/sharedWorkspaceDashboardFeedService.js';
import { readVrCapabilityFeed } from '../services/vrCapabilityFeedService.js';
import { readVrPlaytestFeed } from '../services/vrPlaytestFeedService.js';
import { publishSupportSnapshotWorkspaceObservation } from '../services/supportSnapshotSharedWorkspaceBridgeService.js';
import { publishSpatialWorkspaceTelemetry, readSpatialWorkspaceTelemetryFeed } from '../services/spatialWorkspaceTelemetryService.js';
import { readWorkspaceHydrationBundle } from '../services/workspaceHydrationService.js';

export function createSharedWorkspaceRouter({ env = process.env, repoRoot = process.cwd(), nowMs, staleAfterMs } = {}) {
  const router = express.Router();

  router.get('/hydrate', async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    try {
      const workspaceId = String(req.query?.workspace || req.query?.workspaceId || '').trim();
      const datasets = String(req.query?.datasets || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const bundle = await readWorkspaceHydrationBundle({
        workspaceId,
        datasets,
        env,
        repoRoot,
        nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
        staleAfterMs,
      });
      const statusCode = bundle.reason === 'WORKSPACE_ID_REQUIRED'
        ? 400
        : bundle.state === 'unavailable'
          ? 503
          : 200;
      res.status(statusCode).json(bundle);
    } catch (error) {
      res.status(503).json({
        schemaVersion: 'stephanos.workspace-hydration.v1',
        route: '/api/shared-workspace/hydrate',
        readOnly: true,
        state: 'unavailable',
        reason: 'WORKSPACE_HYDRATION_UNAVAILABLE',
        workspaceId: String(req.query?.workspace || req.query?.workspaceId || '').trim().toLowerCase(),
        requestedDatasets: [],
        datasets: {},
        errors: [String(error?.message || 'WORKSPACE_HYDRATION_UNAVAILABLE')],
      });
    }
  });

  router.get('/dashboard-feed', async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    try {
      const requestedScope = String(req.query?.scope || '').trim().toLowerCase();
      const recordScope = requestedScope === 'full-history' ? 'full-history' : 'current-state';
      const feed = await readBackendSharedWorkspaceDashboardFeed({
        env,
        repoRoot,
        nowMs,
        staleAfterMs,
        recordScope,
      });

      res.status(feed.state === 'unavailable' ? 503 : 200).json(feed);
    } catch (_error) {
      res.status(503).json({
        schemaVersion: 'stephanos.backend.shared-workspace-dashboard-feed.v1',
        route: '/api/shared-workspace/dashboard-feed',
        readOnly: true,
        state: 'unavailable',
        reason: 'SHARED_WORKSPACE_DASHBOARD_FEED_UNAVAILABLE',
        workspaceRoot: 'UNKNOWN',
        exactNextAction: 'Inspect Shared Workspace configuration and rerun the local Battle Bridge proof commands before claiming live health.',
        errors: ['SHARED_WORKSPACE_DASHBOARD_FEED_UNAVAILABLE'],
      });
    }
  });

  router.post('/support-observation', async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    try {
      const result = await publishSupportSnapshotWorkspaceObservation({
        env,
        repoRoot,
        nowMs,
        observation: req.body && typeof req.body === 'object' ? req.body : {},
      });
      res.status(result.ok ? 200 : 503).json(result);
    } catch (error) {
      res.status(503).json({
        ok: false,
        changed: false,
        reason: 'SUPPORT_SNAPSHOT_WORKSPACE_BRIDGE_FAILED',
        error: String(error?.message || 'unknown'),
        finalVerdict: 'SUPPORT_SNAPSHOT_WORKSPACE_BRIDGE_UNAVAILABLE',
      });
    }
  });

  router.post('/spatial-telemetry', async (req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    try {
      const result = await publishSpatialWorkspaceTelemetry({
        env,
        repoRoot,
        nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
        payload: req.body && typeof req.body === 'object' ? req.body : {},
      });
      res.status(result.ok ? 202 : 503).json(result);
    } catch (error) {
      res.status(400).json({
        ok: false,
        reason: String(error?.message || 'SPATIAL_TELEMETRY_REJECTED'),
      });
    }
  });

  router.get('/spatial-telemetry-feed', async (_req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    try {
      const feed = await readSpatialWorkspaceTelemetryFeed({ env, repoRoot, nowMs, staleAfterMs });
      res.status(feed.state === 'unavailable' ? 503 : 200).json(feed);
    } catch (error) {
      res.status(503).json({
        schemaVersion: 'stephanos.spatial-workspace-telemetry-feed.v1',
        readOnly: true,
        state: 'unavailable',
        reason: 'SPATIAL_TELEMETRY_FEED_UNAVAILABLE',
        error: String(error?.message || 'unknown'),
      });
    }
  });

  router.get('/vr-capability-feed', async (_req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    try {
      const feed = await readVrCapabilityFeed({ env, repoRoot, nowMs, staleAfterMs });
      res.json(feed);
    } catch (error) {
      res.status(503).json({
        schemaVersion: 'stephanos.vr-capability-live-feed.v1',
        route: '/api/shared-workspace/vr-capability-feed',
        readOnly: true,
        state: 'unavailable',
        reason: 'VR_CAPABILITY_FEED_UNAVAILABLE',
        error: String(error?.message || 'unknown'),
      });
    }
  });

  router.get('/vr-research-qa', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    try {
      const answer = await readCanonicalVrResearchAnswer({
        repoRoot, questionClass: req.query?.questionClass,
        subjectRef: req.query?.subjectRef ?? '',
        nowUtc: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : new Date().toISOString(),
      });
      res.status(answer.ok ? 200 : answer.reason === 'QUESTION_CLASS_NOT_SUPPORTED' || answer.reason === 'SUBJECT_REF_INVALID' ? 400 : 503)
        .json({ route: VR_RESEARCH_QA_ROUTE, ...answer });
    } catch {
      res.status(503).json({ route: VR_RESEARCH_QA_ROUTE, ok: false,
        readOnly: true, reason: 'CANONICAL_VR_QA_UNAVAILABLE' });
    }
  });

  router.get('/vr-playtest-feed', async (_req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    try {
      const feed = await readVrPlaytestFeed({ env, repoRoot, nowMs, staleAfterMs });
      res.status(feed.state === 'unavailable' ? 503 : 200).json(feed);
    } catch (error) {
      res.status(503).json({
        schemaVersion: 'stephanos.vr-playtest-live-feed.v1',
        route: '/api/shared-workspace/vr-playtest-feed',
        readOnly: true,
        state: 'unavailable',
        reason: 'VR_PLAYTEST_FEED_UNAVAILABLE',
        error: String(error?.message || 'unknown'),
      });
    }
  });

  return router;
}

export default createSharedWorkspaceRouter();
