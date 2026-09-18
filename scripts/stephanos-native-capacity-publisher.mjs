#!/usr/bin/env node
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  clearStephanosNativeCapacityStatus,
  publishStephanosNativeCapacityV1,
} from '../shared/agents/stephanosNativeCapacityPublisherV1.mjs';

export const STEPHANOS_NATIVE_CAPACITY_KEY_ID = 'stephanos-native-capacity-key-v1';
export const STEPHANOS_NATIVE_CAPACITY_REFRESH_MS = 60_000;
export const STEPHANOS_NATIVE_CAPACITY_RELOAD_EXIT_CODE = 75;
const SHA40 = /^[0-9a-f]{40}$/;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function missionRunnerRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_RUNNER_ROOT);
  if (configured) return resolve(configured);
  if (!text(env.USERPROFILE)) return '';
  return resolve(env.USERPROFILE, 'Documents', 'OpenClaw-Standalone', 'mission-runner');
}
function canonicalRepositoryRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT);
  if (configured) return resolve(configured);
  if (!text(env.USERPROFILE)) return '';
  return resolve(env.USERPROFILE, 'Documents', 'GitHub', 'stephan-os');
}
function canonicalWorkspaceRoot(env = process.env) {
  const configured = text(env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  if (configured) return resolve(configured);
  if (!text(env.USERPROFILE)) return '';
  return resolve(env.USERPROFILE, 'Documents', 'Stephanos-openclaw-workspace');
}
function capacityKeyPaths(env = process.env) {
  const root = missionRunnerRoot(env);
  return root ? Object.freeze({
    root,
    privateKeyPath: resolve(root, 'keys', 'stephanos-native-capacity-private.pem'),
    publicKeyPath: resolve(root, 'keys', 'stephanos-native-capacity-public.pem'),
  }) : null;
}

export async function ensureStephanosNativeCapacityKeyPair(options = {}) {
  const env = options.env || process.env;
  const paths = capacityKeyPaths(env);
  if (!paths) return Object.freeze({ ok: false, reason: 'native-capacity-key-root-missing' });
  await mkdir(dirname(paths.privateKeyPath), { recursive: true });
  let privateKeyPem = '';
  try { privateKeyPem = await readFile(paths.privateKeyPath, 'utf8'); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (!privateKeyPem) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await writeFile(paths.privateKeyPath, privateKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(paths.publicKeyPath, publicKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  } else {
    const publicKeyPem = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
    try { await writeFile(paths.publicKeyPath, publicKeyPem, { encoding: 'utf8', flag: 'wx', mode: 0o644 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  return Object.freeze({ ok: true, reason: 'STEPHANOS_NATIVE_CAPACITY_KEY_READY', ...paths, privateKeyPem });
}

export function inspectStephanosNativeCapacitySourceIdentity(options = {}) {
  const env = options.env || process.env;
  const repoRoot = canonicalRepositoryRoot(env);
  const workspaceRoot = canonicalWorkspaceRoot(env);
  const gitExecutable = text(env.STEPHANOS_GIT_EXECUTABLE) || 'C:\\Program Files\\Git\\cmd\\git.exe';
  const run = options.spawnSyncFn || spawnSync;
  if (!repoRoot || !workspaceRoot) return Object.freeze({ ok: false, reason: 'native-capacity-runtime-root-missing' });
  const runGit = (args) => run(gitExecutable, ['-C', repoRoot, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  try {
    const branchResult = runGit(['branch', '--show-current']);
    const headResult = runGit(['rev-parse', 'HEAD']);
    const dirtResult = runGit(['status', '--porcelain=v1', '--untracked-files=no']);
    if (branchResult?.status !== 0 || headResult?.status !== 0 || dirtResult?.status !== 0) {
      return Object.freeze({ ok: false, reason: 'native-capacity-source-identity-read-failed' });
    }
    const branch = text(branchResult.stdout);
    const sourceHead = text(headResult.stdout).toLowerCase();
    const trackedDirt = text(dirtResult.stdout);
    if (branch !== 'main') return Object.freeze({ ok: false, reason: 'native-capacity-source-not-main', branch, sourceHead });
    if (!SHA40.test(sourceHead)) return Object.freeze({ ok: false, reason: 'native-capacity-source-head-invalid', branch, sourceHead: '' });
    if (trackedDirt) return Object.freeze({ ok: false, reason: 'native-capacity-source-dirty', branch, sourceHead });
    const expectedHead = text(env.STEPHANOS_MISSION_WORKER_HEAD_SHA).toLowerCase();
    if (expectedHead && expectedHead !== sourceHead) {
      return Object.freeze({ ok: false, reason: 'native-capacity-launch-head-mismatch', branch, sourceHead, expectedHead });
    }
    return Object.freeze({ ok: true, reason: 'STEPHANOS_NATIVE_CAPACITY_SOURCE_IDENTITY_PROVED', repoRoot, workspaceRoot, branch, sourceHead });
  } catch {
    return Object.freeze({ ok: false, reason: 'native-capacity-source-identity-read-failed' });
  }
}

function runtimeOptions(env, identity, privateKeyPem, now = new Date()) {
  return {
    workspaceRoot: identity.workspaceRoot,
    repoRoot: identity.repoRoot,
    repository: text(env.STEPHANOS_MISSION_WORKER_REPOSITORY) || 'Cheekyfellastef/stephan-os',
    sourceHead: identity.sourceHead,
    workerId: 'stephanos-native-battle-bridge',
    keyId: STEPHANOS_NATIVE_CAPACITY_KEY_ID,
    privateKeyPem,
    observedAtUtc: now.toISOString(),
    endpoint: text(env.STEPHANOS_NATIVE_OLLAMA_ENDPOINT) || 'http://127.0.0.1:11434',
    model: text(env.STEPHANOS_NATIVE_CAPACITY_MODEL) || 'qwen:14b',
  };
}

function projection(result, sourceHead) {
  return Object.freeze({
    schemaVersion: 'stephanos.native-capacity-publisher-log.v1',
    checkedAt: new Date().toISOString(),
    ok: result?.ok === true,
    reason: text(result?.reason),
    sourceHead,
    model: text(result?.statusRecord?.capacityReceipt?.payload?.model),
    expiresAtUtc: text(result?.expiresAtUtc),
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  });
}

export async function runStephanosNativeCapacityPublisher(options = {}) {
  const env = options.env || process.env;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const argv = options.argv || process.argv.slice(2);
  const once = argv.includes('--once');
  const refreshMs = Math.max(Number.parseInt(text(env.STEPHANOS_NATIVE_CAPACITY_REFRESH_MS) || String(STEPHANOS_NATIVE_CAPACITY_REFRESH_MS), 10) || STEPHANOS_NATIVE_CAPACITY_REFRESH_MS, 15_000);
  const initialIdentity = inspectStephanosNativeCapacitySourceIdentity({ env, spawnSyncFn: options.spawnSyncFn });
  if (!initialIdentity.ok) {
    stderr.write(`${JSON.stringify({ finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_BLOCKED', reason: initialIdentity.reason })}\n`);
    return 1;
  }
  const launchHead = initialIdentity.sourceHead;
  const keys = await ensureStephanosNativeCapacityKeyPair({ env });
  if (!keys.ok) {
    stderr.write(`${JSON.stringify({ finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_BLOCKED', reason: keys.reason })}\n`);
    return 1;
  }

  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    do {
      const identity = inspectStephanosNativeCapacitySourceIdentity({ env, spawnSyncFn: options.spawnSyncFn });
      if (!identity.ok || identity.sourceHead !== launchHead) {
        await clearStephanosNativeCapacityStatus({
          workspaceRoot: identity.workspaceRoot || initialIdentity.workspaceRoot,
          repoRoot: identity.repoRoot || initialIdentity.repoRoot,
        }).catch(() => {});
        const reason = identity.ok ? 'native-capacity-canonical-reload-required' : identity.reason;
        stderr.write(`${JSON.stringify({ finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_RELOAD_REQUIRED', reason, launchHead, observedHead: identity.sourceHead || '' })}\n`);
        return STEPHANOS_NATIVE_CAPACITY_RELOAD_EXIT_CODE;
      }
      const runtime = runtimeOptions(env, identity, keys.privateKeyPem, options.now ? options.now() : new Date());
      const result = await publishStephanosNativeCapacityV1({ ...runtime, fetchImpl: options.fetchImpl });
      const log = projection(result, runtime.sourceHead);
      (result.ok ? stdout : stderr).write(`${JSON.stringify(log)}\n`);
      if (once) return result.ok ? 0 : 1;
      if (!stopping) await (options.sleep || ((ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))))(refreshMs);
    } while (!stopping);
    return 0;
  } finally {
    if (!once || stopping) {
      await clearStephanosNativeCapacityStatus({ workspaceRoot: initialIdentity.workspaceRoot, repoRoot: initialIdentity.repoRoot }).catch(() => {});
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  return Boolean(argv1) && resolve(fileURLToPath(metaUrl)) === resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  process.exitCode = await runStephanosNativeCapacityPublisher();
}
