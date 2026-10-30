import { getDefaultSharedWorkspaceRoot } from './sharedWorkspaceRuntimeConfig.mjs';

// Shared by refill execution and its custody observation. A legacy OpenClaw
// workspace alias must not select evidence for a different mutation target.
export function resolveGoalDiscoveryWorkspaceV1({ builderOptions = {}, env = process.env, paths = {} } = {}) {
  return builderOptions.sharedWorkspaceRoot
    || builderOptions.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
    || env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || paths.workspaceRoot
    || getDefaultSharedWorkspaceRoot({ env });
}
