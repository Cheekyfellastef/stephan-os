export const FORGE_SHADOW_BATTLE_BRIDGE_COMMAND_SCHEMA = 'stephanos.forge-shadow-battle-bridge-command.v1';
export const FORGE_SHADOW_BATTLE_BRIDGE_PLAN_SCHEMA = 'stephanos.forge-shadow-battle-bridge-plan.v1';
export const FORGE_SHADOW_BATTLE_BRIDGE_ACTION = 'INSTALL_FORGE_SHADOW_M2';

const FIXED_REPOSITORY = 'Cheekyfellastef/stephan-os';
const FIXED_REQUESTER = 'Cheekyfellastef';
const FIXED_HOST_ID = 'battle-bridge';
const FIXED_EXECUTABLE = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const FIXED_SCRIPT = '%USERPROFILE%\\Documents\\GitHub\\stephan-os\\scripts\\windows\\install-forge-shadow-podman-v1.ps1';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const COMMAND_KEYS = Object.freeze([
  'schemaVersion',
  'commandId',
  'action',
  'sourceHead',
  'imageDigest',
  'issuedAtUtc',
  'expiresAtUtc',
  'canary',
]);
const CONTEXT_KEYS = Object.freeze([
  'repository',
  'authenticatedRequester',
  'liveMainHead',
  'hostId',
  'nowUtc',
]);
const MAX_LIFETIME_MS = 20 * 60 * 1000;
const MAX_FUTURE_ISSUE_MS = 60 * 1000;

function text(value) {
  return String(value ?? '').trim();
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactTime(value) {
  const raw = text(value);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return Number.NaN;
  return Date.parse(raw);
}

function authority() {
  return Object.freeze({
    sourceMutation: false,
    githubRefWrite: false,
    forgeRefWrite: false,
    forcePush: false,
    branchDeletion: false,
    merge: false,
    deployment: false,
    runnerRegistration: false,
    publicExposure: false,
    tailscaleExposure: false,
    arbitraryCommand: false,
    arbitraryExecutable: false,
    arbitraryPath: false,
    arbitraryEnvironment: false,
    credentialCreation: false,
    githubCredentialUse: false,
    hostMutationByValidator: false,
    requiresProtectedBattleBridgeExecution: true,
    singleUse: true,
  });
}

export function validateForgeShadowBattleBridgeCommand(command = {}, context = {}) {
  const blockers = [];
  if (!exactKeys(command, COMMAND_KEYS)) blockers.push('command-schema-unbounded');
  if (!exactKeys(context, CONTEXT_KEYS)) blockers.push('context-schema-unbounded');

  const repository = text(context.repository);
  const requester = text(context.authenticatedRequester);
  const liveMainHead = text(context.liveMainHead).toLowerCase();
  const hostId = text(context.hostId);
  const nowMs = exactTime(context.nowUtc);
  const sourceHead = text(command.sourceHead).toLowerCase();
  const imageDigest = text(command.imageDigest).toLowerCase();
  const issuedMs = exactTime(command.issuedAtUtc);
  const expiresMs = exactTime(command.expiresAtUtc);

  if (command.schemaVersion !== FORGE_SHADOW_BATTLE_BRIDGE_COMMAND_SCHEMA) blockers.push('command-schema-mismatch');
  if (!SAFE_ID.test(text(command.commandId))) blockers.push('command-id-invalid');
  if (text(command.action) !== FORGE_SHADOW_BATTLE_BRIDGE_ACTION) blockers.push('command-action-not-allowlisted');
  if (repository !== FIXED_REPOSITORY) blockers.push('repository-not-allowlisted');
  if (requester !== FIXED_REQUESTER) blockers.push('authenticated-requester-not-owner');
  if (hostId !== FIXED_HOST_ID) blockers.push('battle-bridge-host-mismatch');
  if (!SHA40.test(liveMainHead)) blockers.push('live-main-head-invalid');
  if (!SHA40.test(sourceHead)) blockers.push('source-head-invalid');
  if (SHA40.test(liveMainHead) && sourceHead !== liveMainHead) blockers.push('source-head-not-live-main');
  if (!SHA256.test(imageDigest)) blockers.push('image-digest-invalid');
  if (command.canary !== true) blockers.push('canary-required');

  if (!Number.isFinite(nowMs)) blockers.push('current-time-invalid');
  if (!Number.isFinite(issuedMs)) blockers.push('issued-time-invalid');
  if (!Number.isFinite(expiresMs)) blockers.push('expiry-time-invalid');
  if (Number.isFinite(nowMs) && Number.isFinite(issuedMs) && issuedMs > nowMs + MAX_FUTURE_ISSUE_MS) {
    blockers.push('command-issued-too-far-in-future');
  }
  if (Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs <= nowMs) blockers.push('command-expired');
  if (Number.isFinite(issuedMs) && Number.isFinite(expiresMs)) {
    if (expiresMs <= issuedMs) blockers.push('command-expiry-not-after-issue');
    if (expiresMs - issuedMs > MAX_LIFETIME_MS) blockers.push('command-authority-window-too-long');
  }

  const uniqueBlockers = [...new Set(blockers)];
  const base = Object.freeze({
    schemaVersion: FORGE_SHADOW_BATTLE_BRIDGE_PLAN_SCHEMA,
    valid: uniqueBlockers.length === 0,
    commandId: text(command.commandId),
    action: text(command.action),
    repository,
    authenticatedRequester: requester,
    sourceHead,
    imageDigest,
    hostId,
    authority: authority(),
  });

  if (uniqueBlockers.length) {
    return Object.freeze({
      ...base,
      blockers: Object.freeze(uniqueBlockers),
      executionPlan: null,
    });
  }

  return Object.freeze({
    ...base,
    blockers: Object.freeze([]),
    executionPlan: Object.freeze({
      adapterId: 'forge-shadow-battle-bridge-executor-v1',
      executable: FIXED_EXECUTABLE,
      scriptIdentity: 'scripts/windows/install-forge-shadow-podman-v1.ps1',
      scriptDisplayPath: FIXED_SCRIPT,
      argv: Object.freeze([
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        FIXED_SCRIPT,
        '-ExpectedHead',
        sourceHead,
        '-ForgejoImageDigest',
        imageDigest,
        '-OperatorApproved',
      ]),
      commandId: text(command.commandId),
      issuedAtUtc: text(command.issuedAtUtc),
      expiresAtUtc: text(command.expiresAtUtc),
      canary: true,
      singleUse: true,
      requiresReplayCheck: true,
      requiresExactHeadRecheckImmediatelyBeforeExecution: true,
      executed: false,
    }),
  });
}
