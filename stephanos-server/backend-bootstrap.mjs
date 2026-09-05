import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bootstrapDataUrlPrefix = 'data:text/javascript;base64,';
const bootstrapIsProcessBound = import.meta.url.startsWith(bootstrapDataUrlPrefix);
const bootstrapSourceFile = bootstrapIsProcessBound ? '' : fileURLToPath(import.meta.url);
const processBoundBootstrapSource = bootstrapIsProcessBound
  ? Buffer.from(import.meta.url.slice(bootstrapDataUrlPrefix.length), 'base64').toString('utf8')
  : '';
const canonicalRepoRoot = resolve(
  String(process.env.STEPHANOS_BACKEND_REPO_ROOT || '').trim()
    || (bootstrapSourceFile ? resolve(dirname(bootstrapSourceFile), '..') : ''),
);
if (bootstrapIsProcessBound && !String(process.env.STEPHANOS_BACKEND_REPO_ROOT || '').trim()) {
  throw new Error('BACKEND_CHILD_REPO_ROOT_REQUIRED');
}
const canonicalGitDirectory = resolve(canonicalRepoRoot, '.git');
const expectedHead = String(process.env.STEPHANOS_BACKEND_SOURCE_HEAD || '').trim().toLowerCase();
const gitExecutable = process.platform === 'win32'
  ? 'C:\\Program Files\\Git\\cmd\\git.exe'
  : '/usr/bin/git';

function minimalBackendChildGitEnvironment() {
  const allowedNames = new Set([
    'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'tmpdir',
  ]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => allowedNames.has(name.toLowerCase())),
  );
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const fixedConfig = [
    ['core.hooksPath', nullDevice],
    ['core.fsmonitor', 'false'],
    ['core.trustctime', 'true'],
    ['core.checkStat', 'default'],
    ['core.ignoreStat', 'false'],
    ['core.untrackedCache', 'false'],
    ['core.attributesFile', nullDevice],
    ['core.excludesFile', nullDevice],
    ['credential.helper', ''],
    ['protocol.allow', 'never'],
    ['protocol.https.allow', 'always'],
    ['submodule.recurse', 'false'],
    ['fetch.recurseSubmodules', 'false'],
    ['fetch.writeCommitGraph', 'false'],
    ['gc.auto', '0'],
    ['maintenance.auto', 'false'],
  ];
  environment.GIT_CONFIG_COUNT = String(fixedConfig.length);
  fixedConfig.forEach(([key, value], index) => {
    environment[`GIT_CONFIG_KEY_${index}`] = key;
    environment[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  Object.assign(environment, {
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
  return environment;
}

function readExactHeadBlob(gitPath, maxBuffer) {
  const result = spawnSync(gitExecutable, [
    `--git-dir=${canonicalGitDirectory}`,
    `--work-tree=${canonicalRepoRoot}`,
    'show',
    `${expectedHead}:${gitPath}`,
  ], {
    cwd: canonicalRepoRoot,
    env: minimalBackendChildGitEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer,
  });
  if (result.error || result.status !== 0 || !String(result.stdout || '').trim()) {
    throw new Error(`BACKEND_CHILD_EXACT_HEAD_BOOTSTRAP_BLOB_FAILED path=${gitPath}`);
  }
  return String(result.stdout);
}

function proveExpectedHead() {
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    throw new Error('BACKEND_CHILD_EXPECTED_HEAD_INVALID');
  }
  const proof = spawnSync(gitExecutable, [
    `--git-dir=${canonicalGitDirectory}`,
    `--work-tree=${canonicalRepoRoot}`,
    'rev-parse',
    'HEAD',
  ], {
    cwd: canonicalRepoRoot,
    env: minimalBackendChildGitEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  const observedHead = String(proof.stdout || '').split(/\r?\n/, 1)[0].trim().toLowerCase();
  if (proof.error || proof.status !== 0 || observedHead !== expectedHead) {
    throw new Error(`BACKEND_CHILD_EXPECTED_HEAD_MISMATCH expected=${expectedHead} observed=${observedHead}`);
  }
}

if (expectedHead) {
  proveExpectedHead();
  const expectedBootstrapSource = readExactHeadBlob('stephanos-server/backend-bootstrap.mjs', 512 * 1024);
  const observedBootstrapSource = bootstrapIsProcessBound
    ? processBoundBootstrapSource
    : readFileSync(bootstrapSourceFile, 'utf8');
  const normalizeText = (value) => String(value).replace(/\r\n/g, '\n');
  if (normalizeText(observedBootstrapSource) !== normalizeText(expectedBootstrapSource)) {
    throw new Error('BACKEND_CHILD_EXACT_HEAD_BOOTSTRAP_SOURCE_MISMATCH');
  }

  const loaderSource = readExactHeadBlob('stephanos-server/backend-exact-head-loader.mjs', 256 * 1024);
  const serverUrl = pathToFileURL(resolve(canonicalRepoRoot, 'stephanos-server', 'server.js')).href;
  register(`data:text/javascript;base64,${Buffer.from(loaderSource, 'utf8').toString('base64')}`, {
    parentURL: serverUrl,
    data: {
      canonicalGitDirectory,
      canonicalRepoRoot,
      expectedHead,
      gitEnvironment: minimalBackendChildGitEnvironment(),
      gitExecutable,
    },
  });
  globalThis[Symbol.for('stephanos.backend.exact-head-bootstrap')] = expectedHead;
}

await import(pathToFileURL(resolve(canonicalRepoRoot, 'stephanos-server', 'server.js')).href);
