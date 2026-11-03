import { createHash, createPublicKey, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export const LEGACY_ORPHAN_QUARANTINE_SCHEMA = 'stephanos.legacy-original-source-orphan-quarantine.v1';
export const LEGACY_ORPHAN_WITNESS_DOMAIN = 'stephanos.legacy-orphan-os-witness.v1\0';
export const LEGACY_ORPHAN_APPROVAL_DOMAIN = 'stephanos.legacy-orphan-operator-approval.v1\0';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const SID = /^S-1-[1-9][0-9]*(?:-[0-9]+){2,15}$/;
const ROOT_ID = 'Cheekyfellastef/stephan-os';
const LEASE_ID = 'critical-2962-elastic-goal-r7-lease';
const MISSION_ID = 'critical-2962-elastic-goal';
const MAX_AGE_MS = 5 * 60_000;
const text = x => String(x ?? '').trim();
const failed = reason => Object.freeze({
  authenticated: false, classification: 'LEGACY_ORPHAN_QUARANTINE_HELD',
  blocker: reason, eligibilityOnly: true,
  leaseReleaseAuthority: false, sourceMutationAuthority: false,
  materialPickupProven: false, goalComplete: false,
});
const timestamp = str => {
  if (typeof str !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(str)) return NaN;
  const ms = Date.parse(str);
  return Number.isFinite(ms) && new Date(ms).toISOString() === str ? ms : NaN;
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, path) => {
  const diff = relative(base, path);
  return diff === '' || (diff !== '..' && !diff.startsWith('..\\')
    && !diff.startsWith('../') && !isAbsolute(diff));
};
// The three independently pinned trust objects must be read from retained
// file handles. A path-only lstat followed by readFile can otherwise open a
// different file after a rename/reparse swap. Reject hard links as well:
 // a second name inside a source-controlled tree defeats path-only custody.
function sameTrustFile(a, b) {
  return a.isFile() && b.isFile()
    && !a.isSymbolicLink() && !b.isSymbolicLink()
    && a.dev === b.dev && a.ino === b.ino
    && a.nlink === 1 && b.nlink === 1
    && a.size === b.size && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs;
}

async function boundedRegular(path, limit, pinnedRealPath) {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1
    || entry.size < 1 || entry.size > limit
    || await realpath(path) !== pinnedRealPath) return null;
  // O_NOFOLLOW protects a final-component link swap where the platform
  // supports it. Handle/path identity checks below fail closed on platforms
  // that do not implement O_NOFOLLOW.
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!sameTrustFile(entry, opened)) return null;
    const data = await handle.readFile();
    const after = await handle.stat();
    const named = await lstat(path);
    if (!sameTrustFile(opened, after) || !sameTrustFile(after, named)
      || data.length !== entry.size || await realpath(path) !== pinnedRealPath) return null;
    return data;
  } finally {
    await handle.close();
  }
}
function verifiedSignature(part, key, domain) {
  if (!part || !part.claims || typeof part.claims !== 'object'
    || Array.isArray(part.claims) || part.algorithm !== 'Ed25519') return false;
  const base64 = text(part.signatureBase64);
  const signature = Buffer.from(base64, 'base64');
  return signature.length === 64 && signature.toString('base64') === base64
    && verify(null, Buffer.from(domain + JSON.stringify(part.claims), 'utf8'), key, signature);
}

// Admits only independently authenticated *prospective source exclusion* for
// the one historically unprovable #2962 revision-7 attempt. It is NOT a signer,
// cancellation, historical terminal receipt, canonical lease release or PID kill.
// Files and digest pins come from trusted machine configuration, never GitHub.
export async function authenticateLegacyOrphanQuarantine(
  expected = {}, { env = process.env, now = () => Date.now() } = {},
) {
  try {
    if (expected.repository !== ROOT_ID || expected.missionId !== MISSION_ID
      || expected.leaseId !== LEASE_ID || expected.revision !== 7
      || !SHA64.test(text(expected.originalLeaseDigest))
      || !SHA40.test(text(expected.headSha)) || !SHA40.test(text(expected.sourceRevision))
      || !isAbsolute(text(expected.worktreePath))
      || !/^critical-2962-elastic-goal-r(?:0|[1-9][0-9]*)-[a-f0-9]{12}$/.test(text(expected.sourceExecutionId))
      || !/^[a-z0-9._-]{8,127}$/.test(text(expected.commandId))
      || !/^[a-z0-9._:-]{8,120}$/.test(text(expected.requestId))
      || !text(expected.branch)) return failed('LEGACY_ORPHAN_EXACT_IDENTITY_UNPROVEN');

    const receiptPath = text(env.STEPHANOS_LEGACY_ORPHAN_EVIDENCE_PATH);
    const witnessPublicPath = text(env.STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_PATH);
    const operatorPublicPath = text(env.STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_PATH);
    const witnessHash = text(env.STEPHANOS_LEGACY_ORPHAN_OS_WITNESS_PUBLIC_KEY_SHA256);
    const operatorHash = text(env.STEPHANOS_LEGACY_ORPHAN_OPERATOR_PUBLIC_KEY_SHA256);
    if (![receiptPath, witnessPublicPath, operatorPublicPath].every(isAbsolute)
      || !SHA64.test(witnessHash) || !SHA64.test(operatorHash) || witnessHash === operatorHash) {
      return failed('LEGACY_ORPHAN_TRUST_ROOTS_UNPROVEN');
    }
    const home = await realpath(resolve(expected.worktreePath));
    const configPaths = [receiptPath, witnessPublicPath, operatorPublicPath].map(x => resolve(x));
    if (new Set(configPaths.map(x => x.toLowerCase())).size !== 3
      || configPaths.some(x => inside(home, x))) return failed('LEGACY_ORPHAN_TRUST_PATHS_UNSAFE');
    const realPaths = await Promise.all(configPaths.map(x => realpath(x)));
    if (realPaths.some(x => inside(home, x))) return failed('LEGACY_ORPHAN_TRUST_PATHS_UNSAFE');
    const [recordBytes, witnessBytes, operatorBytes] = await Promise.all([
      boundedRegular(configPaths[0], 24 * 1024, realPaths[0]),
      boundedRegular(configPaths[1], 4096, realPaths[1]),
      boundedRegular(configPaths[2], 4096, realPaths[2]),
    ]);
    if (!recordBytes || !witnessBytes || !operatorBytes
      || hash(witnessBytes) !== witnessHash || hash(operatorBytes) !== operatorHash) {
      return failed('LEGACY_ORPHAN_TRUST_FILES_UNVERIFIED');
    }
    const witnessKey = createPublicKey(witnessBytes);
    const operatorKey = createPublicKey(operatorBytes);
    if (witnessKey.asymmetricKeyType !== 'ed25519' || operatorKey.asymmetricKeyType !== 'ed25519'
      || witnessKey.export({ format: 'der', type: 'spki' })
        .equals(operatorKey.export({ format: 'der', type: 'spki' }))) {
      return failed('LEGACY_ORPHAN_TRUST_PRINCIPALS_NOT_INDEPENDENT');
    }
    const record = JSON.parse(recordBytes.toString('utf8'));
    if (record?.schemaVersion !== LEGACY_ORPHAN_QUARANTINE_SCHEMA
      || !verifiedSignature(record.osWitness, witnessKey, LEGACY_ORPHAN_WITNESS_DOMAIN)
      || !verifiedSignature(record.operatorApproval, operatorKey, LEGACY_ORPHAN_APPROVAL_DOMAIN)) {
      return failed('LEGACY_ORPHAN_ATTESTATIONS_UNAUTHENTICATED');
    }
    const w = record.osWitness.claims;
    const a = record.operatorApproval.claims;
    const clock = typeof now === 'function' ? now() : Date.now();
    const start = timestamp(w.containmentEffectiveAtUtc);
    const observed = timestamp(w.observedAtUtc);
    const signed = timestamp(w.signedAtUtc);
    const approved = timestamp(a.approvedAtUtc);
    if (![clock, start, observed, signed, approved].every(Number.isFinite)
      || start > observed || observed > signed || signed > approved || approved > clock
      || clock - signed > MAX_AGE_MS || clock - approved > MAX_AGE_MS) {
      return failed('LEGACY_ORPHAN_CURRENT_ATTESTATION_UNPROVEN');
    }
    const keys = ['repository', 'missionId', 'leaseId', 'branch', 'headSha', 'sourceExecutionId'];
    if (keys.some(key => w[key] !== expected[key])
      || w.revision !== 7 || w.originalLeaseDigest !== expected.originalLeaseDigest
      || w.sourceRevision !== expected.sourceRevision
      || resolve(text(w.worktreePath)) !== home
      || w.historicalTerminalReceiptPresent !== false
      || w.historicalTerminalReceiptReconstructed !== false
      || w.historicalExecutionOutcome === 'COMPLETED'
      || w.historicalExecutionOutcome !== 'UNKNOWN'
      || w.activeOriginalSourceWriters !== 0
      || w.oldWriterAccessRevoked !== true || w.outOfJobExecutionRevoked !== true
      || w.wmiComRelaunchDenied !== true || w.scheduledTaskRelaunchDenied !== true
      || w.sourceWriteAccessDeniedToOriginalPrincipals !== true
      || w.testedOldPrincipalWriteDenied !== true
      || w.knownWorkerQueuesQuiesced !== true
      || w.containmentRemainsEnforced === false
      || w.containmentRemainsEnforced !== true
      || !SID.test(text(w.independentOsWitnessSid))
      || !SHA64.test(text(w.osEvidenceDigest))
      || !SHA64.test(text(w.denyAclPolicyDigest))
      || !/^[a-z0-9._:-]{8,120}$/.test(text(w.protectedWitnessLogId))) {
      return failed('LEGACY_ORPHAN_PHYSICAL_CONTAINMENT_UNPROVEN');
    }
    const witnessDigest = hash(Buffer.from(JSON.stringify(record.osWitness), 'utf8'));
    if (a.repository !== ROOT_ID || a.missionId !== MISSION_ID
      || a.leaseId !== LEASE_ID || a.revision !== 7
      || a.originalLeaseDigest !== expected.originalLeaseDigest
      || a.commandId !== expected.commandId || a.requestId !== expected.requestId
      || a.witnessDigest !== witnessDigest
      || a.historicalOutcomeRemainsUnknown !== true
      || a.deferGoalNotComplete !== true
      || a.operatorApprovalKind !== 'QUARANTINE_ORIGINAL_EXECUTION_ONLY'
      || !SID.test(text(a.operatorSid)) || a.operatorSid === w.independentOsWitnessSid) {
      return failed('LEGACY_ORPHAN_INDEPENDENT_OPERATOR_APPROVAL_UNPROVEN');
    }
    return Object.freeze({
      authenticated: true, classification: 'LEGACY_ORPHAN_PROSPECTIVE_CONTAINMENT_VERIFIED',
      evidenceDigest: hash(recordBytes), witnessDigest, observedAtUtc: w.observedAtUtc,
      originalLeaseDigest: w.originalLeaseDigest, historicalExecutionOutcome: 'UNKNOWN',
      eligibilityOnly: true, leaseReleaseAuthority: false, sourceMutationAuthority: false,
      materialPickupProven: false, goalComplete: false,
    });
  } catch {
    return failed('LEGACY_ORPHAN_ATTESTATION_UNOBSERVABLE');
  }
}
