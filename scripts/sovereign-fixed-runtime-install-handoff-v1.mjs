#!/usr/bin/env node
// Private local handoff for the existing reviewed fixed-runtime installer.
// It prepares no arbitrary command/path and performs no elevation or installation.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIXED_RUNTIME_SOURCE_PATHS_V1,
  buildFixedRuntimeInstallerCandidateV1,
} from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import { inspectFixedRuntimeQualificationV1 } from './sovereign-fixed-runtime-parent-v1.mjs';
import { collectCanonicalIgnitionSourceTruth } from './battle-bridge-ignition-supervisor.mjs';
import {
  battleBridgeCanonicalRepositoryArgs,
  createBattleBridgeMinimalChildEnvironment,
  resolveBattleBridgeGitExecution,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1 = 'stephanos.fixed-runtime-install-handoff.v1';
const CANONICAL_REPO = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SHA40 = /^[a-f0-9]{40}$/;
const SID = /^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobSha = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const refusal = blocker => Object.freeze({
  schemaVersion: FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1,
  ok: false,
  state: 'BLOCKED',
  blocker,
  expectedMain: '',
  installationPerformed: false,
  elevationPerformed: false,
  pcRestartPerformed: false,
  arbitraryShellAllowed: false,
  mergeAuthority: false,
});

function productionGitCapture(repoRoot, args, { binary = false } = {}) {
  const git = resolveBattleBridgeGitExecution({ platform: process.platform, environment: process.env });
  const result = spawnSync(git.executable, [
    ...git.fixedConfigArgs,
    ...battleBridgeCanonicalRepositoryArgs(repoRoot),
    ...args,
  ], {
    cwd: repoRoot,
    env: git.environment,
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    encoding: binary ? null : 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result?.error || result?.status !== 0 || result?.signal) throw new Error('FIXED_RUNTIME_HANDOFF_GIT_UNPROVEN');
  return binary ? Buffer.from(result.stdout || []) : String(result.stdout || '').trim();
}

function productionOperatorSid() {
  const script = String.raw`$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
try{[Console]::Write([string]$identity.User.Value)}finally{$identity.Dispose()}`;
  const result = spawnSync(POWERSHELL, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ], {
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024,
    env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }),
  });
  const sid = String(result?.stdout || '').trim();
  if (result?.error || result?.status !== 0 || result?.signal || !SID.test(sid))
    throw new Error('FIXED_RUNTIME_HANDOFF_OPERATOR_IDENTITY_UNPROVEN');
  return sid;
}

function productionPersistPayload(candidate) {
  const localAppData = String(process.env.LOCALAPPDATA || '');
  const expectedPath = localAppData
    ? win32.join(localAppData, 'Temp', `StephanosFixedRuntimeInstall-${candidate.expectedMain}.json`)
    : '';
  if (!expectedPath || win32.normalize(candidate.payloadPath).toLowerCase() !== win32.normalize(expectedPath).toLowerCase())
    throw new Error('FIXED_RUNTIME_HANDOFF_PAYLOAD_PATH_UNPROVEN');
  const parent = dirname(candidate.payloadPath);
  const parentInfo = lstatSync(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
    throw new Error('FIXED_RUNTIME_HANDOFF_PAYLOAD_PARENT_UNPROVEN');
  const bytes = Buffer.from(candidate.payloadBytes);
  if (bytes.length < 1 || bytes.length > 16 * 1024 * 1024)
    throw new Error('FIXED_RUNTIME_HANDOFF_PAYLOAD_BOUND');
  if (existsSync(candidate.payloadPath)) {
    const info = lstatSync(candidate.payloadPath);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== bytes.length
        || !readFileSync(candidate.payloadPath).equals(bytes))
      throw new Error('FIXED_RUNTIME_HANDOFF_EXISTING_PAYLOAD_CHANGED');
  } else {
    const fd = openSync(candidate.payloadPath, 'wx', 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  const readback = readFileSync(candidate.payloadPath);
  if (!readback.equals(bytes) || sha256(readback) !== candidate.payloadSha256)
    throw new Error('FIXED_RUNTIME_HANDOFF_PAYLOAD_READBACK_UNPROVEN');
  return Object.freeze({ path: candidate.payloadPath, sha256: candidate.payloadSha256, bytes: bytes.length });
}

function dependencies(options = {}) {
  if (options.deps && (!options.testOnly || !process.env.NODE_TEST_CONTEXT))
    throw new Error('FIXED_RUNTIME_HANDOFF_TEST_DEPENDENCIES_FORBIDDEN');
  return {
    platform: process.platform,
    repoRoot: resolve(fileURLToPath(new URL('..', import.meta.url))),
    truthFn: collectCanonicalIgnitionSourceTruth,
    gitCapture: productionGitCapture,
    readFile: readFileSync,
    readOperatorSid: productionOperatorSid,
    buildCandidate: buildFixedRuntimeInstallerCandidateV1,
    persistPayload: productionPersistPayload,
    inspect: inspectFixedRuntimeQualificationV1,
    ...options.deps,
  };
}

function installationProjection(observed, expectedMain) {
  if (observed?.ok === true && observed.sourceHead === expectedMain) return Object.freeze({
    schemaVersion: FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1,
    ok: true,
    state: 'QUALIFIED',
    blocker: '',
    expectedMain,
    installationPerformed: false,
    elevationPerformed: false,
    pcRestartPerformed: false,
    laterFullBootRequired: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
  });
  const reason = typeof observed?.reason === 'string' ? observed.reason : 'FIXED_RUNTIME_QUALIFICATION_UNPROVEN';
  if (reason === 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING') return Object.freeze({
    schemaVersion: FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1,
    ok: true,
    state: 'MISSING',
    blocker: reason,
    expectedMain,
    installationPerformed: false,
    elevationPerformed: false,
    pcRestartPerformed: false,
    laterFullBootRequired: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
  });
  if (reason === 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN') return Object.freeze({
    schemaVersion: FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1,
    ok: true,
    state: 'PENDING_REBOOT',
    blocker: reason,
    expectedMain,
    installationPerformed: true,
    elevationPerformed: false,
    pcRestartPerformed: false,
    laterFullBootRequired: true,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
  });
  return Object.freeze({
    ...refusal(reason),
    expectedMain,
  });
}

export function inspectFixedRuntimeInstallHandoffV1({ expectedMain, testOnly = false, deps } = {}) {
  if (!SHA40.test(expectedMain || '')) return refusal('FIXED_RUNTIME_HANDOFF_EXPECTED_MAIN_REQUIRED');
  try {
    const d = dependencies({ testOnly, deps });
    return installationProjection(d.inspect(), expectedMain);
  } catch (error) {
    return refusal(/^[A-Z0-9_]{1,120}$/.test(error?.message || '')
      ? error.message : 'FIXED_RUNTIME_HANDOFF_INSPECTION_UNPROVEN');
  }
}

export function prepareFixedRuntimeInstallHandoffV1({ expectedMain, testOnly = false, deps } = {}) {
  if (!SHA40.test(expectedMain || '')) return refusal('FIXED_RUNTIME_HANDOFF_EXPECTED_MAIN_REQUIRED');
  try {
    const d = dependencies({ testOnly, deps });
    if (d.platform !== 'win32') return refusal('FIXED_RUNTIME_WINDOWS_REQUIRED');
    const canonical = win32.normalize(CANONICAL_REPO).toLowerCase();
    if (win32.normalize(d.repoRoot).toLowerCase() !== canonical)
      return refusal('FIXED_RUNTIME_HANDOFF_CANONICAL_REPOSITORY_REQUIRED');

    const status = installationProjection(d.inspect(), expectedMain);
    if (status.state !== 'MISSING') return status;

    const truth = d.truthFn({ cwd: d.repoRoot });
    if (truth?.ok !== true || truth.head !== expectedMain || truth.originHead !== expectedMain
        || truth.branch !== 'main' || truth.workingTreeDirty === true)
      return refusal('FIXED_RUNTIME_HANDOFF_CANONICAL_SOURCE_UNPROVEN');

    if (d.gitCapture(d.repoRoot, ['rev-parse', 'HEAD']) !== expectedMain
        || d.gitCapture(d.repoRoot, ['rev-parse', 'refs/remotes/origin/main']) !== expectedMain)
      return refusal('FIXED_RUNTIME_HANDOFF_SOURCE_MOVED');
    const sourceTree = d.gitCapture(d.repoRoot, ['rev-parse', 'HEAD^{tree}']);
    if (!SHA40.test(sourceTree)) return refusal('FIXED_RUNTIME_HANDOFF_TREE_UNPROVEN');

    const records = [];
    for (const relativePath of FIXED_RUNTIME_SOURCE_PATHS_V1) {
      const objectId = d.gitCapture(d.repoRoot, ['rev-parse', `HEAD:${relativePath}`]);
      if (!SHA40.test(objectId)) return refusal('FIXED_RUNTIME_HANDOFF_MEMBER_UNPROVEN');
      const bytes = Buffer.from(d.gitCapture(d.repoRoot, ['cat-file', 'blob', objectId], { binary: true }));
      if (bytes.length > 2 * 1024 * 1024 || blobSha(bytes) !== objectId)
        return refusal('FIXED_RUNTIME_HANDOFF_BLOB_UNPROVEN');
      const localBytes = Buffer.from(d.readFile(resolve(d.repoRoot, relativePath)));
      if (!localBytes.equals(bytes)) return refusal('FIXED_RUNTIME_HANDOFF_MATERIALIZATION_CHANGED');
      records.push({ path: relativePath, blobSha: objectId, contentBase64: bytes.toString('base64') });
    }
    if (d.gitCapture(d.repoRoot, ['rev-parse', 'HEAD']) !== expectedMain)
      return refusal('FIXED_RUNTIME_HANDOFF_SOURCE_MOVED');

    const operatorSid = d.readOperatorSid();
    if (!SID.test(operatorSid)) return refusal('FIXED_RUNTIME_HANDOFF_OPERATOR_IDENTITY_UNPROVEN');
    const candidate = d.buildCandidate({ expectedMain, sourceTree, operatorSid, records });
    if (candidate?.expectedMain !== expectedMain || candidate?.sourceTree !== sourceTree
        || candidate?.powershellExecutable !== POWERSHELL
        || typeof candidate.encodedCommand !== 'string' || candidate.encodedCommand.length < 1
        || candidate.encodedCommand.length > 30_000
        || !/^[A-Za-z0-9+/=]+$/.test(candidate.encodedCommand)
        || candidate.independentSourceAuthorityProven !== false
        || candidate.operatorApprovalProven !== false
        || candidate.elevationPerformed !== false || candidate.installed !== false
        || candidate.custodyReleased !== false)
      return refusal('FIXED_RUNTIME_HANDOFF_CANDIDATE_UNPROVEN');
    const payload = d.persistPayload(candidate);
    return Object.freeze({
      schemaVersion: FIXED_RUNTIME_INSTALL_HANDOFF_SCHEMA_V1,
      ok: true,
      state: 'READY_FOR_OPERATOR_APPROVAL',
      blocker: '',
      expectedMain,
      sourceTree,
      sourceFileCount: records.length,
      payloadPath: payload.path,
      payloadSha256: payload.sha256,
      payloadBytes: payload.bytes,
      powershellExecutable: candidate.powershellExecutable,
      encodedCommand: candidate.encodedCommand,
      encodedCommandSha256: sha256(candidate.encodedCommand),
      containsPrivateOperatorIdentity: true,
      installationPerformed: false,
      elevationPerformed: false,
      pcRestartPerformed: false,
      laterFullBootRequired: true,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
    });
  } catch (error) {
    return Object.freeze({
      ...refusal(/^[A-Z0-9_]{1,120}$/.test(error?.message || '')
        ? error.message : 'FIXED_RUNTIME_HANDOFF_PREPARATION_UNPROVEN'),
      expectedMain,
    });
  }
}

function parseArgs(args) {
  if (!Array.isArray(args) || args.length !== 3 || !['status', 'prepare', 'verify'].includes(args[0])
      || args[1] !== '--expected-main' || !SHA40.test(args[2] || ''))
    throw new Error('FIXED_RUNTIME_HANDOFF_ARGUMENTS_INVALID');
  return Object.freeze({ mode: args[0], expectedMain: args[2] });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const { mode, expectedMain } = parseArgs(process.argv.slice(2));
    const result = mode === 'prepare'
      ? prepareFixedRuntimeInstallHandoffV1({ expectedMain })
      : inspectFixedRuntimeInstallHandoffV1({ expectedMain });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.ok ? 0 : 2;
  } catch {
    process.stdout.write(JSON.stringify(refusal('FIXED_RUNTIME_HANDOFF_ARGUMENTS_INVALID')) + '\n');
    process.exitCode = 2;
  }
}
