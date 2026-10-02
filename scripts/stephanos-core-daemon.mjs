#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  projectStephanosCoreDaemonState,
  shouldReloadStephanosCoreDaemon,
} from '../shared/agents/stephanosCoreDaemonV1.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = String(process.env.USERPROFILE || process.env.HOME || homedir()).trim();
const workspaceRoot = resolve(
  process.env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || resolve(profile, 'Documents', 'Stephanos-openclaw-workspace'),
);
const localStateRoot = resolve(process.env.LOCALAPPDATA || resolve(profile, 'AppData', 'Local'), 'Stephanos');
const lockPath = resolve(localStateRoot, 'stephanos-core-daemon.lock.json');
const workerHeartbeatPath = resolve(workspaceRoot, 'status', 'mission-orchestrator-worker-heartbeat.json');
const gamingStatePath = resolve(workspaceRoot, 'status', 'vr-resource-governor-current.json');
const GIT = process.platform === 'win32' ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';
const HEARTBEAT_MS = 15_000;
const RELATED_ISSUE = '#2593';
const PROOF_REF = 'proof/stephanos-core-daemon-current.json';

function currentHead() {
  const result = spawnSync(GIT, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
  });
  const head = String(result.stdout || '').trim().toLowerCase();
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/.test(head)) {
    throw new Error('STEPHANOS_CORE_DAEMON_SOURCE_HEAD_UNAVAILABLE');
  }
  return head;
}

async function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireSingleInstance(sourceHead) {
  await mkdir(localStateRoot, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({
        schemaVersion: 'stephanos.core-daemon-lock.v1',
        pid: process.pid,
        sourceHead,
        startedAtUtc: new Date().toISOString(),
      }));
      return handle;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let stale = true;
      try {
        const existing = JSON.parse(await readFile(lockPath, 'utf8'));
        stale = !(await processAlive(Number(existing?.pid)));
      } catch {}
      if (!stale) return null;
      try { await unlink(lockPath); } catch {}
    }
  }
  return null;
}

async function probe(url, expectedService = '') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) return false;
    if (!expectedService) return true;
    const body = await response.json();
    return body?.ok === true && body?.service === expectedService;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fileAgeMs(path) {
  try {
    const info = await stat(path);
    return Math.max(0, Date.now() - info.mtimeMs);
  } catch {
    return null;
  }
}

async function gamingActive() {
  try {
    const value = JSON.parse(await readFile(gamingStatePath, 'utf8'));
    return value?.active === true || /gaming|vr|flat/i.test(String(value?.phase || ''));
  } catch {
    return false;
  }
}

async function publish(state, timestampUtc) {
  const layout = await ensureSharedWorkspaceLayout({ root: workspaceRoot, repoRoot });
  if (!layout.ok) throw new Error('STEPHANOS_CORE_DAEMON_SHARED_WORKSPACE_UNAVAILABLE');

  const common = {
    heartbeatAtUtc: timestampUtc,
    sourceHead: state.sourceHead,
    processId: process.pid,
    readiness: state.readiness,
    daemonHealthy: state.daemonHealthy,
    sovereignCommanderHealthy: state.sovereignCommanderHealthy,
    backendHealthy: state.backendHealthy,
    missionWorkerHealthy: state.missionWorkerHealthy,
    missionWorkerHeartbeatAgeMs: state.missionWorkerHeartbeatAgeMs,
    gamingActive: state.gamingActive,
    computePosture: state.computePosture,
    uiRequired: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    schedulerAuthority: false,
    leaseAuthority: false,
    arbitraryShellAllowed: false,
    pcRestartAuthority: false,
    canonicalMissionWorkerOnly: true,
    sovereignCommanderIsMachineExecutor: true,
    duplicateControllerFabricAllowed: false,
    finalVerdict: state.finalVerdict,
  };

  const status = {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'stephanos-core-daemon-current',
      participantId: 'stephanos-core',
      timestampUtc,
      relatedIssue: RELATED_ISSUE,
      status: state.readiness,
      summary: `Stephanos Core Daemon is ${state.readiness}; UI is not required for core continuity.`,
      proofRefs: [PROOF_REF],
    }),
    ...common,
  };
  const proof = {
    ...createSharedWorkspaceProofRecord({
      proofId: 'stephanos-core-daemon-current',
      participantId: 'stephanos-core',
      timestampUtc,
      correlationId: 'stephanos-core-daemon-heartbeat',
      relatedIssue: RELATED_ISSUE,
      status: state.readiness,
      summary: 'Persistent Core Daemon heartbeat and bounded dependency observation.',
      refs: [`source:${state.sourceHead}`],
      proofRefs: [PROOF_REF],
    }),
    ...common,
  };
  const [statusWrite, proofWrite] = await Promise.all([
    writeAtomicJson(workspaceRoot, ['status', 'stephanos-core-daemon-current.json'], status, { repoRoot }),
    writeAtomicJson(workspaceRoot, ['proof', 'stephanos-core-daemon-current.json'], proof, { repoRoot }),
  ]);
  if (!statusWrite.ok || !proofWrite.ok) throw new Error('STEPHANOS_CORE_DAEMON_HEARTBEAT_WRITE_FAILED');
}

async function sample(sourceHead) {
  const [sovereignCommanderHealthy, backendHealthy, missionWorkerHeartbeatAgeMs, isGamingActive] = await Promise.all([
    probe('http://127.0.0.1:18791/health', 'stephanos-sovereign-commander'),
    probe('http://127.0.0.1:8787/api/health'),
    fileAgeMs(workerHeartbeatPath),
    gamingActive(),
  ]);
  return projectStephanosCoreDaemonState({
    sourceHead,
    sovereignCommanderHealthy,
    backendHealthy,
    missionWorkerHeartbeatAgeMs,
    gamingActive: isGamingActive,
  });
}

const sourceHead = currentHead();
const lockHandle = await acquireSingleInstance(sourceHead);
if (!lockHandle) {
  console.log(JSON.stringify({
    ok: true,
    finalVerdict: 'STEPHANOS_CORE_DAEMON_ALREADY_RUNNING',
    sourceHead,
  }));
  process.exit(0);
}

let shuttingDown = false;
async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await lockHandle.close(); } catch {}
  try {
    const current = JSON.parse(await readFile(lockPath, 'utf8'));
    if (Number(current?.pid) === process.pid) await unlink(lockPath);
  } catch {}
}
process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });

try {
  while (true) {
    const observedHead = currentHead();
    if (shouldReloadStephanosCoreDaemon(sourceHead, observedHead)) {
      const state = projectStephanosCoreDaemonState({
        sourceHead,
        sovereignCommanderHealthy: false,
        backendHealthy: false,
        missionWorkerHeartbeatAgeMs: null,
        gamingActive: false,
      });
      await publish({ ...state, readiness: 'RELOAD_REQUIRED', finalVerdict: 'STEPHANOS_CORE_DAEMON_SOURCE_ADVANCED' }, new Date().toISOString());
      await cleanup();
      process.exit(75);
    }
    const state = await sample(sourceHead);
    await publish(state, new Date().toISOString());
    await new Promise((resolveWait) => setTimeout(resolveWait, HEARTBEAT_MS));
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    blocker: String(error?.message || error),
    finalVerdict: 'STEPHANOS_CORE_DAEMON_FAILED',
  }));
  await cleanup();
  process.exit(2);
}
