import { createBattleBridgeSupervisorStartupPublisher } from '../../shared/agents/battleBridgePublisherLoop.mjs';
import { validateSharedWorkspaceFeedConfig, MISSING_WORKSPACE_NEXT_ACTION } from './sharedWorkspaceDashboardFeedService.js';

export async function startBattleBridgePublisherLoopForBackend(input = {}) {
  const validation = await validateSharedWorkspaceFeedConfig(input);
  if (!validation.ok) {
    return Object.freeze({
      started: false,
      state: 'unavailable',
      reason: validation.reason,
      workspaceRoot: 'UNKNOWN',
      exactNextAction: MISSING_WORKSPACE_NEXT_ACTION,
      stop: () => ({ stopped: true, finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_LOOP_NOT_STARTED' }),
    });
  }
  const loop = createBattleBridgeSupervisorStartupPublisher({
    root: validation.root,
    repoRoot: input.repoRoot,
    intervalMs: input.intervalMs,
    runImmediately: input.runImmediately,
  });
  return Object.freeze({
    started: true,
    state: 'ready',
    reason: 'BATTLE_BRIDGE_PUBLISHER_LOOP_STARTED',
    workspaceRoot: validation.root,
    loop,
    stop: () => loop.stop(),
  });
}
