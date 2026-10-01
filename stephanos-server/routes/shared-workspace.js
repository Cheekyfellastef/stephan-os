import express from 'express';
import { readBackendSharedWorkspaceDashboardFeed } from '../services/sharedWorkspaceDashboardFeedService.js';
import { readVrCapabilityFeed } from '../services/vrCapabilityFeedService.js';
import { readVrPlaytestFeed } from '../services/vrPlaytestFeedService.js';
import { publishSupportSnapshotWorkspaceObservation } from '../services/supportSnapshotSharedWorkspaceBridgeService.js';

export function createSharedWorkspaceRouter({ env = process.env, repoRoot = process.cwd(), nowMs, staleAfterMs } = {}) {
  const router = express.Router();

  router.get('/dashboard-feed', async (_req, res) => {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });

    try {
      const feed = await readBackendSharedWorkspaceDashboardFeed({
        env,
        repoRoot,
        nowMs,
        staleAfterMs,
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
