const KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS = Object.freeze([
  '.openclaw',
  'COMMANDS.md',
  'DREAMS.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'MEMORY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'exec_output.txt',
  'workspace_contents.txt',
  'memory',
]);

export const OPENCLAW_WORKSPACE_DIRT_PATHS = KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS;
export const OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY = '%USERPROFILE%\\Documents\\Stephanos-openclaw-workspace';
export const OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY_POSIX_HINT = '$HOME/Documents/Stephanos-openclaw-workspace';
export const OPENCLAW_EXTERNAL_AGENT_MEMORY_DIRECTORY = '%USERPROFILE%\\.openclaw\\agents/';
export const OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY = 'runtime/openclaw-workspace/';
export const OPENCLAW_WORKSPACE_SANCTIONED_DIRECTORY = OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY;
export const OPENCLAW_WORKSPACE_MIGRATION_COMMAND = `$workspace = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace'; New-Item -ItemType Directory -Force -Path $workspace | Out-Null; $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'; $migration = Join-Path $workspace ('root-migration-' + $stamp); $index = 2; while (Test-Path -LiteralPath $migration) { $migration = Join-Path $workspace ('root-migration-' + $stamp + '-' + $index); $index++ }; New-Item -ItemType Directory -Path $migration | Out-Null; $paths = @(${KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS.map((path) => `'${path}'`).join(',')}) | Where-Object { Test-Path -LiteralPath $_ }; foreach ($path in $paths) { Move-Item -LiteralPath $path -Destination $migration }; Write-Host "Moved OpenClaw workspace files/directories to $migration without deleting memory."`;
export const OPENCLAW_WORKSPACE_CLEANUP_COMMAND = OPENCLAW_WORKSPACE_MIGRATION_COMMAND;
export const OPENCLAW_WORKSPACE_SAFE_START_COMMAND_PREFIX = `$workspace = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace'; New-Item -ItemType Directory -Force -Path $workspace | Out-Null; Set-Location -LiteralPath $workspace;`;

const PATH_MATCHERS = new Map(KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS.map((path) => [path.toLowerCase(), path]));
const ROOT_FILE_PATTERN = /(^|[\s,;:[({"'`])(?:\.\/)?(\.openclaw\/?|COMMANDS\.md|DREAMS\.md|HEARTBEAT\.md|IDENTITY\.md|MEMORY\.md|SOUL\.md|TOOLS\.md|USER\.md|exec_output\.txt|workspace_contents\.txt|memory\/?)(?=$|[\s,;:\])}"'`])/gi;
const GIT_STATUS_PATH_PATTERN = /^(?:[ MADRCU?!]{1,2}|\?\?)\s+(.+?)(?:\s+->\s+(.+))?$/;

function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => asList(item));
  const text = asText(value, '');
  if (!text) return [];
  return text.split(/[\n,|]/).map((item) => asText(item, '')).filter(Boolean);
}

function normalizeComparablePath(path = '') {
  return asText(path, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/+$/g, '')
    .replace(/\s+$/g, '');
}

export function normalizeOpenClawWorkspacePath(path = '') {
  const text = normalizeComparablePath(path).replace(/^[.][\/]/, '');
  if (!text) return '';
  if (text === '.openclaw' || text.startsWith('.openclaw/')) return '.openclaw';
  if (text === 'memory' || text.startsWith('memory/')) return 'memory';
  return PATH_MATCHERS.get(text.toLowerCase()) || text;
}

export function isOpenClawWorkspaceDirtPath(path = '') {
  return PATH_MATCHERS.has(normalizeOpenClawWorkspacePath(path).toLowerCase());
}

export function resolveOpenClawWorkspaceRepairPath(env = process.env, platform = process.platform) {
  const userProfile = asText(env.USERPROFILE, '');
  if (userProfile) return `${userProfile.replace(/[\\/]+$/g, '')}\\Documents\\Stephanos-openclaw-workspace`;
  if (platform === 'win32') return OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY;
  const home = asText(env.HOME, '');
  if (home) return `${home.replace(/[\\/]+$/g, '')}/Documents/Stephanos-openclaw-workspace`;
  return OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY.replace(/\/$/, '');
}

export function isSanctionedOpenClawWorkspacePath(path = '') {
  const text = normalizeComparablePath(path).replace(/^[.][\/]/, '');
  const runtimeDirectory = OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY.replace(/\/$/, '');
  const externalTokenDirectory = OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY.replace(/\\/g, '/');
  const externalHintDirectory = OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY_POSIX_HINT.replace(/\\/g, '/');
  const externalAgentMemoryDirectory = OPENCLAW_EXTERNAL_AGENT_MEMORY_DIRECTORY.replace(/\\/g, '/').replace(/\/+$/g, '');
  const resolvedAgentMemoryDirectory = process.env.USERPROFILE
    ? `${process.env.USERPROFILE.replace(/[\\/]+$/g, '')}/.openclaw/agents`.replace(/\\/g, '/')
    : '';
  const resolvedExternalDirectory = normalizeComparablePath(resolveOpenClawWorkspaceRepairPath());
  return text === runtimeDirectory
    || text.startsWith(`${runtimeDirectory}/`)
    || text === externalTokenDirectory
    || text.startsWith(`${externalTokenDirectory}/`)
    || text === externalHintDirectory
    || text.startsWith(`${externalHintDirectory}/`)
    || text === externalAgentMemoryDirectory
    || text.startsWith(`${externalAgentMemoryDirectory}/`)
    || (resolvedAgentMemoryDirectory && (text === resolvedAgentMemoryDirectory || text.startsWith(`${resolvedAgentMemoryDirectory}/`)))
    || text === resolvedExternalDirectory
    || text.startsWith(`${resolvedExternalDirectory}/`);
}

function collectPathsFromText(text = '') {
  const output = [];
  const body = asText(text, '');
  if (!body) return output;
  for (const line of body.split('\n')) {
    const statusMatch = line.match(GIT_STATUS_PATH_PATTERN);
    if (statusMatch) {
      output.push(statusMatch[2] || statusMatch[1]);
    }
  }
  for (const match of body.matchAll(ROOT_FILE_PATTERN)) {
    output.push(match[2]);
  }
  return output;
}

function collectCandidatePaths(input = {}) {
  const safeInput = input && typeof input === 'object' ? input : {};
  return [
    ...asList(safeInput.paths),
    ...asList(safeInput.openClawWorkspaceDirtPaths),
    ...asList(safeInput.openclawWorkspaceDirtPaths),
    ...asList(safeInput.ignitionHardBlockPaths),
    ...asList(safeInput.hardBlockPaths),
    ...asList(safeInput.blockedFiles),
    ...asList(safeInput.statusPaths),
    ...collectPathsFromText(safeInput.gitStatusText),
    ...collectPathsFromText(safeInput.housekeepOutput),
    ...collectPathsFromText(safeInput.diagnosticText),
    ...collectPathsFromText(safeInput.openClawDiagnosticText),
  ];
}

export function buildOpenClawWorkspaceHygieneProjection(input = {}) {
  const detected = [];
  const seen = new Set();
  for (const path of collectCandidatePaths(input)) {
    if (isSanctionedOpenClawWorkspacePath(path)) continue;
    const normalized = normalizeOpenClawWorkspacePath(path);
    if (!isOpenClawWorkspaceDirtPath(normalized)) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    detected.push(normalized);
  }
  const dirtDetected = detected.length > 0;
  const blocksIgnition = dirtDetected && (input.ignitionBlockedReason === 'Hard-block dirt detected'
    || input.ignitionStatus === 'BLOCKED'
    || input.ignitionCleanlinessVerdict === 'blocked'
    || input.blocksIgnition === true
    || input.openClawWorkspaceBlocksIgnition === true
    || input.housekeepBlocked === true
    || collectPathsFromText(input.housekeepOutput).some((path) => !isSanctionedOpenClawWorkspacePath(path)));
  const nextOperatorAction = dirtDetected
    ? `Move the root-level OpenClaw workspace files into ${OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY} with the recommended PowerShell command, then rerun ignition/housekeep. Do not delete files; keep OpenClaw mutation locked.`
    : `No root-level OpenClaw workspace dirt detected; keep OpenClaw output in ${OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY} and leave mutation locked.`;
  return {
    workspaceHygieneStatus: dirtDetected ? 'blocked-openclaw-workspace-dirt' : 'clean',
    workspaceDirtDetected: dirtDetected ? 'yes' : 'no',
    workspaceDirtPaths: detected,
    workspaceDirtCount: detected.length,
    workspaceBlocksIgnition: blocksIgnition ? 'yes' : 'no',
    workspaceRecommendedCleanup: dirtDetected ? OPENCLAW_WORKSPACE_MIGRATION_COMMAND : 'No cleanup needed.',
    workspaceRecommendedMigration: dirtDetected ? OPENCLAW_WORKSPACE_MIGRATION_COMMAND : 'No migration needed.',
    workspaceSafeRuntimeDirectory: OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY,
    workspaceFallbackIgnoredRuntimeDirectory: OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY,
    workspaceMutationAuthority: 'locked',
    workspaceNextOperatorAction: nextOperatorAction,
    workspaceClassification: dirtDetected ? 'openclaw-workspace-dirt-not-source-change' : 'none',
    cleanupCommandTargets: KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS,
  };
}
