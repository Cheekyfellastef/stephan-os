import { readFileSync } from 'node:fs';

export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA = 'stephanos.battle-bridge-tailscale-bootstrap.v1';
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_MARKER = 'stephanos-battle-bridge-tailscale-bootstrap';
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION = 'BOOTSTRAP_CANONICAL_GITHUB_SYNC';
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE = 1507;
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_AUTHOR = 'Cheekyfellastef';
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG = 'tag:stephanos-github-recovery';
export const BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_VERDICT = 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_READY';

const SHA = /^[0-9a-f]{40}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const MAX_FUTURE_WINDOW_MS = 30 * 60 * 1000;
const EXACT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
]);

function text(value) {
  return String(value ?? '').trim();
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, finalVerdict: 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_BLOCKED', ...details });
}

function sameExactKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...EXACT_KEYS].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function extractBattleBridgeTailscaleBootstrap(body = '') {
  const source = String(body || '');
  const pattern = new RegExp('```' + BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_MARKER + '\\s*([\\s\\S]*?)```', 'i');
  const match = source.match(pattern);
  if (!match) return fail('TAILSCALE_BOOTSTRAP_MARKER_MISSING');
  try {
    const command = JSON.parse(match[1].trim());
    return Object.freeze({ ok: true, command });
  } catch {
    return fail('TAILSCALE_BOOTSTRAP_JSON_INVALID');
  }
}

export function validateBattleBridgeTailscaleBootstrap(command = {}, {
  authorLogin = '',
  issueNumber = 0,
  now = new Date(),
  currentMainHead = '',
} = {}) {
  if (authorLogin !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_AUTHOR) return fail('TAILSCALE_BOOTSTRAP_AUTHOR_NOT_ALLOWED');
  if (Number(issueNumber) !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE) return fail('TAILSCALE_BOOTSTRAP_ISSUE_MISMATCH');
  if (!sameExactKeys(command)) return fail('TAILSCALE_BOOTSTRAP_FIELDS_NOT_EXACT');
  if (command.schemaVersion !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA) return fail('TAILSCALE_BOOTSTRAP_SCHEMA_MISMATCH');
  if (!REQUEST_ID.test(text(command.requestId))) return fail('TAILSCALE_BOOTSTRAP_REQUEST_ID_INVALID');
  if (command.operation !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION) return fail('TAILSCALE_BOOTSTRAP_OPERATION_NOT_ALLOWED');
  if (command.repository !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY) return fail('TAILSCALE_BOOTSTRAP_REPOSITORY_MISMATCH');
  if (Number(command.issueNumber) !== BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE) return fail('TAILSCALE_BOOTSTRAP_COMMAND_ISSUE_MISMATCH');
  if (command.operatorApproval !== 'operator-approved') return fail('TAILSCALE_BOOTSTRAP_OPERATOR_APPROVAL_REQUIRED');
  const expectedHead = text(command.expectedHead).toLowerCase();
  if (!SHA.test(expectedHead)) return fail('TAILSCALE_BOOTSTRAP_EXPECTED_HEAD_INVALID');
  const observedMain = text(currentMainHead).toLowerCase();
  if (!SHA.test(observedMain) || observedMain !== expectedHead) {
    return fail('TAILSCALE_BOOTSTRAP_MAIN_HEAD_MISMATCH', { expectedHead, currentMainHead: observedMain });
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const expiresAtMs = Date.parse(String(command.expiresAt || ''));
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) return fail('TAILSCALE_BOOTSTRAP_EXPIRY_INVALID');
  if (expiresAtMs <= nowMs) return fail('TAILSCALE_BOOTSTRAP_EXPIRED');
  if (expiresAtMs - nowMs > MAX_FUTURE_WINDOW_MS) return fail('TAILSCALE_BOOTSTRAP_EXPIRY_TOO_FAR_AHEAD');
  return Object.freeze({
    ok: true,
    blocker: '',
    request: Object.freeze({
      schemaVersion: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA,
      requestId: text(command.requestId),
      operation: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION,
      repository: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY,
      issueNumber: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_ISSUE,
      operatorApproval: 'operator-approved',
      expectedHead,
      expiresAt: new Date(expiresAtMs).toISOString(),
    }),
    codexRequired: false,
    arbitraryCommandAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    arbitraryExecutableAllowed: false,
    finalVerdict: 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REQUEST_READY',
  });
}

function psSingleQuoted(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildFixedBattleBridgeBootstrapPowerShell(expectedHead) {
  const head = text(expectedHead).toLowerCase();
  if (!SHA.test(head)) throw new Error('Expected exact main head is required.');
  const expected = psSingleQuoted(head);
  return [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$repo = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\\GitHub\\stephan-os'))",
    "$installer = [System.IO.Path]::GetFullPath((Join-Path $repo 'scripts\\windows\\install-battle-bridge-github-sync.ps1'))",
    "$statusScript = [System.IO.Path]::GetFullPath((Join-Path $repo 'scripts\\windows\\status-battle-bridge-github-sync.ps1'))",
    "$preservationSync = [System.IO.Path]::GetFullPath((Join-Path $repo 'scripts\\battle-bridge-exact-head-preservation-sync.mjs'))",
    "$git = 'C:\\Program Files\\Git\\cmd\\git.exe'",
    "$node = 'C:\\Program Files\\nodejs\\node.exe'",
    "if (-not (Test-Path -LiteralPath $preservationSync -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_PRESERVATION_ADAPTER_MISSING' }",
    "if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_CANONICAL_NODE_MISSING' }",
    "if (-not (Test-Path -LiteralPath $git -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_CANONICAL_GIT_MISSING' }",
    `$expectedHead = ${expected}`,
    "try { $syncOutput = @(& $node $preservationSync $expectedHead) } catch { throw 'TAILSCALE_BOOTSTRAP_PRESERVATION_SYNC_FAILED' }",
    "if ($LASTEXITCODE -ne 0 -or $syncOutput.Count -lt 1) { throw 'TAILSCALE_BOOTSTRAP_PRESERVATION_SYNC_FAILED' }",
    "$sync = (($syncOutput -join [Environment]::NewLine) | ConvertFrom-Json)",
    "if ($null -eq $sync -or $sync.ok -ne $true -or $sync.exactHeadBound -ne $true -or [string]$sync.expectedHead -ne $expectedHead -or [string]$sync.afterHead -ne $expectedHead -or $null -eq $sync.preservation -or $sync.preservation.ok -ne $true -or [int]$sync.preservation.receipt.itemCount -ne 6 -or $sync.preservation.receipt.allHashesVerified -ne $true -or $sync.preservation.destructiveCleanupPerformed -ne $false) { throw 'TAILSCALE_BOOTSTRAP_PRESERVATION_SYNC_INVALID' }",
    "if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_SYNC_INSTALLER_MISSING' }",
    "if (-not (Test-Path -LiteralPath $statusScript -PathType Leaf)) { throw 'TAILSCALE_BOOTSTRAP_SYNC_STATUS_SCRIPT_MISSING' }",
    "try { $installerOutput = @(& $installer -StartNow) } catch { throw 'TAILSCALE_BOOTSTRAP_SYNC_INSTALLER_FAILED' }",
    "$installerReceipt = (($installerOutput -join [Environment]::NewLine) | ConvertFrom-Json)",
    "if ([string]$installerReceipt.taskName -ne 'Stephanos Battle Bridge GitHub Sync' -or $installerReceipt.installed -ne $true -or $installerReceipt.startedNow -ne $true -or [int]$installerReceipt.intervalMinutes -ne 15 -or $installerReceipt.atLogon -ne $true -or $installerReceipt.hidden -ne $true -or [string]$installerReceipt.runLevel -ne 'Limited' -or $installerReceipt.arbitraryShellAllowed -ne $false -or $installerReceipt.liveOpenClawUpdateAllowed -ne $false -or $installerReceipt.headlessLauncher -ne $true) { throw 'TAILSCALE_BOOTSTRAP_SYNC_INSTALLER_RECEIPT_INVALID' }",
    "$observedHead = ''",
    "for ($attempt = 0; $attempt -lt 24; $attempt += 1) {",
    "  $headLine = @(& $git -C $repo rev-parse HEAD 2>$null | Select-Object -First 1)",
    "  if ($LASTEXITCODE -eq 0 -and $headLine.Count -eq 1) { $observedHead = ([string]$headLine[0]).Trim().ToLowerInvariant() }",
    "  if ($observedHead -eq $expectedHead) { break }",
    "  Start-Sleep -Seconds 10",
    "}",
    "if ($observedHead -ne $expectedHead) { throw 'TAILSCALE_BOOTSTRAP_EXACT_HEAD_NOT_REACHED' }",
    "try { $statusOutput = @(& $statusScript) } catch { throw 'TAILSCALE_BOOTSTRAP_SYNC_STATUS_FAILED' }",
    "$status = (($statusOutput -join [Environment]::NewLine) | ConvertFrom-Json)",
    "if ([string]$status.taskName -ne 'Stephanos Battle Bridge GitHub Sync' -or $status.installed -ne $true) { throw 'TAILSCALE_BOOTSTRAP_SYNC_STATUS_INVALID' }",
    "[pscustomobject]@{ schemaVersion = 'stephanos.battle-bridge-tailscale-bootstrap-receipt.v1'; repository = 'Cheekyfellastef/stephan-os'; taskName = 'Stephanos Battle Bridge GitHub Sync'; expectedHead = $expectedHead; observedHead = $observedHead; taskInstalled = $true; taskState = [string]$status.taskState; lastTaskResult = $status.lastTaskResult; preservationProfile = 'battle-bridge-runtime-data-v1'; preservationItemCount = 6; preservationHashesVerified = $true; codexRequired = $false; arbitraryCommandAllowed = $false; arbitraryPathAllowed = $false; arbitraryTaskNameAllowed = $false; sourceMutationOutsideCanonicalSyncAllowed = $false; destructiveGitAllowed = $false; pcRestartAllowed = $false; finalVerdict = 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_READY' } | ConvertTo-Json -Compress",
  ].join('; ');
}

export function encodePowerShellCommand(source) {
  return Buffer.from(String(source), 'utf16le').toString('base64');
}

export function buildFixedBattleBridgeBootstrapEncodedCommand(expectedHead) {
  return encodePowerShellCommand(buildFixedBattleBridgeBootstrapPowerShell(expectedHead));
}

export function validateBattleBridgeTailscaleBootstrapReceipt(value = {}, expectedHead = '') {
  const expected = text(expectedHead).toLowerCase();
  return Boolean(
    SHA.test(expected)
    && value?.schemaVersion === 'stephanos.battle-bridge-tailscale-bootstrap-receipt.v1'
    && value?.repository === BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_REPOSITORY
    && value?.taskName === 'Stephanos Battle Bridge GitHub Sync'
    && text(value?.expectedHead).toLowerCase() === expected
    && text(value?.observedHead).toLowerCase() === expected
    && value?.taskInstalled === true
    && value?.preservationProfile === 'battle-bridge-runtime-data-v1'
    && value?.preservationItemCount === 6
    && value?.preservationHashesVerified === true
    && value?.codexRequired === false
    && value?.arbitraryCommandAllowed === false
    && value?.arbitraryPathAllowed === false
    && value?.arbitraryTaskNameAllowed === false
    && value?.sourceMutationOutsideCanonicalSyncAllowed === false
    && value?.destructiveGitAllowed === false
    && value?.pcRestartAllowed === false
    && value?.finalVerdict === BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_VERDICT
  );
}

export function validateGitHubEventFile(eventPath, { now = new Date(), currentMainHead = '' } = {}) {
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const extracted = extractBattleBridgeTailscaleBootstrap(event?.comment?.body || '');
  if (!extracted.ok) return extracted;
  return validateBattleBridgeTailscaleBootstrap(extracted.command, {
    authorLogin: event?.comment?.user?.login || event?.sender?.login || '',
    issueNumber: event?.issue?.number || 0,
    now,
    currentMainHead,
  });
}
