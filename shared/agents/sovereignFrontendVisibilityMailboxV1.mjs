// Finite remote adapter for the existing disjoint static-visibility profile.
// It neither enters nor releases the shared maintenance owner.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { battleBridgeCanonicalRepositoryArgs, createBattleBridgeMinimalChildEnvironment,
  resolveBattleBridgeGitExecution } from './battleBridgeExecutionBoundaryV1.mjs';

export const FRONTEND_VISIBILITY_OBSERVE_OPERATION = 'OBSERVE_STEPHANOS_FRONTEND_VISIBILITY';
export const FRONTEND_VISIBILITY_START_OPERATION = 'START_STEPHANOS_FRONTEND_VISIBILITY';
export const FRONTEND_VISIBILITY_OPERATIONS = Object.freeze([
  FRONTEND_VISIBILITY_OBSERVE_OPERATION, FRONTEND_VISIBILITY_START_OPERATION,
]);
export const FRONTEND_VISIBILITY_RESULT_SCHEMA = 'stephanos.frontend-visibility-mailbox.v1';
const STARTER_SCHEMA = 'stephanos.frontend-start-only.v1';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const isSha = value => typeof value === 'string' && SHA.test(value);
const isHash = value => typeof value === 'string' && HASH.test(value);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXED_ROOT = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const STARTER = 'scripts/sovereign-frontend-start-only.mjs';
const LISTENER = 'scripts/windows/read-stephanos-frontend-listener.ps1';
const fields = new Set(['schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber',
  'branch', 'operatorApproval', 'expectedHead', 'expiresAt', 'expectedDistFingerprint']);
const childFields = new Set(['schemaVersion', 'service', 'ok', 'blocker', 'frontendAvailable',
  'mode', 'installedHead', 'existingBuildHead', 'sourceCurrent', 'runtimeMarker', 'gitCommit',
  'buildTimestamp', 'intendedMode', 'runtimeUrl', 'launcherCriticalSourceTruth',
  'approvedDistFingerprint', 'servedFingerprint', 'controlsEnabled', 'externalConnectionsEnabled',
  'custodyReleased', 'backendHealth', 'gatewayHealth', 'builderHealth', 'action']);
const errors = new Set([
  'FRONTEND_MAILBOX_FIELD_NOT_ALLOWED', 'FRONTEND_MAILBOX_EXACT_ENVELOPE_REQUIRED',
  'FRONTEND_MAILBOX_EXACT_ACTIVATION_REQUIRED', 'FRONTEND_MAILBOX_SOURCE_UNPROVEN',
  'FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED', 'FRONTEND_MAILBOX_SOURCE_INDEX_UNSAFE',
  'FRONTEND_MAILBOX_FIXED_HOST_REQUIRED', 'FRONTEND_MAILBOX_RECEIPT_INVALID',
  'FRONTEND_MAILBOX_EXECUTION_UNPROVEN', 'FRONTEND_MAILBOX_PAGE_PROOF_FAILED',
  'FRONTEND_LOCAL_SOURCE_UNPROVEN', 'FRONTEND_INSTALLED_HEAD_CHANGED',
  'FRONTEND_CANONICAL_MAIN_REQUIRED', 'FRONTEND_ASSET_FINGERPRINT_CHANGED',
  'FRONTEND_ASSET_CHANGED_DURING_CAPTURE', 'FRONTEND_ASSET_METADATA_UNPROVEN',
  'FRONTEND_EXACT_IDENTITY_REQUIRED', 'FRONTEND_FIXED_INSTALLATION_REQUIRED',
  'FRONTEND_FIXED_EXECUTABLE_REQUIRED', 'FRONTEND_OPERATOR_APPROVAL_REQUIRED',
  'FRONTEND_LISTENER_OWNER_UNPROVEN', 'FRONTEND_FOREIGN_OR_DIFFERENT_LISTENER',
  'FRONTEND_EXISTING_LISTENER_PROOF_FAILED', 'FRONTEND_EXCLUSIVE_LISTENER_UNPROVEN',
  'FRONTEND_STARTUP_UNPROVEN', 'FRONTEND_START_FAILED', 'FRONTEND_GIT_OBJECT_IDENTITY_INVALID',
  'FRONTEND_GIT_TREE_INVALID', 'FRONTEND_GIT_TREE_CHAIN_INVALID', 'FRONTEND_GIT_COMMIT_INVALID',
  'FRONTEND_LAUNCHER_UNPROVEN', 'FRONTEND_SNAPSHOT_LIMIT', 'FRONTEND_ENTRY_INVALID',
]);
const plain = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const stop = code => { throw new Error(code); };
const fail = blocker => Object.freeze({ ok: false, requested: true,
  verdict: 'COMMAND_EXECUTION_BLOCKED', blocker: errors.has(blocker) ? blocker : 'FRONTEND_MAILBOX_EXECUTION_UNPROVEN',
  custodyReleased: false, sourceLeaseReleased: false, pcRestartAllowed: false,
  arbitraryShellAllowed: false, mergeAuthority: false, publicReceiptSafe: true, secretMaterialReturned: false });

export function validateFrontendVisibilityCommandShape(command = {}) {
  if (!FRONTEND_VISIBILITY_OPERATIONS.includes(command?.operation)) return Object.freeze({ ok: true, requested: false });
  if (Object.keys(command).some(key => !fields.has(key))) return fail('FRONTEND_MAILBOX_FIELD_NOT_ALLOWED');
  if (command.schemaVersion !== 'stephanos.battle-bridge-github-command.v1'
    || command.repository !== 'Cheekyfellastef/stephan-os' || command.issueNumber !== CANONICAL_MAILBOX_ISSUE
    || command.branch !== 'main' || command.operatorApproval !== 'operator-approved'
    || typeof command.requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/.test(command.requestId)
    || typeof command.expiresAt !== 'string' || !Number.isFinite(Date.parse(command.expiresAt))
    || !isSha(command.expectedHead)) return fail('FRONTEND_MAILBOX_EXACT_ENVELOPE_REQUIRED');
  if (command.operation === FRONTEND_VISIBILITY_START_OPERATION) {
    if (!isHash(command.expectedDistFingerprint)) return fail('FRONTEND_MAILBOX_EXACT_ACTIVATION_REQUIRED');
  } else if (Object.hasOwn(command, 'expectedDistFingerprint')) return fail('FRONTEND_MAILBOX_FIELD_NOT_ALLOWED');
  return Object.freeze({ ok: true, requested: true, command: Object.freeze({ ...command }) });
}

export function isTerminalizableFrontendVisibilityBlocker(value) {
  return ['FRONTEND_MAILBOX_FIELD_NOT_ALLOWED', 'FRONTEND_MAILBOX_EXACT_ENVELOPE_REQUIRED',
    'FRONTEND_MAILBOX_EXACT_ACTIVATION_REQUIRED'].includes(value);
}

// Bounded static import closure of the fixed starter, manifest helper and native
// witness. Verify bytes before loading/invoking them, independently of index
// masking. This is cooperative drift detection, not hostile-writer exclusion.
export const FRONTEND_VISIBILITY_EXECUTION_FILES = Object.freeze([
  STARTER, LISTENER, 'scripts/serve-stephanos-dist.mjs', 'scripts/stephanos-build-utils.mjs',
  'shared/runtime/stephanosLocalUrls.mjs', 'shared/runtime/systemPanelToggleRegistry.mjs',
  'shared/agents/openClawReadonlyValidationEndpoint.mjs',
  'shared/agents/battleBridgeExecutionBoundaryV1.mjs', 'shared/agents/battleBridgeWindowsHosts.mjs',
]);

export function verifyFrontendExecutionSourceV1({ root = ROOT, expectedHead,
  spawnSyncFn = spawnSync, platform = process.platform } = {}) {
  if (!isSha(expectedHead)) stop('FRONTEND_MAILBOX_SOURCE_UNPROVEN');
  const git = resolveBattleBridgeGitExecution({ platform });
  const capture = args => {
    const result = spawnSyncFn(git.executable,
      [...git.fixedConfigArgs, ...battleBridgeCanonicalRepositoryArgs(root), ...args],
      { cwd: root, env: git.environment, shell: false, windowsHide: true,
        timeout: 10_000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0) stop('FRONTEND_MAILBOX_SOURCE_UNPROVEN');
    return Buffer.from(result.stdout);
  };
  if (capture(['rev-parse', 'HEAD']).toString().trim() !== expectedHead) stop('FRONTEND_INSTALLED_HEAD_CHANGED');
  if (capture(['branch', '--show-current']).toString().trim() !== 'main') stop('FRONTEND_CANONICAL_MAIN_REQUIRED');
  const object = (type, oid) => {
    const bytes = capture(['cat-file', type, oid]);
    const actual = createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== oid) stop('FRONTEND_GIT_OBJECT_IDENTITY_INVALID');
    return bytes;
  };
  const rootTree = object('commit', expectedHead).toString().match(/^tree ([a-f0-9]{40})\n/)?.[1];
  if (!rootTree) stop('FRONTEND_GIT_COMMIT_INVALID');
  const trees = new Map();
  const tree = oid => {
    if (trees.has(oid)) return trees.get(oid);
    const bytes = object('tree', oid), entries = new Map();
    for (let offset = 0; offset < bytes.length;) {
      const space = bytes.indexOf(32, offset), nul = bytes.indexOf(0, space + 1);
      if (space < offset || nul <= space || nul + 21 > bytes.length) stop('FRONTEND_GIT_TREE_INVALID');
      const mode = bytes.subarray(offset, space).toString(), name = bytes.subarray(space + 1, nul).toString();
      if (!name || /[\0/\\]/.test(name) || entries.has(name)) stop('FRONTEND_GIT_TREE_INVALID');
      entries.set(name, { mode, oid: bytes.subarray(nul + 1, nul + 21).toString('hex') }); offset = nul + 21;
    }
    trees.set(oid, entries); return entries;
  };
  for (const file of FRONTEND_VISIBILITY_EXECUTION_FILES) {
    if (capture(['ls-files', '-v', '--', file]).toString().trim() !== `H ${file}`) stop('FRONTEND_MAILBOX_SOURCE_INDEX_UNSAFE');
    const parts = file.split('/'); let oid = rootTree;
    for (let i = 0; i < parts.length; i++) {
      const entry = tree(oid).get(parts[i]);
      if (!entry || (i < parts.length - 1 ? entry.mode !== '40000' : !['100644', '100755'].includes(entry.mode))) stop('FRONTEND_GIT_TREE_CHAIN_INVALID');
      oid = entry.oid;
    }
    const expected = object('blob', oid), pathname = resolve(root, file), info = lstatSync(pathname);
    const samePath = (a, b) => platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024
      || !samePath(realpathSync(pathname), pathname)) stop('FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED');
    if (!readFileSync(pathname).equals(expected)) stop('FRONTEND_MAILBOX_SOURCE_BYTES_CHANGED');
  }
  if (capture(['rev-parse', 'HEAD']).toString().trim() !== expectedHead) stop('FRONTEND_INSTALLED_HEAD_CHANGED');
  return Object.freeze({ ok: true, sourceHead: expectedHead });
}

function validateStarterReceipt(value, { expectedHead, expectedDistFingerprint, starting }) {
  if (!plain(value) || Object.keys(value).some(key => !childFields.has(key))) stop('FRONTEND_MAILBOX_RECEIPT_INVALID');
  if (value.ok === false) stop(errors.has(value.blocker) ? value.blocker : 'FRONTEND_MAILBOX_EXECUTION_UNPROVEN');
  if (value.ok !== true || value.schemaVersion !== STARTER_SCHEMA || value.service !== 'stephanos-dist-server'
    || value.mode !== 'visibility-only' || value.installedHead !== expectedHead
    || !isSha(value.existingBuildHead) || value.approvedDistFingerprint !== expectedDistFingerprint
    || !isHash(value.servedFingerprint) || value.controlsEnabled !== false
    || value.externalConnectionsEnabled !== false || value.custodyReleased !== false
    || (starting ? value.frontendAvailable !== true || !['started', 'already-running'].includes(value.action)
      : value.frontendAvailable !== false || value.action !== 'validated-not-started')) stop('FRONTEND_MAILBOX_RECEIPT_INVALID');
  return value;
}

async function boundedResponse(response, maxBytes) {
  if (!response.ok || !response.body) stop('FRONTEND_MAILBOX_PAGE_PROOF_FAILED');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > maxBytes) stop('FRONTEND_MAILBOX_PAGE_PROOF_FAILED');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function runFixedFrontendVisibilityV1(command, { spawnSyncFn = spawnSync,
  fetchFn = fetch } = {}) {
  if (process.platform !== 'win32' || resolve(ROOT).toLowerCase() !== FIXED_ROOT.toLowerCase()
    || realpathSync(ROOT).toLowerCase() !== FIXED_ROOT.toLowerCase()
    || realpathSync(process.execPath).toLowerCase() !== realpathSync(BATTLE_BRIDGE_WINDOWS_HOST.node).toLowerCase()) stop('FRONTEND_MAILBOX_FIXED_HOST_REQUIRED');
  const guard = () => verifyFrontendExecutionSourceV1({ expectedHead: command.expectedHead, spawnSyncFn });
  guard();
  const { createStephanosDistManifest } = await import('../../scripts/stephanos-build-utils.mjs');
  const fingerprint = createStephanosDistManifest({ rootDir: ROOT }).fingerprint;
  if (!isHash(fingerprint)) stop('FRONTEND_ASSET_METADATA_UNPROVEN');
  const starting = command.operation === FRONTEND_VISIBILITY_START_OPERATION;
  if (starting && fingerprint !== command.expectedDistFingerprint) stop('FRONTEND_ASSET_FINGERPRINT_CHANGED');
  const env = createBattleBridgeMinimalChildEnvironment(process.env, { platform: 'win32' });
  const invoke = mode => {
    guard();
    const result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.node,
      [resolve(ROOT, STARTER), mode, '--expected-head', command.expectedHead,
        '--expected-dist-fingerprint', fingerprint, ...(mode === 'start' ? ['--operator-approved'] : [])],
      { cwd: ROOT, env, shell: false, windowsHide: true, timeout: 45_000, maxBuffer: 32 * 1024, encoding: 'utf8' });
    if (result.error) stop('FRONTEND_MAILBOX_EXECUTION_UNPROVEN');
    let value; try { value = JSON.parse(result.stdout); } catch { stop('FRONTEND_MAILBOX_RECEIPT_INVALID'); }
    if (result.status !== 0 && value?.ok !== false) stop('FRONTEND_MAILBOX_EXECUTION_UNPROVEN');
    return validateStarterReceipt(value, { expectedHead: command.expectedHead, expectedDistFingerprint: fingerprint, starting: mode === 'start' });
  };
  const validated = invoke('status');
  guard();
  const { isExactFrontendListenerV1 } = await import('../../scripts/sovereign-frontend-start-only.mjs');
  const witness = () => {
    guard();
    const result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', resolve(ROOT, LISTENER)],
      { cwd: ROOT, env, shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 8192, encoding: 'utf8' });
    if (result.error || result.status !== 0) stop('FRONTEND_LISTENER_OWNER_UNPROVEN');
    let value; try { value = JSON.parse(result.stdout); } catch { stop('FRONTEND_LISTENER_OWNER_UNPROVEN'); }
    if (value?.schemaVersion !== 'stephanos.frontend-listener.v1' || !Array.isArray(value.owners) || value.owners.length > 8) stop('FRONTEND_LISTENER_OWNER_UNPROVEN');
    return value;
  };
  const profile = value => isExactFrontendListenerV1(value, { expectedHead: command.expectedHead, expectedDistFingerprint: fingerprint, script: resolve(ROOT, STARTER) });
  let observed = witness(), result = validated, pageHttpVerified = false;
  if (starting) {
    result = invoke('start');
    if (result.servedFingerprint !== validated.servedFingerprint || result.existingBuildHead !== validated.existingBuildHead) stop('FRONTEND_MAILBOX_RECEIPT_INVALID');
    observed = witness(); if (!profile(observed)) stop('FRONTEND_EXCLUSIVE_LISTENER_UNPROVEN');
    const request = path => fetchFn(`http://127.0.0.1:4173${path}`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    const health = JSON.parse(await boundedResponse(await request('/__stephanos/health'), 32 * 1024));
    if (health.schemaVersion !== STARTER_SCHEMA || health.mode !== 'visibility-only' || health.frontendAvailable !== true
      || health.installedHead !== command.expectedHead || health.approvedDistFingerprint !== fingerprint
      || health.servedFingerprint !== result.servedFingerprint || health.controlsEnabled !== false
      || health.externalConnectionsEnabled !== false || health.custodyReleased !== false) stop('FRONTEND_MAILBOX_PAGE_PROOF_FAILED');
    for (const path of ['/', '/apps/stephanos/dist/']) {
      const html = await boundedResponse(await request(path), 512 * 1024);
      if (!html.includes('Frontend visibility mode: controls and external connections are disabled.')
        || !html.includes(command.expectedHead.slice(0, 12)) || !html.includes(result.existingBuildHead.slice(0, 12))) stop('FRONTEND_MAILBOX_PAGE_PROOF_FAILED');
    }
    const after = witness();
    if (!profile(after) || after.owners[0].pid !== observed.owners[0].pid) stop('FRONTEND_EXCLUSIVE_LISTENER_UNPROVEN');
    observed = after; pageHttpVerified = true;
  }
  guard();
  return { ...result, listenerObserved: true, listenerOwnerCount: observed.owners.length,
    exactVisibilityProfile: profile(observed), pageHttpVerified };
}

export function projectFrontendVisibilityReceiptV1(value = {}, operation = '', {
  expectedHead = value?.expectedHead, expectedDistFingerprint = value?.expectedDistFingerprint,
} = {}) {
  if (!FRONTEND_VISIBILITY_OPERATIONS.includes(operation)) return {};
  const source = value?.frontendVisibility || value;
  const starting = operation === FRONTEND_VISIBILITY_START_OPERATION;
  const valid = plain(source) && source.schemaVersion === FRONTEND_VISIBILITY_RESULT_SCHEMA
    && source.mode === 'visibility-only' && isSha(source.installedHead)
    && isSha(source.existingBuildHead) && isHash(source.approvedDistFingerprint)
    && (expectedHead === undefined || isSha(expectedHead) && source.installedHead === expectedHead)
    && (starting ? isHash(expectedDistFingerprint) && source.approvedDistFingerprint === expectedDistFingerprint
      : expectedDistFingerprint === undefined || isHash(expectedDistFingerprint) && source.approvedDistFingerprint === expectedDistFingerprint)
    && isHash(source.servedFingerprint) && source.startupValidated === true
    && source.controlsEnabled === false && source.externalConnectionsEnabled === false
    && source.custodyReleased === false && source.sourceLeaseReleased === false
    && source.listenerObserved === true && Number.isSafeInteger(source.listenerOwnerCount)
    && source.listenerOwnerCount >= 0 && source.listenerOwnerCount <= 8
    && typeof source.exactVisibilityProfile === 'boolean' && source.browserVerified === false
    && (!source.exactVisibilityProfile || source.listenerOwnerCount === 1)
    && (starting ? source.frontendAvailable === true && source.listenerOwnerCount === 1
      && source.exactVisibilityProfile === true && source.pageHttpVerified === true
      && ['started', 'already-running'].includes(source.action)
      : source.frontendAvailable === null && source.pageHttpVerified === false && source.action === 'validated-not-started');
  if (!valid) return { frontendVisibility: null };
  return { ...(starting ? { expectedDistFingerprint } : {}),
    frontendVisibility: Object.freeze({ schemaVersion: FRONTEND_VISIBILITY_RESULT_SCHEMA,
    mode: 'visibility-only', action: source.action, installedHead: source.installedHead,
    existingBuildHead: source.existingBuildHead, approvedDistFingerprint: source.approvedDistFingerprint,
    servedFingerprint: source.servedFingerprint, startupValidated: true,
    frontendAvailable: source.frontendAvailable, listenerObserved: true,
    listenerOwnerCount: source.listenerOwnerCount, exactVisibilityProfile: source.exactVisibilityProfile,
    pageHttpVerified: source.pageHttpVerified, browserVerified: false,
    controlsEnabled: false, externalConnectionsEnabled: false, custodyReleased: false, sourceLeaseReleased: false }) };
}

export async function executeFrontendVisibilityOnBattleBridge(command, options = {}) {
  const shape = validateFrontendVisibilityCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;
  try {
    const runner = options.runFixedFrontendVisibilityFn || runFixedFrontendVisibilityV1;
    const result = await runner(shape.command);
    const starting = command.operation === FRONTEND_VISIBILITY_START_OPERATION;
    const fingerprint = starting ? command.expectedDistFingerprint : result?.approvedDistFingerprint;
    if (!isHash(fingerprint)) return fail('FRONTEND_MAILBOX_RECEIPT_INVALID');
    const { listenerObserved, listenerOwnerCount, exactVisibilityProfile, pageHttpVerified, ...child } = result || {};
    validateStarterReceipt(child, { expectedHead: command.expectedHead, expectedDistFingerprint: fingerprint, starting });
    const projected = projectFrontendVisibilityReceiptV1({ schemaVersion: FRONTEND_VISIBILITY_RESULT_SCHEMA,
      mode: 'visibility-only', action: child.action, installedHead: child.installedHead,
      existingBuildHead: child.existingBuildHead, approvedDistFingerprint: fingerprint,
      servedFingerprint: child.servedFingerprint, startupValidated: true,
      frontendAvailable: starting ? child.frontendAvailable : null, listenerObserved, listenerOwnerCount,
      exactVisibilityProfile, pageHttpVerified, browserVerified: false,
      controlsEnabled: child.controlsEnabled, externalConnectionsEnabled: child.externalConnectionsEnabled,
      custodyReleased: child.custodyReleased, sourceLeaseReleased: false }, command.operation,
    { expectedHead: command.expectedHead, ...(starting ? { expectedDistFingerprint: fingerprint } : {}) });
    if (!projected.frontendVisibility) return fail('FRONTEND_MAILBOX_RECEIPT_INVALID');
    return Object.freeze({ ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', operation: command.operation,
      requestId: command.requestId, expectedHead: command.expectedHead, sourceHead: child.installedHead,
      expectedHeadMatch: true, branch: 'main', finalVerdict: starting ? 'FRONTEND_VISIBILITY_STARTED' : 'FRONTEND_VISIBILITY_VALIDATED',
      ...projected, custodyReleased: false, sourceLeaseReleased: false, pcRestartAllowed: false,
      arbitraryShellAllowed: false, mergeAuthority: false, publicReceiptSafe: true, secretMaterialReturned: false });
  } catch (error) { return fail(error?.message); }
}
