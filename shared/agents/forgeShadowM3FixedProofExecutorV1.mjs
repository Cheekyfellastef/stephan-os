import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA,
  FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA,
  buildForgeShadowM3RuntimePlanDigest,
} from './forgeShadowM3RunnerExecutionReceiptAdapterV1.mjs';

export const FORGE_SHADOW_M3_FIXED_EXECUTOR_SCHEMA =
  'stephanos.forge-shadow-m3-fixed-proof-executor.v1';
export const FORGE_SHADOW_M3_FIXED_EXECUTION_RECEIPT_SCHEMA =
  'stephanos.forge-shadow-m3-fixed-proof-execution-receipt.v1';
export const FORGE_SHADOW_M3_FIXED_EXECUTION_READY =
  'FORGE_SHADOW_M3_FIXED_PROOF_EXECUTORS_READY';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const EXECUTION_SURFACE = 'CONNECTED_WINDOWS_BATTLE_BRIDGE';
const SCRIPT_RELATIVE_PATH = 'scripts/windows/invoke-forge-shadow-m3-fixed-proof-executors-v1.ps1';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{7,127}$/i;
const MAX_STDOUT_BYTES = 512 * 1024;
const CALL_KEYS = ['authorization', 'runtimePlan', 'runner', 'artifact', 'canary'];
const RECEIPT_KEYS = [
  'schemaVersion', 'ok', 'status', 'repository', 'sourceHead', 'sourceTree',
  'runtimeAuthorizationId', 'runtimePlanDigest', 'artifactSetDigest', 'runnerVersion',
  'canonicalM2DigestBefore', 'canonicalM2DigestAfter', 'canaryForgeDestroyed',
  'privateRelayDestroyed', 'registrationCredentialsDestroyed', 'workspacesDestroyed',
  'observations', 'authority',
];
const AUTHORITY_KEYS = [
  'futureExecution', 'sourceMutation', 'gitRefWrite', 'githubCredentialAccess',
  'secretAccess', 'merge', 'deployment', 'arbitraryCommand',
];
const FORBIDDEN_FIELDS = new Set([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'url', 'uri', 'environment', 'env', 'token', 'credential',
  'credentials', 'cookie', 'session', 'password', 'secret', 'secrets', 'privatekey',
  'publickey', 'selector', 'javascript', 'dockerhost', 'podmansocket', 'dockersocket',
]);

const text = (value) => String(value ?? '').trim();

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function findForbidden(value, trail = []) {
  if (!value || typeof value !== 'object') return '';
  for (const [key, nested] of Object.entries(value)) {
    const next = [...trail, key];
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) return next.join('.');
    if (Array.isArray(nested)) {
      for (let index = 0; index < nested.length; index += 1) {
        const found = findForbidden(nested[index], [...next, String(index)]);
        if (found) return found;
      }
    } else {
      const found = findForbidden(nested, next);
      if (found) return found;
    }
  }
  return '';
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function runExact(runCommand, executable, args, options = {}) {
  const result = runCommand(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 120_000,
    maxBuffer: options.maxBuffer || MAX_STDOUT_BYTES,
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: text(result?.stdout),
    stderr: text(result?.stderr),
  });
}

function defaultRun(executable, args, options) {
  return spawnSync(executable, args, options);
}

function readSourceIdentity(runCommand, repositoryRoot, expectedHead, scriptPath) {
  const branch = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['branch', '--show-current'], { cwd: repositoryRoot });
  const head = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
  const tree = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${expectedHead}^{tree}`], { cwd: repositoryRoot });
  const committedScript = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['rev-parse', `${expectedHead}:${SCRIPT_RELATIVE_PATH}`], { cwd: repositoryRoot });
  const workingScript = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.git, ['hash-object', `--path=${SCRIPT_RELATIVE_PATH}`, scriptPath], { cwd: repositoryRoot });
  return Object.freeze({
    ok: branch.ok && head.ok && tree.ok && committedScript.ok && workingScript.ok,
    branch: branch.stdout,
    head: head.stdout.toLowerCase(),
    tree: tree.stdout.toLowerCase(),
    committedScript: committedScript.stdout.toLowerCase(),
    workingScript: workingScript.stdout.toLowerCase(),
  });
}

function sourceIdentityMatches(identity, head, tree) {
  return Boolean(identity?.ok
    && identity.branch === 'main'
    && identity.head === head
    && identity.tree === tree
    && SHA40.test(identity.committedScript)
    && identity.workingScript === identity.committedScript);
}

function validateCall(call) {
  if (!exactKeys(call, CALL_KEYS)) throw fail('FORGE_M3_FIXED_EXECUTOR_CALL_FIELDS_INVALID');
  const unsafe = findForbidden(call);
  if (unsafe) throw fail(`FORGE_M3_FIXED_EXECUTOR_UNSAFE_FIELD:${unsafe}`);
  const { authorization, runtimePlan, runner, artifact, canary } = call;
  if (runtimePlan?.valid !== true || runtimePlan?.repository !== REPOSITORY) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_RUNTIME_PLAN_INVALID');
  }
  if (authorization?.schemaVersion !== FORGE_SHADOW_M3_RUNTIME_AUTHORIZATION_SCHEMA
      || authorization?.repository !== REPOSITORY
      || authorization?.executionSurface !== EXECUTION_SURFACE
      || authorization?.operatorApproved !== true
      || authorization?.m3Only !== true) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_AUTHORIZATION_INVALID');
  }
  if (!SHA40.test(text(runtimePlan.canonicalMainHead).toLowerCase())
      || !SHA40.test(text(runtimePlan.canonicalMainTree).toLowerCase())
      || text(authorization.expectedHead).toLowerCase() !== runtimePlan.canonicalMainHead
      || text(authorization.expectedTree).toLowerCase() !== runtimePlan.canonicalMainTree) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_SOURCE_BINDING_INVALID');
  }
  const runtimePlanDigest = buildForgeShadowM3RuntimePlanDigest(runtimePlan);
  if (!DIGEST.test(runtimePlanDigest)
      || text(authorization.runtimePlanDigest).toLowerCase() !== runtimePlanDigest) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_PLAN_DIGEST_INVALID');
  }
  const canonicalRunner = runtimePlan.runners?.find((item) => item.runnerId === runner?.runnerId);
  const canonicalArtifact = runtimePlan.runnerArtifacts?.find((item) => item.runnerClass === runner?.runnerClass);
  if (!canonicalRunner || canonicalRunner.poolId !== runner.poolId
      || canonicalRunner.runnerClass !== runner.runnerClass
      || canonicalRunner.runtimeBoundary !== runner.runtimeBoundary) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_RUNNER_INVALID');
  }
  if (!canonicalArtifact || canonicalArtifact.artifactDigest !== artifact?.artifactDigest
      || canonicalArtifact.version !== artifact?.version || !DIGEST.test(artifact.artifactDigest)) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_ARTIFACT_INVALID');
  }
  if (canary?.repository !== REPOSITORY
      || canary?.head !== runtimePlan.canonicalMainHead
      || canary?.tree !== runtimePlan.canonicalMainTree) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_CANARY_INVALID');
  }
  const versions = [...new Set(runtimePlan.runnerArtifacts.map((item) => item.version))];
  const linuxArtifact = runtimePlan.runnerArtifacts.find((item) => item.runnerClass === 'linux-isolated');
  const windowsArtifact = runtimePlan.runnerArtifacts.find((item) => item.runnerClass === 'windows-proof-isolated');
  const linuxCount = runtimePlan.runners.filter((item) => item.runnerClass === 'linux-isolated').length;
  const windowsCount = runtimePlan.runners.filter((item) => item.runnerClass === 'windows-proof-isolated').length;
  if (versions.length !== 1 || !linuxArtifact || !windowsArtifact
      || linuxCount < 1 || linuxCount > 3 || windowsCount !== 1
      || !SHA256_HEX.test(text(runtimePlan.canaryForge?.backupDigest).toLowerCase())
      || !/^stephanos-forge-shadow-backup-[0-9a-f]{16}$/.test(text(runtimePlan.canaryForge?.backupVolume))) {
    throw fail('FORGE_M3_FIXED_EXECUTOR_ESTATE_INVALID');
  }
  return Object.freeze({
    runtimePlanDigest,
    linuxArtifact,
    windowsArtifact,
    linuxCount,
    windowsCount,
    runnerVersion: versions[0],
  });
}

export function validateForgeShadowM3FixedProofExecutionReceipt(receipt, call) {
  const blockers = [];
  let contract;
  try { contract = validateCall(call); }
  catch (error) { blockers.push(error.code || 'FORGE_M3_FIXED_EXECUTOR_CALL_INVALID'); }
  if (!exactKeys(receipt, RECEIPT_KEYS)) blockers.push('receipt-fields-invalid');
  if (receipt?.schemaVersion !== FORGE_SHADOW_M3_FIXED_EXECUTION_RECEIPT_SCHEMA
      || receipt?.ok !== true || receipt?.status !== FORGE_SHADOW_M3_FIXED_EXECUTION_READY) {
    blockers.push('receipt-verdict-invalid');
  }
  if (receipt?.repository !== REPOSITORY
      || text(receipt?.sourceHead).toLowerCase() !== text(call?.runtimePlan?.canonicalMainHead).toLowerCase()
      || text(receipt?.sourceTree).toLowerCase() !== text(call?.runtimePlan?.canonicalMainTree).toLowerCase()) {
    blockers.push('receipt-source-invalid');
  }
  if (receipt?.runtimeAuthorizationId !== call?.authorization?.authorizationId
      || text(receipt?.runtimePlanDigest).toLowerCase() !== contract?.runtimePlanDigest
      || text(receipt?.artifactSetDigest).toLowerCase() !== text(call?.runtimePlan?.artifactSetDigest).toLowerCase()
      || receipt?.runnerVersion !== contract?.runnerVersion) {
    blockers.push('receipt-execution-binding-invalid');
  }
  if (!SHA256_HEX.test(text(receipt?.canonicalM2DigestBefore).toLowerCase())
      || receipt?.canonicalM2DigestAfter !== receipt?.canonicalM2DigestBefore) blockers.push('receipt-canonical-m2-mutated');
  for (const field of ['canaryForgeDestroyed', 'privateRelayDestroyed', 'registrationCredentialsDestroyed', 'workspacesDestroyed']) {
    if (receipt?.[field] !== true) blockers.push(`receipt-teardown-invalid:${field}`);
  }
  if (!exactKeys(receipt?.authority, AUTHORITY_KEYS)
      || Object.values(receipt?.authority || {}).some((value) => value !== false)) blockers.push('receipt-authority-invalid');
  const observations = Array.isArray(receipt?.observations) ? receipt.observations : [];
  const expectedIds = [...(call?.runtimePlan?.runners || [])].map((item) => item.runnerId).sort();
  const observedIds = observations.map((item) => text(item?.runnerId)).sort();
  if (observations.length !== expectedIds.length
      || JSON.stringify(observedIds) !== JSON.stringify(expectedIds)
      || observations.some((item) => item?.schemaVersion !== FORGE_SHADOW_M3_EXECUTION_OBSERVATION_SCHEMA)) {
    blockers.push('receipt-observation-estate-invalid');
  }
  if (/password|privatekey|cookie|session|registrationtoken|registrationkey/i.test(JSON.stringify(receipt || {}))) {
    blockers.push('receipt-credential-shaped-output-forbidden');
  }
  return Object.freeze({ ok: blockers.length === 0, blockers: Object.freeze([...new Set(blockers)]), receipt: blockers.length ? null : receipt });
}

export function createForgeShadowM3FixedProofExecutor({
  platform = process.platform,
  runCommand = defaultRun,
  repositoryRoot,
  userProfile,
} = {}) {
  let session = null;
  return async function executeFixedRunner(call) {
    const contract = validateCall(call);
    if (platform !== 'win32') throw fail('FORGE_M3_FIXED_EXECUTOR_WINDOWS_REQUIRED');
    const profile = resolve(userProfile || process.env.USERPROFILE || homedir());
    const root = resolve(repositoryRoot || join(profile, 'Documents', 'GitHub', 'stephan-os'));
    const scriptPath = resolve(root, ...SCRIPT_RELATIVE_PATH.split('/'));
    if (!existsSync(root) || !existsSync(scriptPath)) throw fail('FORGE_M3_FIXED_EXECUTOR_SOURCE_MISSING');

    const sourceBefore = readSourceIdentity(runCommand, root, call.runtimePlan.canonicalMainHead, scriptPath);
    if (!sourceIdentityMatches(sourceBefore, call.runtimePlan.canonicalMainHead, call.runtimePlan.canonicalMainTree)) {
      throw fail('FORGE_M3_FIXED_EXECUTOR_SOURCE_IDENTITY_CHANGED');
    }
    const sessionKey = `${call.authorization.authorizationId}:${contract.runtimePlanDigest}`;
    if (session && session.key !== sessionKey) throw fail('FORGE_M3_FIXED_EXECUTOR_SESSION_CHANGED');
    if (!session) {
      const invocation = runExact(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', scriptPath,
        '-ExpectedHead', call.runtimePlan.canonicalMainHead,
        '-ExpectedTree', call.runtimePlan.canonicalMainTree,
        '-RuntimeAuthorizationId', call.authorization.authorizationId,
        '-RuntimePlanDigest', contract.runtimePlanDigest,
        '-ArtifactSetDigest', call.runtimePlan.artifactSetDigest,
        '-IssuedAtUtc', call.authorization.issuedAtUtc,
        '-ExpiresAtUtc', call.authorization.expiresAtUtc,
        '-ForgejoImageDigest', call.runtimePlan.canaryForge.forgejoImageDigest,
        '-BackupDigest', call.runtimePlan.canaryForge.backupDigest,
        '-BackupVolume', call.runtimePlan.canaryForge.backupVolume,
        '-RunnerVersion', contract.runnerVersion,
        '-LinuxArtifactDigest', contract.linuxArtifact.artifactDigest,
        '-WindowsArtifactDigest', contract.windowsArtifact.artifactDigest,
        '-LinuxRunnerCount', String(contract.linuxCount),
        '-OperatorApproved', '-Confirm:$false',
      ], { cwd: root, timeout: 2 * 60 * 60 * 1000, maxBuffer: MAX_STDOUT_BYTES });
      if (!invocation.ok) throw fail('FORGE_M3_FIXED_EXECUTOR_HOST_SCRIPT_FAILED');
      if (Buffer.byteLength(invocation.stdout, 'utf8') > MAX_STDOUT_BYTES) throw fail('FORGE_M3_FIXED_EXECUTOR_RECEIPT_TOO_LARGE');
      let receipt;
      try { receipt = JSON.parse(invocation.stdout); }
      catch { throw fail('FORGE_M3_FIXED_EXECUTOR_RECEIPT_INVALID_JSON'); }
      const validation = validateForgeShadowM3FixedProofExecutionReceipt(receipt, call);
      if (!validation.ok) throw fail(`FORGE_M3_FIXED_EXECUTOR_RECEIPT_INVALID:${validation.blockers[0]}`);
      session = Object.freeze({ key: sessionKey, receipt });
    }
    const sourceAfter = readSourceIdentity(runCommand, root, call.runtimePlan.canonicalMainHead, scriptPath);
    if (!sourceIdentityMatches(sourceAfter, call.runtimePlan.canonicalMainHead, call.runtimePlan.canonicalMainTree)
        || sourceAfter.committedScript !== sourceBefore.committedScript) {
      throw fail('FORGE_M3_FIXED_EXECUTOR_POST_EXECUTION_SOURCE_CHANGED');
    }
    const observation = session.receipt.observations.find((item) => item.runnerId === call.runner.runnerId);
    if (!observation) throw fail('FORGE_M3_FIXED_EXECUTOR_OBSERVATION_MISSING');
    return Object.freeze({ ...observation });
  };
}
