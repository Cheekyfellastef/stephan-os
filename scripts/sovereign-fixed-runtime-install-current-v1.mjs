#!/usr/bin/env node
// Attended commissioning adapter for the existing reviewed fixed-runtime installer.
// It prepares only the exact current protected-main package. No elevation, restart,
// arbitrary path, executable, command, or source mutation is exposed here.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIXED_RUNTIME_SOURCE_PATHS_V1,
  buildFixedRuntimeInstallerCandidateV1,
} from './sovereign-fixed-runtime-installer-candidate-v1.mjs';
import {
  inspectFixedRuntimeInstallationPresenceV1,
  inspectFixedRuntimeQualificationV1,
} from './sovereign-fixed-runtime-parent-v1.mjs';
import { createBattleBridgeMinimalChildEnvironment } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_SCHEMA_V1 =
  'stephanos.sovereign-fixed-runtime-install-current.v1';
export const SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_MARKER_V1 =
  'SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_V1=';
const REPOSITORY = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const SID = /^S-1-5-21-[0-9]+-[0-9]+-[0-9]+-[0-9]+$/;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_TOTAL = 8 * 1024 * 1024;
const MAX_GIT_OUTPUT = 3 * 1024 * 1024;

const frozen = value => Object.freeze(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const code = value => /^[A-Z0-9_]{1,120}$/.test(String(value || ''))
  ? String(value)
  : 'FIXED_RUNTIME_INSTALL_PREPARATION_UNPROVEN';

function runFixed(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    shell: false,
    windowsHide: true,
    env: createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' }),
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? MAX_GIT_OUTPUT,
    ...(options.encoding === null ? { encoding: null } : { encoding: 'utf8' }),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
  if (result?.error || result?.signal || result?.status !== 0) {
    throw new Error(options.blocker || 'FIXED_RUNTIME_INSTALL_SOURCE_COMMAND_FAILED');
  }
  return result.stdout;
}

function gitText(spawnSyncFn, repoRoot, args, options = {}) {
  const stdout = runFixed(spawnSyncFn, GIT, ['-C', repoRoot, ...args], {
    blocker: 'FIXED_RUNTIME_INSTALL_GIT_PROOF_FAILED',
    ...options,
  });
  return String(stdout || '').trim();
}

function gitBytes(spawnSyncFn, repoRoot, args) {
  const stdout = runFixed(spawnSyncFn, GIT, ['-C', repoRoot, ...args], {
    encoding: null,
    maxBuffer: MAX_GIT_OUTPUT,
    blocker: 'FIXED_RUNTIME_INSTALL_GIT_OBJECT_FAILED',
  });
  return Buffer.from(stdout || []);
}

function readOperatorSid(spawnSyncFn) {
  const script = "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value";
  const stdout = runFixed(spawnSyncFn, POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { maxBuffer: 4096, blocker: 'FIXED_RUNTIME_INSTALL_OPERATOR_IDENTITY_UNPROVEN' });
  const sid = String(stdout || '').trim();
  if (!SID.test(sid)) throw new Error('FIXED_RUNTIME_INSTALL_OPERATOR_IDENTITY_UNPROVEN');
  return sid;
}

function canonicalRoot(repoRoot) {
  return win32.normalize(repoRoot).toLowerCase() === win32.normalize(REPOSITORY).toLowerCase();
}

function physicalSource(relative, path, expectedBlobSha, {
  repoRoot, spawnSyncFn, lstatFn, readFileFn,
}) {
  const info = lstatFn(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_FILE)
    throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_FILE_UNPROVEN');
  // Capture the exact raw Windows bytes once, then ask Git to canonicalize THAT
  // captured snapshot through the path attributes. This binds CRLF materialization
  // to the immutable LF-normalized blob without trusting a second live file read.
  const physicalBytes = Buffer.from(readFileFn(path));
  if (physicalBytes.length !== info.size)
    throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_FILE_UNPROVEN');
  const materializedBlobSha = gitText(spawnSyncFn, repoRoot,
    ['hash-object', '--path=' + relative, '--stdin'], { input: physicalBytes }).toLowerCase();
  if (!SHA40.test(materializedBlobSha) || materializedBlobSha !== expectedBlobSha)
    throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_MATERIALIZATION_CHANGED');
  return hash(physicalBytes);
}

export function observeCurrentFixedRuntimeInstallationV1(expectedMain, {
  platform = process.platform,
  inspectPresence = inspectFixedRuntimeInstallationPresenceV1,
} = {}) {
  if (platform !== 'win32') return frozen({ ok: false, state: 'BLOCKED',
    reason: 'FIXED_RUNTIME_WINDOWS_REQUIRED', installed: false });
  if (!SHA40.test(expectedMain || '')) return frozen({ ok: false, state: 'BLOCKED',
    reason: 'FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN', installed: false });
  const observed = inspectPresence();
  if (observed?.ok === true && observed.installed === true) {
    if (observed.sourceHead !== expectedMain || !SHA64.test(observed.helperSha256 || '')
      || !SHA64.test(observed.manifestSha256 || '')) {
      return frozen({ ok: false, state: 'BLOCKED',
        reason: 'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN', installed: false });
    }
    return frozen({ ok: true, state: 'PRESENT', reason: '', installed: true,
      sourceHead: expectedMain, helperSha256: observed.helperSha256,
      manifestSha256: observed.manifestSha256 });
  }
  if (observed?.reason === 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING') {
    return frozen({ ok: true, state: 'MISSING',
      reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', installed: false,
      sourceHead: expectedMain });
  }
  return frozen({ ok: false, state: 'BLOCKED',
    reason: code(observed?.reason), installed: false, sourceHead: expectedMain });
}

export function observeCurrentFixedRuntimeQualificationV1(expectedMain, {
  platform = process.platform,
  inspectQualification = inspectFixedRuntimeQualificationV1,
} = {}) {
  if (platform !== 'win32') return frozen({ ok: false, state: 'BLOCKED',
    reason: 'FIXED_RUNTIME_WINDOWS_REQUIRED', qualified: false });
  if (!SHA40.test(expectedMain || '')) return frozen({ ok: false, state: 'BLOCKED',
    reason: 'FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN', qualified: false });
  const observed = inspectQualification();
  if (observed?.ok === true && observed.dispatchAllowed === true
      && observed.sourceHead === expectedMain) {
    return frozen({ ok: true, state: 'QUALIFIED', reason: '', qualified: true,
      sourceHead: expectedMain });
  }
  if (observed?.reason === 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN') {
    return frozen({ ok: true, state: 'RESTART_REQUIRED',
      reason: observed.reason, qualified: false, sourceHead: expectedMain });
  }
  if (observed?.reason === 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING') {
    return frozen({ ok: true, state: 'MISSING',
      reason: observed.reason, qualified: false, sourceHead: expectedMain });
  }
  return frozen({ ok: false, state: 'BLOCKED',
    reason: code(observed?.reason), qualified: false, sourceHead: expectedMain });
}

export function prepareCurrentFixedRuntimeInstallerV1({
  expectedMain,
  platform = process.platform,
  repoRoot = REPOSITORY,
  spawnSyncFn = spawnSync,
  lstatFn = lstatSync,
  readFileFn = readFileSync,
  writeFileFn = writeFileSync,
  existsFn = existsSync,
  buildCandidate = buildFixedRuntimeInstallerCandidateV1,
  readOperatorSidFn = () => readOperatorSid(spawnSyncFn),
} = {}) {
  try {
    if (platform !== 'win32') throw new Error('FIXED_RUNTIME_WINDOWS_REQUIRED');
    if (!SHA40.test(expectedMain || '') || !canonicalRoot(repoRoot))
      throw new Error('FIXED_RUNTIME_INSTALL_CANONICAL_SOURCE_REQUIRED');
    const rootInfo = lstatFn(repoRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())
      throw new Error('FIXED_RUNTIME_INSTALL_CANONICAL_SOURCE_REQUIRED');

    const branch = gitText(spawnSyncFn, repoRoot, ['branch', '--show-current']);
    const head = gitText(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']).toLowerCase();
    const originMain = gitText(spawnSyncFn, repoRoot, ['rev-parse', 'refs/remotes/origin/main']).toLowerCase();
    const sourceTree = gitText(spawnSyncFn, repoRoot, ['rev-parse', expectedMain + '^{tree}']).toLowerCase();
    if (branch !== 'main' || head !== expectedMain || originMain !== expectedMain
      || !SHA40.test(sourceTree)) throw new Error('FIXED_RUNTIME_INSTALL_EXACT_MAIN_UNPROVEN');

    const records = [];
    let total = 0;
    for (const relative of FIXED_RUNTIME_SOURCE_PATHS_V1) {
      const full = resolve(repoRoot, relative);
      if (!full.toLowerCase().startsWith((resolve(repoRoot) + '\\').toLowerCase()))
        throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_PATH_UNSAFE');
      const blobSha = gitText(spawnSyncFn, repoRoot,
        ['rev-parse', expectedMain + ':' + relative]).toLowerCase();
      if (!SHA40.test(blobSha)) throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_MEMBERSHIP_UNPROVEN');
      const bytes = gitBytes(spawnSyncFn, repoRoot, ['cat-file', 'blob', blobSha]);
      total += bytes.length;
      if (bytes.length > MAX_FILE || total > MAX_TOTAL)
        throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_BOUND');
      const materializedSha256 = physicalSource(relative, full, blobSha, {
        repoRoot, spawnSyncFn, lstatFn, readFileFn,
      });
      records.push({
        path: relative,
        blobSha,
        materializedSha256,
        contentBase64: bytes.toString('base64'),
      });
    }

    const headAfter = gitText(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']).toLowerCase();
    const originAfter = gitText(spawnSyncFn, repoRoot,
      ['rev-parse', 'refs/remotes/origin/main']).toLowerCase();
    if (headAfter !== expectedMain || originAfter !== expectedMain)
      throw new Error('FIXED_RUNTIME_INSTALL_SOURCE_MOVED');

    const operatorSid = readOperatorSidFn();
    if (!SID.test(operatorSid || '')) throw new Error('FIXED_RUNTIME_INSTALL_OPERATOR_IDENTITY_UNPROVEN');
    const candidate = buildCandidate({ expectedMain, sourceTree, operatorSid, records });
    if (candidate?.schemaVersion !== 'stephanos.fixed-runtime-installer-candidate.v1'
      || candidate.expectedMain !== expectedMain || candidate.sourceTree !== sourceTree
      || !SHA64.test(candidate.payloadSha256 || '') || !SHA64.test(candidate.scriptSha256 || '')
      || typeof candidate.encodedCommand !== 'string' || candidate.encodedCommand.length < 32
      || candidate.encodedCommand.length > 30000
      || candidate.powershellExecutable !== POWERSHELL
      || candidate.installed !== false || candidate.elevationPerformed !== false
      || candidate.operatorApprovalProven !== false || candidate.custodyReleased !== false) {
      throw new Error('FIXED_RUNTIME_INSTALL_CANDIDATE_UNPROVEN');
    }

    const expectedPayloadPath =
      'C:\\Users\\Stephan Callear\\AppData\\Local\\Temp\\StephanosFixedRuntimeInstall-' +
      expectedMain + '.json';
    if (win32.normalize(candidate.payloadPath).toLowerCase()
      !== win32.normalize(expectedPayloadPath).toLowerCase()) {
      throw new Error('FIXED_RUNTIME_INSTALL_PAYLOAD_PATH_UNPROVEN');
    }

    const payload = Buffer.from(candidate.payloadBytes);
    if (hash(payload) !== candidate.payloadSha256)
      throw new Error('FIXED_RUNTIME_INSTALL_PAYLOAD_DIGEST_UNPROVEN');
    if (existsFn(candidate.payloadPath)) {
      const info = lstatFn(candidate.payloadPath);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1
        || info.size > 16 * 1024 * 1024
        || !Buffer.from(readFileFn(candidate.payloadPath)).equals(payload)) {
        throw new Error('FIXED_RUNTIME_INSTALL_PAYLOAD_COLLISION');
      }
    } else {
      writeFileFn(candidate.payloadPath, payload, { flag: 'wx', mode: 0o600 });
    }
    const readback = Buffer.from(readFileFn(candidate.payloadPath));
    if (!readback.equals(payload) || hash(readback) !== candidate.payloadSha256)
      throw new Error('FIXED_RUNTIME_INSTALL_PAYLOAD_READBACK_UNPROVEN');

    return frozen({
      schemaVersion: SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_SCHEMA_V1,
      ok: true,
      state: 'READY_FOR_OPERATOR_APPROVAL',
      blocker: '',
      expectedMain,
      sourceTree,
      payloadPath: candidate.payloadPath,
      payloadSha256: candidate.payloadSha256,
      scriptSha256: candidate.scriptSha256,
      encodedCommand: candidate.encodedCommand,
      powershellExecutable: candidate.powershellExecutable,
      sourceFileCount: records.length,
      sourceBytes: total,
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      elevationPerformed: false,
      installed: false,
      requiresUac: true,
    });
  } catch (error) {
    return frozen({
      schemaVersion: SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_SCHEMA_V1,
      ok: false,
      state: 'BLOCKED',
      blocker: code(error?.message),
      expectedMain: SHA40.test(expectedMain || '') ? expectedMain : '',
      arbitraryShellAllowed: false,
      sourceMutationAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      elevationPerformed: false,
      installed: false,
      requiresUac: true,
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let result;
  if (args.length === 3 && args[1] === '--expected-main' && SHA40.test(args[2])) {
    if (args[0] === 'status') {
      result = observeCurrentFixedRuntimeInstallationV1(args[2]);
    } else if (args[0] === 'qualification') {
      result = observeCurrentFixedRuntimeQualificationV1(args[2]);
    } else if (args[0] === 'prepare') {
      result = prepareCurrentFixedRuntimeInstallerV1({ expectedMain: args[2] });
    }
  }
  if (!result) result = frozen({
    schemaVersion: SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_SCHEMA_V1,
    ok: false, state: 'BLOCKED', blocker: 'FIXED_RUNTIME_INSTALL_ARGUMENTS_INVALID',
    arbitraryShellAllowed: false, sourceMutationAllowed: false, mergeAuthority: false,
    pcRestartAuthority: false, elevationPerformed: false, installed: false, requiresUac: true,
  });
  process.stdout.write(SOVEREIGN_FIXED_RUNTIME_INSTALL_CURRENT_MARKER_V1 + JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 2;
}
