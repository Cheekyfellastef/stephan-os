import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { types } from 'node:util';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const LEGACY_ROUTER_PATH = './windowsAuthoritySpecialistReviewV1LegacyRouter.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const LIFEBOAT_PRINCIPAL_SID_PATH = './windowsAuthorityLifeboatPrincipalSidReviewV1.mjs';
const NATIVE_CAPACITY_PUBLISHER_PATH = './windowsAuthorityStephanosNativeCapacityPublisherReviewV1.mjs';
const STARFIELD_VR_SPLASH_PATH = './windowsAuthorityStarfieldVrSplashReviewV1.mjs';
const STARFIELD_VR_LAUNCHER_PATH = './windowsAuthorityStarfieldVrLauncherReviewV1.mjs';
const STARFIELD_VR_AER_OBSERVE_PATH = './windowsAuthorityStarfieldVrAerObserveReviewV1.mjs';
const MAILBOX_CADENCE_PATH = './windowsAuthorityMailboxCadenceReviewV1.mjs';
const IGNITION_CONVERGENCE_PATH = './windowsAuthorityIgnitionConvergenceReviewV1.mjs';
const MISSION_WORKER_CLEANUP_PATH = './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';
const STEPHANOS_CORE_DAEMON_PATH = './windowsAuthorityStephanosCoreDaemonReviewV1.mjs';
const VR_RESOURCE_GOVERNOR_PATH = './windowsAuthorityVrResourceGovernorReviewV1.mjs';
const SOVEREIGN_FIXED_RUNTIME_PATH = './windowsAuthoritySovereignFixedRuntimeReviewV1.mjs';
const CANONICAL_MAILBOX_NATIVE_PATH = './windowsAuthorityCanonicalMailboxNativeEvidenceReviewV1.mjs';

const BASE_BLOB_SHA = 'b0d5a568b8d51e7a1343a05bdac72c910ea4037f';
const LEGACY_ROUTER_BLOB_SHA = '0bd8978f55ace41b6743fc3cc900575e4f0cdf8f';
const WSL2_BLOB_SHA = '492fb7cd3fa8d33cded13c97bba2a1041b029d30';
const LIFEBOAT_PRINCIPAL_SID_BLOB_SHA = '4aa91a912958f1baf637584a391bfd7f925797e8';
const NATIVE_CAPACITY_PUBLISHER_BLOB_SHA = '0b608e1f88d9a04e947f629a46f0cd2f6c2c331a';
const STARFIELD_VR_SPLASH_BLOB_SHA = '4f6ff4fc53748cbe2dc52b11885e6051b72fa48d';
const STARFIELD_VR_LAUNCHER_BLOB_SHA = '2e5a167dfbe33b7860c57aa31173efb9223e9f08';
const STARFIELD_VR_AER_OBSERVE_BLOB_SHA = 'f66cc26ef865bb840522b16cbb53f830f9499838';
const MAILBOX_CADENCE_BLOB_SHA = 'd1319d542b219c786a36e8063f4080369f1f9a51';
const IGNITION_CONVERGENCE_BLOB_SHA = '8115a382c5c7b9a0bfe5611d4931fcbd969d1162';
const MISSION_WORKER_CLEANUP_BLOB_SHA = 'aba7123d16a26aa736ccd52be8e04ef2ecc4534e';
const STEPHANOS_CORE_DAEMON_BLOB_SHA = '074eab1b76e480f10c78d052188ba88764f4ad37';
const VR_RESOURCE_GOVERNOR_BLOB_SHA = '5e059ea759e3f96c10ccfdc874b020a3fb6d7cae';
const SOVEREIGN_FIXED_RUNTIME_BLOB_SHA = 'c1d0df145b50eb05696eb23818679abcd6a3f6ec';
const CANONICAL_MAILBOX_NATIVE_BLOB_SHA = '1b103fda85c371a218f38f20fe5163ca3f5042bf';

// Keep the established switchboard proof vocabulary visible at the trusted
// composition boundary. The legacy router remains byte-pinned and supplies
// these older specialist routes unchanged; this wrapper only layers the two
// newly qualified children before that frozen fallback.
const MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '70ea72980c29a4b69159ea44965b0d2af231cded';
const WORKER_WATCHDOG_BLOB_SHA = '148972def36e1af880f21876f4203f802c697ecb';
const MAILBOX_CADENCE_ROUTE = 'mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1';
const MAILBOX_CADENCE_ROUTE_SEQUENCE = 'mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1(input); if (mailboxCadenceResult.eligible) return mailboxCadenceResult;';
const MAILBOX_CADENCE_INVENTORY_GUARD = 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_INVENTORY_MISMATCH';
const IGNITION_PATH_INVENTORY = 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1';
const MISSION_WORKER_PATH_INVENTORY = 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1';
const EXPECTED_IGNITION_CONVERGENCE_PATHS = Object.freeze(['scripts/windows/probe-battle-bridge-recovery-mesh.ps1','scripts/windows/repair-stephanos-battle-bridge.ps1','scripts/windows/restart-approved-stephanos-runtime.ps1','scripts/windows/start-stephanos-backend.ps1']);
const IGNITION_ROUTE_SEQUENCE = 'ignitionConvergence.analyzeWindowsAuthorityIgnitionConvergenceReview(input); if (ignitionConvergenceResult.eligible) return ignitionConvergenceResult;';
const MISSION_WORKER_ROUTE_SEQUENCE = 'missionWorkerCleanup.analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input); if (missionWorkerCleanupResult.eligible) return missionWorkerCleanupResult;';
const MAILBOX_RECOVERY_ROUTE = 'analyzeWindowsAuthorityMailboxRecoveryGuardianReview';
const LEGACY_RECOVERY_MESH_ROUTE = 'analyzeWindowsAuthorityRecoveryMeshGuardianReview';
const WORKER_WATCHDOG_ROUTE = 'analyzeWindowsAuthorityWorkerWatchdogReview';
const LEGACY_CORE_ROUTE = 'core.analyzeWindowsAuthoritySpecialistReview';
const MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1': '2c4bcfe69f030071e0bbd278f7fd55b7da9a0cba',
  'scripts/windows/request-battle-bridge-recovery.ps1': 'b86ac43ed02f9742bc3213b1e847707f79a6153f',
});
const REVIEW_AUTHORITY_BOUNDARY = Object.freeze({
  sourceMutationAllowed: false,
  mergeAuthority: false,
  runtimeMutationAllowed: false,
  providerQualificationAuthority: false,
});

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function provePinnedModule(path, expectedBlobSha) {
  const url = new URL(path, import.meta.url);
  const content = readFileSync(url, 'utf8');
  const observedBlobSha = gitBlobSha(content);
  if (observedBlobSha !== expectedBlobSha) {
    throw new Error(`WINDOWS_AUTHORITY_SPECIALIST_PIN_MISMATCH:${path}:${observedBlobSha}`);
  }
  return Object.freeze({ url, content });
}

// Re-prove the long-standing specialist estate at this composition boundary.
// The byte-pinned legacy router performs the actual older dispatches.
provePinnedModule(BASE_PATH, BASE_BLOB_SHA);
const starfieldVrSplashModule = provePinnedModule(STARFIELD_VR_SPLASH_PATH, STARFIELD_VR_SPLASH_BLOB_SHA);
provePinnedModule(MAILBOX_CADENCE_PATH, MAILBOX_CADENCE_BLOB_SHA);
provePinnedModule(IGNITION_CONVERGENCE_PATH, IGNITION_CONVERGENCE_BLOB_SHA);
provePinnedModule(MISSION_WORKER_CLEANUP_PATH, MISSION_WORKER_CLEANUP_BLOB_SHA);
const stephanosCoreDaemonModule = provePinnedModule(STEPHANOS_CORE_DAEMON_PATH, STEPHANOS_CORE_DAEMON_BLOB_SHA);
const vrResourceGovernorModule = provePinnedModule(VR_RESOURCE_GOVERNOR_PATH, VR_RESOURCE_GOVERNOR_BLOB_SHA);
const sovereignFixedRuntimeModule = provePinnedModule(SOVEREIGN_FIXED_RUNTIME_PATH, SOVEREIGN_FIXED_RUNTIME_BLOB_SHA);
const canonicalMailboxNativeModule = provePinnedModule(CANONICAL_MAILBOX_NATIVE_PATH, CANONICAL_MAILBOX_NATIVE_BLOB_SHA);
void MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA;
void WORKER_WATCHDOG_BLOB_SHA;
void MAILBOX_CADENCE_ROUTE;
void MAILBOX_CADENCE_ROUTE_SEQUENCE;
void MAILBOX_CADENCE_INVENTORY_GUARD;
void IGNITION_PATH_INVENTORY;
void MISSION_WORKER_PATH_INVENTORY;
void EXPECTED_IGNITION_CONVERGENCE_PATHS;
void IGNITION_ROUTE_SEQUENCE;
void MISSION_WORKER_ROUTE_SEQUENCE;
void MAILBOX_RECOVERY_ROUTE;
void LEGACY_RECOVERY_MESH_ROUTE;
void WORKER_WATCHDOG_ROUTE;
void LEGACY_CORE_ROUTE;
void MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH;

const legacyRouterModule = provePinnedModule(LEGACY_ROUTER_PATH, LEGACY_ROUTER_BLOB_SHA);
const wsl2Module = provePinnedModule(WSL2_PATH, WSL2_BLOB_SHA);
const lifeboatPrincipalSidModule = provePinnedModule(LIFEBOAT_PRINCIPAL_SID_PATH, LIFEBOAT_PRINCIPAL_SID_BLOB_SHA);
const nativeCapacityPublisherModule = provePinnedModule(
  NATIVE_CAPACITY_PUBLISHER_PATH,
  NATIVE_CAPACITY_PUBLISHER_BLOB_SHA,
);
const starfieldVrLauncherModule = provePinnedModule(STARFIELD_VR_LAUNCHER_PATH, STARFIELD_VR_LAUNCHER_BLOB_SHA);
const starfieldVrAerObserveModule = provePinnedModule(STARFIELD_VR_AER_OBSERVE_PATH, STARFIELD_VR_AER_OBSERVE_BLOB_SHA);

const base = await import(legacyRouterModule.url.href);
const wsl2 = await import(wsl2Module.url.href);
const lifeboatPrincipalSid = await import(lifeboatPrincipalSidModule.url.href);
const nativeCapacityPublisher = await import(nativeCapacityPublisherModule.url.href);
const starfieldVrSplash = await import(starfieldVrSplashModule.url.href);
const starfieldVrLauncher = await import(starfieldVrLauncherModule.url.href);
const starfieldVrAerObserve = await import(starfieldVrAerObserveModule.url.href);
const stephanosCoreDaemon = await import(stephanosCoreDaemonModule.url.href);
if (JSON.stringify(stephanosCoreDaemon.WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1) !== JSON.stringify([
  'scripts/windows/run-sovereign-commander-hidden.ps1',
  'scripts/windows/status-stephanos-core-daemon.ps1',
  'scripts/windows/stephanos-core-process-observation.ps1',
])) throw new Error('WINDOWS_AUTHORITY_CORE_DAEMON_TRANSITIVE_INVENTORY_MISMATCH');
const vrResourceGovernor = await import(vrResourceGovernorModule.url.href);
const sovereignFixedRuntime = await import(sovereignFixedRuntimeModule.url.href);
const canonicalMailboxNative = await import(canonicalMailboxNativeModule.url.href);

export * from './windowsAuthoritySpecialistReviewV1LegacyRouter.mjs';
export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = wsl2.WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1;
export const WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1 = lifeboatPrincipalSid.WINDOWS_AUTHORITY_LIFEBOAT_PRINCIPAL_SID_PATHS_V1;
export const WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1 = nativeCapacityPublisher.WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1;
export const WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1 = starfieldVrSplash.WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1;
export const WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1 = starfieldVrLauncher.WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1;
export const WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1 = starfieldVrAerObserve.WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1;
export const WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1 = stephanosCoreDaemon.WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1;
export const WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1 = vrResourceGovernor.WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1;
export const WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1 = sovereignFixedRuntime.WINDOWS_AUTHORITY_SOVEREIGN_FIXED_RUNTIME_PATHS_V1;
export const WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1 = canonicalMailboxNative.WINDOWS_AUTHORITY_CANONICAL_MAILBOX_NATIVE_PATHS_V1;

const STARFIELD_VR_SPLASH_LAUNCH_PATH = 'scripts/windows/launch-starfield-vr-with-splash.ps1';
const STARFIELD_VR_LAUNCHER_SCRIPT_PATH = WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0];
const STARFIELD_VR_AER_OBSERVE_SCRIPT_PATH = WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0];


// A sibling specialist may inspect nested evidence before its own P0 route
// is known. Refuse hostile Proxy envelopes without invoking a single trap.
// Keep the walk bounded and inspect own DATA descriptors only: accessors are
// never evaluated by this preflight. Strict child evidence guards still apply.
function unsafeNestedReviewEvidence(value, seen = new Set(), depth = 0, sourceEvidence = false) {
  if (value === null || typeof value !== 'object') return false;
  if (types.isProxy(value)) return true;
  if (seen.has(value)) return false;
  if (depth >= 10 || seen.size >= 512) return true;
  seen.add(value);
  if (types.isProxy(Object.getPrototypeOf(value))) return true;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 512) return true;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    // Array index accessors can run during child iteration, and P0
    // analysis identity accessors can run in older sibling specialists.
    // Source-envelope accessors can run before strict byte checks.
    // Harmless analysis extension accessors remain inert and compatible.
    if (!descriptor) return true;
    if (!Object.hasOwn(descriptor, 'value')) {
      if (sourceEvidence || (Array.isArray(value) && typeof key === 'string'
        && /^(0|[1-9][0-9]*)$/.test(key))
        || (typeof key === 'string' && ['findings', 'counts', 'verdict', 'clean', 'P0', 'P1', 'P2'].includes(key))) return true;
      continue;
    }
    if (unsafeNestedReviewEvidence(descriptor.value, seen, depth + 1, sourceEvidence)) return true;
  }
  return false;
}

function inertCompositeField(value, key) {
  // Walk literal data descriptors only. Never execute a getter while selecting
  // the specialist route; strict own-field checks still decide admission.
  let cursor = value;
  while (cursor !== null && (typeof cursor === 'object' || typeof cursor === 'function')) {
    // Descriptor and prototype operations on a Proxy can execute hostile traps.
    // Stop before touching a Proxy, including one in a plain object's prototype chain.
    if (types.isProxy(cursor)) return undefined;
    const slot = Object.getOwnPropertyDescriptor(cursor, key);
    if (slot) return Object.hasOwn(slot, 'value') ? slot.value : undefined;
    cursor = Object.getPrototypeOf(cursor);
  }
  return undefined;
}

function inertTwoP0CompositeFindings(analysis, expected) {
  const findings = inertCompositeField(analysis, 'findings');
  if (types.isProxy(findings) || !Array.isArray(findings) || findings.length !== 2) return null;
  // Two adjacent accessors cannot create a trusted two-P0 candidate.
  const entries = [inertCompositeField(findings, '0'), inertCompositeField(findings, '1')];
  const identities = entries.map((item) => ({
    path: inertCompositeField(item, 'path'),
    severity: inertCompositeField(item, 'severity'),
    code: inertCompositeField(item, 'code'),
  }));
  const known = [STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_LAUNCHER_SCRIPT_PATH, STARFIELD_VR_AER_OBSERVE_SCRIPT_PATH];
  // Let the matching composite own a known partner; never intercept the other.
  if (identities.some(({ path }) => typeof path === 'string'
    && known.includes(path.trim()) && !expected.has(path.trim()))) return null;
  // Any malformed identity beside a known candidate must fail closed through
  // the strict validator, not be evaluated to discover the candidate.
  if (identities.some(({ path, severity, code }) => typeof path !== 'string'
    || typeof severity !== 'string' || typeof code !== 'string')) {
    return identities.some(({ path }) => typeof path === 'string' && expected.has(path.trim()))
      ? findings : null;
  }
  const paths = identities.map(({ path }) => path.trim());
  if (new Set(paths).size !== 2 || paths.some((path) => !expected.has(path))) return null;
  if (identities.some(({ severity, code }) => severity.toUpperCase() !== 'P0'
    || code !== 'unsupported-high-risk-surface')) return null;
  return findings;
}

function starfieldVrCompositeFindings(analysis = {}) {
  return inertTwoP0CompositeFindings(analysis,
    new Set([STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_LAUNCHER_SCRIPT_PATH]));
}

function singleFindingAnalysis(finding) {
  // Split into literal one-P0 evidence, never spread untrusted analysis.
  return Object.freeze({
    findings: Object.freeze([finding]),
    counts: Object.freeze({ P0: 1, P1: 0, P2: 0 }),
    verdict: 'findings',
    clean: false,
  });
}

function compositeChildInput(input, finding) {
  // Retain own data fields without executing caller-defined accessors.
  const next = {};
  for (const key of Object.keys(input)) {
    const slot = Object.getOwnPropertyDescriptor(input, key);
    if (slot && Object.hasOwn(slot, 'value')) {
      Object.defineProperty(next, key, {
        value: slot.value, enumerable: true, configurable: true, writable: true,
      });
    }
  }
  next.analysis = singleFindingAnalysis(finding);
  return Object.freeze(next);
}

function literalCompositeFinding(findings, path) {
  // Strict envelope validation preceded this call. Never use the potentially
  // shadowed Array#find on untrusted review evidence.
  for (const index of ['0', '1']) {
    const entry = Object.getOwnPropertyDescriptor(findings, index)?.value;
    if (entry?.path === path) return entry;
  }
  return null;
}

/**
 * Composite specialist routing must preserve the original analysis identity.
 * In particular, recomputing two single-P0 subreviews cannot cleanse an
 * upstream contradictory counts/verdict envelope.
 */
function ownCompositeReviewData(value, keys) {
  // Accessor-backed claims are executable, not literal review evidence.
  return Boolean(value && typeof value === 'object' && !types.isProxy(value) && !Array.isArray(value)
    && keys.every((key) => {
      const slot = Object.getOwnPropertyDescriptor(value, key);
      return slot && Object.hasOwn(slot, 'value');
    }));
}

function exactTwoP0CompositeEnvelope(analysis) {
  // Refuse inherited or getter-backed P0 evidence before reading its values.
  if (!ownCompositeReviewData(analysis, ['findings', 'counts', 'verdict'])
    || (Object.hasOwn(analysis, 'clean') && !ownCompositeReviewData(analysis, ['clean']))) return false;
  const counts = analysis.counts;
  return ownCompositeReviewData(counts, ['P0', 'P1', 'P2'])
    && Object.keys(counts).length === 3
    && counts.P0 === 2
    && counts.P1 === 0
    && counts.P2 === 0
    && (!Object.hasOwn(analysis, 'clean') || analysis.clean === false)
    && analysis.verdict === 'findings';
}

// Do not let one-element JSON arrays masquerade as scalar P0 identities.
// This is reviewer-only source classification; it grants no game/runtime action.
function exactCompositeFindingScalars(findings) {
  // Array index accessors are executable too; inspect descriptors first.
  return !types.isProxy(findings) && Array.isArray(findings) && findings.length === 2 && [0, 1].every((index) => {
    const slot = Object.getOwnPropertyDescriptor(findings, String(index));
    const item = slot && Object.hasOwn(slot, 'value') ? slot.value : null;
    return ownCompositeReviewData(item, ['severity', 'code', 'path'])
      && item.severity === 'P0'
      && item.code === 'unsupported-high-risk-surface'
      && typeof item.path === 'string'
      && item.path === item.path.trim();
  });
}

function rejectedCompositeEnvelope(paths) {
  return Object.freeze({
    schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
    eligible: true,
    clean: false,
    reviewedPaths: Object.freeze([...paths]),
    findings: Object.freeze([Object.freeze({
      severity: 'P0',
      code: 'windows-authority-composite-escalation-envelope-invalid',
      path: paths[0],
    })]),
    proofRefs: Object.freeze([]),
    ...REVIEW_AUTHORITY_BOUNDARY,
    finalVerdict: 'WINDOWS_AUTHORITY_COMPOSITE_ESCALATION_ENVELOPE_INVALID',
  });
}

function analyzeStarfieldVrCompositeReview(input = {}) {
  const findings = starfieldVrCompositeFindings(input.analysis);
  if (!findings) return null;
  if (!exactTwoP0CompositeEnvelope(input.analysis) || !exactCompositeFindingScalars(findings)) {
    return rejectedCompositeEnvelope([STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_LAUNCHER_SCRIPT_PATH]);
  }
  const splashFinding = literalCompositeFinding(findings, STARFIELD_VR_SPLASH_LAUNCH_PATH);
  const launcherFinding = literalCompositeFinding(findings, STARFIELD_VR_LAUNCHER_SCRIPT_PATH);
  const splash = starfieldVrSplash.analyzeWindowsAuthorityStarfieldVrSplashReviewV1(compositeChildInput(input, splashFinding));
  const launcher = starfieldVrLauncher.analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(compositeChildInput(input, launcherFinding));
  if (!splash.eligible || !launcher.eligible) return null;
  const combinedFindings = Object.freeze([...(splash.findings || []), ...(launcher.findings || [])]);
  const reviewedPaths = Object.freeze([STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_LAUNCHER_SCRIPT_PATH]);
  const clean = splash.clean === true && launcher.clean === true && combinedFindings.length === 0;
  // A partially rejected composite cannot advertise a positive source proof.
  const proofRefs = Object.freeze(clean
    ? [...new Set([...(splash.proofRefs || []), ...(launcher.proofRefs || [])])] : []);
  return Object.freeze({
    schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
    eligible: true,
    clean,
    findings: combinedFindings,
    reviewedPaths,
    proofRefs,
    ...REVIEW_AUTHORITY_BOUNDARY,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STARFIELD_VR_COMPOSITE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_STARFIELD_VR_COMPOSITE_SPECIALIST_FINDINGS',
  });
}

function starfieldVrAerCompositeFindings(analysis = {}) {
  return inertTwoP0CompositeFindings(analysis,
    new Set([STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_AER_OBSERVE_SCRIPT_PATH]));
}

function analyzeStarfieldVrAerCompositeReview(input = {}) {
  const findings = starfieldVrAerCompositeFindings(input.analysis);
  if (!findings) return null;
  if (!exactTwoP0CompositeEnvelope(input.analysis) || !exactCompositeFindingScalars(findings)) {
    return rejectedCompositeEnvelope([STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_AER_OBSERVE_SCRIPT_PATH]);
  }
  const splashFinding = literalCompositeFinding(findings, STARFIELD_VR_SPLASH_LAUNCH_PATH);
  const aerFinding = literalCompositeFinding(findings, STARFIELD_VR_AER_OBSERVE_SCRIPT_PATH);
  const splash = starfieldVrSplash.analyzeWindowsAuthorityStarfieldVrSplashReviewV1(compositeChildInput(input, splashFinding));
  const aer = starfieldVrAerObserve.analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(compositeChildInput(input, aerFinding));
  if (!splash.eligible || !aer.eligible) return null;
  const combinedFindings = Object.freeze([...(splash.findings || []), ...(aer.findings || [])]);
  const reviewedPaths = Object.freeze([STARFIELD_VR_SPLASH_LAUNCH_PATH, STARFIELD_VR_AER_OBSERVE_SCRIPT_PATH]);
  const clean = splash.clean === true && aer.clean === true && combinedFindings.length === 0;
  // Never return a partial positive proof when the combined P0 review fails.
  const proofRefs = Object.freeze(clean
    ? [...new Set([...(splash.proofRefs || []), ...(aer.proofRefs || [])])] : []);
  return Object.freeze({
    schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
    eligible: true,
    clean,
    findings: combinedFindings,
    reviewedPaths,
    proofRefs,
    ...REVIEW_AUTHORITY_BOUNDARY,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_COMPOSITE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_COMPOSITE_SPECIALIST_FINDINGS',
  });
}

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  // A caller-controlled root Proxy can execute traps inside any downstream
  // specialist before composite evidence classification begins. A revoked
  // Proxy is equally untrusted; types.isProxy inspects both without traps.
  if (types.isProxy(input)) {
    return Object.freeze({
      schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      ...REVIEW_AUTHORITY_BOUNDARY,
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_UNTRUSTED_ROOT_PROXY',
    });
  }
  // Validate the actual root review identity fields before child dispatch.
  // Unrelated extension accessors are not read by the existing router and
  // must not invalidate otherwise literal, independently pinned P0 evidence.
  // Keep the Proxy guard first so no Proxy trap can run.
  const rootPrototype = input && typeof input === 'object' ? Object.getPrototypeOf(input) : undefined;
  const rootIdentityFields = ['repository', 'prNumber', 'branch', 'sourceHead', 'baseSha', 'analysis', 'sources', 'lineageEvidence'];
  const literalRoot = input && typeof input === 'object' && !Array.isArray(input)
    && (rootPrototype === Object.prototype || rootPrototype === null)
    && rootIdentityFields.every((key) => {
      const field = Object.getOwnPropertyDescriptor(input, key);
      return !field || Object.hasOwn(field, 'value');
    });
  if (!literalRoot) {
    return Object.freeze({
      schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      ...REVIEW_AUTHORITY_BOUNDARY,
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_UNTRUSTED_ROOT_EVIDENCE',
    });
  }
  // A literal root can conceal an executable Proxy in a nested finding,
  // source or lineage array. Check before any sibling specialist dispatch.
  const untrustedNestedEvidence = ['analysis', 'sources', 'lineageEvidence'].some((key) => {
    const field = Object.getOwnPropertyDescriptor(input, key);
    return field && Object.hasOwn(field, 'value')
      && unsafeNestedReviewEvidence(field.value, new Set(), 0, key === 'sources');
  });
  if (untrustedNestedEvidence) {
    return Object.freeze({
      schemaVersion: 'stephanos.windows-authority-specialist-review.v1',
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      ...REVIEW_AUTHORITY_BOUNDARY,
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_UNTRUSTED_NESTED_EVIDENCE',
    });
  }

  // Original #2315 source-only review, never an installed native-signer qualification.
  const mailboxNative = canonicalMailboxNative.analyzeWindowsAuthorityCanonicalMailboxNativeEvidenceReviewV1(input);
  if (mailboxNative.eligible) return mailboxNative;
  const sovereignFixedRuntimeResult = sovereignFixedRuntime.analyzeWindowsAuthoritySovereignFixedRuntimeReviewV1(input);
  if (sovereignFixedRuntimeResult.eligible) return sovereignFixedRuntimeResult;

  const vrResourceGovernorResult = vrResourceGovernor.analyzeWindowsAuthorityVrResourceGovernorReviewV1(input);
  if (vrResourceGovernorResult.eligible) return vrResourceGovernorResult;

  const stephanosCoreDaemonResult = stephanosCoreDaemon.analyzeWindowsAuthorityStephanosCoreDaemonReviewV1(input);
  if (stephanosCoreDaemonResult.eligible) return stephanosCoreDaemonResult;

  const lifeboatPrincipalSidResult = lifeboatPrincipalSid.analyzeWindowsAuthorityLifeboatPrincipalSidReviewV1(input);
  if (lifeboatPrincipalSidResult.eligible) return lifeboatPrincipalSidResult;

  const nativeCapacityPublisherResult = nativeCapacityPublisher.analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1(input);
  if (nativeCapacityPublisherResult.eligible) return nativeCapacityPublisherResult;

  const starfieldVrAerCompositeResult = analyzeStarfieldVrAerCompositeReview(input);
  if (starfieldVrAerCompositeResult) return starfieldVrAerCompositeResult;

  const starfieldVrCompositeResult = analyzeStarfieldVrCompositeReview(input);
  if (starfieldVrCompositeResult) return starfieldVrCompositeResult;

  const starfieldVrAerObserveResult = starfieldVrAerObserve.analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input);
  if (starfieldVrAerObserveResult.eligible) return starfieldVrAerObserveResult;

  const starfieldVrLauncherResult = starfieldVrLauncher.analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input);
  if (starfieldVrLauncherResult.eligible) return starfieldVrLauncherResult;

  const wsl2Result = wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input);
  if (wsl2Result.eligible) return wsl2Result;

  return base.analyzeWindowsAuthoritySpecialistReview(input);
}
