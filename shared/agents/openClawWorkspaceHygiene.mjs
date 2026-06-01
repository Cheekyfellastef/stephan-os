const KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS = Object.freeze([
  '.openclaw',
  'DREAMS.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'memory',
]);

export const OPENCLAW_WORKSPACE_DIRT_PATHS = KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS;
export const OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY = 'runtime/openclaw-workspace/';
export const OPENCLAW_WORKSPACE_MIGRATION_COMMAND = 'New-Item -ItemType Directory -Force -Path "runtime\\openclaw-workspace" | Out-Null; Move-Item -Force ".openclaw","DREAMS.md","HEARTBEAT.md","IDENTITY.md","SOUL.md","TOOLS.md","USER.md","memory" "runtime\\openclaw-workspace\\"';
export const OPENCLAW_WORKSPACE_CLEANUP_COMMAND = OPENCLAW_WORKSPACE_MIGRATION_COMMAND;

const PATH_MATCHERS = new Map(KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS.map((path) => [path.toLowerCase(), path]));
const ROOT_FILE_PATTERN = /(^|[\s,;:[({"'`])(?:\.\/)?(\.openclaw\/?|DREAMS\.md|HEARTBEAT\.md|IDENTITY\.md|SOUL\.md|TOOLS\.md|USER\.md|memory\/?)(?=$|[\s,;:\])}"'`])/gi;
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

export function normalizeOpenClawWorkspacePath(path = '') {
  const text = asText(path, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^[.][\\/]/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
    .replace(/\s+$/g, '');
  if (!text) return '';
  if (text === '.openclaw' || text.startsWith('.openclaw/')) return '.openclaw';
  if (text === 'memory' || text.startsWith('memory/')) return 'memory';
  return PATH_MATCHERS.get(text.toLowerCase()) || text;
}

export function isOpenClawWorkspaceDirtPath(path = '') {
  return PATH_MATCHERS.has(normalizeOpenClawWorkspacePath(path).toLowerCase());
}

export function isSanctionedOpenClawWorkspacePath(path = '') {
  const text = asText(path, '')
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^[.][\\/]/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '');
  return text === OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY.replace(/\/$/, '')
    || text.startsWith(OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY);
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
    ? `Move the root-level OpenClaw workspace files into ${OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY} with the recommended PowerShell command, then rerun ignition/housekeep. Do not delete files; keep OpenClaw mutation locked.`
    : `No root-level OpenClaw workspace dirt detected; keep OpenClaw output in ${OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY} and leave mutation locked.`;
  return {
    workspaceHygieneStatus: dirtDetected ? 'blocked-openclaw-workspace-dirt' : 'clean',
    workspaceDirtDetected: dirtDetected ? 'yes' : 'no',
    workspaceDirtPaths: detected,
    workspaceDirtCount: detected.length,
    workspaceBlocksIgnition: blocksIgnition ? 'yes' : 'no',
    workspaceRecommendedCleanup: dirtDetected ? OPENCLAW_WORKSPACE_MIGRATION_COMMAND : 'No cleanup needed.',
    workspaceRecommendedMigration: dirtDetected ? OPENCLAW_WORKSPACE_MIGRATION_COMMAND : 'No migration needed.',
    workspaceSafeRuntimeDirectory: OPENCLAW_WORKSPACE_SAFE_RUNTIME_DIRECTORY,
    workspaceMutationAuthority: 'locked',
    workspaceNextOperatorAction: nextOperatorAction,
    workspaceClassification: dirtDetected ? 'openclaw-workspace-dirt-not-source-change' : 'none',
    cleanupCommandTargets: KNOWN_OPENCLAW_WORKSPACE_DIRT_PATHS,
  };
}
