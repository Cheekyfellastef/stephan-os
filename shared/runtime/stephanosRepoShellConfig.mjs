export const DEFAULT_STEPHANOS_REPO_PATH = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';

export function normalizeStephanosRepoPath(value, fallback = DEFAULT_STEPHANOS_REPO_PATH) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

export function buildPowerShellCdCommand(repoPath) {
  return `cd "${normalizeStephanosRepoPath(repoPath).replace(/"/g, '\\"')}"`;
}
