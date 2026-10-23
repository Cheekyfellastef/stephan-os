#!/usr/bin/env node
// Read-only qualification of the pinned Starfield2VR native source/build estate.
// No compiler invocation, DLL staging, Starfield mutation, or game deployment.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const NATIVE_BUILD_READINESS_SCHEMA = 'stephanos.starfield-aer-native-build-readiness.v1';
export const MUTAR_PIN = 'c8a2b200710cdf70db22fd0fcac498cba02da676';
export const STABILIZER_SOURCE_PIN = 'b25bb9f9bf7f02ec87660a34ce3a2ef129d2fd3d';
const PATCH_V1_PATH = 'VR-Research-Lab/patches/starfield2vr-aer-stabilizer-v1.patch';
const PATCH_V2_PATH = 'VR-Research-Lab/patches/starfield2vr-aer-v2-stereo-history-v1.patch';
const RENDERER = 'src/CreationEngine/CreationEngineRendererModule.cpp';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sha40 = (value) => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

function patchPaths(patch) {
  return [...patch.matchAll(/^diff --git a\/(.+?) b\/(.+?)\s*$/gm)]
    .map((match) => ({ from: match[1], to: match[2] }));
}

export function inspectStarfieldAerNativeBuildContract({
  sourceLock = {}, patchV1 = '', patchV2 = '', cmakePreset = {}, sourceState = null,
} = {}) {
  const blockers = [];
  const source = Array.isArray(sourceLock.sources)
    ? sourceLock.sources.find((entry) => entry.source_id === 'mutar-starfield2vr')
    : null;
  if (!source || source.repository !== 'mutars/starfield2vr'
      || source.commit !== MUTAR_PIN || source.licence !== 'MIT'
      || source.code_reuse_allowed !== true || source.local_cache_allowed !== true) {
    blockers.push('PINNED_MIT_SOURCE_IDENTITY_INVALID');
  }
  if (typeof patchV1 !== 'string' || typeof patchV2 !== 'string'
      || patchV1.length < 100 || patchV2.length < 100
      || patchV1.length > 30000 || patchV2.length > 30000) {
    blockers.push('EXPERIMENTAL_PATCH_BYTES_MISSING');
  }
  const p1 = patchPaths(patchV1);
  const p2 = patchPaths(patchV2);
  const allowedV1 = new Set(['CMakeLists.txt', RENDERER]);
  if (p1.length !== 2 || p1.some((p) => p.from !== p.to || !allowedV1.has(p.to))
      || !p1.some((p) => p.to === 'CMakeLists.txt')
      || !p1.some((p) => p.to === RENDERER)
      || !patchV1.includes('AER-STABILIZER')) {
    blockers.push('STABILIZER_PATCH_SCOPE_INVALID');
  }
  if (p2.length !== 1 || p2[0].from !== RENDERER || p2[0].to !== RENDERER
      || !patchV2.includes(STABILIZER_SOURCE_PIN)
      || !patchV2.includes('struct StereoCameraHistory')
      || !patchV2.includes('stereoHistory.eye[eye]')) {
    blockers.push('STEREO_PATCH_SCOPE_OR_PARENT_INVALID');
  }
  const configure = Array.isArray(cmakePreset.configurePresets) ? cmakePreset.configurePresets : [];
  const build = Array.isArray(cmakePreset.buildPresets) ? cmakePreset.buildPresets : [];
  const major = Number(cmakePreset?.cmakeMinimumRequired?.major);
  const minor = Number(cmakePreset?.cmakeMinimumRequired?.minor);
  if (!configure.some((p) => p.name === 'build-release-msvc')
      || !build.some((p) => p.name === 'release-msvc' && p.configurePreset === 'build-release-msvc')
      || !Number.isInteger(major) || major < 3 || (major === 3 && (!Number.isInteger(minor) || minor < 27))) {
    blockers.push('PINNED_MSVC_CMAKE_PRESET_INVALID');
  }
  if (!sourceState) blockers.push('ISOLATED_PINNED_CHECKOUT_NOT_PROVEN');
  else if (sourceState.ok !== true || sourceState.commit !== MUTAR_PIN || sourceState.clean !== true
      || sourceState.submodulesVerified !== true) {
    blockers.push('ISOLATED_SOURCE_HEAD_OR_CLEANLINESS_INVALID');
  }
  return Object.freeze({
    schemaVersion: NATIVE_BUILD_READINESS_SCHEMA,
    repository: 'mutars/starfield2vr',
    sourceCommit: MUTAR_PIN,
    sourceLicense: source?.licence || 'UNKNOWN',
    sourceState: sourceState || {ok: false, reason: 'NOT_INSPECTED'},
    patches: Object.freeze([
      {stage: 'AER_STABILIZER_V1', path: PATCH_V1_PATH, sha256: sha(patchV1), paths: p1.map((p) => p.to)},
      {stage: 'AER_V2_STEREO_HISTORY_V1', path: PATCH_V2_PATH, sha256: sha(patchV2), paths: p2.map((p) => p.to)},
    ]),
    nextSteps: Object.freeze([
      'Copy exact clean pinned source and submodules to isolated non-game build directory.',
      'Run git apply --check on V1, apply V1 in the copy, then check and apply V2 in that copy.',
      'On separately qualified idle Windows builder configure: cmake --preset build-release-msvc.',
      'Compile: cmake --build --preset release-msvc; retain compiler/source/dependency/DLL hash receipts.',
      'Require independent review, approved experimental staging and verified baseline restoration.',
    ]),
    blockers: Object.freeze(blockers),
    status: blockers.length ? 'BLOCKED' : 'SOURCE_READY_FOR_SEPARATE_QUALIFIED_NATIVE_BUILD',
    verifiedNativeCompiler: false,
    verifiedNativeDll: false,
    deploymentAllowed: false,
    gameMutationAllowed: false,
    windowsMutationAllowed: false,
    sourceMutationAllowed: false,
    readOnly: true,
  });
}

// Read-only resource partition check for the EXISTING #2707 VR lane.
// This does not grant native writer custody, authenticated worker pickup,
// approval, deployment, task creation, or any lease release.
export const STARFIELD_NATIVE_R7_ISOLATION_SCHEMA = 'stephanos.starfield-native-r7-isolation.v1';
const HOSTED_VR_SOURCE_RESOURCES = Object.freeze([
  'vr/2707/pinned-source-read',
  'vr/2707/hosted-cpp23-test-scratch',
]);

export function classifyStarfieldNativeR7Isolation({
  action = 'HOSTED_SOURCE_TEST',
  surface = 'GITHUB_HOSTED',
  requestedResourceIds = HOSTED_VR_SOURCE_RESOURCES,
  activeResourceIds = [],
  gamingActive = null,
  originalR7LeaseState = 'UNVERIFIED',
} = {}) {
  const blockers = [];
  const strings = (value) => Array.isArray(value)
    && value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 120);
  // Reject malformed/duplicate/foreign resource claims rather than pretending
  // that an unrelated R7 or game-directory owner has become available.
  if (!strings(requestedResourceIds) || !strings(activeResourceIds)
    || requestedResourceIds.length !== HOSTED_VR_SOURCE_RESOURCES.length
    || !HOSTED_VR_SOURCE_RESOURCES.every((id) => requestedResourceIds.includes(id))
    || new Set(requestedResourceIds).size !== requestedResourceIds.length
    || new Set(activeResourceIds).size !== activeResourceIds.length
    || requestedResourceIds.some((id) => !HOSTED_VR_SOURCE_RESOURCES.includes(id))) {
    blockers.push('NATIVE_VR_RESOURCE_IDENTITY_INVALID');
  }
  if (action !== 'HOSTED_SOURCE_TEST') blockers.push('NATIVE_BUILD_SEPARATE_AUTHORITY_REQUIRED');
  if (surface !== 'GITHUB_HOSTED') blockers.push('NATIVE_VR_EXECUTION_SURFACE_UNQUALIFIED');
  if (strings(requestedResourceIds) && strings(activeResourceIds)
    && requestedResourceIds.some((id) => activeResourceIds.includes(id))) {
    blockers.push('NATIVE_VR_RESOURCE_CONFLICT');
  }
  // Any R7 hold, including unknown or spoofed release status, is irrelevant to
  // read-only hosted VR compilation. It never authorises local source writing.
  const eligible = blockers.length === 0;
  return Object.freeze({
    schemaVersion: STARFIELD_NATIVE_R7_ISOLATION_SCHEMA,
    existingGoal: 2707,
    existingControllerPreserved: true,
    originalR7LeaseStateObservedOnly: String(originalR7LeaseState).slice(0, 100),
    gamingActiveObservedOnly: gamingActive === true ? true : gamingActive === false ? false : null,
    action,
    surface,
    resourceIds: Object.freeze(strings(requestedResourceIds) ? [...requestedResourceIds] : []),
    blockers: Object.freeze(blockers),
    classification: eligible ? 'HOSTED_SOURCE_TEST_R7_DISJOINT' : 'NATIVE_VR_WORK_PARKED',
    sourceTestCandidateEligible: eligible,
    sourceWriterPickupVerified: false,
    independentNativeWorkerQualified: false,
    nativeBuildAllowed: false,
    originalR7LeaseReleaseAllowed: false,
    originalR7WriterMutationAllowed: false,
    battleBridgeMutationAllowed: false,
    questMutationAllowed: false,
    deploymentAllowed: false,
    authority: Object.freeze({
      sourceMutationAllowed: false, nativeBuildAllowed: false,
      originalR7LeaseReleaseAllowed: false, deploymentAllowed: false,
    }),
  });
}

export function inspectPinnedSourceCheckout(sourceRoot, {run = spawnSync} = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    return Object.freeze({ok: false, commit: '', clean: false, reason: 'SOURCE_DIR_REQUIRED'});
  }
  const dir = resolve(sourceRoot);
  // Reuse the canonical Git child boundary; checkout-owned core.fsmonitor,
  // hooks, global config, credentials or untrusted Git environment may never
  // execute merely because this source-preflight is described as read-only.
  // Its fixed -c overrides and sanitized GIT_CONFIG_* environment survive
  // recursively spawned submodule Git subprocesses.
  const gitBoundary = resolveBattleBridgeGitExecution();
  const git = (args) => run(gitBoundary.executable,
    [...gitBoundary.fixedConfigArgs, '-C', dir, ...args], {
      encoding: 'utf8', timeout: 3000, windowsHide: true,
      maxBuffer: 8 * 1024 * 1024, shell: false, env: gitBoundary.environment,
    });
  // A Git command from an ignored nested child still reports the parent HEAD.
  // Compare the requested source directory against Git's actual checkout root.
  const root = git(['rev-parse', '--show-toplevel']);
  const top = typeof root.stdout === 'string' ? root.stdout.trim() : '';
  const sameDir = (left, right) => {
    const l = resolve(left), r = resolve(right);
    return process.platform === 'win32' ? l.toLowerCase() === r.toLowerCase() : l === r;
  };
  if (root.status !== 0 || !top || !sameDir(dir, top)) {
    return Object.freeze({ok: false, commit: '', clean: false, reason: 'SOURCE_GIT_ROOT_MISMATCH'});
  }
  const head = git(['rev-parse', 'HEAD']);
  const commit = String(head.stdout || '').trim();
  if (head.status !== 0 || !sha40(commit)) {
    return Object.freeze({ok: false, commit: '', clean: false, reason: 'SOURCE_GIT_HEAD_UNAVAILABLE'});
  }
  // 'git status' can also hide tracked edits under assume-unchanged and
  // skip-worktree bits. Enumerate the full indexed source/dependency closure
  // and reject those marks before treating the workspace as build-ready.
  const index = git(['ls-files', '-v', '-z', '--recurse-submodules']);
  const indexEntries = index.status === 0 && !index.error && typeof index.stdout === 'string'
    ? index.stdout.split('\0').filter(Boolean) : [];
  const indexVerified = indexEntries.length > 0
    && indexEntries.every((entry) => /^[HhSs] .+$/s.test(entry))
    && indexEntries.some((entry) => entry.endsWith(' CMakePresets.json'))
    && indexEntries.some((entry) => entry.endsWith(' src/CreationEngine/CreationEngineRendererModule.cpp'))
    && !indexEntries.some((entry) => /^[hSs] /.test(entry));
  // Fail before any worktree-sensitive Git status or filter execution when
  // the actual index is hidden, missing or incompletely inspected. The
  // source-only index enumeration is not a physical custody attestation.
  if (!indexVerified) {
    return Object.freeze({ ok: false, commit, clean: false, indexVerified: false,
      reason: 'SOURCE_GIT_INDEX_FLAGS_OR_CONTENT_UNVERIFIED' });
  }
  // Git's clean/process filters can execute checkout-defined helpers during
  // status and fabricate clean bytes. Before touching the worktree, inspect
  // the *effective*, sanitized Git configuration for the pinned root and both
  // required submodules. Any filter driver, uncertain result, or missing
  // submodule is a source qualification HOLD, never a clean checkout.
  const filterPattern = '^filter\\..*\\.(clean|process)$';
  const gitOptions = {
    encoding: 'utf8', timeout: 3000, windowsHide: true,
    maxBuffer: 8 * 1024 * 1024, shell: false, env: gitBoundary.environment,
  };
  for (const inspectDir of [
    dir, resolve(dir, 'extern/vrframework'), resolve(dir, 'extern/CommonLibSF'),
  ]) {
    const filterConfig = run(gitBoundary.executable,
      [...gitBoundary.fixedConfigArgs, '-C', inspectDir,
        'config', '--name-only', '--get-regexp', filterPattern], gitOptions);
    if (filterConfig?.error || filterConfig?.status !== 1
        || typeof filterConfig.stdout !== 'string'
        || filterConfig.stdout.length !== 0
        || (filterConfig.stderr && String(filterConfig.stderr).trim() !== '')) {
      return Object.freeze({
        ok: false, commit, clean: false,
        reason: 'SOURCE_GIT_FILTER_DRIVER_OR_CONFIG_UNVERIFIED',
      });
    }
  }
  // Git configuration can hide dirty submodule trees. Override it rather
  // than inheriting submodule.<name>.ignore=all from the inspected checkout.
  const status = git(['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']);
  if (status.status !== 0) {
    return Object.freeze({ok: false, commit, clean: false, reason: 'SOURCE_GIT_STATUS_UNAVAILABLE'});
  }
  const clean = typeof status.stdout === 'string' && status.stdout.trim() === '';
  // Gitlink equality, hydration and dirty nested dependency state are separate
  // proofs. A pinned parent with -/+/U submodules is not build-ready.
  const submodules = git(['submodule', 'status', '--recursive']);
  const lines = submodules.status === 0
    ? String(submodules.stdout || '').split(/\r?\n/).filter(Boolean) : [];
  const expected = new Set(['extern/vrframework', 'extern/CommonLibSF']);
  const submodulesVerified = lines.length >= 2
    && lines.every((line) => {
      const match = /^ ([0-9a-f]{40}) (\S+)(?: \(.*\))?$/.exec(line);
      if (!match) return false;
      expected.delete(match[2]);
      return true;
    })
    && expected.size === 0;
  return Object.freeze({
    ok: commit === MUTAR_PIN && clean && submodulesVerified && indexVerified,
    commit, clean, submodulesVerified, indexVerified,
    reason: commit !== MUTAR_PIN ? 'SOURCE_COMMIT_DRIFT'
      : !clean ? 'SOURCE_DIR_DIRTY'
        : !indexVerified ? 'SOURCE_GIT_INDEX_FLAGS_OR_CONTENT_UNVERIFIED'
          : submodulesVerified ? 'PINNED_CHECKOUT_VERIFIED' : 'SOURCE_SUBMODULES_UNVERIFIED',
  });
}

export async function createStarfieldAerNativeBuildReadiness({
  repoRoot = ROOT, sourceRoot = '', sourceProbe = inspectPinnedSourceCheckout,
} = {}) {
  const fromRepo = (p) => readFile(resolve(repoRoot, p), 'utf8');
  const [sourceLock, patchV1, patchV2] = await Promise.all([
    fromRepo('VR-Research-Lab/reference-source-lock.json'),
    fromRepo(PATCH_V1_PATH), fromRepo(PATCH_V2_PATH),
  ]);
  let cmakePreset = {};
  if (sourceRoot) {
    try {cmakePreset = JSON.parse(await readFile(resolve(sourceRoot, 'CMakePresets.json'), 'utf8'));}
    catch { /* remain blocked; no invented Windows toolchain */ }
  }
  return inspectStarfieldAerNativeBuildContract({
    sourceLock: JSON.parse(sourceLock), patchV1, patchV2, cmakePreset,
    sourceState: sourceRoot ? sourceProbe(sourceRoot) : null,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 1 && args[0] === '--json')
    || (args.length === 2 && args[0] === '--source-dir' && !args[1].startsWith('--'))
    || (args.length === 3 && args[0] === '--source-dir' && !args[1].startsWith('--') && args[2] === '--json');
  if (!valid) {
    process.stderr.write('Usage: node scripts/starfield-vr-aer-native-build-readiness.mjs [--source-dir <pinned-checkout>] [--json]\n');
    process.exitCode = 2;
  } else {
    const sourceRoot = args[0] === '--source-dir' ? args[1] : '';
    createStarfieldAerNativeBuildReadiness({sourceRoot}).then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.status !== 'SOURCE_READY_FOR_SEPARATE_QUALIFIED_NATIVE_BUILD') process.exitCode = 2;
    }).catch((error) => {
      process.stderr.write('STARFIELD_AER_BUILD_PREFLIGHT_UNAVAILABLE: ' + (error.code || 'UNAVAILABLE') + '\n');
      process.exitCode = 2;
    });
  }
}
