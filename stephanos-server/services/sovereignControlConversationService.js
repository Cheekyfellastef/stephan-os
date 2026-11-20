import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolveSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { resolveSharedWorkspacePath, validateSharedWorkspaceWriteAncestors } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { projectControlTowerBuildBeaconFactsV1 } from '../../shared/agents/controlTowerBuildBeaconFactsV1.mjs';
import { buildSovereignControlConversationV1, classifySovereignControlConversationV1 } from '../../shared/agents/sovereignControlConversationV1.mjs';
import { readSovereignCommanderStatus } from './sovereignCommanderStatusTool.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_RELAY_BYTES = 64 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const within = (parent, child) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

// The fixed relay record is an observation. Neither its existence nor any
// returned request state is authority to invoke Commander or submit a workflow.
async function readRelayRecord(env) {
  const config = resolveSharedWorkspaceRuntimeConfig({ repoRoot: REPO_ROOT, env });
  if (!config.ok) return { record: null, blocker: 'CONTROL_TOWER_WORKSPACE_UNAVAILABLE' };
  const location = resolveSharedWorkspacePath({
    root: config.root, repoRoot: REPO_ROOT, segments: ['status', 'sovereign-relay-current.json'],
  });
  let handle;
  try {
    if (!location.ok || !(await validateSharedWorkspaceWriteAncestors(location)).ok)
      return { record: null, blocker: 'CONTROL_TOWER_RELAY_PATH_UNSAFE' };
    const [realRoot, realRepo] = await Promise.all([realpath(location.root), realpath(REPO_ROOT)]);
    if (within(realRepo, realRoot)) return { record: null, blocker: 'CONTROL_TOWER_RELAY_PATH_UNSAFE' };
    const initial = await lstat(location.path);
    if (!initial.isFile() || initial.isSymbolicLink())
      return { record: null, blocker: 'CONTROL_TOWER_RELAY_PATH_UNSAFE' };
    if (initial.size < 2 || initial.size > MAX_RELAY_BYTES)
      return { record: null, blocker: 'CONTROL_TOWER_RELAY_SIZE_INVALID' };
    handle = await open(location.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(initial, opened))
      return { record: null, blocker: 'CONTROL_TOWER_RELAY_CHANGED_DURING_READ' };
    const bytes = Buffer.alloc(MAX_RELAY_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(bytes, length, bytes.length - length, length);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    if (length !== initial.size || length > MAX_RELAY_BYTES
      || !sameFile(initial, await handle.stat()) || !sameFile(initial, await lstat(location.path))
      || !(await validateSharedWorkspaceWriteAncestors(location)).ok
      || !within(realRoot, await realpath(location.path)))
      return { record: null, blocker: 'CONTROL_TOWER_RELAY_CHANGED_DURING_READ' };
    return { record: JSON.parse(bytes.subarray(0, length).toString('utf8')), blocker: '' };
  } catch {
    return { record: null, blocker: 'CONTROL_TOWER_RELAY_READ_UNAVAILABLE' };
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Public chat supplies presentation context only. All observations use fixed
 * server-owned sources; no token, URL, path, source head or action comes from it.
 * Dependency injection is available only inside the Node test runner.
 */
export async function readSovereignControlConversationV1(input = {}, options = {}) {
  const classification = classifySovereignControlConversationV1(input);
  if (!classification.applies) return null;
  const testOptions = options.testOnly === true && process.env.NODE_TEST_CONTEXT ? options : {};
  const env = testOptions.env || process.env;
  const clock = testOptions.nowMs || Date.now;
  const nowMs = clock();
  const expectedHead = SHA.test(env.STEPHANOS_BACKEND_SOURCE_HEAD || '') ? env.STEPHANOS_BACKEND_SOURCE_HEAD : '';
  const [commander, relay] = await Promise.all([
    readSovereignCommanderStatus({ ...(testOptions.fetchFn ? { fetchFn: testOptions.fetchFn } : {}), nowMs: clock }),
    readRelayRecord(env),
  ]);
  const projectedTower = projectControlTowerBuildBeaconFactsV1(relay.record, { expectedHead, nowMs });
  const controlTower = relay.blocker && !projectedTower.observed
    ? { ...projectedTower, blocker: relay.blocker } : projectedTower;
  return buildSovereignControlConversationV1({
    classification, observedAtUtc: new Date(nowMs).toISOString(),
    commander, controlTower, handoffId: randomUUID(),
  });
}
