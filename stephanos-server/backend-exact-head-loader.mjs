import { spawnSync } from 'node:child_process';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let boundLoad = null;

function exactHeadGitEnvironment(environment = process.env) {
  const allowedNames = new Set([
    'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'tmpdir',
  ]);
  const sanitized = Object.fromEntries(
    Object.entries(environment).filter(([name]) => allowedNames.has(name.toLowerCase())),
  );
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const fixedConfig = [
    ['core.hooksPath', nullDevice], ['core.fsmonitor', 'false'], ['core.trustctime', 'true'],
    ['core.checkStat', 'default'], ['core.ignoreStat', 'false'], ['core.untrackedCache', 'false'],
    ['core.attributesFile', nullDevice], ['core.excludesFile', nullDevice], ['credential.helper', ''],
    ['protocol.allow', 'never'], ['protocol.https.allow', 'always'], ['submodule.recurse', 'false'],
    ['fetch.recurseSubmodules', 'false'], ['fetch.writeCommitGraph', 'false'], ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
  ];
  sanitized.GIT_CONFIG_COUNT = String(fixedConfig.length);
  fixedConfig.forEach(([key, value], index) => {
    sanitized[`GIT_CONFIG_KEY_${index}`] = key;
    sanitized[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  Object.assign(sanitized, {
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_GRAFT_FILE: nullDevice,
    GIT_NO_LAZY_FETCH: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  });
  return sanitized;
}

function inferModuleFormat(filePath, contextFormat) {
  switch (extname(filePath).toLowerCase()) {
    case '.js':
    case '.mjs':
      return 'module';
    case '.json':
      return 'json';
    default:
      return contextFormat || '';
  }
}

function canonicalRepositoryPath(filePath, canonicalRepoRoot) {
  const repoRelativePath = relative(canonicalRepoRoot, filePath);
  if (
    !repoRelativePath
    || isAbsolute(repoRelativePath)
    || repoRelativePath === '..'
    || repoRelativePath.startsWith(`..${sep}`)
  ) {
    return '';
  }

  const pathParts = repoRelativePath.split(sep);
  if (pathParts.some((part) => ['.git', 'node_modules'].includes(part.toLowerCase()))) {
    return '';
  }
  return pathParts.join('/');
}

export function createExactHeadSourceLoader({
  canonicalGitDirectory,
  canonicalRepoRoot,
  expectedHead,
  gitEnvironment,
  gitExecutable,
}) {
  const normalizedExpectedHead = String(expectedHead || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalizedExpectedHead)) {
    throw new Error('BACKEND_CHILD_EXACT_HEAD_MODULE_LOADER_EXPECTED_HEAD_INVALID');
  }
  const hardenedGitEnvironment = exactHeadGitEnvironment(gitEnvironment);

  return async function loadExactHeadSource(url, context, nextLoad) {
    if (!String(url).startsWith('file:')) return nextLoad(url, context);

    const filePath = fileURLToPath(url);
    const gitPath = canonicalRepositoryPath(filePath, canonicalRepoRoot);
    const format = inferModuleFormat(filePath, context?.format);
    if (!gitPath || !format) return nextLoad(url, context);

    const sourceProof = spawnSync(gitExecutable, [
      `--git-dir=${canonicalGitDirectory}`,
      `--work-tree=${canonicalRepoRoot}`,
      'show',
      `${normalizedExpectedHead}:${gitPath}`,
    ], {
      cwd: canonicalRepoRoot,
      env: hardenedGitEnvironment,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (sourceProof.error || sourceProof.status !== 0) {
      throw new Error(`BACKEND_CHILD_EXACT_HEAD_MODULE_BLOB_FAILED path=${gitPath}`);
    }

    return {
      format,
      shortCircuit: true,
      source: String(sourceProof.stdout || ''),
    };
  };
}

export function initialize(data) {
  boundLoad = createExactHeadSourceLoader(data);
}

export async function load(url, context, nextLoad) {
  if (!boundLoad) throw new Error('BACKEND_CHILD_EXACT_HEAD_MODULE_LOADER_NOT_INITIALIZED');
  return boundLoad(url, context, nextLoad);
}
