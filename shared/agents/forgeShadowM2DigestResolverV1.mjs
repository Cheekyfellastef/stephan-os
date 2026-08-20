import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

export const FORGE_SHADOW_M2_IMAGE_TAG = 'code.forgejo.org/forgejo/forgejo:15.0.6-rootless';
export const FORGE_SHADOW_M2_PODMAN_VERSION = '6.0.2';
export const FORGE_SHADOW_M2_RUNTIME_PLATFORM = 'linux/amd64';

const OCI_DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_MANIFEST_BYTES = 128 * 1024;
const SYSTEM_PODMAN_EXE = 'C:\\Program Files\\RedHat\\Podman\\podman.exe';

function blocked(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    status: 'BLOCKED',
    blocker,
    imageTag: FORGE_SHADOW_M2_IMAGE_TAG,
    imageDigest: '',
    forgejoVersion: '15.0.6',
    podmanVersion: '',
    runtimePlatform: FORGE_SHADOW_M2_RUNTIME_PLATFORM,
    tlsVerified: false,
    registryCredentialUsed: false,
    mutationPerformed: false,
    pullPerformed: false,
    containerMutationPerformed: false,
    ...details,
  });
}

function fixedPodmanCandidates(env = process.env) {
  const candidates = [];
  if (String(env.LOCALAPPDATA || '').trim()) {
    candidates.push(Object.freeze({
      identity: 'fixed-user-podman',
      path: join(String(env.LOCALAPPDATA), 'Programs', 'Podman', 'podman.exe'),
    }));
  }
  candidates.push(Object.freeze({ identity: 'fixed-system-podman', path: SYSTEM_PODMAN_EXE }));
  return Object.freeze(candidates);
}

function isRegularExecutable(path, lstatFn) {
  try {
    const info = lstatFn(path);
    return info?.isFile?.() === true && info?.isSymbolicLink?.() !== true;
  } catch {
    return false;
  }
}

function capture(spawnSyncFn, executable, args, { cwd = '', maxBytes = 16 * 1024 } = {}) {
  const result = spawnSyncFn(executable, args, {
    cwd: cwd || undefined,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: maxBytes,
  });
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  if (Buffer.byteLength(stdout, 'utf8') > maxBytes || Buffer.byteLength(stderr, 'utf8') > maxBytes) {
    return Object.freeze({ ok: false, status: result?.status ?? null, stdout: '', stderr: '', blocker: 'FORGE_SHADOW_M2_DIGEST_OUTPUT_TOO_LARGE' });
  }
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout,
    stderr,
    blocker: '',
  });
}

export function resolveForgeShadowM2DigestOnBattleBridge({
  repoRoot = '',
  platform = process.platform,
  architecture = os.arch(),
  env = process.env,
  spawnSyncFn = spawnSync,
  lstatFn = lstatSync,
} = {}) {
  if (platform !== 'win32') return blocked('WINDOWS_REQUIRED');
  if (architecture !== 'x64') {
    return blocked('FORGE_SHADOW_M2_HOST_ARCHITECTURE_NOT_ALLOWED', { observedArchitecture: String(architecture || '') });
  }

  const podman = fixedPodmanCandidates(env).find((candidate) => isRegularExecutable(candidate.path, lstatFn));
  if (!podman) return blocked('PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED');

  const versionProbe = capture(spawnSyncFn, podman.path, ['--version'], { cwd: repoRoot });
  if (!versionProbe.ok) return blocked(versionProbe.blocker || 'PODMAN_VERSION_PROBE_FAILED', { podmanExecutableIdentity: podman.identity });
  const versionText = versionProbe.stdout.trim();
  if (!/^podman version 6\.0\.2(?:\s|$)/.test(versionText)) {
    return blocked('PODMAN_VERSION_MISMATCH', {
      podmanExecutableIdentity: podman.identity,
      observedVersion: versionText.slice(0, 120),
    });
  }

  const manifestArgs = Object.freeze([
    'manifest',
    'inspect',
    '--tls-verify=true',
    FORGE_SHADOW_M2_IMAGE_TAG,
  ]);
  const manifestProbe = capture(spawnSyncFn, podman.path, manifestArgs, {
    cwd: repoRoot,
    maxBytes: MAX_MANIFEST_BYTES,
  });
  if (!manifestProbe.ok) {
    return blocked(manifestProbe.blocker || 'FORGE_SHADOW_M2_MANIFEST_INSPECT_FAILED', {
      podmanExecutableIdentity: podman.identity,
      podmanVersion: FORGE_SHADOW_M2_PODMAN_VERSION,
    });
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestProbe.stdout);
  } catch {
    return blocked('FORGE_SHADOW_M2_MANIFEST_JSON_INVALID', {
      podmanExecutableIdentity: podman.identity,
      podmanVersion: FORGE_SHADOW_M2_PODMAN_VERSION,
    });
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || !Array.isArray(manifest.manifests)) {
    return blocked('FORGE_SHADOW_M2_MANIFEST_INDEX_REQUIRED', {
      podmanExecutableIdentity: podman.identity,
      podmanVersion: FORGE_SHADOW_M2_PODMAN_VERSION,
    });
  }

  const candidates = manifest.manifests.filter((descriptor) => (
    descriptor
    && typeof descriptor === 'object'
    && !Array.isArray(descriptor)
    && String(descriptor?.platform?.os || '').toLowerCase() === 'linux'
    && String(descriptor?.platform?.architecture || '').toLowerCase() === 'amd64'
  ));
  if (candidates.length !== 1) {
    return blocked('FORGE_SHADOW_M2_AMD64_DESCRIPTOR_NOT_UNIQUE', {
      podmanExecutableIdentity: podman.identity,
      podmanVersion: FORGE_SHADOW_M2_PODMAN_VERSION,
      matchingDescriptorCount: candidates.length,
    });
  }

  const imageDigest = String(candidates[0]?.digest || '').trim().toLowerCase();
  if (!OCI_DIGEST.test(imageDigest)) {
    return blocked('FORGE_SHADOW_M2_DIGEST_INVALID', {
      podmanExecutableIdentity: podman.identity,
      podmanVersion: FORGE_SHADOW_M2_PODMAN_VERSION,
    });
  }

  return Object.freeze({
    ok: true,
    status: 'FORGE_SHADOW_M2_DIGEST_READY',
    blocker: '',
    imageTag: FORGE_SHADOW_M2_IMAGE_TAG,
    imageDigest,
    forgejoVersion: '15.0.6',
    podmanVersion: FORGE_SHADOW_M2_PODMAN_VERSION,
    podmanExecutableIdentity: podman.identity,
    runtimePlatform: FORGE_SHADOW_M2_RUNTIME_PLATFORM,
    tlsVerified: true,
    registryCredentialUsed: false,
    mutationPerformed: false,
    pullPerformed: false,
    containerMutationPerformed: false,
  });
}
