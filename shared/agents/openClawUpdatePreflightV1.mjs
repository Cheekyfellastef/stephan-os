import { createHash } from 'node:crypto';
import {
  OPENCLAW_GATEWAY_APPROVED_ENDPOINT,
  OPENCLAW_GATEWAY_STARTUP_SOURCE,
  getOpenClawGatewayStartupCommand,
} from './openClawGatewayStartup.mjs';
import {
  OPENCLAW_EXTERNAL_AGENT_MEMORY_DIRECTORY,
  OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY,
} from './openClawWorkspaceHygiene.mjs';

export const OPENCLAW_UPDATE_PREFLIGHT_SCHEMA = 'stephanos.openclaw-update-preflight.v1';
export const OPENCLAW_UPDATE_PREFLIGHT_VERSION = '1.0.0';
export const OPENCLAW_UPDATE_PREFLIGHT_MAX_INVENTORY = 512;
export const OPENCLAW_UPDATE_PREFLIGHT_MAX_TEXT = 512;

export const OPENCLAW_UPDATE_PREFLIGHT_STATUS = Object.freeze({
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  BLOCKED_WITH_RESTORE_PATH: 'BLOCKED_WITH_RESTORE_PATH',
  NO_UPDATE_NEEDED: 'NO_UPDATE_NEEDED',
});

export const OPENCLAW_PRESERVATION_CLASS = Object.freeze({
  UPDATE_TARGET: 'UPDATE_TARGET',
  PRESERVE_SOURCE: 'PRESERVE_SOURCE',
  PRESERVE_CONFIG: 'PRESERVE_CONFIG',
  PRESERVE_RUNTIME: 'PRESERVE_RUNTIME',
  REBUILDABLE_GENERATED: 'REBUILDABLE_GENERATED',
  MANUAL_ONLY: 'MANUAL_ONLY',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
});

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:/+-]{0,127}$/i;
const SAFE_VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const WINDOWS_ABSOLUTE_PATH = /^[a-z]:[\\/]/i;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SECRET_PATH_PATTERN = /(?:^|\/)(?:\.env(?:\.[^/]+)?|credentials?|secrets?|tokens?|cookies?|sessions?|private[-_]?keys?|id_rsa(?:\.pub)?)(?:$|\/)/i;
const CONFIG_PATH_PATTERN = /(?:^|\/)(?:\.openclaw\/openclaw\.json|openclaw\.json|config\/openclaw(?:\/|$)|openclaw\/config(?:\/|$))/i;
const SOURCE_PATH_PATTERN = /^(?:integrations\/openclaw\/|plugins\/|commands\/|mission-runner\/(?:tools|runbooks|staging)\/|scripts\/windows\/[^/]*openclaw[^/]*|shared\/agents\/openclaw[^/]*|docs\/[^/]*openclaw[^/]*)/i;
const RUNTIME_PATH_PATTERN = /(?:^|\/)(?:memory|dreams?|logs?|proof|proofs|receipts?|events?|status|archive)(?:\/|$)/i;
const UPDATE_TARGET_PATTERN = /(?:^|\/)(?:node_modules\/openclaw(?:\/|$)|openclaw\.mjs$|openclaw\.(?:cmd|bat|exe|ps1)$)/i;
const GENERATED_PATH_PATTERN = /(?:^|\/)(?:apps\/stephanos\/dist|dist|build|coverage|\.cache|cache|tmp|temp|node_modules)(?:\/|$)/i;
const SUPPORTED_INVENTORY_KINDS = Object.freeze(['file', 'directory', 'command', 'package']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function lower(value) {
  return text(value).toLowerCase();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizePath(value) {
  const raw = text(value);
  if (!raw || raw.length > OPENCLAW_UPDATE_PREFLIGHT_MAX_TEXT || CONTROL_CHARACTERS.test(raw)) return '';
  const slashed = raw.replace(/\\/g, '/').replace(/\/+/g, '/');
  const withoutQuotes = slashed.replace(/^["'`]+|["'`]+$/g, '');
  const isAbsolute = WINDOWS_ABSOLUTE_PATH.test(withoutQuotes) || withoutQuotes.startsWith('/');
  const comparable = isAbsolute ? withoutQuotes : withoutQuotes.replace(/^\.\//, '');
  const segments = comparable.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) return '';
  return comparable.replace(/\/$/, '');
}

function isAbsolutePath(value) {
  return WINDOWS_ABSOLUTE_PATH.test(value) || value.startsWith('/');
}

function safePathIdentity(value) {
  const normalized = normalizePath(value);
  if (!normalized) return null;
  const comparable = normalized.toLowerCase();
  const fingerprint = sha256(comparable);
  return Object.freeze({
    normalized,
    pathFingerprintSha256: fingerprint,
    displayPath: isAbsolutePath(normalized)
      ? `absolute-path:${fingerprint}`
      : normalized,
  });
}

function knownWorkspacePath(normalized) {
  const lowerPath = lower(normalized);
  return lowerPath.includes('/documents/stephanos-openclaw-workspace')
    || lowerPath.includes('/.openclaw/agents')
    || lowerPath === lower(OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY.replace(/\\/g, '/'))
    || lowerPath === lower(OPENCLAW_EXTERNAL_AGENT_MEMORY_DIRECTORY.replace(/\\/g, '/').replace(/\/$/, ''));
}

export function classifyOpenClawPreservationPath(value) {
  const identity = safePathIdentity(value);
  if (!identity) {
    return Object.freeze({
      classification: OPENCLAW_PRESERVATION_CLASS.APPROVAL_REQUIRED,
      reason: 'unsafe-or-empty-path',
      pathFingerprintSha256: null,
      displayPath: '<unsafe-path>',
    });
  }
  const normalized = identity.normalized;
  let classification = OPENCLAW_PRESERVATION_CLASS.APPROVAL_REQUIRED;
  let reason = 'unclassified-path';

  if (SECRET_PATH_PATTERN.test(normalized)) {
    classification = OPENCLAW_PRESERVATION_CLASS.MANUAL_ONLY;
    reason = 'secret-or-session-bearing-path';
  } else if (CONFIG_PATH_PATTERN.test(normalized)) {
    classification = OPENCLAW_PRESERVATION_CLASS.PRESERVE_CONFIG;
    reason = 'openclaw-config';
  } else if (SOURCE_PATH_PATTERN.test(normalized)) {
    classification = OPENCLAW_PRESERVATION_CLASS.PRESERVE_SOURCE;
    reason = 'source-controlled-openclaw-extension';
  } else if (knownWorkspacePath(normalized) || RUNTIME_PATH_PATTERN.test(normalized)) {
    classification = OPENCLAW_PRESERVATION_CLASS.PRESERVE_RUNTIME;
    reason = 'durable-openclaw-runtime-or-workspace-state';
  } else if (UPDATE_TARGET_PATTERN.test(normalized)) {
    classification = OPENCLAW_PRESERVATION_CLASS.UPDATE_TARGET;
    reason = 'pinned-openclaw-package-target';
  } else if (GENERATED_PATH_PATTERN.test(normalized)) {
    classification = OPENCLAW_PRESERVATION_CLASS.REBUILDABLE_GENERATED;
    reason = 'generated-or-cache-output';
  }

  return Object.freeze({
    classification,
    reason,
    pathFingerprintSha256: identity.pathFingerprintSha256,
    displayPath: identity.displayPath,
  });
}

function normalizeDigest(value) {
  const digest = lower(value);
  return SHA256_PATTERN.test(digest) ? digest : '';
}

function normalizeSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function normalizeInventory(inventory, blockers) {
  if (!Array.isArray(inventory)) {
    blockers.push('INVENTORY_NOT_ARRAY');
    return [];
  }
  if (inventory.length === 0) blockers.push('INVENTORY_EMPTY');
  if (inventory.length > OPENCLAW_UPDATE_PREFLIGHT_MAX_INVENTORY) {
    blockers.push('INVENTORY_LIMIT_EXCEEDED');
    return [];
  }

  const byFingerprint = new Map();
  for (const item of inventory) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      blockers.push('INVENTORY_ITEM_MALFORMED');
      continue;
    }
    const classified = classifyOpenClawPreservationPath(item.path);
    const digestSha256 = normalizeDigest(item.digestSha256 ?? item.sha256);
    const existsProvided = Object.prototype.hasOwnProperty.call(item, 'exists');
    const existsValid = !existsProvided || typeof item.exists === 'boolean';
    const exists = existsValid ? item.exists !== false : null;
    const rawKind = item.kind === undefined ? 'file' : text(item.kind);
    const kindValid = SUPPORTED_INVENTORY_KINDS.includes(rawKind);
    const kind = kindValid ? rawKind : 'unsupported';
    const sizeProvided = Object.prototype.hasOwnProperty.call(item, 'size');
    const size = normalizeSize(item.size);
    const entry = Object.freeze({
      displayPath: classified.displayPath,
      pathFingerprintSha256: classified.pathFingerprintSha256,
      classification: classified.classification,
      reason: classified.reason,
      kind,
      exists,
      size,
      digestSha256: exists === true ? digestSha256 || null : null,
    });

    if (!classified.pathFingerprintSha256) blockers.push('INVENTORY_PATH_UNSAFE');
    if (!kindValid) blockers.push(`UNSUPPORTED_INVENTORY_KIND:${classified.pathFingerprintSha256 || 'unsafe'}`);
    if (!existsValid) blockers.push(`INVENTORY_EXISTS_INVALID:${classified.pathFingerprintSha256 || 'unsafe'}`);
    if (sizeProvided && size === null) blockers.push(`INVENTORY_SIZE_INVALID:${classified.pathFingerprintSha256 || 'unsafe'}`);
    if (exists === false && digestSha256) blockers.push(`ABSENT_INVENTORY_DIGEST_PRESENT:${classified.pathFingerprintSha256 || 'unsafe'}`);
    if (exists === true && classified.classification !== OPENCLAW_PRESERVATION_CLASS.REBUILDABLE_GENERATED && !digestSha256) {
      blockers.push(`MISSING_DIGEST:${classified.pathFingerprintSha256 || 'unsafe'}`);
    }
    if (classified.classification === OPENCLAW_PRESERVATION_CLASS.MANUAL_ONLY) {
      blockers.push(`MANUAL_ONLY_PATH:${classified.pathFingerprintSha256}`);
    }
    if (classified.classification === OPENCLAW_PRESERVATION_CLASS.APPROVAL_REQUIRED) {
      blockers.push(`UNCLASSIFIED_PATH:${classified.pathFingerprintSha256}`);
    }

    const existing = byFingerprint.get(classified.pathFingerprintSha256);
    if (existing) {
      const existingCanonical = canonicalJson(existing);
      const entryCanonical = canonicalJson(entry);
      if (existingCanonical !== entryCanonical) {
        blockers.push(`CONFLICTING_INVENTORY_IDENTITY:${classified.pathFingerprintSha256}`);
        if (entryCanonical < existingCanonical) byFingerprint.set(classified.pathFingerprintSha256, entry);
      }
      continue;
    }
    if (classified.pathFingerprintSha256) byFingerprint.set(classified.pathFingerprintSha256, entry);
  }
  return [...byFingerprint.values()].sort((a, b) => (
    a.pathFingerprintSha256.localeCompare(b.pathFingerprintSha256)
  ));
}

function normalizeOpenClawFingerprint(input, blockers) {
  const version = text(input?.version);
  const executableDigestSha256 = normalizeDigest(input?.executableSha256);
  const packageDigestSha256 = normalizeDigest(input?.packageSha256);
  const installIdentity = safePathIdentity(input?.installPath);
  const executableIdentity = safePathIdentity(input?.executablePath);
  const packageIdentity = safePathIdentity(input?.packagePath);
  const gatewayEndpoint = text(input?.gatewayEndpoint);
  const startupSource = text(input?.startupSource);
  const startupCommand = text(input?.startupCommand);

  if (!SAFE_VERSION_PATTERN.test(version)) blockers.push('OPENCLAW_VERSION_UNSAFE_OR_MISSING');
  if (!executableDigestSha256) blockers.push('OPENCLAW_EXECUTABLE_DIGEST_MISSING');
  if (!packageDigestSha256) blockers.push('OPENCLAW_PACKAGE_DIGEST_MISSING');
  if (!installIdentity) blockers.push('OPENCLAW_INSTALL_PATH_MISSING');
  if (!executableIdentity) blockers.push('OPENCLAW_EXECUTABLE_PATH_MISSING');
  if (!packageIdentity) blockers.push('OPENCLAW_PACKAGE_PATH_MISSING');
  if (gatewayEndpoint !== OPENCLAW_GATEWAY_APPROVED_ENDPOINT) blockers.push('OPENCLAW_GATEWAY_ENDPOINT_MISMATCH');
  if (startupSource !== OPENCLAW_GATEWAY_STARTUP_SOURCE) blockers.push('OPENCLAW_STARTUP_SOURCE_MISMATCH');
  if (startupCommand !== getOpenClawGatewayStartupCommand()) blockers.push('OPENCLAW_STARTUP_COMMAND_MISMATCH');

  return Object.freeze({
    version: SAFE_VERSION_PATTERN.test(version) ? version : null,
    executableDigestSha256: executableDigestSha256 || null,
    packageDigestSha256: packageDigestSha256 || null,
    installPathFingerprintSha256: installIdentity?.pathFingerprintSha256 ?? null,
    executablePathFingerprintSha256: executableIdentity?.pathFingerprintSha256 ?? null,
    packagePathFingerprintSha256: packageIdentity?.pathFingerprintSha256 ?? null,
    gatewayEndpoint,
    startupSource,
    startupCommand,
  });
}

function normalizeUpdatePacket(input, blockers) {
  const packetId = text(input?.packetId);
  const sourceId = text(input?.sourceId);
  const targetVersion = text(input?.targetVersion ?? input?.version);
  const packetSha256 = normalizeDigest(input?.packetSha256 ?? input?.sha256);
  if (!SAFE_ID_PATTERN.test(packetId)) blockers.push('UPDATE_PACKET_ID_UNSAFE_OR_MISSING');
  if (!SAFE_ID_PATTERN.test(sourceId)) blockers.push('UPDATE_PACKET_SOURCE_UNSAFE_OR_MISSING');
  if (!SAFE_VERSION_PATTERN.test(targetVersion)) blockers.push('UPDATE_TARGET_VERSION_UNSAFE_OR_MISSING');
  if (!packetSha256) blockers.push('UPDATE_PACKET_DIGEST_MISSING');
  return Object.freeze({
    packetId: SAFE_ID_PATTERN.test(packetId) ? packetId : null,
    sourceId: SAFE_ID_PATTERN.test(sourceId) ? sourceId : null,
    targetVersion: SAFE_VERSION_PATTERN.test(targetVersion) ? targetVersion : null,
    packetSha256: packetSha256 || null,
  });
}

function countByClassification(entries) {
  return Object.freeze(Object.values(OPENCLAW_PRESERVATION_CLASS).reduce((counts, key) => {
    counts[key] = entries.filter((entry) => entry.classification === key).length;
    return counts;
  }, {}));
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function buildDryRunPlan() {
  return Object.freeze([
    Object.freeze({ step: 1, action: 'VERIFY_EXACT_PREFLIGHT_MANIFEST', executed: false, mutation: false }),
    Object.freeze({ step: 2, action: 'STAGE_PINNED_UPDATE_PACKET_OUTSIDE_PROTECTED_PATHS', executed: false, mutation: false }),
    Object.freeze({ step: 3, action: 'BACK_UP_PROTECTED_CONFIG_SOURCE_AND_RUNTIME_IDENTITIES', executed: false, mutation: false }),
    Object.freeze({ step: 4, action: 'REQUEST_EXACT_OPERATOR_APPROVAL', executed: false, mutation: false }),
    Object.freeze({ step: 5, action: 'APPLY_PINNED_PACKAGE_UPDATE_THROUGH_BOUNDED_ADAPTER', executed: false, mutation: true }),
    Object.freeze({ step: 6, action: 'VERIFY_GATEWAY_BACKEND_UI_WORKER_AND_SHARED_WORKSPACE', executed: false, mutation: false }),
    Object.freeze({ step: 7, action: 'COMPARE_PROTECTED_IDENTITIES_BEFORE_AND_AFTER', executed: false, mutation: false }),
  ]);
}

function buildRollbackPlan() {
  return Object.freeze([
    Object.freeze({ step: 1, action: 'STOP_ONLY_VERIFIED_UPDATED_OPENCLAW_RUNTIME', executed: false }),
    Object.freeze({ step: 2, action: 'RESTORE_PREVIOUS_PINNED_OPENCLAW_PACKAGE', executed: false }),
    Object.freeze({ step: 3, action: 'RESTORE_PROTECTED_CONFIG_SOURCE_AND_RUNTIME_IDENTITIES', executed: false }),
    Object.freeze({ step: 4, action: 'START_CANONICAL_OPENCLAW_GATEWAY_ROUTE', executed: false }),
    Object.freeze({ step: 5, action: 'VERIFY_PORT_18789_AND_COMPLETE_BATTLE_BRIDGE_HEALTH', executed: false }),
    Object.freeze({ step: 6, action: 'PUBLISH_BLOCKED_WITH_RESTORE_PATH_OR_RESTORED_VERDICT', executed: false }),
  ]);
}

export function buildOpenClawUpdatePreflightV1(input = {}) {
  const blockers = [];
  const observedAtUtc = text(input.observedAtUtc);
  const repository = text(input.repository);
  const sourceHead = lower(input.sourceHead);
  if (!observedAtUtc || !EXPLICIT_TIMEZONE.test(observedAtUtc) || Number.isNaN(Date.parse(observedAtUtc))) {
    blockers.push('OBSERVED_AT_UTC_INVALID');
  }
  if (!SAFE_ID_PATTERN.test(repository) || !repository.includes('/')) blockers.push('REPOSITORY_IDENTITY_INVALID');
  if (!SHA_PATTERN.test(sourceHead)) blockers.push('SOURCE_HEAD_INVALID');

  const current = normalizeOpenClawFingerprint(input.openClaw, blockers);
  const updatePacket = normalizeUpdatePacket(input.updatePacket, blockers);
  const entries = normalizeInventory(input.inventory, blockers);
  const blockersUnique = uniqueSorted(blockers);
  const noUpdateNeeded = current.version && updatePacket.targetVersion && current.version === updatePacket.targetVersion;

  const manifestCore = Object.freeze({
    schema: 'stephanos.openclaw-preservation-manifest.v1',
    repository: SAFE_ID_PATTERN.test(repository) && repository.includes('/') ? repository : null,
    sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : null,
    current,
    updatePacket,
    entries,
  });
  const manifestSha256 = sha256(canonicalJson(manifestCore));
  const status = noUpdateNeeded && blockersUnique.length === 0
    ? OPENCLAW_UPDATE_PREFLIGHT_STATUS.NO_UPDATE_NEEDED
    : blockersUnique.length > 0
      ? OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH
      : OPENCLAW_UPDATE_PREFLIGHT_STATUS.APPROVAL_REQUIRED;

  return Object.freeze({
    schema: OPENCLAW_UPDATE_PREFLIGHT_SCHEMA,
    version: OPENCLAW_UPDATE_PREFLIGHT_VERSION,
    observedAtUtc: observedAtUtc || null,
    repository: manifestCore.repository,
    sourceHead: manifestCore.sourceHead,
    status,
    blocker: blockersUnique[0] ?? null,
    blockers: blockersUnique,
    currentOpenClaw: current,
    updatePacket,
    preservationManifest: Object.freeze({
      ...manifestCore,
      manifestSha256,
      counts: countByClassification(entries),
    }),
    dryRunPlan: buildDryRunPlan(),
    rollbackPlan: buildRollbackPlan(),
    safety: Object.freeze({
      mutationAllowed: false,
      updateAttempted: false,
      installAttempted: false,
      servicesStopped: false,
      configWritten: false,
      sourceMutated: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      operatorApprovalRequired: status === OPENCLAW_UPDATE_PREFLIGHT_STATUS.APPROVAL_REQUIRED,
      secretsIncluded: false,
      absolutePathsPublished: false,
    }),
    nextAction: status === OPENCLAW_UPDATE_PREFLIGHT_STATUS.APPROVAL_REQUIRED
      ? 'Review the exact preservation manifest, dry-run plan and rollback plan, then issue a separate exact update-packet approval.'
      : status === OPENCLAW_UPDATE_PREFLIGHT_STATUS.NO_UPDATE_NEEDED
        ? 'No version-changing update is required; retain the preservation manifest as the current baseline.'
        : 'Resolve every named blocker without mutating OpenClaw, then regenerate the read-only preflight.',
  });
}

export function renderOpenClawUpdatePreflightSummary(preflight) {
  const value = preflight && typeof preflight === 'object' ? preflight : {};
  return [
    `OPENCLAW_UPDATE_PREFLIGHT=${text(value.status, 'UNKNOWN')}`,
    `SOURCE_HEAD=${text(value.sourceHead, 'UNKNOWN')}`,
    `CURRENT_VERSION=${text(value.currentOpenClaw?.version, 'UNKNOWN')}`,
    `TARGET_VERSION=${text(value.updatePacket?.targetVersion, 'UNKNOWN')}`,
    `MANIFEST_SHA256=${text(value.preservationManifest?.manifestSha256, 'UNKNOWN')}`,
    `BLOCKER=${text(value.blocker, 'NONE')}`,
    `MUTATION_ALLOWED=${value.safety?.mutationAllowed === true ? 'YES' : 'NO'}`,
    `OPERATOR_APPROVAL_REQUIRED=${value.safety?.operatorApprovalRequired === true ? 'YES' : 'NO'}`,
    `NEXT_ACTION=${text(value.nextAction, 'UNKNOWN')}`,
  ].join('\n');
}
