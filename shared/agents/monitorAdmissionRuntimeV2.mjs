import { readFile, writeFile, open, lstat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  verifyLogicalGoalBuildTruthV1,
  loadControllerActivityProofRecordsV1,
  loadPinnedWorkerPickupVerifierV1,
  verifyCleanCanonicalTrackedMainV1,
} from './logicalGoalPickupProofV1.mjs';
import {
  admitLogicalMonitor,
  MONITOR_ADMISSION_REGISTRY_VERSION,
  proposalToMonitorDefinition,
} from './monitorAdmissionBridge.mjs';
import {
  MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
  MONITOR_MULTIPLEXER_MAX_MONITORS,
  MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
  runMonitorMultiplexerTick,
} from './monitorMultiplexer.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  LOGICAL_GOAL_CONTROLLER_FABRIC_FILE,
  LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA,
  buildLogicalGoalControllerMonitorProposals,
} from './logicalGoalControllerFabricV1.mjs';

export const MONITOR_ADMISSION_RUNTIME_V2_SCHEMA = 'stephanos.monitor-admission-runtime.v2';
export const MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT = 'monitor-admission-runtime-v2';
export const LOGICAL_CONTROLLER_SCOPE_PREFIX = 'controller:';
export const MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_SCHEMA = 'stephanos.monitor-admission-registry-bootstrap.v1';
export const MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_FILE = 'monitor-admission-registry-bootstrap.json';
export const LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_AGE_MS = 15 * 60 * 1000;
export const LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_FUTURE_SKEW_MS = 60 * 1000;
export const LOGICAL_GOAL_PICKUP_PROOF_MAX_AGE_MS = 15 * 60 * 1000;
export const LOGICAL_GOAL_BUILD_TRUTH_FILE = 'stephanos-build-truth-current.json';
export const LOGICAL_GOAL_BUILD_TRUTH_SCHEMA = 'stephanos.sovereign-build-truth.v1';

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => String(value ?? '').trim();
const safeId = (value) => /^[a-z0-9][a-z0-9._-]{0,80}$/i.test(text(value)) ? text(value) : '';
const DERIVED_MONITOR_AUTHORITY_FIELDS = Object.freeze([
  'runnerRegistryOnly',
  'arbitraryShellAllowed',
  'arbitraryPowerShellAllowed',
  'arbitraryFilesystemAccess',
  'sourceMutationAllowed',
  'mergeAuthority',
]);

function runtimeMonitorInput(definition = {}) {
  const input = { ...definition };
  for (const key of DERIVED_MONITOR_AUTHORITY_FIELDS) delete input[key];
  return Object.freeze(input);
}

function runtimeSafeRegistry(value) {
  if (!plainObject(value) || value.registrySchemaVersion !== MONITOR_ADMISSION_REGISTRY_VERSION) return false;
  if (!plainObject(value.monitors) || !plainObject(value.idempotency)) return false;
  for (const [monitorId, monitor] of Object.entries(value.monitors)) {
    if (!safeId(monitorId) || !plainObject(monitor) || monitor.monitorId !== monitorId || !plainObject(monitor.proposal)) return false;
    try {
      const expected = proposalToMonitorDefinition(monitor.proposal);
      if (!expected || expected.monitorId !== monitorId || !plainObject(monitor.definition)) return false;
      if (JSON.stringify(expected) !== JSON.stringify(monitor.definition)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function loadMonitorAdmissionRegistryV2(input = {}) {
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'MULTIPLEXER_ADMISSION_UNAVAILABLE', registry: null, monitorCount: 0 });
  const resolved = resolveSharedWorkspacePath({
    root: layout.root,
    repoRoot: input.repoRoot,
    segments: ['status', 'monitor-admission-registry.json'],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason || 'MONITOR_ADMISSION_REGISTRY_PATH_BLOCKED', registry: null, monitorCount: 0 });
  try {
    const registry = JSON.parse(await readFile(resolved.path, 'utf8'));
    if (!runtimeSafeRegistry(registry)) return Object.freeze({ ok: false, reason: 'MALFORMED_DURABLE_REGISTRY', registry: null, monitorCount: 0 });
    return Object.freeze({ ok: true, reason: 'MONITOR_ADMISSION_REGISTRY_READY', registry, monitorCount: Object.keys(registry.monitors).length });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const marker = resolveSharedWorkspacePath({
        root: layout.root,
        repoRoot: input.repoRoot,
        segments: ['archive', MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_FILE],
      });
      if (!marker.ok) return Object.freeze({
        ok: false,
        reason: marker.reason || 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_PATH_BLOCKED',
        registry: null,
        monitorCount: 0,
      });

      try {
        const bootstrap = JSON.parse(await readFile(marker.path, 'utf8'));
        if (bootstrap?.bootstrapSchema !== MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_SCHEMA
          || bootstrap?.registrySchemaVersion !== MONITOR_ADMISSION_REGISTRY_VERSION
          || bootstrap?.state !== 'INITIALIZED') {
          return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_MARKER_INVALID',
            registry: null,
            monitorCount: 0,
          });
        }
        return Object.freeze({
          ok: false,
          reason: 'MONITOR_ADMISSION_REGISTRY_MISSING_AFTER_BOOTSTRAP',
          registry: null,
          monitorCount: 0,
        });
      } catch (markerError) {
        if (markerError?.code !== 'ENOENT') {
          return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_MARKER_READ_FAILED',
            registry: null,
            monitorCount: 0,
          });
        }
      }

      const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
      const registry = Object.freeze({
        registrySchemaVersion: MONITOR_ADMISSION_REGISTRY_VERSION,
        monitors: Object.freeze({}),
        idempotency: Object.freeze({}),
      });
      const initializedAtUtc = new Date(nowMs).toISOString();
      const bootstrap = Object.freeze({
        ...createSharedWorkspaceReceiptRecord({
          receiptId: 'monitor-admission-registry-bootstrap',
          participantId: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
          timestampUtc: initializedAtUtc,
          correlationId: 'monitor-admission-registry-bootstrap',
          relatedIssue: '#1585',
          receivedRecordId: 'monitor-admission-registry-bootstrap',
          disposition: 'initialized',
          summary: 'Durable bootstrap marker proving the monitor admission registry has been initialized once.',
          proofRefs: ['proof/monitor-admission-registry-bootstrap.json'],
        }),
        bootstrapSchema: MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_SCHEMA,
        registrySchemaVersion: MONITOR_ADMISSION_REGISTRY_VERSION,
        state: 'INITIALIZED',
        initializedAtUtc,
        authorityWidened: false,
      });
      const markerWrite = await writeAtomicJson(
        layout.root,
        ['archive', MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_FILE],
        bootstrap,
        { repoRoot: input.repoRoot, nowMs },
      );
      if (!markerWrite.ok) return Object.freeze({
        ok: false,
        reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_MARKER_WRITE_FAILED',
        registry: null,
        monitorCount: 0,
      });
      try {
        await writeFile(resolved.path, JSON.stringify(registry, null, 2) + '\n', {
          flag: 'wx',
          mode: 0o600,
        });
      } catch (registryError) {
        if (registryError?.code !== 'EEXIST') return Object.freeze({
          ok: false,
          reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_WRITE_FAILED',
          registry: null,
          monitorCount: 0,
        });
        try {
          const concurrent = JSON.parse(await readFile(resolved.path, 'utf8'));
          if (!runtimeSafeRegistry(concurrent)) return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_CONFLICT',
            registry: null,
            monitorCount: 0,
          });
          return Object.freeze({
            ok: true,
            reason: 'MONITOR_ADMISSION_REGISTRY_READY',
            registry: concurrent,
            monitorCount: Object.keys(concurrent.monitors).length,
            durableRegistryPresent: true,
          });
        } catch {
          return Object.freeze({
            ok: false,
            reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAP_CONFLICT',
            registry: null,
            monitorCount: 0,
          });
        }
      }
      return Object.freeze({
        ok: true,
        reason: 'MONITOR_ADMISSION_REGISTRY_BOOTSTRAPPED_EMPTY',
        registry,
        monitorCount: 0,
        durableRegistryPresent: true,
      });
    }
    return Object.freeze({
      ok: false,
      reason: 'MONITOR_ADMISSION_REGISTRY_READ_FAILED',
      registry: null,
      monitorCount: 0,
    });
  }
}

export async function loadLogicalGoalControllerFabricForMonitorRuntimeV2(input = {}) {
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_WORKSPACE_UNAVAILABLE', fabric: null });
  const resolved = resolveSharedWorkspacePath({
    root: layout.root,
    repoRoot: input.repoRoot,
    segments: ['status', LOGICAL_GOAL_CONTROLLER_FABRIC_FILE],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason || 'LOGICAL_GOAL_CONTROLLER_FABRIC_PATH_BLOCKED', fabric: null });
  try {
    const fabric = JSON.parse(await readFile(resolved.path, 'utf8'));
    if (fabric?.schemaVersion !== LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA
      || fabric?.valid !== true
      || !Array.isArray(fabric?.controllers)
      || fabric.controllers.some((controller) => !safeId(controller?.logicalControllerId))) {
      return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_MALFORMED', fabric: null });
    }
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    const observedAtMs = Date.parse(text(fabric?.observedAtUtc));
    if (!Number.isFinite(observedAtMs)) {
      return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_OBSERVATION_INVALID', fabric: null });
    }
    const ageMs = nowMs - observedAtMs;
    if (ageMs > LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_AGE_MS
      || ageMs < -LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_FUTURE_SKEW_MS) {
      return Object.freeze({
        ok: true,
        reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_STALE',
        fabric: null,
        ageMs,
      });
    }
    return Object.freeze({ ok: true, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READY', fabric, ageMs });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ ok: true, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_NOT_YET_PUBLISHED', fabric: null });
    return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READ_FAILED', fabric: null });
  }
}

// Physical goal pickup is established by the existing, separately produced
// per-goal Build Truth witness; a scheduled logical pulse is never its substitute.
export function evaluateLogicalGoalControllerContinuityV2(controller, buildTruth, options = {}) {
  const id = text(controller?.logicalControllerId);
  const issue = Number(controller?.goalIssueNumber);
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const proofTime = Date.parse(text(buildTruth?.observedAtUtc));
  const fixed = {
    notify: false,
    proofRefs: ['proof/logical-goal-controller-fabric-current.json'],
  };
  const hold = (blocker, summary, nextAction) => Object.freeze({
    ...fixed, state: 'BLOCKED', blocker, summary, nextAction,
  });
  if (!Number.isSafeInteger(issue) || issue < 1 || id !== `logical-goal-${issue}`
    || text(controller?.hostControllerId).length === 0) {
    return hold('LOGICAL_GOAL_OWNER_INVALID', 'The logical goal identity or physical continuity host is invalid.',
      'Repair the existing canonical scheduler-to-controller binding without creating a new controller.');
  }
  if (buildTruth?.schemaVersion !== LOGICAL_GOAL_BUILD_TRUTH_SCHEMA
    || !Array.isArray(buildTruth?.goals)
    || !Number.isFinite(proofTime)
    || proofTime > nowMs + LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_FUTURE_SKEW_MS
    || nowMs - proofTime > LOGICAL_GOAL_PICKUP_PROOF_MAX_AGE_MS
    || text(buildTruth?.state).toUpperCase() === 'STALE') {
    return hold('LOGICAL_GOAL_BUILD_TRUTH_MISSING_OR_STALE',
      `Logical controller ${id} has no current per-goal physical build witness.`,
      'Run the existing Sovereign Commander controller-lane-status proof collector and repair stale publication.');
  }
  const matches = buildTruth.goals.filter((goal) => text(goal?.issue) === `#${issue}`);
  if (matches.length !== 1) {
    return hold('LOGICAL_GOAL_PICKUP_BINDING_MISSING',
      `Logical controller ${id} is tracked but has no unique same-goal Build Truth record.`,
      'Reconcile the current scheduler portfolio and existing per-goal Build Truth collector.');
  }
  const goal = matches[0];
  if (text(goal.controllerId) !== text(controller.hostControllerId)
    || text(goal.logicalLaneId) !== id
    || goal.selectedForAdmission !== (controller.selectedForAdmission === true)) {
    return hold('LOGICAL_GOAL_PICKUP_OWNER_MISMATCH',
      `Logical controller ${id} does not match the physical host or scheduler selection in the witness.`,
      'Repair the stale host/selection reconciliation; never borrow proof from another controller or goal.');
  }
  const state = text(goal.state).toUpperCase();
  // Being tracked is not scheduler admission. Even a physical lane left behind
  // by a previous selection cannot make the unselected controller green.
  if (controller.selectedForAdmission !== true && state === 'BUILDING') {
    return hold('LOGICAL_GOAL_UNSELECTED_MATERIAL_WORK_PRESENT',
      `Logical controller ${id} is not selected but retains a BUILDING worker lane; admission must be reconciled.`,
      'Reconcile the existing canonical scheduler and worker lane without granting new source authority.');
  }
  const refs = Array.isArray(goal.proofRefs)
    ? goal.proofRefs.filter((ref) => typeof ref === 'string'
      && /^(?:proof|receipts)\/[a-z0-9][a-z0-9._/-]{0,180}$/i.test(ref)
      && !ref.includes('..')).slice(0, 8)
    : [];
  if (state === 'BUILDING') {
    const progressAtMs = Date.parse(text(goal.lastMaterialProgressAtUtc));
    if (controller.selectedForAdmission !== true
      || !refs.length
      || !Number.isFinite(progressAtMs)
      || progressAtMs > nowMs + LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_FUTURE_SKEW_MS
      || nowMs - progressAtMs > LOGICAL_GOAL_PICKUP_PROOF_MAX_AGE_MS) {
      return hold('LOGICAL_GOAL_PICKUP_PROOF_UNVERIFIED',
        `Logical controller ${id} claims BUILDING without a current bound physical pickup receipt.`,
        'Repair the physical worker receipt binding, not the scheduler or controller count.');
    }
    const authentication = verifyLogicalGoalBuildTruthV1({
      buildTruth,
      attestation: options.pickupAttestation,
      proofRecords: Array.isArray(options.proofRecords) ? options.proofRecords : [],
      expectedSourceHead: options.expectedSourceHead,
      trustedPublicKeyPem: options.trustedPublicKeyPem,
      trustedPublicKeySha256: options.trustedPublicKeySha256,
      trustedWorkerPublicKeyPem: options.trustedWorkerPublicKeyPem,
      trustedWorkerPublicKeySha256: options.trustedWorkerPublicKeySha256,
      nowMs,
    });
    if (!authentication.ok || !authentication.verifiedGoalIds.includes(goal.issue)) {
      return hold('LOGICAL_GOAL_PICKUP_NOT_AUTHENTICATED',
        `Logical controller ${id} has a BUILDING claim but no independently pinned, signed Core proof linked to its physical controller records.`,
        'Commission or repair the existing protected Core signer and verified worker-pickup records. Never turn unsigned Shared Workspace claims green.');
    }
    return Object.freeze({
      state: 'PASS', blocker: '', notify: true,
      summary: `Logical controller ${id}: same-goal, current Core-attested physical BUILDING witnessed for ${text(controller.goalTitle)}.`,
      nextAction: 'Continue in the existing canonical mission worker; require separate test, merge and deployed runtime receipts.',
      proofRefs: refs,
    });
  }
  if (state === 'HELD' || state === 'BLOCKED' || state === 'STALE') {
    return hold(state === 'STALE' ? 'LOGICAL_GOAL_PICKUP_WITNESS_STALE' : (
      state === 'HELD' ? 'LOGICAL_GOAL_CANONICAL_GUARD_HELD' : 'LOGICAL_GOAL_CANONICAL_WORK_BLOCKED'),
    `Logical controller ${id} is ${state}; no physical pickup can be claimed.`,
    text(goal.nextAction) || 'Repair the existing guarded goal or worker lane and recheck.');
  }
  if (controller.selectedForAdmission === true) {
    return hold('LOGICAL_GOAL_SELECTED_WITHOUT_PICKUP',
      `Logical controller ${id} was selected but no actual physical pickup is proven.`,
      text(goal.nextAction) || 'Hand the selected eligible goal to the existing mission worker and demand its physical pickup receipt.');
  }
  return Object.freeze({
    ...fixed, state: 'PASS', blocker: '',
    summary: `Logical controller ${id}: TRACKED only, not scheduler-selected; no build or pickup claimed.`,
    nextAction: 'Retain continuity tracking; the canonical scheduler alone may select and dispatch this goal.',
  });
}

// Read the independent goal witness from the existing Shared Workspace.
// Invalid, missing or stale evidence never turns a scheduled pulse green.
export async function loadLogicalGoalBuildTruthForMonitorRuntimeV2(input = {}) {
  const layout = await ensureSharedWorkspaceLayout({ root: input.root, repoRoot: input.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_BUILD_TRUTH_WORKSPACE_UNAVAILABLE', buildTruth: null });
  const resolved = resolveSharedWorkspacePath({
    root: layout.root, repoRoot: input.repoRoot,
    segments: ['status', LOGICAL_GOAL_BUILD_TRUTH_FILE],
  });
  if (!resolved.ok) return Object.freeze({ ok: false, reason: resolved.reason || 'LOGICAL_GOAL_BUILD_TRUTH_PATH_BLOCKED', buildTruth: null });
  try {
    const record = JSON.parse(await readFile(resolved.path, 'utf8'));
    const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
    const truth = record?.stephanosBuildTruth;
    if (record?.kind !== 'stephanos.shared_workspace.status'
      || record.statusId !== 'stephanos-build-truth-current'
      || record.participantId !== 'sovereign-commander'
      || validateSharedWorkspaceRecord(record, { repoRoot: input.repoRoot, nowMs, staleAfterMs: LOGICAL_GOAL_PICKUP_PROOF_MAX_AGE_MS }).valid !== true
      || truth?.schemaVersion !== LOGICAL_GOAL_BUILD_TRUTH_SCHEMA
      || text(record.timestampUtc) !== text(truth.observedAtUtc)) {
      return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_BUILD_TRUTH_INVALID', buildTruth: null });
    }
    const observed = Date.parse(text(truth.observedAtUtc));
    if (!Number.isFinite(observed)
      || observed > nowMs + LOGICAL_GOAL_CONTROLLER_FABRIC_MAX_FUTURE_SKEW_MS
      || nowMs - observed > LOGICAL_GOAL_PICKUP_PROOF_MAX_AGE_MS) {
      return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_BUILD_TRUTH_STALE', buildTruth: null });
    }
    const loaded = await loadControllerActivityProofRecordsV1({ workspaceRoot: layout.root });
    if (!loaded.ok) return Object.freeze({ ok: false,
      reason: loaded.blocker || 'LOGICAL_GOAL_DERIVED_CONTROLLER_PROOF_UNAVAILABLE',
      buildTruth: null });
    const proofRecords = loaded.records;
    return Object.freeze({ ok: true, reason: 'LOGICAL_GOAL_BUILD_TRUTH_READY', buildTruth: truth,
      pickupAttestation: record.logicalGoalPickupAttestation || null,
      proofRecords: Object.freeze(proofRecords) });
  } catch {
    return Object.freeze({ ok: false, reason: 'LOGICAL_GOAL_BUILD_TRUTH_UNAVAILABLE', buildTruth: null });
  }
}

// Trust anchors are only read from the pre-commissioned local machine
// environment, outside this checkout and the mutable Shared Workspace.
// Missing pin or Git source-head drift makes BUILDING authentication fail.
export async function loadLogicalGoalProofTrustV2(input = {}) {
  const env = input.env || process.env;
  const sha = text(env.STEPHANOS_GOAL_BUILD_GATES_TRUSTED_PUBLIC_KEY_SHA256).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha)) return Object.freeze({ blocker: 'LOGICAL_GOAL_PUBLIC_KEY_PIN_NOT_COMMISSIONED' });
  let trustedPublicKeyPem = '';
  try {
    const keyPath = resolve(text(env.LOCALAPPDATA) || resolve(text(env.USERPROFILE) || homedir(), 'AppData', 'Local'),
      'Stephanos', 'keys', 'stephanos-goal-build-gates-public.pem');
    const handle = await open(keyPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    try {
      const meta = await handle.stat();
      if (!meta.isFile() || meta.nlink !== 1 || meta.size > 8192 || meta.size < 1) throw new Error('key-invalid');
      trustedPublicKeyPem = await handle.readFile('utf8');
    } finally { await handle.close(); }
  } catch { return Object.freeze({ blocker: 'LOGICAL_GOAL_PUBLIC_KEY_NOT_AVAILABLE' }); }
  // Green pickup proof requires the exact protected tracked tree, not just
  // Git refs. A dirty original checkout remains untouched and non-authoritative.
  const canonicalTree = verifyCleanCanonicalTrackedMainV1(input.repoRoot || process.cwd());
  if (!canonicalTree.ok) return Object.freeze({ blocker: canonicalTree.blocker });
  const expectedSourceHead = canonicalTree.sourceHead;
  const localStateRoot = resolve(text(env.LOCALAPPDATA) || resolve(text(env.USERPROFILE) || homedir(), 'AppData', 'Local'), 'Stephanos');
  const workerTrust = await loadPinnedWorkerPickupVerifierV1({ localStateRoot, env });
  if (!workerTrust.ok) return Object.freeze({ blocker: workerTrust.blocker });
  const finalCanonicalTree = verifyCleanCanonicalTrackedMainV1(input.repoRoot || process.cwd());
  if (!finalCanonicalTree.ok || finalCanonicalTree.sourceHead !== expectedSourceHead) {
    return Object.freeze({ blocker: finalCanonicalTree.blocker
      || 'LOGICAL_GOAL_SOURCE_CHANGED_DURING_OBSERVATION' });
  }
  return Object.freeze({
    trustedPublicKeyPem, trustedPublicKeySha256: sha, expectedSourceHead,
    trustedWorkerPublicKeyPem: workerTrust.workerPublicKeyPem,
    trustedWorkerPublicKeySha256: workerTrust.workerPublicKeySha256,
    blocker: '',
  });
}

export function isLogicalControllerPulseProposalV2(proposal = {}) {
  return proposal?.handlerType === 'SCHEDULED_SUMMARY'
    && typeof proposal?.boundedSubject?.scope === 'string'
    && proposal.boundedSubject.scope.startsWith(LOGICAL_CONTROLLER_SCOPE_PREFIX)
    && Boolean(text(proposal?.boundedSubject?.topic));
}

export function buildMonitorRuntimeProjectionV2(registry = {}, options = {}) {
  const monitorRecords = plainObject(registry?.monitors) ? Object.values(registry.monitors) : [];
  const logicalGoalProposals = buildLogicalGoalControllerMonitorProposals(options.logicalGoalControllerFabric, {
    nowMs: options.nowMs,
  });
  const syntheticGoalRecords = logicalGoalProposals.map((proposal) => Object.freeze({
    monitorId: proposal.monitorId,
    proposal,
    definition: proposalToMonitorDefinition(proposal),
    updatedAtUtc: new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString(),
    syntheticLogicalGoalController: true,
  }));
  const existingIds = new Set(monitorRecords.map((record) => record?.monitorId).filter(Boolean));
  const logicalControllerCollisions = syntheticGoalRecords
    .filter((record) => existingIds.has(record.monitorId))
    .map((record) => record.monitorId);
  const collisionFreeSyntheticGoalRecords = syntheticGoalRecords
    .filter((record) => !existingIds.has(record.monitorId));
  const logicalControllerPriority = new Map(
    (Array.isArray(options.logicalGoalControllerFabric?.controllers)
      ? options.logicalGoalControllerFabric.controllers
      : [])
      .map((controller, index) => [
        text(controller?.logicalControllerId),
        Object.freeze({
          selected: controller?.selectedForAdmission === true,
          active: text(controller?.continuityState).toUpperCase() === 'ACTIVE',
          index,
        }),
      ])
      .filter(([monitorId]) => Boolean(monitorId)),
  );
  const prioritizedSyntheticGoalRecords = [...collisionFreeSyntheticGoalRecords]
    .sort((left, right) => {
      const leftPriority = logicalControllerPriority.get(left.monitorId) || {};
      const rightPriority = logicalControllerPriority.get(right.monitorId) || {};
      return Number(rightPriority.selected === true) - Number(leftPriority.selected === true)
        || Number(rightPriority.active === true) - Number(leftPriority.active === true)
        || Number(leftPriority.index ?? Number.MAX_SAFE_INTEGER) - Number(rightPriority.index ?? Number.MAX_SAFE_INTEGER);
    });
  const syntheticCapacity = Math.max(0, MONITOR_MULTIPLEXER_MAX_MONITORS - monitorRecords.length);
  const admittedSyntheticGoalRecords = prioritizedSyntheticGoalRecords.slice(0, syntheticCapacity);
  const logicalControllerOverflow = prioritizedSyntheticGoalRecords
    .slice(syntheticCapacity)
    .map((record) => record.monitorId);
  const combinedMonitorRecords = [
    ...monitorRecords,
    ...admittedSyntheticGoalRecords,
  ];
  const monitors = [];
  const controllerRecords = new Map();
  const fabricControllers = new Map(
    (Array.isArray(options.logicalGoalControllerFabric?.controllers)
      ? options.logicalGoalControllerFabric.controllers : [])
      .map((controller) => [text(controller?.logicalControllerId), controller]),
  );
  for (const record of combinedMonitorRecords) {
    if (!plainObject(record) || !plainObject(record.definition) || !plainObject(record.proposal)) continue;
    monitors.push(runtimeMonitorInput(record.definition));
    if (isLogicalControllerPulseProposalV2(record.proposal)) controllerRecords.set(record.monitorId, record);
  }
  const handlers = Object.create(null);
  if (controllerRecords.size) {
    handlers['scheduled-summary'] = async (context = {}) => {
      const record = controllerRecords.get(context.monitorId);
      if (!record) {
        return Object.freeze({
          state: 'BLOCKED',
          blocker: 'SCHEDULED_SUMMARY_HANDLER_NOT_WIRED',
          summary: 'Scheduled summary is not a logical controller pulse.',
          nextAction: 'Route through a qualified fixed handler or retain the standalone fallback.',
          notify: false,
        });
      }
      const controllerId = text(record.proposal.boundedSubject.scope).slice(LOGICAL_CONTROLLER_SCOPE_PREFIX.length);
      // Durable operator-admitted controller pulses are scheduled summaries,
      // not synthetic scheduler-goal controllers. Preserve their existing
      // wake/notification contract; explicitly disclaim any build proof.
      if (record.syntheticLogicalGoalController !== true) {
        return Object.freeze({
          state: 'PASS',
          summary: `Controller ${controllerId} continuity pulse due at ${context.timestampUtc}: ${text(record.proposal.boundedSubject.topic)}. Pulse only; no physical build claimed.`,
          nextAction: 'Use the existing canonical controller hub and mission worker for independently verified material execution.',
          proofRefs: record.proposal.proofRefs,
          notify: true,
        });
      }
      return evaluateLogicalGoalControllerContinuityV2(
        fabricControllers.get(controllerId), options.logicalGoalBuildTruth,
        { nowMs: Date.parse(text(context.timestampUtc)) || options.nowMs,
          pickupAttestation: options.pickupAttestation,
          proofRecords: options.proofRecords,
          expectedSourceHead: options.expectedSourceHead,
          trustedPublicKeyPem: options.trustedPublicKeyPem,
          trustedPublicKeySha256: options.trustedPublicKeySha256,
          trustedWorkerPublicKeyPem: options.trustedWorkerPublicKeyPem,
          trustedWorkerPublicKeySha256: options.trustedWorkerPublicKeySha256 },
      );
    };
  }
  return Object.freeze({
    schemaVersion: MONITOR_ADMISSION_RUNTIME_V2_SCHEMA,
    monitors: Object.freeze(monitors),
    handlers: Object.freeze(handlers),
    monitorCount: monitors.length,
    logicalControllerCount: controllerRecords.size,
    logicalGoalControllerCount: admittedSyntheticGoalRecords.length,
    logicalControllerCollisions: Object.freeze(logicalControllerCollisions),
    logicalControllerOverflowCount: logicalControllerOverflow.length,
    logicalControllerOverflow: Object.freeze(logicalControllerOverflow),
    externalTaskSlotsRequired: monitors.length ? 1 : 0,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    maximumConcurrency: MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    finalVerdict: 'MONITOR_ADMISSION_RUNTIME_PROJECTION_READY',
  });
}

export async function runMonitorAdmissionRuntimeV2(input = {}) {
  const loaded = await loadMonitorAdmissionRegistryV2(input);
  if (!loaded.ok) return Object.freeze({ ...loaded, schemaVersion: MONITOR_ADMISSION_RUNTIME_V2_SCHEMA, finalVerdict: 'MONITOR_ADMISSION_RUNTIME_BLOCKED' });
  const logicalGoalControllerFabric = await loadLogicalGoalControllerFabricForMonitorRuntimeV2(input);
  const goalBuildTruth = await loadLogicalGoalBuildTruthForMonitorRuntimeV2(input);
  const trust = await loadLogicalGoalProofTrustV2(input);
  const projection = buildMonitorRuntimeProjectionV2(loaded.registry, {
    logicalGoalControllerFabric: logicalGoalControllerFabric.fabric,
    logicalGoalBuildTruth: goalBuildTruth.buildTruth,
    pickupAttestation: goalBuildTruth.pickupAttestation,
    proofRecords: goalBuildTruth.proofRecords,
    trustedPublicKeyPem: trust.trustedPublicKeyPem,
    trustedPublicKeySha256: trust.trustedPublicKeySha256,
    trustedWorkerPublicKeyPem: trust.trustedWorkerPublicKeyPem,
    trustedWorkerPublicKeySha256: trust.trustedWorkerPublicKeySha256,
    expectedSourceHead: trust.expectedSourceHead,
    nowMs: input.nowMs,
  });
  const tick = await runMonitorMultiplexerTick({
    root: input.root,
    repoRoot: input.repoRoot,
    monitors: projection.monitors,
    handlers: projection.handlers,
    relatedIssue: input.relatedIssue || '#1585',
    nowMs: input.nowMs,
    timestampUtc: input.timestampUtc,
    concurrency: input.concurrency ?? MONITOR_MULTIPLEXER_MAX_CONCURRENCY,
  });
  return Object.freeze({
    schemaVersion: MONITOR_ADMISSION_RUNTIME_V2_SCHEMA,
    ok: tick.ok,
    reason: tick.reason,
    monitorCount: projection.monitorCount,
    logicalControllerCount: projection.logicalControllerCount,
    logicalGoalControllerCount: projection.logicalGoalControllerCount,
    logicalGoalControllerFabricReason: logicalGoalControllerFabric.reason,
    logicalGoalBuildTruthReason: goalBuildTruth.reason,
    logicalGoalProofTrustBlocker: trust.blocker,
    logicalControllerCollisions: projection.logicalControllerCollisions,
    logicalControllerOverflowCount: projection.logicalControllerOverflowCount,
    logicalControllerOverflow: projection.logicalControllerOverflow,
    externalTaskSlotsRequired: projection.externalTaskSlotsRequired,
    notificationSurface: projection.notificationSurface,
    maximumConcurrency: projection.maximumConcurrency,
    tick,
    finalVerdict: tick.ok ? 'MONITOR_ADMISSION_RUNTIME_TICK_PASS' : 'MONITOR_ADMISSION_RUNTIME_TICK_BLOCKED',
  });
}

export async function admitLogicalMonitorWithRuntimeV2(envelope = {}, options = {}) {
  const v1 = await admitLogicalMonitor(envelope, options);
  if (v1.ok === true || v1.reason !== 'MULTIPLEXER_PROJECTION_NOT_PROVEN') return v1;

  const loaded = await loadMonitorAdmissionRegistryV2(options);
  const monitorId = envelope?.proposal?.monitorId || envelope?.monitorId || '';
  const persisted = loaded.ok && Boolean(loaded.registry?.monitors?.[monitorId]);
  if (!persisted) return Object.freeze({ ...v1, runtimeConsumerProven: false });

  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ...v1, runtimeConsumerProven: false, fallbackReason: 'MULTIPLEXER_ADMISSION_UNAVAILABLE' });
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const timestampUtc = new Date(nowMs).toISOString();
  const receiptId = `monitor-admission-runtime-v2-${safeId(envelope.requestId) || safeId(monitorId) || 'request'}`;
  const proofRefs = loaded.registry.monitors[monitorId]?.proposal?.proofRefs || ['proof/monitor-admission.json'];
  const receipt = Object.freeze({
    ...createSharedWorkspaceReceiptRecord({
      receiptId,
      participantId: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
      timestampUtc,
      correlationId: safeId(envelope.requestId) || receiptId,
      relatedIssue: String(loaded.registry.monitors[monitorId]?.proposal?.relatedIssueOrGoal || '').startsWith('#')
        ? loaded.registry.monitors[monitorId].proposal.relatedIssueOrGoal
        : '#1585',
      receivedRecordId: safeId(envelope.requestId) || receiptId,
      disposition: 'published',
      summary: 'Logical monitor admitted to the live Monitor Multiplexer V2 runtime consumer.',
      proofRefs,
    }),
    verdict: 'MULTIPLEXER_ADMISSION_READY',
    monitorId,
    runtimeConsumer: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
    notificationSurface: MONITOR_MULTIPLEXER_NOTIFICATION_SURFACE,
    externalTaskSlotsRequired: loaded.monitorCount ? 1 : 0,
    sourceMutationAllowed: false,
    mergeAuthority: false,
  });
  const status = Object.freeze({
    ...createSharedWorkspaceStatusRecord({
      statusId: `monitor-admission-runtime-v2-${monitorId}`,
      participantId: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
      timestampUtc,
      status: 'READY',
      summary: 'Logical monitor is present in the durable registry and consumable by the V2 runtime.',
      proofRefs,
    }),
    verdict: 'MULTIPLEXER_ADMISSION_READY',
    monitorId,
    runtimeConsumer: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
  });
  const receiptWrite = await writeAtomicJson(layout.root, ['receipts', `${receiptId}.json`], receipt, { repoRoot: options.repoRoot, nowMs });
  if (!receiptWrite.ok) return Object.freeze({ ...v1, runtimeConsumerProven: true, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: 'MULTIPLEXER_ADMISSION_EVIDENCE_INCOMPLETE' });
  const statusWrite = await writeAtomicJson(layout.root, ['status', `${status.statusId}.json`], status, { repoRoot: options.repoRoot, nowMs });
  if (!statusWrite.ok) return Object.freeze({ ...v1, runtimeConsumerProven: true, reason: 'MONITOR_ADMISSION_FALLBACK_REQUIRED', fallbackReason: 'MULTIPLEXER_ADMISSION_EVIDENCE_INCOMPLETE' });

  return Object.freeze({
    ...v1,
    ok: true,
    reason: 'MULTIPLEXER_ADMISSION_READY',
    blocker: '',
    runtimeConsumerProven: true,
    runtimeConsumer: MONITOR_ADMISSION_RUNTIME_V2_PARTICIPANT,
    receipt,
    status,
    externalTaskSlotsRequired: loaded.monitorCount ? 1 : 0,
  });
}
