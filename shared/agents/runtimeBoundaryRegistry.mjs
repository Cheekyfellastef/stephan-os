import os from 'node:os';
import path from 'node:path';

export const RUNTIME_BOUNDARY_CLASSIFICATIONS = Object.freeze({
  SOURCE_CLEAN: 'SOURCE_CLEAN',
  KNOWN_EXTERNAL_RUNTIME_STATE: 'KNOWN_EXTERNAL_RUNTIME_STATE',
  KNOWN_REGENERABLE_RUNTIME_DIRT: 'KNOWN_REGENERABLE_RUNTIME_DIRT',
  BLOCKED_UNPUBLISHED_SOURCE: 'BLOCKED_UNPUBLISHED_SOURCE',
  BLOCKED_UNKNOWN_DIRT: 'BLOCKED_UNKNOWN_DIRT',
  BLOCKED_RUNTIME_BOUNDARY_MISCONFIGURED: 'BLOCKED_RUNTIME_BOUNDARY_MISCONFIGURED',
});

export const RUNTIME_ROOT_KINDS = Object.freeze({
  RUNTIME: 'runtime-root',
  OPENCLAW_WORKSPACE: 'openclaw-workspace',
});

export const RUNTIME_PATH_REGISTRY = Object.freeze({
  dreams: Object.freeze({
    key: 'dreams',
    legacyPrefixes: Object.freeze(['memory/.dreams/', 'memory/dreaming/']),
    rootKind: RUNTIME_ROOT_KINDS.OPENCLAW_WORKSPACE,
    externalRelativePath: 'memory',
    producer: 'OpenClaw workspace-relative dreaming agents',
    trackedExpectation: 'external-untracked',
    deterministicRegeneration: false,
    preservation: 'required',
    reconciliation: 'copy-hash-verify-before-switch',
    verifier: 'dream-runtime-boundary',
  }),
  receipts: Object.freeze({
    key: 'receipts',
    legacyPrefixes: Object.freeze(['receipts/', 'proof/', 'proofs/']),
    rootKind: RUNTIME_ROOT_KINDS.RUNTIME,
    externalRelativePath: 'receipts',
    producer: 'Stephanos/OpenClaw proof publishers',
    trackedExpectation: 'external-untracked',
    deterministicRegeneration: false,
    preservation: 'required',
    reconciliation: 'copy-hash-verify-before-switch',
    verifier: 'runtime-boundary-workbench',
  }),
  status: Object.freeze({
    key: 'status',
    legacyPrefixes: Object.freeze(['status/', 'heartbeat/', 'heartbeats/']),
    rootKind: RUNTIME_ROOT_KINDS.RUNTIME,
    externalRelativePath: 'status',
    producer: 'workers, supervisors and monitors',
    trackedExpectation: 'external-untracked',
    deterministicRegeneration: true,
    preservation: 'latest-receipt-only',
    reconciliation: 'regenerate-after-switch',
    verifier: 'runtime-boundary-workbench',
  }),
  logs: Object.freeze({
    key: 'logs',
    legacyPrefixes: Object.freeze(['logs/']),
    rootKind: RUNTIME_ROOT_KINDS.RUNTIME,
    externalRelativePath: 'logs',
    producer: 'runtime services',
    trackedExpectation: 'external-untracked',
    deterministicRegeneration: true,
    preservation: 'bounded-retention',
    reconciliation: 'rotate-and-retain',
    verifier: 'runtime-boundary-workbench',
  }),
  cache: Object.freeze({
    key: 'cache',
    legacyPrefixes: Object.freeze(['.cache/', 'cache/', 'tmp/']),
    rootKind: RUNTIME_ROOT_KINDS.RUNTIME,
    externalRelativePath: 'cache',
    producer: 'runtime services and build helpers',
    trackedExpectation: 'external-untracked',
    deterministicRegeneration: true,
    preservation: 'not-required',
    reconciliation: 'regenerate-after-switch',
    verifier: 'runtime-boundary-workbench',
  }),
  uiBuildStaging: Object.freeze({
    key: 'uiBuildStaging',
    legacyPrefixes: Object.freeze(['apps/stephanos/dist/']),
    rootKind: RUNTIME_ROOT_KINDS.RUNTIME,
    externalRelativePath: 'build-staging/stephanos-ui',
    producer: 'Stephanos UI build',
    trackedExpectation: 'external-staging-deliberate-publish',
    deterministicRegeneration: true,
    preservation: 'not-required',
    reconciliation: 'stage-external-then-reviewed-publish',
    verifier: 'verify-stephanos-dist',
  }),
});

export function defaultRuntimeRoot({ env = process.env, homeDir = os.homedir() } = {}) {
  const configured = env.STEPHANOS_RUNTIME_ROOT || env.STEPHANOS_SHARED_WORKSPACE_ROOT;
  return path.resolve(configured || path.join(homeDir, 'Stephanos', 'shared-agent-workspace', 'runtime'));
}

export function defaultOpenClawWorkspaceRoot({ env = process.env, homeDir = os.homedir() } = {}) {
  const configured = env.STEPHANOS_SHARED_WORKSPACE || env.STEPHANOS_OPENCLAW_WORKSPACE;
  return path.resolve(configured || path.join(homeDir, 'Documents', 'Stephanos-openclaw-workspace'));
}

export function runtimeRootForEntry(entry, options = {}) {
  if (entry?.rootKind === RUNTIME_ROOT_KINDS.OPENCLAW_WORKSPACE) {
    return defaultOpenClawWorkspaceRoot(options);
  }
  if (entry?.rootKind === RUNTIME_ROOT_KINDS.RUNTIME) {
    return defaultRuntimeRoot(options);
  }
  throw new Error(`Unknown runtime root kind: ${entry?.rootKind || '<missing>'}`);
}

export function getRuntimePath(key, options = {}) {
  const entry = RUNTIME_PATH_REGISTRY[key];
  if (!entry) throw new Error(`Unknown runtime path key: ${key}`);
  const root = runtimeRootForEntry(entry, options);
  const resolved = path.resolve(root, entry.externalRelativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Runtime path escaped approved root: ${key}`);
  }
  return resolved;
}

export function findRegistryEntryForRepoPath(repoPath) {
  const normalized = String(repoPath ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  return Object.values(RUNTIME_PATH_REGISTRY).find((entry) =>
    entry.legacyPrefixes.some((prefix) => normalized.startsWith(prefix)),
  ) ?? null;
}

export function classifyRepositoryDirt(statusLines = []) {
  const result = {
    classification: RUNTIME_BOUNDARY_CLASSIFICATIONS.SOURCE_CLEAN,
    source: [],
    knownRuntime: [],
    unknown: [],
    blocksSync: false,
  };

  for (const raw of statusLines) {
    if (!raw || !raw.trim()) continue;
    if (raw.length < 4) {
      result.unknown.push(raw);
      continue;
    }
    const status = raw.slice(0, 2);
    const repoPath = raw.slice(3).trim();
    const entry = findRegistryEntryForRepoPath(repoPath);
    if (entry) {
      result.knownRuntime.push({ path: repoPath, key: entry.key, status });
    } else if (/^[ MADRCU?!]{2}$/.test(status) && repoPath) {
      result.source.push({ path: repoPath, status });
    } else {
      result.unknown.push(raw);
    }
  }

  if (result.unknown.length) {
    result.classification = RUNTIME_BOUNDARY_CLASSIFICATIONS.BLOCKED_UNKNOWN_DIRT;
    result.blocksSync = true;
  } else if (result.source.length) {
    result.classification = RUNTIME_BOUNDARY_CLASSIFICATIONS.BLOCKED_UNPUBLISHED_SOURCE;
    result.blocksSync = true;
  } else if (result.knownRuntime.length) {
    result.classification = RUNTIME_BOUNDARY_CLASSIFICATIONS.KNOWN_REGENERABLE_RUNTIME_DIRT;
  }

  return result;
}

export function registryAsSerializableObject(options = {}) {
  const runtimeRoot = defaultRuntimeRoot(options);
  const openClawWorkspaceRoot = defaultOpenClawWorkspaceRoot(options);
  return {
    schemaVersion: 1,
    runtimeRoot,
    openClawWorkspaceRoot,
    sourcePolicy: 'source-in-git-runtime-outside-git',
    unknownPathsFailClosed: true,
    entries: Object.fromEntries(Object.entries(RUNTIME_PATH_REGISTRY).map(([key, entry]) => [key, {
      ...entry,
      resolvedRoot: runtimeRootForEntry(entry, options),
      resolvedExternalPath: getRuntimePath(key, options),
    }])),
  };
}
