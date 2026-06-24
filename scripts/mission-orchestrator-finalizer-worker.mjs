import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMissionWorkerTick } from './mission-orchestrator-worker.mjs';
import {
  processNextLocalDeploymentItem,
  processNextVerificationItem,
} from '../stephanos-server/services/missionOrchestratorFinalizerConsumer.js';

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function hashOutput(stdout, stderr) {
  return createHash('sha256').update(`${stdout || ''}\n${stderr || ''}`, 'utf8').digest('hex');
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function parseLocalDeploymentOutput(stdout = '') {
  try {
    const result = JSON.parse(String(stdout).trim());
    if (result?.schemaVersion !== 'stephanos.local-deployment-result.v1') {
      throw new Error('Local deployment result schema is unsupported.');
    }
    return result;
  } catch (error) {
    throw new Error(`Local deployment returned invalid JSON: ${error.message}`);
  }
}

export async function executeLocalDeployment(action, _claim, options = {}) {
  if (action?.actionKind !== 'local-deployment') {
    throw new Error('Unsupported local deployment action.');
  }
  const repositoryRoot = text(action.repositoryRoot);
  const mergeCommitSha = text(action.mergeCommitSha).toLowerCase();
  const scriptPath = options.deploymentScriptPath
    || resolve(repositoryRoot, 'scripts', 'windows', 'invoke-mission-orchestrator-local-deployment.ps1');
  if (!repositoryRoot || !/^[a-f0-9]{40}$/.test(mergeCommitSha) || !existsSync(scriptPath)) {
    throw new Error('Local deployment requires an exact merge commit and installed deployment script.');
  }
  const run = options.runCommand || defaultRun;
  const result = run(options.powerShellExecutable || 'powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-StephanosRepositoryRoot',
    repositoryRoot,
    '-MissionId',
    action.missionId,
    '-ExpectedMergeCommit',
    mergeCommitSha,
  ], { cwd: repositoryRoot, env: options.env || process.env });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  let parsed;
  try {
    parsed = parseLocalDeploymentOutput(stdout);
  } catch (error) {
    return {
      success: false,
      error: result.error?.message || stderr || error.message,
      steps: {},
      commandOutputHash: hashOutput(stdout, stderr),
      completedAt: new Date().toISOString(),
    };
  }
  return {
    ...parsed,
    success: !result.error && result.status === 0 && parsed.success === true,
    error: parsed.error || result.error?.message || (result.status === 0 ? '' : stderr || `Deployment exited with code ${result.status}.`),
    commandOutputHash: hashOutput(stdout, stderr),
  };
}

export async function runMissionFinalizerTick(options = {}) {
  const worker = await runMissionWorkerTick(options);
  const verification = await processNextVerificationItem(options);
  const deployment = await processNextLocalDeploymentItem({
    ...options,
    executeLocalDeployment: (action, claim) => executeLocalDeployment(action, claim, options),
  });
  return { worker, verification, deployment };
}

async function main() {
  const once = process.argv.includes('--once');
  const intervalMs = Number.parseInt(process.env.STEPHANOS_MISSION_WORKER_INTERVAL_MS || '2000', 10);
  do {
    try {
      const result = await runMissionFinalizerTick();
      process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), ...result })}\n`);
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        checkedAt: new Date().toISOString(),
        finalVerdict: 'MISSION_FINALIZER_TICK_FAILED',
        error: error.message,
      })}\n`);
      if (once) process.exitCode = 1;
    }
    if (!once) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(intervalMs, 250)));
    }
  } while (!once);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main();
