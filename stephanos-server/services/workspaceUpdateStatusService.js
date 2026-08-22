import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function text(value, fallback = '') {
  const normalized = String(value || '').trim();
  return normalized || fallback;
}

async function git(args, options = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: options.cwd || process.cwd(),
      timeout: Number.isFinite(options.timeoutMs) ? options.timeoutMs : 2500,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return { ok: true, stdout: text(result.stdout), stderr: text(result.stderr) };
  } catch (error) {
    return { ok: false, stdout: text(error?.stdout), stderr: text(error?.stderr || error?.message) };
  }
}

function cleanSha(value) {
  const candidate = text(value);
  return SHA_PATTERN.test(candidate) ? candidate : '';
}

function deriveStatus({ enabled, dirty, localSha, mainSha, remoteKnown, buildRequired }) {
  if (!enabled) return 'AUTO_UPDATE_NOT_ENABLED';
  if (dirty) return 'PULL_REQUIRED';
  if (remoteKnown && localSha && mainSha && localSha !== mainSha) return 'UPDATE_AVAILABLE';
  if (buildRequired) return 'REBUILD_REQUIRED';
  return 'CURRENT';
}

function nextActionFor(status, dirty) {
  if (dirty) return 'Review and commit or stash local workspace changes before any pull or rebuild.';
  switch (status) {
    case 'UPDATE_AVAILABLE':
    case 'PULL_REQUIRED':
      return 'Manually run the Battle Bridge git pull helper, then rebuild and refresh Stephanos UI.';
    case 'REBUILD_REQUIRED':
      return 'Manually rebuild Stephanos UI, then refresh the browser after the build completes.';
    case 'CURRENT':
      return 'No update action is required; use manual refresh if the browser still shows stale UI.';
    case 'AUTO_UPDATE_NOT_ENABLED':
    default:
      return 'Auto-update is not enabled; manually refresh status before pulling, rebuilding, or reloading the UI.';
  }
}

export async function readWorkspaceUpdateStatus(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const autoUpdateEnabled = env.STEPHANOS_SAFE_AUTO_UPDATE === '1' || env.STEPHANOS_SAFE_AUTO_UPDATE === 'true';
  const [local, remote, status] = await Promise.all([
    git(['rev-parse', 'HEAD'], { cwd }),
    git(['rev-parse', 'origin/main'], { cwd }),
    git(['status', '--porcelain'], { cwd }),
  ]);
  const localSha = cleanSha(local.stdout);
  const mainSha = cleanSha(remote.stdout);
  const dirty = status.ok ? Boolean(status.stdout) : null;
  const remoteKnown = Boolean(mainSha);
  const buildRequired = env.STEPHANOS_REBUILD_REQUIRED === '1' || env.STEPHANOS_REBUILD_REQUIRED === 'true';
  const updateStatus = deriveStatus({ enabled: autoUpdateEnabled, dirty: dirty === true, localSha, mainSha, remoteKnown, buildRequired });

  return {
    schemaVersion: 'stephanos.workspace-update-status.v1',
    source: 'local-git-read-only',
    generatedAt: new Date().toISOString(),
    status: updateStatus,
    autoUpdateEnabled,
    autoPullAttempted: false,
    autoRebuildAttempted: false,
    manualRefreshRequired: true,
    dirtyTree: dirty,
    localSha,
    mainSha,
    remoteKnown,
    pullRequired: ['UPDATE_AVAILABLE', 'PULL_REQUIRED'].includes(updateStatus),
    rebuildRequired: updateStatus === 'REBUILD_REQUIRED',
    nextOperatorAction: nextActionFor(updateStatus, dirty === true),
    battleBridgeGitPullHelper: 'npm run stephanos:publish-merge',
    uiRefreshAfterBuild: 'manual-browser-refresh-required',
    receiptsRoute: 'shared-workspace/status/workspace-update-status.json',
    finalVerdict: updateStatus,
  };
}
