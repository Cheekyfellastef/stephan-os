import { readFileSync } from 'node:fs';
import {
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_AUTHOR,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG,
  encodePowerShellCommand,
} from './battleBridgeTailscaleBootstrapPipeV1.mjs';

export const BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SCHEMA = 'stephanos.battle-bridge-tailscale-bootstrap-prerequisites.v1';
export const BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_MARKER = 'stephanos-battle-bridge-tailscale-bootstrap-prerequisites';
export const BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_OPERATION = 'CHECK_BOOTSTRAP_PREREQUISITES';
export const BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SETTINGS_VERDICT = 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITE_SETTINGS_READY';
export const BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_REMOTE_VERDICT = 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITE_REMOTE_READY';
export const BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_VERDICT = 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITES_READY';
export { BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG };

const SHA = /^[0-9a-f]{40}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const WINDOWS_SSH_USER = /^[A-Za-z0-9._-][A-Za-z0-9._ -]{0,63}$/;
const MAX_FUTURE_WINDOW_MS = 30 * 60 * 1000;
const EXACT_KEYS = Object.freeze([
  'schemaVersion', 'requestId', 'operation', 'repository', 'issueNumber', 'expectedHead', 'expiresAt',
]);

function text(value) {
  return String(value ?? '').trim();
}

function fail(blocker, details = {}) {
  return Object.freeze({
    ok: false,
    blocker,
    finalVerdict: 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITES_BLOCKED',
    ...details,
  });
}

function sameExactKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...EXACT_KEYS].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function parseIpv4(value = '') {
  const candidate = text(value);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) return null;
  const octets = candidate.split('.').map((part) => Number.parseInt(part, 10));
  return octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ? null : octets;
}

export function isBattleBridgeTailscaleOnlyHost(value = '') {
  const host = text(value).toLowerCase();
  if (!host) return false;
  const ipv4 = parseIpv4(host);
  if (ipv4) return ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127;
  return host.endsWith('.ts.net')
    && !host.startsWith('.')
    && !host.includes('..')
    && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.ts\.net$/i.test(host);
}

export function isBattleBridgeWindowsSshUser(value = '') {
  return WINDOWS_SSH_USER.test(text(value));
}

export function extractBattleBridgeTailscalePrerequisiteCheck(body = '') {
  const pattern = new RegExp('```' + BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_MARKER + '\\s*([\\s\\S]*?)```', 'i');
  const match = String(body || '').match(pattern);
  if (!match) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_MARKER_MISSING');
  try {
    return Object.freeze({ ok: true, command: JSON.parse(match[1].trim()) });
  } catch {
    return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_JSON_INVALID');
  }
}

export function validateBattleBridgeTailscalePrerequisiteCheck(command = {}, {
  authorLogin = '', issueNumber = 0, now = new Date(), currentMainHead = '',
} = {}) {
  if (authorLogin !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_AUTHOR) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_AUTHOR_NOT_ALLOWED');
  if (Number(issueNumber) !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_ISSUE_MISMATCH');
  if (!sameExactKeys(command)) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_FIELDS_NOT_EXACT');
  if (command.schemaVersion !== BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SCHEMA) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_SCHEMA_MISMATCH');
  if (!REQUEST_ID.test(text(command.requestId))) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_REQUEST_ID_INVALID');
  if (command.operation !== BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_OPERATION) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_OPERATION_NOT_ALLOWED');
  if (command.repository !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_REPOSITORY_MISMATCH');
  if (Number(command.issueNumber) !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_COMMAND_ISSUE_MISMATCH');
  const expectedHead = text(command.expectedHead).toLowerCase();
  if (!SHA.test(expectedHead)) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_EXPECTED_HEAD_INVALID');
  const observedMain = text(currentMainHead).toLowerCase();
  if (!SHA.test(observedMain) || observedMain !== expectedHead) {
    return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_MAIN_HEAD_MISMATCH', { expectedHead, currentMainHead: observedMain });
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const expiresAtMs = Date.parse(String(command.expiresAt || ''));
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_EXPIRY_INVALID');
  if (expiresAtMs <= nowMs) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_EXPIRED');
  if (expiresAtMs - nowMs > MAX_FUTURE_WINDOW_MS) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_EXPIRY_TOO_FAR_AHEAD');
  return Object.freeze({
    ok: true,
    blocker: '',
    request: Object.freeze({
      schemaVersion: BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SCHEMA,
      requestId: text(command.requestId),
      operation: BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_OPERATION,
      repository: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY,
      issueNumber: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE,
      expectedHead,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }),
    readOnly: true,
    mutationPerformed: false,
    codexRequired: false,
    arbitraryCommandAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    finalVerdict: 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITE_REQUEST_READY',
  });
}

export function buildBattleBridgeTailscalePrerequisiteSettingsProof(expectedHead, input = {}) {
  const head = text(expectedHead).toLowerCase();
  if (!SHA.test(head)) throw new Error('Expected exact main head is required.');
  const checks = Object.freeze({
    tsOauthClientIdPresent: Boolean(text(input.tsOauthClientId)),
    tsAudiencePresent: Boolean(text(input.tsAudience)),
    sshPrivateKeyPresent: Boolean(text(input.sshPrivateKey)),
    sshKnownHostsPresent: Boolean(text(input.sshKnownHosts)),
    bootstrapHostPresent: Boolean(text(input.bootstrapHost)),
    bootstrapUserPresent: Boolean(text(input.bootstrapUser)),
    bootstrapHostTailscaleOnly: isBattleBridgeTailscaleOnlyHost(input.bootstrapHost),
    bootstrapUserValid: isBattleBridgeWindowsSshUser(input.bootstrapUser),
  });
  const missing = [];
  if (!checks.tsOauthClientIdPresent) missing.push('TS_OAUTH_CLIENT_ID');
  if (!checks.tsAudiencePresent) missing.push('TS_AUDIENCE');
  if (!checks.sshPrivateKeyPresent) missing.push('STEPHANOS_BATTLE_BRIDGE_SSH_PRIVATE_KEY');
  if (!checks.sshKnownHostsPresent) missing.push('STEPHANOS_BATTLE_BRIDGE_SSH_KNOWN_HOSTS');
  if (!checks.bootstrapHostPresent) missing.push('STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST');
  if (!checks.bootstrapUserPresent) missing.push('STEPHANOS_BATTLE_BRIDGE_SSH_USER');
  const invalid = [];
  if (checks.bootstrapHostPresent && !checks.bootstrapHostTailscaleOnly) invalid.push('STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST_NOT_TAILSCALE_ONLY');
  if (checks.bootstrapUserPresent && !checks.bootstrapUserValid) invalid.push('STEPHANOS_BATTLE_BRIDGE_SSH_USER_INVALID');
  const ready = missing.length === 0 && invalid.length === 0;
  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-tailscale-bootstrap-prerequisite-settings-proof.v1',
    repository: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY,
    expectedHead: head,
    checks,
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
    ready,
    secretValuesExposed: false,
    mutationPerformed: false,
    codexRequired: false,
    finalVerdict: ready
      ? BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SETTINGS_VERDICT
      : 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITE_SETTINGS_BLOCKED',
  });
}

export function validateBattleBridgeTailscalePrerequisiteSettingsProof(value = {}, expectedHead = '') {
  const expected = text(expectedHead).toLowerCase();
  return Boolean(
    SHA.test(expected)
    && value?.schemaVersion === 'stephanos.battle-bridge-tailscale-bootstrap-prerequisite-settings-proof.v1'
    && value?.repository === BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY
    && text(value?.expectedHead).toLowerCase() === expected
    && value?.ready === true
    && value?.checks?.tsOauthClientIdPresent === true
    && value?.checks?.tsAudiencePresent === true
    && value?.checks?.sshPrivateKeyPresent === true
    && value?.checks?.sshKnownHostsPresent === true
    && value?.checks?.bootstrapHostPresent === true
    && value?.checks?.bootstrapUserPresent === true
    && value?.checks?.bootstrapHostTailscaleOnly === true
    && value?.checks?.bootstrapUserValid === true
    && Array.isArray(value?.missing) && value.missing.length === 0
    && Array.isArray(value?.invalid) && value.invalid.length === 0
    && value?.secretValuesExposed === false
    && value?.mutationPerformed === false
    && value?.codexRequired === false
    && value?.finalVerdict === BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SETTINGS_VERDICT
  );
}

function psSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildFixedBattleBridgePrerequisiteProbePowerShell(expectedHead) {
  const head = text(expectedHead).toLowerCase();
  if (!SHA.test(head)) throw new Error('Expected exact main head is required.');
  const expected = psSingleQuoted(head);
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$repo = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\\GitHub\\stephan-os'))",
    "$installer = [System.IO.Path]::GetFullPath((Join-Path $repo 'scripts\\windows\\install-battle-bridge-github-sync.ps1'))",
    "$statusScript = [System.IO.Path]::GetFullPath((Join-Path $repo 'scripts\\windows\\status-battle-bridge-github-sync.ps1'))",
    "$git = 'C:\\Program Files\\Git\\cmd\\git.exe'",
    "$tailscale = 'C:\\Program Files\\Tailscale\\tailscale.exe'",
    "if (-not (Test-Path -LiteralPath $repo -PathType Container)) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_CANONICAL_REPO_MISSING' }",
    "if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_SYNC_INSTALLER_MISSING' }",
    "if (-not (Test-Path -LiteralPath $statusScript -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_SYNC_STATUS_SCRIPT_MISSING' }",
    "if (-not (Test-Path -LiteralPath $git -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_CANONICAL_GIT_MISSING' }",
    "if (-not (Test-Path -LiteralPath $tailscale -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_TAILSCALE_CLIENT_MISSING' }",
    "$headLine = @(& $git -C $repo rev-parse HEAD 2>$null | Select-Object -First 1)",
    "if ($LASTEXITCODE -ne 0 -or $headLine.Count -ne 1) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_HEAD_READ_FAILED' }",
    "$observedHead = ([string]$headLine[0]).Trim().ToLowerInvariant()",
    "if ($observedHead -notmatch '^[0-9a-f]{40}$') { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_HEAD_INVALID' }",
    "$tailscaleOutput = @(& $tailscale status --json 2>$null)",
    "if ($LASTEXITCODE -ne 0 -or $tailscaleOutput.Count -eq 0) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_TAILSCALE_STATUS_FAILED' }",
    "$tailscaleStatus = (($tailscaleOutput -join [Environment]::NewLine) | ConvertFrom-Json)",
    "$backendState = [string]$tailscaleStatus.BackendState",
    "$selfOnline = $false",
    "if ($null -ne $tailscaleStatus.Self) { $selfOnline = [bool]$tailscaleStatus.Self.Online }",
    "if ($backendState -ne 'Running' -or $selfOnline -ne $true) { throw 'TAILSCALE_BOOTSTRAP_PREREQUISITE_TAILSCALE_NOT_CONNECTED' }",
    `$expectedHead = ${expected}`,
    "[pscustomobject]@{ schemaVersion = 'stephanos.battle-bridge-tailscale-bootstrap-prerequisite-remote-receipt.v1'; repository = 'Cheekyfellastef/stephan-os'; expectedHead = $expectedHead; observedHead = $observedHead; sshAuthenticated = $true; tailscaleClientPresent = $true; tailscaleConnected = $true; canonicalRepoPresent = $true; canonicalGitPresent = $true; installerPresent = $true; statusScriptPresent = $true; codexRequired = $false; mutationPerformed = $false; arbitraryCommandAllowed = $false; sourceMutationAllowed = $false; destructiveGitAllowed = $false; pcRestartAllowed = $false; finalVerdict = 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITE_REMOTE_READY' } | ConvertTo-Json -Compress",
  ].join('; ');
}

export function buildFixedBattleBridgePrerequisiteProbeEncodedCommand(expectedHead) {
  return encodePowerShellCommand(buildFixedBattleBridgePrerequisiteProbePowerShell(expectedHead));
}

export function validateBattleBridgeTailscalePrerequisiteRemoteReceipt(value = {}, expectedHead = '') {
  const expected = text(expectedHead).toLowerCase();
  return Boolean(
    SHA.test(expected)
    && value?.schemaVersion === 'stephanos.battle-bridge-tailscale-bootstrap-prerequisite-remote-receipt.v1'
    && value?.repository === BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY
    && text(value?.expectedHead).toLowerCase() === expected
    && SHA.test(text(value?.observedHead).toLowerCase())
    && value?.sshAuthenticated === true
    && value?.tailscaleClientPresent === true
    && value?.tailscaleConnected === true
    && value?.canonicalRepoPresent === true
    && value?.canonicalGitPresent === true
    && value?.installerPresent === true
    && value?.statusScriptPresent === true
    && value?.codexRequired === false
    && value?.mutationPerformed === false
    && value?.arbitraryCommandAllowed === false
    && value?.sourceMutationAllowed === false
    && value?.destructiveGitAllowed === false
    && value?.pcRestartAllowed === false
    && value?.finalVerdict === BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_REMOTE_VERDICT
  );
}

export function buildBattleBridgeTailscalePrerequisiteReceipt(settingsProof = {}, remoteReceipt = {}, expectedHead = '') {
  const expected = text(expectedHead).toLowerCase();
  if (!validateBattleBridgeTailscalePrerequisiteSettingsProof(settingsProof, expected)) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_SETTINGS_PROOF_INVALID');
  if (!validateBattleBridgeTailscalePrerequisiteRemoteReceipt(remoteReceipt, expected)) return fail('TAILSCALE_BOOTSTRAP_PREREQUISITE_REMOTE_PROOF_INVALID');
  return Object.freeze({
    ok: true,
    blocker: '',
    schemaVersion: 'stephanos.battle-bridge-tailscale-bootstrap-prerequisite-receipt.v1',
    repository: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY,
    expectedHead: expected,
    observedHead: text(remoteReceipt.observedHead).toLowerCase(),
    githubSettingsReady: true,
    tailscaleOnlyTargetEnforced: true,
    ephemeralTailscaleIdentityReady: true,
    tailscaleTcp22PathReady: true,
    sshKnownHostBindingReady: true,
    sshKeyAuthorizationReady: true,
    windowsTailscaleConnected: true,
    canonicalRepoPresent: true,
    fixedInstallerPresent: true,
    fixedStatusScriptPresent: true,
    codexRequired: false,
    mutationPerformed: false,
    arbitraryCommandAllowed: false,
    sourceMutationAllowed: false,
    destructiveGitAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_VERDICT,
  });
}

export function validateGitHubPrerequisiteEventFile(eventPath, { now = new Date(), currentMainHead = '' } = {}) {
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const extracted = extractBattleBridgeTailscalePrerequisiteCheck(event?.comment?.body || '');
  if (!extracted.ok) return extracted;
  return validateBattleBridgeTailscalePrerequisiteCheck(extracted.command, {
    authorLogin: event?.comment?.user?.login || event?.sender?.login || '',
    issueNumber: event?.issue?.number || 0,
    now,
    currentMainHead,
  });
}
