import { createHash, createPrivateKey, createPublicKey, randomUUID, sign, verify } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { lstat, open, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveBattleBridgeGitExecutable, createBattleBridgeMinimalChildEnvironment,
  validateBattleBridgeLocalGitConfiguration } from './battleBridgeExecutionBoundaryV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { readBrokeredGithubJson } from './githubObservationBrokerV1.mjs';

// Use the EXISTING independently commissioned Core Ed25519 key; this
// observation is diagnostic only and never grants source/lease/merge powers.
export const LOGICAL_GOAL_PICKUP_ATTESTATION_SCHEMA = 'stephanos.logical-goal-pickup-attestation.v1';
export const LOGICAL_GOAL_PICKUP_ATTESTATION_DOMAIN = 'stephanos.logical-goal-pickup-attestation.v1\\0';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const REF = /^(?:proof|receipts)\/[a-z0-9][a-z0-9._/-]{0,180}$/i;
const WORKER_RECEIPT_SCHEMA = 'stephanos.physical-worker-goal-pickup.v1';
const WORKER_RECEIPT_DOMAIN = 'stephanos.physical-worker-goal-pickup.v1\\0';
const MAX_SKEW_MS = 60_000;
const MAX_AGE_MS = 15 * 60_000;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = v => String(v ?? '').trim();
const millis = v => Date.parse(text(v));

// Core and monitor are independent readers. A shared payload cache cannot
// authenticate either one and must not starve the second reader every cycle.
// This stable private reader key retains the broker's repository-wide backoff.
const canonicalMainReaderKey = `logical-goal-pickup:authenticated-main:${process.pid}:${randomUUID()}`;
let authenticatedMainObservation = null;
function readAuthenticatedCanonicalMainV1(root) {
  // Use the existing repository-wide broker's single-reader and rate-limit
  // custody. A writable Shared Workspace cache is discovery, never authority:
  // only this call's successful upstream observation may qualify the source.
  // Neither a caller-supplied SHA nor the checkout's origin/main is trusted.
  const monotonicNow = process.hrtime.bigint();
  // Reuse only our own live transport result for one second. Never import a
  // persisted broker payload into this private observation. Each reuse still
  // performs both local tracked-tree checks below.
  if (authenticatedMainObservation?.root === root
    && monotonicNow >= authenticatedMainObservation.at
    && monotonicNow - authenticatedMainObservation.at < 1_000_000_000n) {
    return authenticatedMainObservation.result;
  }
  const gh = process.platform === 'win32'
    ? BATTLE_BRIDGE_WINDOWS_HOST.githubCli : '/usr/bin/gh';
  const childEnv = createBattleBridgeMinimalChildEnvironment(process.env);
  try {
    const observed = readBrokeredGithubJson({
      key: canonicalMainReaderKey,
      endpoint: 'repos/Cheekyfellastef/stephan-os/git/ref/heads/main',
      args: ['--hostname', 'github.com', '--jq', '{ref,url,object:{sha:.object.sha,type:.object.type}}'],
      ttlMs: 1000, maxStaleMs: 1000, timeoutMs: 10000,
      ghCommand: gh,
      // Bind the existing CLI to its installed executable and fixed host,
      // without inherited PATH, GH_HOST, proxy, TLS or command overrides.
      spawnSyncFn: (_command, args, options) => spawnSync(gh, args, {
        ...options, env: childEnv,
      }),
    });
    if (observed?.rateLimitHold || observed?.reason === 'GITHUB_RATE_LIMIT_BACKOFF') {
      return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_GITHUB_RATE_LIMIT_HOLD' });
    }
    const response = observed?.payload;
    if (observed?.ok !== true || observed.source !== 'UPSTREAM_REFRESH'
      || observed.ageMs !== 0 || response?.ref !== 'refs/heads/main'
      || response.url !== 'https://api.github.com/repos/Cheekyfellastef/stephan-os/git/refs/heads/main'
      || response.object?.type !== 'commit' || !SHA40.test(response.object?.sha || '')) {
      return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_AUTHENTICATED_MAIN_UNAVAILABLE' });
    }
    const result = Object.freeze({ ok: true, sourceHead: response.object.sha, blocker: '' });
    authenticatedMainObservation = { root, at: process.hrtime.bigint(), result };
    return result;
  } catch {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_AUTHENTICATED_MAIN_UNAVAILABLE' });
  }
}


/**
 * A Git HEAD label is not evidence that the code evaluating physical pickup
 * matches that commit. Fail closed if *any tracked* index/worktree file differs
 * from canonical main, including staged edits. Untracked user files are left
 * untouched; never reset or clean the operator's checkout.
 */
function inspectLocalCanonicalTrackedMainV1(root) {
  // Never inherit Git's environment-controlled worktree/config overrides.
  // The shared fixed boundary also disables executable Git monitors/hooks,
  // external transports and dynamic credential helpers in every child call.
  const gitBinary = resolveBattleBridgeGitExecutable();
  const gitEnv = createBattleBridgeMinimalChildEnvironment(process.env, { git: true });
  const git = args => {
    const result = spawnSync(gitBinary, ['-C', root, ...args], {
      encoding: 'utf8', windowsHide: true, shell: false,
      timeout: 12000, maxBuffer: 4 * 1024 * 1024, env: gitEnv,
    });
    return result.status === 0 && !result.error ? String(result.stdout).trim() : null;
  };
  // A mutable local Git configuration can redirect the physical worktree or
  // install an execution-bearing filter; audit it *before* source promotion.
  const localConfig = git(['config', '--local', '--null', '--list']);
  if (localConfig === null || !validateBattleBridgeLocalGitConfiguration(localConfig).ok) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_GIT_CONFIGURATION_UNTRUSTED' });
  }
  const head = git(['rev-parse', '--verify', 'HEAD']);
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const originMain = git(['rev-parse', '--verify', 'refs/remotes/origin/main']);
  if (!SHA40.test(head || '') || branch !== 'main' || originMain !== head) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_CANONICAL_MAIN_UNVERIFIED' });
  }
  const trackedStatus = git(['status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=none']);
  if (trackedStatus === null) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_TRACKED_TREE_STATUS_UNAVAILABLE' });
  }
  if (trackedStatus !== '') {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_TRACKED_SOURCE_DIRTY' });
  }
  // Git intentionally hides locally changed bytes when index flags
  // assume-unchanged (lowercase 'h') or skip-worktree ('S') are present.
  // Never sign physical BUILDING proof from a tree that can evade status.
  const trackedIndex = git(['ls-files', '-v', '-z', '--']);
  if (trackedIndex === null) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_TRACKED_INDEX_UNAVAILABLE' });
  }
  const entries = trackedIndex.split('\0').filter(Boolean);
  if (entries.some(entry => !entry.startsWith('H ') || entry.length < 3)) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_TRACKED_INDEX_FLAGS_UNSAFE' });
  }
  return Object.freeze({ ok: true, sourceHead: head, blocker: '' });
}

export function verifyCleanCanonicalTrackedMainV1(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const initial = inspectLocalCanonicalTrackedMainV1(root);
  if (!initial.ok) return initial;
  // A source writer can move both local refs after committing altered code.
  // The final source decision must bind to GitHub's authenticated current main,
  // not merely to two matching values controlled by that same checkout.
  const authenticatedMain = readAuthenticatedCanonicalMainV1(root);
  if (!authenticatedMain.ok) return authenticatedMain;
  // The bounded upstream read may take seconds. Re-observe tracked source and
  // refs after it; a concurrent edit cannot borrow the earlier clean result.
  const final = inspectLocalCanonicalTrackedMainV1(root);
  if (!final.ok) return final;
  if (final.sourceHead !== initial.sourceHead) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_SOURCE_CHANGED_DURING_OBSERVATION' });
  }
  if (authenticatedMain.sourceHead !== final.sourceHead) {
    return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_AUTHENTICATED_MAIN_MISMATCH' });
  }
  return final;
}

// Public-key identities are cryptographic keys, not PEM byte strings. Different
// whitespace/newline encodings of the same Ed25519 SPKI MUST NOT count as two
// independent workers. Missing/invalid keys fail closed.
export function distinctPhysicalWorkerSigningIdentityV1(corePublicKeyPem, workerPublicKeyPem) {
  try {
    const core = createPublicKey(corePublicKeyPem);
    const worker = createPublicKey(workerPublicKeyPem);
    if (core.asymmetricKeyType !== 'ed25519' || worker.asymmetricKeyType !== 'ed25519') return false;
    return !core.export({ format: 'der', type: 'spki' })
      .equals(worker.export({ format: 'der', type: 'spki' }));
  } catch { return false; }
}

function safeProofRef(ref) { return REF.test(text(ref)) && !text(ref).includes('..'); }
function verifyWorkerReceipt(record, ref, goal, sourceHead, trust = {}) {
  const evidence = record?.workerPickupAttestation;
  if (!evidence || evidence.schemaVersion !== WORKER_RECEIPT_SCHEMA
    || evidence.publisherId !== 'stephanos-physical-worker'
    || evidence.sourceHead !== sourceHead
    || evidence.goalIssue !== goal.issue
    || evidence.logicalLaneId !== goal.logicalLaneId
    || evidence.controllerId !== goal.controllerId
    || evidence.runId !== record?.controllerActivityProof?.runId
    || evidence.proofId !== record?.proofId
    || evidence.proofRef !== ref
    || evidence.observedAtUtc !== goal.lastMaterialProgressAtUtc
    || !text(evidence.workerId)
    // A signed pickup for worker A cannot authenticate a Build Truth lane
    // attributed to worker B. Missing builder identity also fails closed.
    || !text(goal.builder)
    || text(evidence.workerId) !== text(goal.builder)
    || !SHA64.test(text(trust.workerPublicKeySha256))
    || !distinctPhysicalWorkerSigningIdentityV1(trust.corePublicKeyPem, trust.workerPublicKeyPem)
    || createHash('sha256').update(String(trust.workerPublicKeyPem || '')).digest('hex') !== trust.workerPublicKeySha256) {
    return false;
  }
  try {
    const key = createPublicKey(trust.workerPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    const body = {
      schemaVersion: evidence.schemaVersion, publisherId: evidence.publisherId,
      sourceHead: evidence.sourceHead, goalIssue: evidence.goalIssue,
      logicalLaneId: evidence.logicalLaneId, controllerId: evidence.controllerId,
      runId: evidence.runId, proofId: evidence.proofId, proofRef: evidence.proofRef,
      observedAtUtc: evidence.observedAtUtc, workerId: evidence.workerId,
    };
    const sig = Buffer.from(String(evidence.signatureBase64 || ''), 'base64');
    return sig.length === 64 && sig.toString('base64') === evidence.signatureBase64
      && verify(null, Buffer.from(WORKER_RECEIPT_DOMAIN + JSON.stringify(body)), key, sig);
  } catch { return false; }
}
function refsOf(record) {
  const id = text(record?.proofId);
  return new Set([
    ...(Array.isArray(record?.refs) ? record.refs : []),
    ...(Array.isArray(record?.proofRefs) ? record.proofRefs : []),
    id ? `proof/${id}` : '', id ? `proof/${id}.json` : '',
  ]);
}
function qualifiedProof(record, ref, goal, timeMs, currentMs, sourceHead, trust) {
  if (!record || record.kind !== 'stephanos.shared_workspace.proof'
    || text(record.status).toUpperCase() !== 'PASS'
    || record.controllerActivityProof?.schemaVersion !== 'stephanos.controller-activity-proof.v1'
    || record.controllerActivityProof.controllerId !== goal.controllerId
    || !text(record.controllerActivityProof.runId)
    || Number(record.controllerActivityProof.materialActionsSucceeded) < 1
    || text(record.correlationId) !== text(record.controllerActivityProof.runId)
    || !refsOf(record).has(ref)
    || !safeProofRef(ref)
    || !verifyWorkerReceipt(record, ref, goal, sourceHead, trust)) return false;
  const at = millis(record.timestampUtc);
  return Number.isFinite(at) && at <= currentMs + MAX_SKEW_MS
    && currentMs - at <= MAX_AGE_MS
    && Math.abs(at - timeMs) <= MAX_AGE_MS;
}
function canonicalClaims(buildTruth, proofRecords, nowMs, sourceHead, trust) {
  if (!Array.isArray(buildTruth?.goals)) return null;
  const claims = [];
  for (const goal of buildTruth.goals) {
    if (goal?.state !== 'BUILDING') continue;
    const refs = Array.isArray(goal.proofRefs) ? goal.proofRefs : [];
    const at = millis(goal.lastMaterialProgressAtUtc);
    if (refs.length < 1 || refs.length > 8 || !Number.isFinite(at)
      || at > nowMs + MAX_SKEW_MS || nowMs - at > MAX_AGE_MS
      || !/^#[1-9]\d*$/.test(text(goal.issue))
      || !/^logical-goal-[1-9]\d*$/.test(text(goal.logicalLaneId))
      || goal.logicalLaneId !== `logical-goal-${text(goal.issue).slice(1)}`
      || !text(goal.controllerId) || goal.selectedForAdmission !== true) return null;
    const perRef = [];
    for (const ref of refs) {
      if (!safeProofRef(ref)) return null;
      const matches = proofRecords.filter(record =>
        qualifiedProof(record, ref, goal, at, nowMs, sourceHead, trust));
      if (matches.length !== 1) return null;
      perRef.push(Object.freeze({ proofRef: ref, proofId: matches[0].proofId, recordSha256: digest(matches[0]) }));
    }
    claims.push(Object.freeze({
      issue: goal.issue,
      logicalLaneId: goal.logicalLaneId,
      controllerId: goal.controllerId,
      selectedForAdmission: true,
      lastMaterialProgressAtUtc: goal.lastMaterialProgressAtUtc,
      proofRecords: Object.freeze(perRef),
    }));
  }
  return claims;
}
function signedBody({ buildTruth, sourceHead, proofRecords, nowMs, trust }) {
  if (!SHA40.test(text(sourceHead)) || buildTruth?.schemaVersion !== 'stephanos.sovereign-build-truth.v1'
    || !Number.isFinite(millis(buildTruth.observedAtUtc))
    || millis(buildTruth.observedAtUtc) > nowMs + MAX_SKEW_MS
    || nowMs - millis(buildTruth.observedAtUtc) > MAX_AGE_MS
    || !Array.isArray(proofRecords)) return null;
  const claims = canonicalClaims(buildTruth, proofRecords, nowMs, sourceHead, trust);
  if (!claims) return null;
  return Object.freeze({
    schemaVersion: LOGICAL_GOAL_PICKUP_ATTESTATION_SCHEMA,
    publisherId: 'stephanos-core',
    signingKeyId: 'stephanos-goal-build-gates-v1',
    sourceHead,
    observedAtUtc: buildTruth.observedAtUtc,
    buildTruthSha256: digest(buildTruth),
    claims,
  });
}

/*
 * Read the canonical controller-activity proof records, not the originating
 * arbitrary receipts/* path. The latter appears only inside the controller
 * proof's refs list and may belong to a different producer. This scanner is
 * bounded and read-only; missing/redirected proof material denies attestation.
 */
export async function loadControllerActivityProofRecordsV1({ workspaceRoot } = {}) {
  const blocked = blocker => Object.freeze({ ok: false, blocker, records: Object.freeze([]) });
  if (typeof workspaceRoot !== 'string' || !workspaceRoot.trim()) return blocked('CONTROLLER_PROOF_ROOT_UNAVAILABLE');
  const root = resolve(workspaceRoot, 'proof');
  try {
    const dir = await lstat(root);
    if (!dir.isDirectory() || dir.isSymbolicLink()) return blocked('CONTROLLER_PROOF_ROOT_UNSAFE');
    const names = await readdir(root);
    // Durable proofs are append-only. Do NOT fail just because historical or
    // unrelated files have accumulated; bound CURRENT relevant reads instead.
    // mtime is a retrieval hint only, never proof of authenticity or freshness.
    const relevant = names.filter(name => /^controller-[a-z0-9._-]{1,110}\.json$/i.test(name));
    const nowMs = Date.now();
    const recentAfterMs = nowMs - MAX_AGE_MS - MAX_SKEW_MS;
    const records = [];
    for (const name of relevant) {
      const handle = await open(resolve(root, name), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > 262144) {
          return blocked('CONTROLLER_PROOF_RECORD_UNSAFE');
        }
        if (info.mtimeMs < recentAfterMs || info.mtimeMs > nowMs + MAX_SKEW_MS) continue;
        if (records.length >= 512) return blocked('CONTROLLER_PROOF_CURRENT_RECORD_CAP_EXCEEDED');
        const record = JSON.parse(await handle.readFile('utf8'));
        if (record?.kind !== 'stephanos.shared_workspace.proof'
          || record?.proofId !== name.slice(0, -5)
          || record?.controllerActivityProof?.schemaVersion !== 'stephanos.controller-activity-proof.v1') {
          return blocked('CONTROLLER_PROOF_RECORD_INVALID');
        }
        records.push(record);
      } finally { await handle.close(); }
    }
    return Object.freeze({ ok: true, blocker: '', records: Object.freeze(records) });
  } catch { return blocked('CONTROLLER_PROOF_RECORD_READ_FAILED'); }
}

export async function loadPinnedWorkerPickupVerifierV1({ localStateRoot, env = process.env } = {}) {
  const blocked = blocker => Object.freeze({ ok: false, blocker });
  const workerPublicKeySha256 = text(env.STEPHANOS_PHYSICAL_WORKER_TRUSTED_PUBLIC_KEY_SHA256).toLowerCase();
  const corePublicKeySha256 = text(env.STEPHANOS_GOAL_BUILD_GATES_TRUSTED_PUBLIC_KEY_SHA256).toLowerCase();
  if (!SHA64.test(workerPublicKeySha256) || !SHA64.test(corePublicKeySha256)
    || workerPublicKeySha256 === corePublicKeySha256) {
    return blocked('WORKER_PICKUP_DISTINCT_PIN_NOT_COMMISSIONED');
  }
  if (!text(localStateRoot)) return blocked('WORKER_PICKUP_LOCAL_TRUST_ROOT_UNAVAILABLE');
  try {
    const keyPath = resolve(localStateRoot, 'keys', 'stephanos-physical-worker-public.pem');
    const handle = await open(keyPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > 8192) return blocked('WORKER_PICKUP_PUBLIC_KEY_UNSAFE');
      const workerPublicKeyPem = await handle.readFile('utf8');
      if (createHash('sha256').update(workerPublicKeyPem).digest('hex') !== workerPublicKeySha256
        || createPublicKey(workerPublicKeyPem).asymmetricKeyType !== 'ed25519') {
        return blocked('WORKER_PICKUP_PUBLIC_KEY_PIN_MISMATCH');
      }
      // Read the separately pinned Core public key from the same precommissioned
      // machine trust directory. The two raw pins being different is NOT enough.
      const coreHandle = await open(resolve(localStateRoot, 'keys', 'stephanos-goal-build-gates-public.pem'),
        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      let corePublicKeyPem;
      try {
        const coreInfo = await coreHandle.stat();
        if (!coreInfo.isFile() || coreInfo.nlink !== 1 || coreInfo.size <= 0 || coreInfo.size > 8192) {
          return blocked('WORKER_PICKUP_CORE_PUBLIC_KEY_UNSAFE');
        }
        corePublicKeyPem = await coreHandle.readFile('utf8');
      } finally { await coreHandle.close(); }
      if (createHash('sha256').update(corePublicKeyPem).digest('hex') !== corePublicKeySha256) {
        return blocked('WORKER_PICKUP_CORE_PUBLIC_KEY_PIN_MISMATCH');
      }
      if (!distinctPhysicalWorkerSigningIdentityV1(corePublicKeyPem, workerPublicKeyPem)) {
        return blocked('WORKER_PICKUP_SIGNING_IDENTITY_NOT_DISTINCT');
      }
      return Object.freeze({ ok: true, blocker: '', workerPublicKeyPem,
        workerPublicKeySha256, corePublicKeySha256, corePublicKeyPem });
    } finally { await handle.close(); }
  } catch { return blocked('WORKER_PICKUP_PUBLIC_KEY_UNAVAILABLE'); }
}

export function signLogicalGoalBuildTruthV1({
  buildTruth, sourceHead, proofRecords = [], signingPrivateKeyPem = '',
  trustedWorkerPublicKeyPem = '', trustedWorkerPublicKeySha256 = '',
  corePublicKeySha256 = '', corePublicKeyPem = '', nowMs = Date.now(),
} = {}) {
  const trust = { workerPublicKeyPem: trustedWorkerPublicKeyPem,
    workerPublicKeySha256: trustedWorkerPublicKeySha256, corePublicKeySha256, corePublicKeyPem };
  const body = signedBody({ buildTruth, sourceHead, proofRecords, nowMs, trust });
  if (!body) return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_SIGNING_SOURCE_OR_PROOF_UNVERIFIED' });
  try {
    const key = createPrivateKey(signingPrivateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key');
    return Object.freeze({ ok: true, attestation: Object.freeze({
      ...body, signatureBase64: sign(null, Buffer.from(LOGICAL_GOAL_PICKUP_ATTESTATION_DOMAIN + JSON.stringify(body)), key).toString('base64'),
    }) });
  } catch { return Object.freeze({ ok: false, blocker: 'LOGICAL_GOAL_SIGNER_UNAVAILABLE' }); }
}
export function verifyLogicalGoalBuildTruthV1({
  buildTruth, attestation, proofRecords = [], expectedSourceHead = '',
  trustedPublicKeyPem = '', trustedPublicKeySha256 = '',
  trustedWorkerPublicKeyPem = '', trustedWorkerPublicKeySha256 = '', nowMs = Date.now(),
} = {}) {
  const blocked = reason => Object.freeze({ ok: false, blocker: reason, verifiedGoalIds: Object.freeze([]) });
  if (!SHA64.test(text(trustedPublicKeySha256))
    || createHash('sha256').update(String(trustedPublicKeyPem)).digest('hex') !== trustedPublicKeySha256) {
    return blocked('LOGICAL_GOAL_PINNED_VERIFIER_UNAVAILABLE');
  }
  const trust = { workerPublicKeyPem: trustedWorkerPublicKeyPem,
    workerPublicKeySha256: trustedWorkerPublicKeySha256,
    corePublicKeySha256: trustedPublicKeySha256,
    corePublicKeyPem: trustedPublicKeyPem };
  const body = signedBody({ buildTruth, sourceHead: expectedSourceHead, proofRecords, nowMs, trust });
  if (!body || !attestation || attestation.sourceHead !== expectedSourceHead
    || !Array.isArray(attestation.claims)
    || JSON.stringify(attestation.claims) !== JSON.stringify(body.claims)
    || attestation.schemaVersion !== body.schemaVersion
    || attestation.publisherId !== body.publisherId
    || attestation.signingKeyId !== body.signingKeyId
    || attestation.observedAtUtc !== body.observedAtUtc
    || attestation.buildTruthSha256 !== body.buildTruthSha256) {
    return blocked('LOGICAL_GOAL_PICKUP_ATTESTATION_BINDING_INVALID');
  }
  try {
    const key = createPublicKey(trustedPublicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key');
    const sig = Buffer.from(String(attestation.signatureBase64 || ''), 'base64');
    if (sig.length !== 64 || sig.toString('base64') !== attestation.signatureBase64
      || !verify(null, Buffer.from(LOGICAL_GOAL_PICKUP_ATTESTATION_DOMAIN + JSON.stringify(body)), key, sig)) {
      return blocked('LOGICAL_GOAL_PICKUP_ATTESTATION_SIGNATURE_INVALID');
    }
    return Object.freeze({ ok: true, blocker: '', verifiedGoalIds: Object.freeze(body.claims.map(c=>c.issue)) });
  } catch { return blocked('LOGICAL_GOAL_PICKUP_ATTESTATION_SIGNATURE_INVALID'); }
}
