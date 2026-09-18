#!/usr/bin/env node
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
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

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function missionRunnerRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_RUNNER_ROOT);
  if (configured) return resolve(configured);
  if (!text(env.USERPROFILE)) return '';
  return resolve(env.USERPROFILE, 'Documents', 'OpenClaw-Standalone', 'mission-runner');
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

function runtimeOptions(env, privateKeyPem, now = new Date()) {
  return {
    workspaceRoot: text(env.STEPHANOS_SHARED_AGENT_WORKSPACE),
    repoRoot: text(env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT),
    repository: text(env.STEPHANOS_MISSION_WORKER_REPOSITORY) || 'Cheekyfellastef/stephan-os',
    sourceHead: text(env.STEPHANOS_MISSION_WORKER_HEAD_SHA).toLowerCase(),
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
      const runtime = runtimeOptions(env, keys.privateKeyPem, options.now ? options.now() : new Date());
      const result = await publishStephanosNativeCapacityV1({ ...runtime, fetchImpl: options.fetchImpl });
      const log = projection(result, runtime.sourceHead);
      (result.ok ? stdout : stderr).write(`${JSON.stringify(log)}\n`);
      if (once) return result.ok ? 0 : 1;
      if (!stopping) await (options.sleep || ((ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))))(refreshMs);
    } while (!stopping);
    return 0;
  } finally {
    const runtime = runtimeOptions(env, keys.privateKeyPem, options.now ? options.now() : new Date());
    await clearStephanosNativeCapacityStatus({ workspaceRoot: runtime.workspaceRoot, repoRoot: runtime.repoRoot }).catch(() => {});
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
