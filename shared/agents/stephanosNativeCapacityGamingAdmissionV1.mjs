import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { resolveSharedWorkspacePath } from './sharedAgentWorkspaceStore.mjs';

const MAX_EVIDENCE_BYTES = 32_768;
const MAX_OBSERVATION_AGE_MS = 30_000;
const ACTIVITY_FLAGS = Object.freeze([
  'active', 'flatGameActive', 'airLinkActive', 'realAirLinkActive',
  'virtualAirLinkTestActive', 'prepareLeaseActive',
]);
const PERMISSION_FLAGS = Object.freeze(['localModelAllowed', 'heavyModelAllowed']);

function hold(reason) {
  return Object.freeze({
    ok: false,
    finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_GAMING_HOLD',
    reason: `native-capacity-gaming-${reason}`,
  });
}

function present(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function readBoundedJson(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size < 2 || info.size > MAX_EVIDENCE_BYTES) {
    throw new Error('UNSAFE_GOVERNOR_EVIDENCE');
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) {
      throw new Error('GOVERNOR_EVIDENCE_CHANGED');
    }
    const bytes = Buffer.alloc(MAX_EVIDENCE_BYTES + 1);
    const length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length < 2 || length > MAX_EVIDENCE_BYTES || fstatSync(fd).size !== length) {
      throw new Error('UNBOUNDED_GOVERNOR_EVIDENCE');
    }
    return JSON.parse(bytes.toString('utf8', 0, length));
  } finally {
    closeSync(fd);
  }
}

// Derive permission from the governor's own fixed workspace, never a supplied
// verdict or a fallback file. This is a read-only restriction on the publisher;
// only the existing governor may refresh observations or clear preparation.
export function inspectStephanosNativeCapacityGamingAdmissionV1(options = {}) {
  const env = options.env || process.env;
  const userProfile = typeof env.USERPROFILE === 'string' ? env.USERPROFILE.trim() : '';
  const workspaceRoot = typeof options.workspaceRoot === 'string' ? options.workspaceRoot.trim() : '';
  if (!userProfile || !isAbsolute(userProfile) || !workspaceRoot || !isAbsolute(workspaceRoot)
    || /[\0\r\n]/.test(userProfile + workspaceRoot)) return hold('workspace-unproved');
  const canonicalRoot = resolve(userProfile, 'Documents', 'Stephanos-openclaw-workspace');
  const normalizeCase = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  if (normalizeCase(resolve(workspaceRoot)) !== normalizeCase(canonicalRoot)) return hold('workspace-mismatch');
  const resolved = resolveSharedWorkspacePath({
    root: canonicalRoot, repoRoot: options.repoRoot, segments: ['vr', 'vr-resource-governor-current.json'],
  });
  if (!resolved.ok) return hold('workspace-unproved');
  const stateRoot = join(canonicalRoot, 'vr');
  const preparePath = join(stateRoot, 'gaming-resource-prepare.json');
  const overridePath = join(stateRoot, 'gaming-resource-override.json');

  try {
    for (const directory of [canonicalRoot, stateRoot]) {
      const info = lstatSync(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return hold('workspace-unproved');
    }
    // lstat also detects a dangling link. Any prepare evidence is a hold until
    // its existing owner removes it, including expired or malformed records.
    if (present(preparePath)) return hold('prepare-pending');
    const state = readBoundedJson(resolved.path);
    if (present(overridePath)) {
      const override = readBoundedJson(overridePath);
      if (override?.schemaVersion !== 'stephanos.gaming-resource-override.v1' || override.mode !== 'AUTO') {
        return hold('override-unproved');
      }
    }
    // A prepare request may precede the governor's next persisted observation.
    if (present(preparePath)) return hold('prepare-pending');
    if (state?.schemaVersion !== 'stephanos.vr-resource-governor.v1' || state.governorVersion !== 3
      || [...ACTIVITY_FLAGS, ...PERMISSION_FLAGS].some((flag) => typeof state[flag] !== 'boolean')) {
      return hold('state-invalid');
    }
    const nowMs = typeof options.nowMs === 'function' ? options.nowMs() : Date.now();
    const observed = typeof state.updatedAtUtc === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(state.updatedAtUtc)
      ? Date.parse(state.updatedAtUtc) : NaN;
    if (!Number.isSafeInteger(nowMs) || !Number.isFinite(observed)) return hold('clock-unproved');
    if (observed > nowMs) return hold('observation-future');
    if (nowMs - observed > MAX_OBSERVATION_AGE_MS) return hold('observation-stale');
    if (state.phase !== 'NORMAL' || state.overrideMode !== 'AUTO' || state.ollamaLoadMode !== 'balanced'
      || state.cooldownUntilUtc !== '' || ACTIVITY_FLAGS.some((flag) => state[flag])
      || PERMISSION_FLAGS.some((flag) => !state[flag])) return hold('permission-denied');
    return Object.freeze({ ok: true, reason: 'STEPHANOS_NATIVE_CAPACITY_GAMING_ADMITTED' });
  } catch {
    return hold('evidence-unavailable');
  }
}
