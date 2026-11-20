#!/usr/bin/env node
// TEMPORARY RESCUE: independent of elastic admission, never an independent writer.
// The only potentially mutating operation below is the EXISTING canonical,
// exact-bound lease reconciler. There is no direct lease delete/update API.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  createSharedWorkspaceStatusRecord, writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { projectTemporarySovereignLeaseRescueV1 } from
  '../shared/agents/temporarySovereignLeaseRescueV1.mjs';
import { readSourceMutationLease } from
  '../stephanos-server/services/programmeAuthorityService.js';
import { listMissionRecords } from
  '../stephanos-server/services/missionOrchestratorStore.js';
import {
  inspectOriginalTerminalWorkerPairV1, reconcileExpiredElasticReviewLeaseV1,
} from '../stephanos-server/services/elasticPrHeadLeaseService.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const profile = String(process.env.USERPROFILE || process.env.HOME || homedir()).trim();
const workspaceRoot = resolve(process.env.STEPHANOS_SHARED_AGENT_WORKSPACE
  || resolve(profile, 'Documents', 'Stephanos-openclaw-workspace'));
const intervalMs = 60_000;
const gitExecutable = process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\cmd\\git.exe' : 'git';

function currentHead() {
  const r = spawnSync(gitExecutable, ['-C', repoRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000,
  });
  const head = String(r?.stdout || '').trim().toLowerCase();
  return r?.status === 0 && /^[a-f0-9]{40}$/.test(head) ? head : '';
}

export async function runTemporarySovereignRescueObservationV1({
  now = new Date(),
  env = process.env,
  readLease = readSourceMutationLease,
  readMissions = listMissionRecords,
  inspectPair = inspectOriginalTerminalWorkerPairV1,
  reconcile = reconcileExpiredElasticReviewLeaseV1,
  writeStatus = writeAtomicJson,
  sourceHead = currentHead(),
  paths = { repoRoot, workspaceRoot },
} = {}) {
  const timestampUtc = now.toISOString();
  let leaseRead = null;
  let forensic = null;
  let canonicalReconciliation = null;
  try {
    leaseRead = await readLease({
      root: paths.workspaceRoot, repoRoot: paths.repoRoot, nowUtc: timestampUtc,
    });
  } catch {
    leaseRead = { ok: false, present: null };
  }
  const lease = leaseRead?.record;
  // Read-only original-worker forensic check; it cannot authorize release.
  if (leaseRead?.ok === true && leaseRead?.present === true
      && String(lease?.leaseId || '').startsWith('critical-2962-elastic-goal-')) {
    try {
      forensic = await inspectPair({
        lease, missionId: lease.laneId, env,
      });
    } catch {
      forensic = { classification: 'ORIGINAL_TERMINAL_QUEUE_UNOBSERVABLE' };
    }
  }
  // Do not use elastic admission to bootstrap: that is the blocked subsystem.
  // The canonical reconciler may release ONLY after its own identity,
  // terminal-receipt, worker-quiescence and exact-lease guards all succeed.
  if (leaseRead?.ok === true && leaseRead?.present === true
      && String(lease?.leaseId || '').startsWith('critical-2962-elastic-goal-')
      && leaseRead?.validation?.valid === true
      && leaseRead?.validation?.stale === true
      && /^[a-f0-9]{40}$/.test(sourceHead)) {
    try {
      const missions = await readMissions({ env });
      canonicalReconciliation = await reconcile({
        now, env, paths, sourceRevision: sourceHead,
        missionRecords: missions,
      });
    } catch {
      canonicalReconciliation = {
        ok: false, released: false,
        blocker: 'ORIGINAL_WORKER_RECONCILIATION_UNVERIFIED',
      };
    }
  }
  const view = projectTemporarySovereignLeaseRescueV1({
    timestampUtc, sourceHead, leaseRead, forensic, canonicalReconciliation,
  });
  const record = {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'temporary-sovereign-rescue-lane-current',
      participantId: 'temporary-sovereign-rescue',
      relatedIssue: '#2961',
      timestampUtc,
      status: 'HELD',
      summary: 'Independent exact-bound lease observation; canonical pickup not yet proven.',
    }),
    rescue: view,
  };
  const publication = await writeStatus(paths.workspaceRoot,
    ['status', 'temporary-sovereign-rescue-lane-current.json'],
    record, { repoRoot: paths.repoRoot });
  return Object.freeze({
    ...view,
    publicationOk: publication?.ok === true,
    publicationBlocker: publication?.ok === true ? ''
      : String(publication?.reason || 'RESCUE_STATUS_PUBLICATION_UNVERIFIED'),
  });
}

async function main() {
  if (!['--once', '--watch'].includes(process.argv[2] || '--once')
      || process.argv.length > 3) {
    process.stderr.write('Usage: node temporary-sovereign-lease-rescue.mjs [--once|--watch]\n');
    process.exitCode = 2;
    return;
  }
  const watch = process.argv[2] === '--watch';
  let stopped = false;
  process.on('SIGINT', () => { stopped = true; });
  process.on('SIGTERM', () => { stopped = true; });
  do {
    try {
      const result = await runTemporarySovereignRescueObservationV1();
      process.stdout.write('TEMPORARY_SOVEREIGN_LEASE_RESCUE_RESULT='
        + JSON.stringify(result) + '\n');
      if (!result.publicationOk) process.exitCode = 1;
    } catch {
      process.stderr.write('TEMPORARY_SOVEREIGN_RESCUE_CYCLE_FAILED\n');
      process.exitCode = 1;
    }
    if (watch && !stopped) await new Promise(r => setTimeout(r, intervalMs));
  } while (watch && !stopped);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
