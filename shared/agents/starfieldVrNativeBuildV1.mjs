import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { win32 } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { inspectStephanosNativeCapacityGamingAdmissionV1 } from './stephanosNativeCapacityGamingAdmissionV1.mjs';

export const STARFIELD_VR_NATIVE_BUILD_OPERATION = 'BUILD_STARFIELD_VR_PAIRED_OBSERVER';
export const STARFIELD_VR_NATIVE_BUILD_SCHEMA = 'stephanos.starfield-native-build.v1';
export const STARFIELD_VR_NATIVE_BUILD_STAGE = 'paired-source-observe-v1';
export const STARFIELD_VR_NATIVE_BUILD_RECIPE = 'VR-Research-Lab/native/starfield-paired-observer-v1/build-recipe.json';
const RUNNER = 'scripts/windows/starfield-native-build/native_build.py';
const OWNED_JOB = 'scripts/windows/starfield-native-build/owned_job.py';
const LAUNCHER = 'scripts/windows/starfield-native-build/start_native_build.ps1';
const RUNTIME_MODULE = 'scripts/windows/starfield-native-build/pinned_python_runtime.ps1';
const RUNTIME_MANIFEST = 'scripts/windows/starfield-native-build/python_runtime_v1.json';
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST = /^[a-z0-9][a-z0-9-]{7,95}$/;
const MAX_MEMBER = 256 * 1024;
const MAX_CLOSURE = 1536 * 1024;
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const REMOTE = 'https://github.com/Cheekyfellastef/stephan-os.git';
const EXPECTED_ARTIFACTS = Object.freeze(['test-scoped-eye-ledger.exe', 'test-paired-scoped-eye-ledger.exe',
  'test-paired-source-observation.exe', 'native-paired-source-observe-test.exe', 'native-paired-source-observe.dll']);
const FALSE_CLAIMS = Object.freeze({
  arbitraryShellAllowed: false, arbitraryPathAllowed: false, arbitraryExecutableAllowed: false,
  providerMutationAllowed: false, sourceMutationAllowed: false, launchAllowed: false,
  pixelsCaptured: false, gpuCommandsIssued: false, openXrSubmitted: false, headsetPlaytestReady: false,
});

// A fixed Windows PowerShell bootstrap authenticates the complete, fixed
// 37-member PSF Python runtime. Scripts execute the verified in-memory Git source closure;
// neither resolves an interpreter through the repository or inherited PATH.

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, finalVerdict: 'STARFIELD_VR_NATIVE_BUILD_BLOCKED', blocker,
    schemaVersion: STARFIELD_VR_NATIVE_BUILD_SCHEMA, ...FALSE_CLAIMS, ...details });
}
async function awaitOrdinaryGamingAdmission(inspect, clock, pause) {
  // Observation only: a hold never grants permission. Wait before launch for
  // a fresh ordinary admission, without changing the shared policy predicate.
  const started = clock();
  for (let attempt = 0; attempt < 11; attempt++) {
    if (clock() - started >= 1000) return false;
    const current = inspect();
    if (clock() - started >= 1000) return false;
    if (current?.ok === true) return true;
    if (current?.ok !== false || current.reason !== 'native-capacity-gaming-permission-denied') return false;
    if (attempt < 10) await pause(100);
  }
  return false;
}
function options(cwd, timeout = 30_000) {
  return { cwd, shell: false, windowsHide: true, timeout, encoding: 'utf8', maxBuffer: MAX_MEMBER + 8192 };
}
function runLauncher(executable, args, { input, ...launchOptions }) {
  // Only the fixed, source-verified PowerShell launch below reaches this local
  // helper. Async process I/O leaves the canonical mailbox heartbeat runnable.
  return new Promise(resolve => {
    let child; let inputFailed = false; let inputFinished = false;
    const failInput = () => {
      inputFailed = true;
      try { child?.kill(); } catch { /* An unproven terminal never releases custody. */ }
    };
    try {
      child = execFile(executable, args, launchOptions, (error, stdout, stderr) => {
        // execFile reports an ordinary nonzero exit through error.code. A
        // timeout, output overflow, signal or stream fault is not an exit code.
        const status = !error ? 0 : Number.isInteger(error.code) && !error.killed && !error.signal ? error.code : null;
        resolve({ status, stdout, stderr,
          ...(status === null || inputFailed || !inputFinished ? { error: true } : {}) });
      });
      if (!child.stdin) { failInput(); return; }
      child.stdin.once('error', failInput);
      child.stdin.once('finish', () => { inputFinished = true; });
      child.stdin.end(input, 'utf8');
    } catch {
      failInput(); resolve({ status: null, error: true });
    }
  });
}
function gitOptions(repoRoot, env) {
  const sanitized = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'USERPROFILE', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA',
      'PROGRAMFILES', 'PROGRAMFILES(X86)', 'USERDOMAIN', 'USERNAME'].includes(key.toUpperCase())
      && typeof value === 'string' && value.length < 4096 && !/[\0\r\n]/.test(value)) sanitized[key.toUpperCase()] = value;
  }
  Object.assign(sanitized, { PATH: 'C:\\Windows\\System32;C:\\Windows',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: 'NUL', GIT_CONFIG_GLOBAL: 'NUL',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' });
  return { ...options(repoRoot), env: sanitized };
}
function gitArgs(repoRoot, args) {
  return ['--no-replace-objects', `--git-dir=${win32.resolve(repoRoot, '.git')}`,
    `--work-tree=${repoRoot}`, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=',
    '-c', 'credential.helper=', '-c', 'protocol.allow=never', ...args];
}
function json(value) {
  try { const result = JSON.parse(String(value)); return result && typeof result === 'object' && !Array.isArray(result) ? result : null; }
  catch { return null; }
}
function protectedHeadMatches(head, repoRoot, invoke, env) {
  const local = invoke(GIT, gitArgs(repoRoot, ['rev-parse', '--verify', 'HEAD']), gitOptions(repoRoot, env));
  // This public remote observation runs outside the repository so a local
  // url.insteadOf/include/remote setting cannot substitute its authority.
  const remote = invoke(GIT, ['--no-replace-objects', '-c', 'credential.helper=',
    '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never',
    'ls-remote', '--exit-code', REMOTE, 'refs/heads/main'], gitOptions('C:\\Windows\\System32', env));
  return !local?.error && local?.status === 0 && String(local.stdout || '').trim() === head
    && !remote?.error && remote?.status === 0 && new RegExp(`^${head}\\s+refs/heads/main$`).test(String(remote.stdout || '').trim());
}

function verifiedSourceReader(head, repoRoot, invoke, env) {
  const cache = new Map();
  function object(type, id) {
    if (!SHA.test(id)) throw new Error('SOURCE_OBJECT_ID_INVALID');
    const key = `${type}:${id}`;
    if (cache.has(key)) return cache.get(key);
    const r = invoke(GIT, gitArgs(repoRoot, ['cat-file', type, id]), { ...gitOptions(repoRoot, env), encoding: null });
    if (r?.error || r?.status !== 0 || !Buffer.isBuffer(r.stdout)) throw new Error('SOURCE_OBJECT_UNAVAILABLE');
    const raw = r.stdout;
    if (!raw.length || raw.length > MAX_MEMBER
      || createHash('sha1').update(`${type} ${raw.length}\0`).update(raw).digest('hex') !== id) throw new Error('SOURCE_OBJECT_BYTES_CHANGED');
    cache.set(key, raw); return raw;
  }
  const commit = object('commit', head);
  const rootTree = /^tree ([a-f0-9]{40})\n/.exec(commit.toString('utf8'))?.[1];
  if (!rootTree) throw new Error('SOURCE_COMMIT_TREE_INVALID');
  return (path) => {
    const parts = path.split('/'); let tree = rootTree; let blob = '';
    for (let depth = 0; depth < parts.length; depth++) {
      const raw = object('tree', tree); let offset = 0; let matched = null; const names = new Set();
      while (offset < raw.length) {
        const space = raw.indexOf(32, offset); const nul = raw.indexOf(0, space + 1);
        if (space <= offset || nul <= space + 1 || nul + 21 > raw.length) throw new Error('SOURCE_TREE_INVALID');
        const mode = raw.toString('ascii', offset, space);
        const name = raw.toString('utf8', space + 1, nul);
        if (names.has(name) || name.includes('/')) throw new Error('SOURCE_TREE_INVALID');
        names.add(name);
        const id = raw.subarray(nul + 1, nul + 21).toString('hex');
        if (name === parts[depth]) matched = { mode, id };
        offset = nul + 21;
      }
      if (!matched || matched.mode !== (depth === parts.length - 1 ? '100644' : '40000')) throw new Error('SOURCE_TREE_MEMBER_INVALID');
      if (depth === parts.length - 1) blob = matched.id;
      else tree = matched.id;
    }
    const bytes = object('blob', blob);
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { bytes, record: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      gitBlob: blob, base64: bytes.toString('base64') } };
  };
}

export function validateStarfieldVrNativeBuildRecipe(value) {
  if (!value || value.schemaVersion !== 'stephanos.starfield-native-build-recipe.v1'
    || value.stage !== STARFIELD_VR_NATIVE_BUILD_STAGE
    || value.originalPackageSha256 !== '1ea602071f2452f0afc70de1b9a63e6e99ef765f9edccb160b1c8a8f9ffca951'
    || !Array.isArray(value.publicMembers) || value.publicMembers.length < 3 || value.publicMembers.length > 24
    || Object.keys(value).some(key => !['schemaVersion', 'stage', 'originalPackageSha256', 'publicMembers'].includes(key))) return false;
  const seen = new Set();
  return value.publicMembers.every(row => {
    if (!row || Object.keys(row).sort().join(',') !== 'path,sha256'
      || typeof row.path !== 'string'
      || !/^VR-Research-Lab\/native\/starfield-paired-observer-v1\/[a-zA-Z0-9_-]+\.(?:py|h|cpp|cmd|json)$/.test(row.path)
      || row.path === STARFIELD_VR_NATIVE_BUILD_RECIPE || !SHA256.test(row.sha256 || '')
      || seen.has(row.path.toLowerCase())) return false;
    seen.add(row.path.toLowerCase()); return true;
  });
}

export function projectStarfieldVrNativeBuildReceipt(value, expectedHead, requestId) {
  if (!value || value.schemaVersion !== STARFIELD_VR_NATIVE_BUILD_SCHEMA
    || value.sourceHead !== expectedHead || !SHA.test(expectedHead || '')
    || value.requestId !== requestId || !REQUEST.test(requestId || '')
    || value.stage !== STARFIELD_VR_NATIVE_BUILD_STAGE
    || !['STARFIELD_VR_NATIVE_BUILD_PASSED', 'STARFIELD_VR_NATIVE_BUILD_FAILED', 'STARFIELD_VR_NATIVE_BUILD_BLOCKED', 'STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD'].includes(value.finalVerdict)
    || Object.keys(FALSE_CLAIMS).some(key => value[key] !== false)) return null;
  const booleans = ['originalSourceVerified', 'originalSourceUnchanged', 'sourceClosureVerified',
    'isolatedBuildCreated', 'toolchainObserved', 'buildPassed', 'testsPassed', 'allJobsEmpty',
    'executionCustodyReleased', 'outputComplete', 'terminalFinalized'];
  if (booleans.some(key => typeof value[key] !== 'boolean') || !Number.isSafeInteger(value.stagesCompleted)
    || value.stagesCompleted < 0 || value.stagesCompleted > 8 || !Array.isArray(value.artifacts) || value.artifacts.length > 8
    || !SHA256.test(value.sourceClosureSha256 || '') || !SHA256.test(value.recipeSha256 || '')) return null;
  const artifacts = [];
  for (const row of value.artifacts) {
    if (!row || !/^[a-z][a-z0-9-]{0,80}\.(?:exe|dll)$/.test(row.name || '')
      || !SHA256.test(row.sha256 || '') || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 16 * 1024 * 1024) return null;
    if (artifacts.some(other => other.name === row.name)) return null;
    artifacts.push(Object.freeze({ name: row.name, sha256: row.sha256, bytes: row.bytes }));
  }
  const passed = value.finalVerdict === 'STARFIELD_VR_NATIVE_BUILD_PASSED';
  if (passed && (!booleans.every(key => value[key] === true) || value.stagesCompleted !== 1
    || artifacts.length !== EXPECTED_ARTIFACTS.length || artifacts.some((row, index) => row.name !== EXPECTED_ARTIFACTS[index]))) return null;
  if (value.executionCustodyReleased && !value.allJobsEmpty) return null;
  if (value.finalVerdict === 'STARFIELD_VR_NATIVE_BUILD_CUSTODY_HELD' && value.executionCustodyReleased) return null;
  const reason = typeof value.reason === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(value.reason) ? value.reason : 'BUILD_PROOF_INCOMPLETE';
  return Object.freeze({ schemaVersion: value.schemaVersion, requestId, sourceHead: expectedHead,
    stage: value.stage, finalVerdict: value.finalVerdict, reason,
    ...Object.fromEntries(booleans.map(key => [key, value[key]])),
    stagesCompleted: value.stagesCompleted, sourceClosureSha256: value.sourceClosureSha256,
    recipeSha256: value.recipeSha256, artifacts: Object.freeze(artifacts),
    workerGoal: 1595, missionGoal: 1769, ...FALSE_CLAIMS });
}

export async function executeStarfieldVrNativeBuild(command, paths, {
  spawnSyncFn = spawnSync, runLauncherFn = runLauncher, env = process.env, parentPid = process.pid,
  admissionFn = inspectStephanosNativeCapacityGamingAdmissionV1,
  admissionClockFn = () => performance.now(), admissionDelayFn = delay,
} = {}) {
  const head = command?.expectedHead;
  const requestId = command?.requestId;
  if (command?.operation !== STARFIELD_VR_NATIVE_BUILD_OPERATION || !SHA.test(head || '') || !REQUEST.test(requestId || '')) return fail('STARFIELD_VR_NATIVE_BUILD_ENVELOPE_INVALID');
  // Independent exact-head preflight for this new execution class. Local
  // replace refs, alternate Git directories and caller Git configuration do
  // not select the code that is sent to the build interpreter.
  if (!protectedHeadMatches(head, paths.repoRoot, spawnSyncFn, env)) return fail('STARFIELD_VR_NATIVE_BUILD_PROTECTED_HEAD_UNPROVEN');
  const workspaceRoot = win32.resolve(paths.userProfile, 'Documents', 'Stephanos-openclaw-workspace');
  const ordinaryAdmission = () => awaitOrdinaryGamingAdmission(
    () => admissionFn({ env, repoRoot: paths.repoRoot, workspaceRoot }), admissionClockFn, admissionDelayFn);
  if (!await ordinaryAdmission()) return fail('STARFIELD_VR_NATIVE_BUILD_GAMING_HOLD');
  let recipe, records, closureSha256;
  try {
    const readBlob = verifiedSourceReader(head, paths.repoRoot, spawnSyncFn, env);
    const recipeBlob = readBlob(STARFIELD_VR_NATIVE_BUILD_RECIPE);
    recipe = json(recipeBlob.bytes.toString('utf8'));
    if (!validateStarfieldVrNativeBuildRecipe(recipe)) return fail('STARFIELD_VR_NATIVE_BUILD_RECIPE_INVALID');
    records = { [STARFIELD_VR_NATIVE_BUILD_RECIPE]: recipeBlob.record };
    for (const path of [RUNNER, OWNED_JOB, LAUNCHER, RUNTIME_MODULE, RUNTIME_MANIFEST, ...recipe.publicMembers.map(row => row.path)]) {
      const blob = readBlob(path);
      const expected = recipe.publicMembers.find(row => row.path === path);
      if (expected && expected.sha256 !== blob.record.sha256) return fail('STARFIELD_VR_NATIVE_BUILD_RECIPE_SOURCE_MISMATCH');
      records[path] = blob.record;
    }
    if (Object.values(records).reduce((sum, row) => sum + row.bytes, 0) > MAX_CLOSURE) return fail('STARFIELD_VR_NATIVE_BUILD_SOURCE_BOUND');
    closureSha256 = createHash('sha256').update(Object.keys(records).sort().map(path => `${path}\0${records[path].sha256}\n`).join('')).digest('hex');
  } catch { return fail('STARFIELD_VR_NATIVE_BUILD_SOURCE_UNAVAILABLE'); }
  // Recheck admission immediately before the owned build process starts.
  if (!await ordinaryAdmission()) return fail('STARFIELD_VR_NATIVE_BUILD_GAMING_HOLD');
  if (!protectedHeadMatches(head, paths.repoRoot, spawnSyncFn, env)) return fail('STARFIELD_VR_NATIVE_BUILD_PROTECTED_HEAD_UNPROVEN');
  const packet = { schemaVersion: 'stephanos.starfield-native-build-input.v1', sourceHead: head,
    requestId, stage: STARFIELD_VR_NATIVE_BUILD_STAGE, sourceClosureSha256: closureSha256,
    parentPid, files: records };
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  // The mailbox preserves SystemRoot casing (commonly C:\WINDOWS). Admit only
  // that fixed Windows path, then launch the source-owned literal below.
  if (typeof paths.powershellExe !== 'string'
    || paths.powershellExe.toLowerCase() !== powershell.toLowerCase()) return fail('STARFIELD_VR_NATIVE_BUILD_LAUNCHER_PATH_INVALID');
  const launcher = Buffer.from(records[LAUNCHER].base64, 'base64').toString('utf8');
  const encoded = Buffer.from(launcher, 'utf16le').toString('base64');
  if (encoded.length > 32000) return fail('STARFIELD_VR_NATIVE_BUILD_LAUNCHER_BOUND');
  const launcherEnv = { ...gitOptions(paths.repoRoot, env).env,
    PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' };
  let result;
  try {
    result = await runLauncherFn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      ...options('C:\\Windows\\System32', 690_000), env: launcherEnv,
      input: JSON.stringify(packet), maxBuffer: 64 * 1024,
    });
  } catch { result = { status: null, error: true }; }
  if (result?.error || ![0, 2, 3].includes(result?.status)) return fail('STARFIELD_VR_NATIVE_BUILD_TERMINAL_UNPROVEN', {
    executionCustodyReleased: false, sourceHead: head, expectedHead: head,
  });
  const terminal = json(result.stdout);
  if ([2, 3].includes(result.status) && terminal?.schemaVersion === 'stephanos.starfield-native-build-launcher.v1'
    && terminal.finalVerdict === 'STARFIELD_VR_NATIVE_BUILD_BLOCKED' && terminal.executionCustodyReleased === false
    && typeof terminal.reason === 'string'
    && /^FIXED_PYTHON_(?:INPUT|OWNER|RUNTIME|SELECTION|START|IMAGE|EXECUTION|TERMINAL)_UNPROVEN$/.test(terminal.reason)) {
    return fail(terminal.reason, { executionCustodyReleased: false, sourceHead: head, expectedHead: head });
  }
  const proof = projectStarfieldVrNativeBuildReceipt(terminal, head, requestId);
  if (!proof || proof.sourceClosureSha256 !== closureSha256 || proof.recipeSha256 !== records[STARFIELD_VR_NATIVE_BUILD_RECIPE].sha256
    || (proof.finalVerdict === 'STARFIELD_VR_NATIVE_BUILD_PASSED') !== (result.status === 0)) return fail('STARFIELD_VR_NATIVE_BUILD_RECEIPT_INVALID', { executionCustodyReleased: false });
  return Object.freeze({ ok: proof.finalVerdict === 'STARFIELD_VR_NATIVE_BUILD_PASSED',
    schemaVersion: STARFIELD_VR_NATIVE_BUILD_SCHEMA, operation: STARFIELD_VR_NATIVE_BUILD_OPERATION,
    sourceHead: head, expectedHead: head, finalVerdict: proof.finalVerdict,
    blocker: proof.finalVerdict === 'STARFIELD_VR_NATIVE_BUILD_PASSED' ? '' : proof.reason,
    nativeBuild: proof, ...FALSE_CLAIMS });
}
