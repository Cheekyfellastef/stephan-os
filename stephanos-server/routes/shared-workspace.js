import express from 'express';
import { readBackendSharedWorkspaceDashboardFeed } from '../services/sharedWorkspaceDashboardFeedService.js';

export function createSharedWorkspaceRouter(input = {}) {
  const router = express.Router();
  const readFeed = typeof input.readFeed === 'function' ? input.readFeed : readBackendSharedWorkspaceDashboardFeed;

  router.get('/dashboard-feed', async (_req, res) => {
    try {
      const feed = await readFeed({
        env: input.env,
        repoRoot: input.repoRoot || process.cwd(),
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

  return router;
}

export default createSharedWorkspaceRouter();
