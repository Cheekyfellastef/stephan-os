#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SELF_HOSTING_CRITICAL_BACKLOG } from '../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import { buildCompletionGuardianProjection } from '../shared/agents/completionGuardianV1.mjs';
import {
  createSharedWorkspaceHandoffRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  listMissionRecords,
  resolveMissionOrchestratorRoot,
} from '../stephanos-server/services/missionOrchestratorStore.js';

export const COMPLETION_GUARDIAN_RUNNER_SCHEMA = 'stephanos.completion-guardian-runner.v1';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function resolveCompletionGuardianPaths({
  env = process.env,
  home = os.homedir(),
  repoRoot,
  workspaceRoot,
  missionRoot,
} = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const resolvedRepoRoot = path.resolve(repoRoot || userHome, ...(repoRoot ? [] : ['Documents', 'GitHub', 'stephan-os']));
  const resolvedWorkspaceRoot = workspaceRoot
    ? path.resolve(workspaceRoot)
    : path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  const resolvedMissionRoot = missionRoot
    ? path.resolve(missionRoot)
    : resolveMissionOrchestratorRoot({ ...env, USERPROFILE: userHome });
  return Object.freeze({
    repoRoot: resolvedRepoRoot,
    workspaceRoot: resolvedWorkspaceRoot,
    missionRoot: resolvedMissionRoot,
  });
}

async function readGoals(workspaceRoot) {
  const root = path.resolve(workspaceRoot, 'goals');
  let names = [];
  try { names = await readdir(root); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const goals = [];
  for (const name of names.filter((value) => /^goal-[1-9]\d*\.json$/.test(value))) {
    try { goals.push(JSON.parse(await readFile(path.join(root, name), 'utf8'))); } catch {}
  }
  return goals;
}

function compactProjection(projection) {
  return Object.freeze({
    finalVerdict: projection.finalVerdict,
    actionableCount: projection.actionableCount,
    counts: projection.counts,
    repairQueue: projection.repairQueue,
    readyUnownedGoalIssueNumbers: projection.readyUnownedGoalIssueNumbers,
  });
}

export async function runCompletionGuardian(options = {}) {
  const paths = resolveCompletionGuardianPaths(options);
  const observedAtUtc = options.observedAtUtc || new Date().toISOString();
  const [goals, missions] = await Promise.all([
    options.goals || readGoals(paths.workspaceRoot),
    options.missions || listMissionRecords({ root: paths.missionRoot }),
  ]);
  const projection = buildCompletionGuardianProjection({
    goals,
    missions,
    backlog: options.backlog || SELF_HOSTING_CRITICAL_BACKLOG,
    regressedMissionIds: options.regressedMissionIds || [],
    observedAtUtc,
  });
  const compact = compactProjection(projection);
  const proofRef = 'proof/completion-guardian-current.json';
  const relatedIssue = '#1284';

  const proof = {
    ...createSharedWorkspaceProofRecord({
      proofId: 'completion-guardian-current',
      participantId: 'completion-guardian',
      timestampUtc: observedAtUtc,
      correlationId: 'completion-guardian-current',
      relatedIssue,
      status: projection.finalVerdict,
      summary: `Completion Guardian reconciled ${missions.length} missions and ${goals.length} durable goals; ${projection.actionableCount} item(s) require continuation.`,
      refs: [proofRef],
      proofRefs: [proofRef],
    }),
    schema: COMPLETION_GUARDIAN_RUNNER_SCHEMA,
    ...compact,
    duplicateSchedulerCreated: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
  };
  const proofWrite = await writeAtomicJson(paths.workspaceRoot, ['proof', 'completion-guardian-current.json'], proof, {
    repoRoot: paths.repoRoot,
    nowMs: Date.parse(observedAtUtc),
  });

  const status = {
    ...createSharedWorkspaceStatusRecord({
      statusId: 'completion-guardian-current',
      participantId: 'completion-guardian',
      timestampUtc: observedAtUtc,
      status: projection.finalVerdict,
      summary: proof.summary,
      proofRefs: [proofRef],
    }),
    schema: COMPLETION_GUARDIAN_RUNNER_SCHEMA,
    ...compact,
    proofRefs: [proofRef],
    running: true,
    nextSweepRequired: true,
    duplicateSchedulerCreated: false,
    mergeAuthority: false,
  };
  const statusWrite = await writeAtomicJson(paths.workspaceRoot, ['status', 'completion-guardian-current.json'], status, {
    repoRoot: paths.repoRoot,
    nowMs: Date.parse(observedAtUtc),
  });

  let handoffWrite = { ok: true, skipped: true, reason: 'NO_REPAIR_HANDOFF_REQUIRED' };
  if (projection.repairQueue.length > 0) {
    const primary = projection.repairQueue.find((item) => item.missionId === 'critical-1284-1286-completion-controller')
      || projection.repairQueue[0];
    const handoff = {
      ...createSharedWorkspaceHandoffRecord({
        handoffId: 'completion-guardian-repair-current',
        fromParticipantId: 'completion-guardian',
        toParticipantId: 'goal-building-agent',
        timestampUtc: observedAtUtc,
        correlationId: 'completion-guardian-current',
        relatedIssue: primary.issueNumbers[0] ? `#${primary.issueNumbers[0]}` : relatedIssue,
        proofRefs: [proofRef],
        summary: `Resume existing mission ${primary.missionId}; do not create a duplicate mission, branch, PR, or scheduler.`,
        body: JSON.stringify(primary),
      }),
      schema: COMPLETION_GUARDIAN_RUNNER_SCHEMA,
      requestedAction: primary.nextAction,
      existingMissionId: primary.missionId,
      duplicateMissionAllowed: false,
      duplicateBranchOrPrAllowed: false,
      mergeAuthority: false,
    };
    handoffWrite = await writeAtomicJson(paths.workspaceRoot, ['handoffs', 'completion-guardian-repair-current.json'], handoff, {
      repoRoot: paths.repoRoot,
      nowMs: Date.parse(observedAtUtc),
    });
  }

  const ok = proofWrite.ok === true && statusWrite.ok === true && handoffWrite.ok === true;
  return Object.freeze({
    schema: COMPLETION_GUARDIAN_RUNNER_SCHEMA,
    ok,
    finalVerdict: projection.finalVerdict,
    paths,
    projection,
    writes: Object.freeze({ proofWrite, statusWrite, handoffWrite }),
  });
}

export async function main(stdout = process.stdout) {
  const result = await runCompletionGuardian();
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) {
    console.error(`COMPLETION_GUARDIAN_BLOCKED: ${error?.message || error}`);
    process.exitCode = 2;
  }
}
