const APPROVED_RUNTIME_PREFIXES = Object.freeze([
  'apps/stephanos/dist/',
  'data/activity/',
  'data/knowledge-graph/',
  'data/proposals/',
  'data/roadmap/',
  'data/simulations/',
  'logs/',
  'node_modules/',
  'stephanos-server/node_modules/',
  'stephanos-ui/node_modules/',
  'stephanos-server/data/memory/durable-memory.json',
  'tmp',
  'tmp/',
  'memory/.dreams/',
  'memory/dreaming/deep/',
  'memory/dreaming/light/',
  'memory/dreaming/rem/',
]);
const SECRET_SHAPED_PATH = /(^|\/)(\.env($|\.)|.*(secret|token|credential|passwd|password|private[-_]?key).*)/i;

function splitRenamePaths(value) {
  const input = String(value || '').trim();
  let quoted = false;
  let escaped = false;
  for (let index = 0; index <= input.length - 4; index += 1) {
    const character = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (!quoted && input.slice(index, index + 4) === ' -> ') {
      return [input.slice(0, index), input.slice(index + 4)];
    }
  }
  return [input];
}

function normalizePorcelainPath(value) {
  return String(value || '').trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
}

function parsePorcelain(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      // A leading-space worktree status is lost by callers which trim the
      // complete porcelain output. Do not confuse the two status columns of a
      // rename (for example `R  old -> new`) with that compatibility shape.
      const leadingWorktreeStatusWasTrimmed = /^[MADRCU] [^ ]/.test(line);
      const status = leadingWorktreeStatusWasTrimmed ? ` ${line[0]}` : line.slice(0, 2);
      const rawPath = leadingWorktreeStatusWasTrimmed ? line.slice(2) : line.slice(3);
      const paths = splitRenamePaths(rawPath).map(normalizePorcelainPath).filter(Boolean);
      return {
        status,
        path: paths.at(-1) || '',
        paths,
      };
    })
    .filter((entry) => entry.path);
}

function stableEntries(entries = []) {
  return entries.map((entry) => `${entry.status} ${(entry.paths || [entry.path]).join(' -> ')}`).sort((a, b) => a.localeCompare(b));
}

function runtimePath(pathname) {
  if (SECRET_SHAPED_PATH.test(pathname)) return false;
  return APPROVED_RUNTIME_PREFIXES.some((prefix) => (
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix
  ));
}

export function classifyUpdateDirt(output = '') {
  const entries = parsePorcelain(output);
  const runtimeEntries = entries.filter((entry) => entry.paths.length > 0 && entry.paths.every(runtimePath));
  const sourceEntries = entries.filter((entry) => !runtimeEntries.includes(entry));
  return Object.freeze({
    entries,
    runtimeEntries,
    sourceEntries,
    runtime: [...new Set(runtimeEntries.flatMap((entry) => entry.paths))],
    source: [...new Set(sourceEntries.flatMap((entry) => entry.paths.filter((pathname) => !runtimePath(pathname))))],
  });
}

export function compareUpdateDirt(before = {}, after = {}) {
  const sourceBefore = stableEntries(before.sourceEntries || []);
  const sourceAfter = stableEntries(after.sourceEntries || []);
  const runtimeBefore = stableEntries(before.runtimeEntries || []);
  const runtimeAfter = stableEntries(after.runtimeEntries || []);
  return Object.freeze({
    sourceMutationDetected: JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter),
    runtimeMutationDetected: JSON.stringify(runtimeBefore) !== JSON.stringify(runtimeAfter),
    sourceDirtBefore: sourceBefore,
    sourceDirtAfter: sourceAfter,
    runtimeDirtBefore: runtimeBefore,
    runtimeDirtAfter: runtimeAfter,
  });
}
