import { spawnSync } from 'node:child_process';
import { extname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let boundLoad = null;

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
      env: gitEnvironment,
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
