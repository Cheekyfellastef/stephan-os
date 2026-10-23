#!/usr/bin/env node
// Read-only qualification of the pinned Starfield2VR native source/build estate.
// No compiler invocation, DLL staging, Starfield mutation, or game deployment.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

export function inspectPinnedSourceCheckout(sourceRoot, {run = spawnSync} = {}) {
  if (typeof sourceRoot !== 'string' || !sourceRoot.trim()) {
    return Object.freeze({ok: false, commit: '', clean: false, reason: 'SOURCE_DIR_REQUIRED'});
  }
  const dir = resolve(sourceRoot);
  const git = (args) => run('git', ['-C', dir, ...args], {encoding: 'utf8', timeout: 3000, windowsHide: true});
  const head = git(['rev-parse', 'HEAD']);
  const commit = String(head.stdout || '').trim();
  if (head.status !== 0 || !sha40(commit)) {
    return Object.freeze({ok: false, commit: '', clean: false, reason: 'SOURCE_GIT_HEAD_UNAVAILABLE'});
  }
  const status = git(['status', '--porcelain', '--untracked-files=normal']);
  if (status.status !== 0) {
    return Object.freeze({ok: false, commit, clean: false, reason: 'SOURCE_GIT_STATUS_UNAVAILABLE'});
  }
  const clean = status.stdout.trim() === '';
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
    ok: commit === MUTAR_PIN && clean && submodulesVerified,
    commit, clean, submodulesVerified,
    reason: commit !== MUTAR_PIN ? 'SOURCE_COMMIT_DRIFT'
      : !clean ? 'SOURCE_DIR_DIRTY'
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
