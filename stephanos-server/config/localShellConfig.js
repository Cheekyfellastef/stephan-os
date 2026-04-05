import { DEFAULT_STEPHANOS_REPO_PATH, normalizeStephanosRepoPath } from '../../shared/runtime/stephanosRepoShellConfig.mjs';

const ENV_REPO_PATH_KEYS = Object.freeze([
  'STEPHANOS_REPO_ROOT',
  'STEPHANOS_REPO_PATH',
  'REPO_ROOT',
]);

export function resolveStephanosRepoPath(env = process.env) {
  const configured = ENV_REPO_PATH_KEYS
    .map((key) => env?.[key])
    .find((value) => typeof value === 'string' && value.trim());
  return normalizeStephanosRepoPath(configured, DEFAULT_STEPHANOS_REPO_PATH);
}

export function getLocalShellConfig(env = process.env) {
  return {
    repoPath: resolveStephanosRepoPath(env),
    source: ENV_REPO_PATH_KEYS.find((key) => typeof env?.[key] === 'string' && env[key].trim()) || 'default',
    windowsOnly: true,
  };
}
