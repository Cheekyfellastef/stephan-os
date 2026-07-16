#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  publishRemoteCodexTaskVisibility,
} from '../shared/agents/remoteCodexTaskVisibility.mjs';

export const REMOTE_CODEX_VISIBILITY_OBSERVER_SCHEMA = 'stephanos.remote-codex-task-visibility-observer.v1';

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function defaultProcessIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function readJson(target) {
  try { return JSON.parse(await readFile(target, 'utf8')); } catch { return null; }
}

export function resolveRemoteCodexVisibilityObserverPaths({ env = process.env, home = os.homedir() } = {}) {
  const userHome = path.resolve(env.USERPROFILE || env.HOME || home);
  const repoRoot = path.resolve(userHome, 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = path.resolve(userHome, 'Documents', 'Stephanos-openclaw-workspace');
  return Object.freeze({
    repoRoot,
    workspaceRoot,
    currentTaskPath: path.resolve(workspaceRoot, 'codex-dispatch', 'current.json'),
    tasksRoot: path.resolve(workspaceRoot, 'codex-dispatch', 'tasks'),
  });
}

function safeJobId(value) {
  const jobId = text(value);
  return /^[a-z0-9][a-z0-9._:-]{0,120}$/i.test(jobId) ? jobId : '';
}

export async function observeRemoteCodexTaskVisibility({
  env = process.env,
  now = new Date(),
  paths = resolveRemoteCodexVisibilityObserverPaths({ env }),
  processIsAliveFn = defaultProcessIsAlive,
  publisher = publishRemoteCodexTaskVisibility,
} = {}) {
  const current = await readJson(paths.currentTaskPath);
  if (!current) {
    return Object.freeze({
      ok: true,
      schemaVersion: REMOTE_CODEX_VISIBILITY_OBSERVER_SCHEMA,
      classification: 'REMOTE_CODEX_VISIBILITY_NO_CURRENT_TASK',
      published: false,
    });
  }

  const jobId = safeJobId(current.jobId || current.taskId);
  if (!jobId) {
    return Object.freeze({
      ok: false,
      schemaVersion: REMOTE_CODEX_VISIBILITY_OBSERVER_SCHEMA,
      classification: 'REMOTE_CODEX_VISIBILITY_UNSAFE_CURRENT_TASK',
      published: false,
    });
  }

  const resultPath = path.resolve(paths.tasksRoot, jobId, 'result.json');
  const result = await readJson(resultPath);
  const status = text(result?.status || current.status, 'UNKNOWN').toUpperCase();
  const workerPid = Number.parseInt(current.workerPid ?? result?.workerPid, 10);
  const workerAlive = status === 'RUNNING' ? processIsAliveFn(workerPid) : false;
  const resultAvailable = Boolean(result) || ['DONE', 'FAILED', 'BLOCKED'].includes(status);
  const timestampUtc = now.toISOString();
  const input = {
    ...current,
    ...(result || {}),
    jobId,
    taskId: current.taskId || result?.taskId || jobId,
    status,
    timestampUtc,
    heartbeatUtc: result?.heartbeatUtc || current.heartbeatUtc || current.startedAt || current.createdAt || '',
    workerAlive,
    resultAvailable,
    resultVerdict: result?.resultVerdict || result?.verdict || current.resultVerdict || current.verdict || '',
    sourceHead: result?.sourceHeadAfter || result?.sourceHeadBefore || current.sourceHeadAfter || current.sourceHeadBefore || '',
    nextAction: result?.nextOperatorAction || current.nextOperatorAction || '',
  };

  const publication = await publisher(paths.workspaceRoot, input, {
    repoRoot: paths.repoRoot,
    nowMs: now.getTime(),
    timestampUtc,
  });

  return Object.freeze({
    ok: publication.ok === true,
    schemaVersion: REMOTE_CODEX_VISIBILITY_OBSERVER_SCHEMA,
    classification: publication.ok ? 'REMOTE_CODEX_VISIBILITY_RECONCILED' : 'REMOTE_CODEX_VISIBILITY_RECONCILIATION_FAILED',
    published: publication.ok === true,
    jobId,
    taskStatus: status,
    taskState: publication.slice?.state || '',
    workerAlive,
    resultAvailable,
    reason: publication.reason || '',
  });
}

function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) {
  if (!argv1) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1);
}

if (isDirectCliEntrypoint()) {
  const result = await observeRemoteCodexTaskVisibility();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
