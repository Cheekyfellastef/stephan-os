import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LOCAL_CODEX_EXEC_INTEGRATION_SCHEMA = 'stephanos.local-codex-exec-integration.v1';
export const LOCAL_CODEX_TASK_SCHEMA = 'stephanos.codex-dispatch-task.v1';
export const LOCAL_CODEX_INTEGRATION_ID = 'battle-bridge-local-codex-exec-v1';

const SAFE_JOB_ID = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const ACTIVE_STATUSES = new Set(['DISPATCHED', 'CLAIMED', 'RUNNING', 'WAITING_PROOF']);

function defaultRepoRoot() {
  return resolve(fileURLToPath(new URL('../..', import.meta.url)));
}

function defaultWorkspaceRoot(env = process.env) {
  const explicit = String(env.STEPHANOS_SHARED_WORKSPACE || env.STEPHANOS_SHARED_AGENT_WORKSPACE || '').trim();
  if (explicit) return resolve(explicit);
  const home = env.USERPROFILE || env.HOME;
  if (!home) throw new Error('Unable to resolve the Stephanos shared workspace because USERPROFILE/HOME is missing.');
  return resolve(home, 'Documents', 'Stephanos-openclaw-workspace');
}

export function resolveLocalCodexDispatchPaths({
  repoRoot = process.env.STEPHANOS_REPO_ROOT || defaultRepoRoot(),
  workspaceRoot = defaultWorkspaceRoot(),
  jobId = '',
} = {}) {
  const repository = resolve(repoRoot);
  const workspace = resolve(workspaceRoot);
  const dispatchRoot = join(workspace, 'codex-dispatch');
  const tasksRoot = join(dispatchRoot, 'tasks');
  const receiptsRoot = join(workspace, 'receipts');
  const currentPath = join(dispatchRoot, 'current.json');
  if (!jobId) return { repoRoot: repository, workspaceRoot: workspace, dispatchRoot, tasksRoot, receiptsRoot, currentPath };
  if (!SAFE_JOB_ID.test(jobId)) throw new Error(`Unsafe Codex job id: ${jobId}`);
  const taskRoot = join(tasksRoot, jobId);
  return {
    repoRoot: repository,
    workspaceRoot: workspace,
    dispatchRoot,
    tasksRoot,
    receiptsRoot,
    currentPath,
    taskRoot,
    taskPath: join(taskRoot, 'task.json'),
    statusPath: join(taskRoot, 'status.json'),
    resultPath: join(taskRoot, 'result.json'),
    stdoutPath: join(taskRoot, 'codex.stdout.jsonl'),
    stderrPath: join(taskRoot, 'codex.stderr.log'),
    lastMessagePath: join(taskRoot, 'codex-last-message.txt'),
    receiptPath: join(receiptsRoot, `${jobId}.json`),
  };
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function readLocalCodexTaskStatus(jobId, options = {}) {
  const paths = resolveLocalCodexDispatchPaths({ ...options, jobId });
  return readJson(paths.statusPath) || readJson(paths.taskPath) || null;
}

export function readLocalCodexTaskResult(jobId, options = {}) {
  const paths = resolveLocalCodexDispatchPaths({ ...options, jobId });
  return readJson(paths.resultPath) || null;
}

export function createLocalCodexExecIntegration({
  repoRoot = process.env.STEPHANOS_REPO_ROOT || defaultRepoRoot(),
  workspaceRoot = defaultWorkspaceRoot(),
  spawnFn = spawn,
  now = () => new Date().toISOString(),
  idFactory = () => randomUUID(),
  workerPath = resolve(fileURLToPath(new URL('../../scripts/stephanos-codex-dispatch-worker.mjs', import.meta.url))),
} = {}) {
  const basePaths = resolveLocalCodexDispatchPaths({ repoRoot, workspaceRoot });

  return Object.freeze({
    integrationId: LOCAL_CODEX_INTEGRATION_ID,
    capabilities: Object.freeze({
      launchCodexJob: true,
      returnDispatchReceipt: true,
      returnProofMetadata: true,
    }),
    dispatch(packet) {
      if (!packet || !SAFE_JOB_ID.test(String(packet.jobId || ''))) {
        throw new Error('Local Codex dispatch requires a valid canonical queue packet.');
      }
      if (packet.mergeAuthority === true) throw new Error('Local Codex dispatch refuses merge authority.');
      if (!String(packet.prompt || '').trim()) throw new Error('Local Codex dispatch refuses an empty prompt.');

      mkdirSync(basePaths.tasksRoot, { recursive: true });
      mkdirSync(basePaths.receiptsRoot, { recursive: true });

      const current = readJson(basePaths.currentPath);
      if (current && ACTIVE_STATUSES.has(String(current.status || '')) && current.jobId !== packet.jobId) {
        throw new Error(`Local Codex dispatch blocked because ${current.jobId} is already ${current.status}.`);
      }

      const paths = resolveLocalCodexDispatchPaths({ repoRoot: basePaths.repoRoot, workspaceRoot: basePaths.workspaceRoot, jobId: packet.jobId });
      mkdirSync(paths.taskRoot, { recursive: true });
      const timestampUtc = now();
      const task = {
        schemaVersion: LOCAL_CODEX_TASK_SCHEMA,
        kind: 'stephanos.codex_dispatch.local_task',
        taskId: packet.jobId,
        jobId: packet.jobId,
        issueNumber: Number(packet.issueNumber || 0),
        branch: String(packet.branch || 'main'),
        taskType: 'battle-bridge-proof',
        prompt: String(packet.prompt),
        requestedProofCommands: Array.isArray(packet.requestedProofCommands) ? packet.requestedProofCommands.map(String) : [],
        exactHeadProof: packet.exactHeadProof ? {
          repository: String(packet.exactHeadProof.repository || ''),
          prNumber: Number(packet.exactHeadProof.prNumber || 0),
          expectedHead: String(packet.exactHeadProof.expectedHead || '').toLowerCase(),
          proofScenario: String(packet.exactHeadProof.proofScenario || ''),
        } : null,
        approvalRequirements: { ...(packet.approvalRequirements || {}) },
        repoRoot: paths.repoRoot,
        workspaceRoot: paths.workspaceRoot,
        createdAt: timestampUtc,
        status: 'DISPATCHED',
        safety: {
          mergeAllowed: false,
          pushAllowed: false,
          branchDeletionAllowed: false,
          hardResetAllowed: false,
          broadProcessKillAllowed: false,
          sourceMutationAllowed: false,
          generatedDistMutationAllowed: false,
          oneActiveJob: true,
          childApprovalPolicy: 'never',
          childSandboxMode: 'read-only',
          childMcpToolsAllowed: false,
        },
        proofRefs: [`proof/${packet.jobId}.json`, `receipts/${packet.jobId}.json`],
      };
      writeJson(paths.taskPath, task);
      writeJson(paths.statusPath, task);
      writeJson(paths.currentPath, task);

      const child = spawnFn(process.execPath, [workerPath, '--task', paths.taskPath], {
        cwd: paths.repoRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, STEPHANOS_REPO_ROOT: paths.repoRoot, STEPHANOS_SHARED_WORKSPACE: paths.workspaceRoot },
      });
      if (!child || !Number(child.pid || 0)) throw new Error('Local Codex worker did not return a process id.');
      if (typeof child.unref === 'function') child.unref();

      const receipt = {
        schemaVersion: LOCAL_CODEX_EXEC_INTEGRATION_SCHEMA,
        kind: 'stephanos.codex_dispatch.local_receipt',
        receiptId: `local-codex-${idFactory()}`,
        jobId: packet.jobId,
        accepted: true,
        started: true,
        timestampUtc,
        integrationId: LOCAL_CODEX_INTEGRATION_ID,
        workerPid: Number(child.pid),
        repoRoot: paths.repoRoot,
        taskPath: paths.taskPath,
        proofRefs: [`receipts/${packet.jobId}.json`, `proof/${packet.jobId}.json`],
        mergeAuthority: false,
        arbitraryShellAllowed: false,
      };
      writeJson(paths.receiptPath, receipt);
      return receipt;
    },
    readStatus(jobId) { return readLocalCodexTaskStatus(jobId, { repoRoot: basePaths.repoRoot, workspaceRoot: basePaths.workspaceRoot }); },
    readResult(jobId) { return readLocalCodexTaskResult(jobId, { repoRoot: basePaths.repoRoot, workspaceRoot: basePaths.workspaceRoot }); },
    paths: Object.freeze({ ...basePaths }),
  });
}

export function localCodexIntegrationInstalled(options = {}) {
  const paths = resolveLocalCodexDispatchPaths(options);
  return existsSync(paths.workspaceRoot) && existsSync(resolve(fileURLToPath(new URL('../../scripts/stephanos-codex-dispatch-worker.mjs', import.meta.url))));
}
