import { types as nodeTypes } from 'node:util';
import {
  inspectPostSyncRefreshCompletion, collectPostSyncRefreshDebt, resolvePostSyncRefreshDebt,
  POST_SYNC_GOVERNOR_PROOF_SCHEMA,
  projectPostSyncGovernorProof,
  POST_SYNC_SOVEREIGN_RELAY_OBSERVATION_SCHEMA,
  POST_SYNC_SOVEREIGN_RELAY_PROOF_SCHEMA,
  projectPostSyncSovereignRelayObservation,
  projectPostSyncSovereignRelayProof,
} from '../../scripts/battle-bridge-github-sync-policy.mjs';
export {
  POST_SYNC_GOVERNOR_PROOF_SCHEMA,
  projectPostSyncGovernorProof,
  POST_SYNC_SOVEREIGN_RELAY_OBSERVATION_SCHEMA,
  POST_SYNC_SOVEREIGN_RELAY_PROOF_SCHEMA,
  projectPostSyncSovereignRelayObservation,
  projectPostSyncSovereignRelayProof,
};

// Source-side validation only: an adapter is not a commissioned native host.
// Proof flags must be inert own data, never inherited or accessor-mediated.
function sovereignPluginHostProofPass(proof, expectedHead) {
  if (!proof || typeof proof !== 'object' || nodeTypes.isProxy(proof)) return false;
  let fields;
  try {
    const prototype = Object.getPrototypeOf(proof);
    if (prototype !== Object.prototype && prototype !== null) return false;
    fields = Object.getOwnPropertyDescriptors(proof);
  } catch {
    return false;
  }
  for (const key of ['ok', 'exactHeadProofOk', 'desktopPluginHostHandshakeVerified', 'loadedManifestVerified']) {
    const field = fields[key];
    if (!field || !Object.hasOwn(field, 'value') || field.value !== true) return false;
  }
  const ownData = key => {
    const descriptor = fields[key];
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  if (typeof ownData('sourceHead') !== 'string' || !SHA_PATTERN.test(ownData('sourceHead'))
    || ownData('sourceHead').toLowerCase() !== String(expectedHead).toLowerCase()) return false;

  // A boolean success claim is not evidence of a loaded native host. The
  // original private verifier must additionally establish process/session
  // identity, a loaded manifest and a fresh observation. These checks alone
  // do NOT create authenticated transport, reviewer authority or provenance.
  if (ownData('schemaVersion') !== 'stephanos.sovereign-plugin-host-activation.v1'
    || ownData('hostPrincipalVerified') !== true
    || ownData('hostProcessBirthVerified') !== true
    || ownData('sessionRevoked') !== false
    || ownData('sessionExpired') !== false) return false;
  const processId = ownData('hostProcessId');
  const sessionId = ownData('sessionId');
  if (!Number.isSafeInteger(processId) || processId <= 0 || processId > 0xffffffff
    || typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(sessionId)) return false;
  const loadedDigest = ownData('loadedManifestSha256');
  const expectedDigest = ownData('expectedManifestSha256');
  if (typeof loadedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(loadedDigest)
    || typeof expectedDigest !== 'string' || loadedDigest !== expectedDigest
    || ownData('manifestDigestVerified') !== true) return false;
  const birth = ownData('hostProcessStartedAtUtc');
  const observed = ownData('observedAtUtc');
  const expiry = ownData('expiresAtUtc');
  const iso = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  if (![birth, observed, expiry].every(iso)) return false;
  const now = Date.now();
  const birthMs = Date.parse(birth), observedMs = Date.parse(observed), expiryMs = Date.parse(expiry);
  return birthMs <= observedMs && observedMs <= now + 2_000
    && observedMs >= now - 15_000
    && expiryMs > now && expiryMs > observedMs && expiryMs <= observedMs + 30_000;
}

export const POST_SYNC_REFRESH_SCHEMA = 'stephanos.post-sync-runtime-refresh.v1';

export const POST_SYNC_REFRESH_CLASSIFICATIONS = Object.freeze({
  NO_RUNTIME_REFRESH_REQUIRED: 'NO_RUNTIME_REFRESH_REQUIRED',
  REFRESH_READY: 'REFRESH_READY',
  REFRESH_COMPLETE: 'REFRESH_COMPLETE',
  APPROVAL_REQUIRED_OPENCLAW: 'APPROVAL_REQUIRED_OPENCLAW',
  BLOCKED_UNSAFE_CHANGED_PATH: 'BLOCKED_UNSAFE_CHANGED_PATH',
  BLOCKED_UNCLASSIFIED_RUNTIME_PATH: 'BLOCKED_UNCLASSIFIED_RUNTIME_PATH',
  BLOCKED_SPATIAL_ADOPTION_REQUIRED: 'BLOCKED_SPATIAL_ADOPTION_REQUIRED',
  BLOCKED_REFRESH_FAILED: 'BLOCKED_REFRESH_FAILED',
});

export const POST_SYNC_REFRESH_TARGETS = Object.freeze({
  NATURAL_RELOAD: 'natural-reload',
  UI_4173: 'stephanos-ui-4173',
  BACKEND_8787: 'stephanos-backend-8787',
  MISSION_WORKER: 'mission-orchestrator-worker',
  VR_ATLAS_BROWSER_PROOF: 'vr-capability-atlas-browser-proof',
  GITHUB_MAILBOX: 'github-command-mailbox',
  SOVEREIGN_COMMANDER: 'sovereign-commander',
});

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._@+()\-][A-Za-z0-9._@+()\-/ ]{0,500}$/;
const CANONICAL_WORKER_WATCHDOG_PROBE_PATH = 'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1';
const REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH = 'scripts/battle-bridge-github-command-mailbox-with-receipt-index.mjs';
const MISSION_WORKER_POST_SYNC_COORDINATOR_PATH = 'scripts/battle-bridge-post-sync-refresh.mjs';
const GOAL_DISCOVERY_HEARTBEAT_RUNTIME_PATH = 'scripts/battle-bridge-goal-discovery-heartbeat.mjs';
const REQUIRED_LOCAL_LAUNCHER_PATH = 'windows/Launch-Stephanos-Local.ps1';
// Fresh invocation owns this complete guarded chain; no resident process is
// restarted by these source paths. The same inventory protects removals.
export const LOCAL_LAUNCHER_FRESH_ENTRY_PATHS = Object.freeze([
  'windows/Launch-Stephanos-Local.cmd',
  REQUIRED_LOCAL_LAUNCHER_PATH,
  'windows/Invoke-Stephanos-Ignite-With-Approval.ps1',
]);
const TARGET_ORDER = Object.freeze([
  POST_SYNC_REFRESH_TARGETS.UI_4173,
  POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF,
  POST_SYNC_REFRESH_TARGETS.BACKEND_8787,
  POST_SYNC_REFRESH_TARGETS.MISSION_WORKER,
  POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX,
  POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER,
  POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD,
]);

const SOVEREIGN_COMMANDER_PLUGIN_MANIFESTS = new Set([
  'plugins/sovereign-commander/plugin.json',
  'plugins/sovereign-commander/.codex-plugin/plugin.json',
]);

// These two resident components belong only to the explicit Spatial launcher.
// None of the existing refresh targets imports or launches them. Keep their
// adoption debt separate: source sync and unrelated target success cannot prove
// a loaded Spatial host, nor grant permission to start, stop or replace one.
const SPATIAL_RESIDENT_ADOPTION_PATHS = new Set([
  'scripts/spatial-window-host.mjs',
  'shared/vr/spatialDesktopSurfaceContractV1.mjs',
]);

// The Commander watchdog owns this long-running relay and its static imports.
// A healthy HTTP daemon alone cannot prove that this separate process reloaded.
const SOVEREIGN_RELAY_RUNTIME_EXACT = new Set([
  'scripts/battle-bridge-sovereign-relay-daemon.mjs',
  'scripts/control-tower-build-consumer-v1.mjs',
  'scripts/sovereign-commander-native-inspect.mjs',
]);

// Exact source-activation model. The recipe/source-capture and complete Git
// inventories are checked independently by regressions; no directory rule or
// runtime recipe discovery can grant a new sibling an activation owner.
export const STARFIELD_NATIVE_BUILD_ACTIVATION = Object.freeze({
  freshCapture: Object.freeze([
  'scripts/windows/starfield-native-build/native_build.py',
  'scripts/windows/starfield-native-build/owned_job.py',
  'scripts/windows/starfield-native-build/start_native_build.ps1',
  'scripts/windows/starfield-native-build/pinned_python_runtime.ps1',
  'scripts/windows/starfield-native-build/python_runtime_v1.json',
  ]),
  offlineBuild: Object.freeze([
  'scripts/windows/starfield-native-build/.gitattributes',
  'scripts/windows/starfield-native-build/governor_owner_fixture.py',
  'scripts/windows/starfield-native-build/install_pinned_python_runtime.ps1',
  'scripts/windows/starfield-native-build/owned_job_fixture.py',
  'scripts/windows/starfield-native-build/runtime_filtered_user_fixture.ps1',
  'scripts/windows/starfield-native-build/test_native_build.py',
  'scripts/windows/starfield-native-build/test_owned_job.py',
  'scripts/windows/starfield-native-build/test_pinned_python_runtime.py',
  'scripts/windows/starfield-native-build/test_start_native_build.py',
  ]),
  offlinePackage: Object.freeze([
  'VR-Research-Lab/native/starfield-paired-observer-v1/.gitattributes',
  'VR-Research-Lab/native/starfield-paired-observer-v1/README.md',
  'VR-Research-Lab/native/starfield-paired-observer-v1/build-recipe.json',
  'VR-Research-Lab/native/starfield-paired-observer-v1/analyze-paired-source-observation.py',
  'VR-Research-Lab/native/starfield-paired-observer-v1/build-paired-source-observe.cmd',
  'VR-Research-Lab/native/starfield-paired-observer-v1/native-paired-source-observer.h',
  'VR-Research-Lab/native/starfield-paired-observer-v1/paired-observer-recipe.json',
  'VR-Research-Lab/native/starfield-paired-observer-v1/paired-source-observation.h',
  'VR-Research-Lab/native/starfield-paired-observer-v1/reconstruct_paired_observer.py',
  'VR-Research-Lab/native/starfield-paired-observer-v1/reconstruct_paired_loader.py',
  'VR-Research-Lab/native/starfield-paired-observer-v1/test_paired_loader_preparation.py',
  'VR-Research-Lab/native/starfield-paired-observer-v1/scoped-eye-ledger.h',
  'VR-Research-Lab/native/starfield-paired-observer-v1/test-paired-scoped-eye-ledger.cpp',
  'VR-Research-Lab/native/starfield-paired-observer-v1/test-paired-source-observation.cpp',
  'VR-Research-Lab/native/starfield-paired-observer-v1/test-paired-source-observer-source.py',
  'VR-Research-Lab/native/starfield-paired-observer-v1/test-scoped-eye-ledger.cpp',
  ]),
});
const GOVERNOR_RUNTIME_PATH = 'scripts/windows/run-vr-resource-governor.ps1';
const SOVEREIGN_COMMANDER_RUNTIME_EXACT = new Set([
  GOVERNOR_RUNTIME_PATH,
  ...SOVEREIGN_RELAY_RUNTIME_EXACT,
  'scripts/windows/status-stephanos-core-daemon.ps1',
  'scripts/stephanos-core-daemon.mjs',
  'shared/agents/stephanosCoreDaemonV1.mjs',
  'shared/agents/sovereignCommanderV1.mjs',
  'shared/agents/sovereignCommanderCapabilityParityV1.mjs',
  'shared/agents/sovereignCommanderRemoteMailboxV1.mjs',
  'scripts/battle-bridge-observation.mjs',
  'scripts/sovereign-commander-http.mjs',
  // The existing Commander HTTP process statically imports the Caravan
  // handler, page and native bridge. Keep them with that resident owner;
  // source classification grants no mobile enrollment or installation.
  'scripts/battle-bridge-caravan-http-v1.mjs',
  'scripts/battle-bridge-caravan-page-v1.mjs',
  'scripts/windows/battle-bridge-mobile-install-native-v1.mjs',
  'scripts/sovereign-maintenance-custody-store-v1.mjs',
  'scripts/sovereign-maintenance-owner-observation-v2.mjs',
  'scripts/sovereign-fixed-runtime-parent-v1.mjs',
  'scripts/sovereign-commander-ignition-autoheal.mjs',
  'scripts/sovereign-commander-mcp.mjs',
  'scripts/sovereign-controller-lane-status.mjs',
  'scripts/sovereign-commander-visibility-snapshot.mjs',
  'scripts/sovereign-commander-fleet-goal-supervisor.mjs',
  'scripts/sovereign-commander-goal-builder-repair.mjs',
  'scripts/sovereign-commander-ignition-diagnosis.mjs',
  'scripts/sovereign-commander-persistent-runtime-repair.mjs',
  'scripts/sovereign-commander-ui-4173-repair.mjs',
  'scripts/sovereign-commander-ui-runtime-proof.mjs',
  'scripts/windows/configure-sovereign-commander-tailscale.ps1',
  'scripts/windows/repair-openclaw-full-stack.ps1',
  'scripts/windows/run-sovereign-commander-hidden.ps1',
  'plugins/sovereign-commander/skills/use-sovereign-commander/SKILL.md',
  'plugins/sovereign-commander/plugin.json',
  'plugins/sovereign-commander/.codex-plugin/plugin.json',
]);

const NATURAL_EXACT = new Set([
  ...STARFIELD_NATIVE_BUILD_ACTIVATION.freshCapture,
  // The fixed Caravan bridge rereads and hash-checks this read-only probe in
  // a fresh bounded child. Adoption checks source only; it invokes no probe,
  // native PREPARE, enrollment or installer and never qualifies the helper.
  'scripts/windows/observe-battle-bridge-mobile-install-v1.ps1',
  // On-demand VR owners load these on their next explicit invocation. This
  // confirms source adoption only; never launch/restart games or recorders.
  'scripts/report-starfield-vr-telemetry.mjs',
  // The fixed mailbox starts this delivery observation in a fresh Node child.
  'scripts/starfield-vr-delivery-truth-probe.mjs',
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
  // The existing third splash card owns this attended monitor continuation.
  // Sync adopts source only; it never starts a monitor session or a game.
  'scripts/windows/starfield-native-monitor/splash_monitor_bridge.py',
  'scripts/windows/starfield-native-monitor/run_native_eye_output_monitor.py',
  'scripts/windows/starfield-native-monitor/start_native_eye_output_session.py',
  'scripts/windows/starfield-native-monitor/analyze_native_eye_output_session.py',
  'scripts/windows/starfield-native-monitor/analyze_paired_source_session.py',
  'scripts/windows/launch-starfield-vr.ps1',
  'scripts/windows/new-vr-telemetry-session.ps1',
  'scripts/windows/read-starfield-vr-performance-diagnosis.ps1',
  'scripts/windows/run-starfield-aer-stabilizer-observe.ps1',
  'scripts/windows/starfield-vr-flight-recorder.ps1',
  'scripts/windows/starfield-vr-performance-mode.ps1',
  'scripts/windows/starfield-vr-runtime-metrics-producer.ps1',
  'scripts/windows/vr-visual-fault-marker.ps1',
  'shared/vr/vrTelemetrySensorContractV1.mjs',
  // Commander invokes these bounded Node children afresh. Source adoption
  // confirms the checkout only; it never invokes observation, reconciliation,
  // or Spatial preparation. Fixed native qualification remains independent.
  'scripts/sovereign-commander-browser-observe.mjs',
  'scripts/sovereign-commander-capability-parity-reconcile.mjs',
  'scripts/sovereign-commander-spatial-workspace.mjs',
  // These exact entry points/helpers are captured anew by their existing
  // bounded or attended callers. Source adoption invokes none of them and
  // grants no canary, process, administrator or native execution authority.
  'scripts/qwen35-canary.mjs',
  'scripts/windows/read-sovereign-maintenance-owner-v2.ps1',
  'scripts/windows/stephanos-core-process-observation.ps1',
  'scripts/sovereign-fixed-runtime-empty-version-quarantine-v1.mjs',
  'scripts/windows/quarantine-sovereign-fixed-runtime-empty-version-v1.ps1',
  // These private operations capture and hash-check their exact helper pairs
  // on each call, then compile captured C# in a fresh PowerShell child. This
  // source check never performs an operation or grants native custody.
  'scripts/windows/SovereignDirectoryCreateV1.cs',
  'scripts/windows/sovereign-create-directory.ps1',
  'scripts/windows/SovereignFileCopyV1.cs',
  'scripts/windows/sovereign-copy-file-content.ps1',
  'scripts/windows/SovereignFileMoveV1.cs',
  'scripts/windows/sovereign-move-file.ps1',
  'scripts/windows/SovereignPdfWriteV1.cs',
  'scripts/windows/sovereign-write-pdf.ps1',
  'scripts/windows/SovereignSearchV1.cs',
  'scripts/windows/sovereign-search.ps1',
  // Attended lock recovery loads this policy and native helper in a fresh
  // child. Its installation, qualification and operator gates remain separate.
  'scripts/windows/StephanosCoreLockRecoveryV1.cs',
  'scripts/windows/recover-stephanos-core-lock.ps1',
  'scripts/windows/stephanos-core-lock-recovery-policy.ps1',
  'scripts/canonical-mailbox-execution-ledger-v1.mjs',
  'scripts/canonical-mailbox-rotation-transaction-v2.mjs',
  'scripts/canonical-mailbox-rotation-host-v1.mjs',
  'scripts/canonical-mailbox-rotation-sync-preflight-v1.mjs',
  'scripts/canonical-mailbox-action-evidence-v2.mjs',
  'shared/agents/canonicalMailboxRotationV1.mjs',
  'shared/agents/canonicalMailboxRotationFenceV1.mjs',
  'shared/agents/canonicalMailboxRotationActionEvidenceV1.mjs',
  'scripts/stephanos-codex-dispatch-host-operation-v1.mjs',
  'shared/agents/battleBridgeGitHubCommandMailbox.mjs',
  'shared/agents/stephanosCapabilityRegistry.mjs',
  'shared/agents/postSyncRuntimeRefreshCoordinator.mjs',
  'shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs',
  'shared/agents/windowsAuthorityMailboxRecoveryGuardianReviewV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  'shared/agents/windowsAuthorityMobileRecoveryExecutorReviewV1.mjs',
  'shared/agents/windowsAuthorityOpenClawRecoveryReviewV1.mjs',
  'shared/agents/windowsAuthorityRecoveryMeshGuardianReviewV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewLegacyV1.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1Base.mjs',
  'shared/agents/windowsAuthoritySpecialistReviewV1LegacyRouter.mjs',
  'scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1',
  'scripts/windows/request-battle-bridge-recovery-openclaw.ps1',
  'scripts/windows/request-battle-bridge-recovery.ps1',
  'scripts/battle-bridge-github-command-mailbox.mjs',
  REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH,
  'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs',
  'scripts/battle-bridge-github-sync-executor.mjs',
  // The fixed sync executor spawns this bounded one-shot child afresh each cycle.
  // Natural reload confirms source adoption; never run housekeeping as refresh.
  'scripts/battle-bridge-sync-housekeeper-runner.mjs',
  'scripts/battle-bridge-github-sync-and-refresh.mjs',
  'scripts/stephanos-codex-dispatch-mcp.mjs',
  'scripts/battle-bridge-post-sync-refresh.mjs',
  'scripts/battle-bridge-shared-workspace-publisher.mjs',
  'scripts/battle-bridge-outbound-health-beacon-core.mjs',
  'scripts/battle-bridge-outbound-health-beacon.mjs',
  'scripts/sovereign-commander-stephanos-repair.mjs',
  'scripts/chatgpt-shared-workspace-github-relay.mjs',
  'scripts/chatgpt-shared-workspace-github-relay-core.mjs',
  'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-hidden.ps1',
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
  'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  'scripts/windows/run-battle-bridge-github-sync-hidden.ps1',
  'scripts/windows/install-battle-bridge-github-sync.ps1',
  'scripts/windows/status-battle-bridge-github-sync.ps1',
  'scripts/windows/uninstall-battle-bridge-github-sync.ps1',
  'scripts/windows/install-battle-bridge-outbound-health-beacon.ps1',
  'scripts/windows/run-battle-bridge-outbound-health-beacon-hidden.ps1',
  'scripts/windows/install-desktop-commander-watchdog.ps1',
  'scripts/windows/run-desktop-commander-watchdog-hidden.ps1',
  'scripts/windows/install-battle-bridge-recovery-lifeboat-v1.ps1',
  'scripts/windows/invoke-battle-bridge-recovery-lifeboat-github-claim-v1.ps1',
  'scripts/windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/run-vr-virtual-airlink-acceptance.ps1',
  ...LOCAL_LAUNCHER_FRESH_ENTRY_PATHS,
  'scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1',
  'scripts/windows/install-forge-shadow-podman-v1.ps1',
]);

const NATURAL_PREFIXES = Object.freeze([
  'scripts/battle-bridge-github-command-mailbox.',
  'scripts/battle-bridge-github-sync-',
  'scripts/chatgpt-shared-workspace-github-relay.',
]);

const OPENCLAW_APPROVAL_EXEMPT_EXACT = new Set([
  'shared/agents/openClawProviderPoolQualificationV1.mjs',
  // The specialist review model is imported by backend-side protected merge
  // adapters; it is not the running OpenClaw gateway or its plugin bundle.
  'shared/agents/openClawBuilderProviderSpecialistReviewSuccessorV1.mjs',
  'scripts/windows/repair-openclaw-full-stack.ps1',
]);

const NO_RUNTIME_PREFIXES = Object.freeze([
  '.agents/',
  '.codex/',
  '.github/',
  'docs/',
  'tests/',
  'src/windows/Stephanos.CanonicalMailboxNativeEvidence/',
  // This host is an offline native package, not a live Windows service.
  // Distinct sibling versions deliberately remain unclassified and blocked.
  'src/windows/Stephanos.CanonicalMailboxNativeEvidenceHost/',
  'VR-Research-Lab/docs/',
]);

const NO_RUNTIME_EXACT = new Set([
  ...STARFIELD_NATIVE_BUILD_ACTIVATION.offlineBuild,
  ...STARFIELD_NATIVE_BUILD_ACTIVATION.offlinePackage,
  'scripts/windows/Test-StarfieldMonitorSplash.ps1',
  'scripts/windows/starfield-native-monitor/test_splash_monitor_bridge.py',
  'scripts/windows/starfield-native-monitor/test_run_native_eye_output_monitor.py',
  'scripts/windows/starfield-native-monitor/test_start_native_eye_output_session.py',
  'scripts/windows/starfield-native-monitor/test_analyze_native_eye_output_session.py',
  'scripts/windows/starfield-native-monitor/test_analyze_paired_source_session.py',
  // Existing GitHub Actions job loads this fixed artifact producer from its
  // exact checkout. It is never a resident Battle Bridge process or a local
  // submission adapter; activating the native reader belongs to the relay.
  'scripts/control-tower-build-request-v1.mjs',
  // Offline/attended native package sources. Source adoption cannot compile,
  // install, sign, commission, or qualify their separately installed binaries.
  'scripts/windows/install-vr-openxr-telemetry-layer.ps1',
  'src/vr/Stephanos.OpenXrTelemetryLayer/layer.json',
  'src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.cpp',
  'src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.test.cpp',
  'src/windows/Stephanos.OriginalR7CustodyWitness.Tests/LegacySigningInterop.mjs',
  'src/windows/Stephanos.OriginalR7CustodyWitness.Tests/OriginalR7SigningProviderTests.cs',
  'src/windows/Stephanos.OriginalR7CustodyWitness/OriginalR7SigningPrimitives.cs',
  // Manual offline source-package construction; no runtime root imports it.
  'scripts/sovereign-fixed-runtime-install-source-package-v1.mjs',
  'scripts/sovereign-fixed-runtime-install-current-v1.mjs',
  // Seed Forge worker is an on-demand child loaded afresh by the existing
  // bounded supervisor for each exact approved task. Source adoption does not
  // require restarting a long-running runtime.
  'scripts/seed-canopy-parallel-builder.mjs',
  // Exact installer construction/native sources are consumed only by the
  // attended Ignition installer. Source adoption must not start/restart a
  // long-running service; the later exact-head installation/boot gate owns them.
  'scripts/sovereign-fixed-runtime-installer-candidate-v1.mjs',
  'scripts/windows/SovereignFixedRuntimeIdentityV1.cs',
  // Protected host C# source is compiled only by the attended installer. A
  // source change never activates or qualifies the installed native binary.
  'scripts/windows/SovereignFixedRuntimeHostV1.cs',
  'scripts/windows/SovereignFixedRuntimeJobV1.cs',
  'scripts/windows/SovereignFixedRuntimeSourceV1.cs',
  'scripts/windows/install-sovereign-fixed-runtime-v1.ps1',
  // Exact #1814 offline review/bootstrap and native compilation inputs. Their
  // immutable manual enrollment/preservation routes retain separate authority;
  // sync never compiles, installs, preserves a partial root or qualifies them.
  'scripts/battle-bridge-mobile-install-enrollment-bootstrap-v1.mjs',
  'scripts/battle-bridge-mobile-install-enrollment-review-v1.mjs',
  'scripts/battle-bridge-mobile-partial-preservation-review-v1.mjs',
  'scripts/windows/SovereignMobileInstallAnchorV1.cs',
  'scripts/windows/SovereignMobileInstallAssertionV1.cs',
  'scripts/windows/SovereignMobileInstallEnrollmentV1.cs',
  'scripts/windows/SovereignMobileInstallEntryV1.cs',
  'scripts/windows/SovereignMobileInstallExecutorV1.cs',
  'scripts/windows/SovereignMobileInstallJournalV1.cs',
  'scripts/windows/SovereignMobileInstallProvisioningV1.cs',
  'scripts/windows/SovereignMobileInstallReceiptV1.cs',
  'scripts/windows/SovereignMobileInstallReconciliationV1.cs',
  'scripts/windows/SovereignMobileInstallReleaseV1.cs',
  'scripts/windows/SovereignMobileInstallRequestsV1.cs',
  'scripts/windows/install-battle-bridge-mobile-installer-v1.ps1',
  'scripts/windows/preserve-battle-bridge-mobile-partial-v1.ps1',
  // Exact test-only consumers; no scripts/fixtures or native-source wildcard.
  'scripts/fixtures/mobile-device-pairing-v1.mjs',
  'scripts/fixtures/sovereign-mobile-installer-native-source-v1.mjs',
  'scripts/windows/test-sovereign-fixed-runtime-job-v1.ps1',
  'scripts/fixtures/sovereign-fixed-runtime-adoption-parent-fixture-v1.mjs',
  'scripts/fixtures/sovereign-fixed-runtime-closure-fixture-v1.mjs',
  'scripts/fixtures/sovereign-fixed-runtime-inspection-diagnostics-fixture-v1.mjs',
  'scripts/fixtures/sovereign-fixed-runtime-parent-protocol-fixture-v1.mjs',
  'scripts/fixtures/sovereign-fixed-runtime-source-proof-fixture-v1.mjs',
  'scripts/canonical-mailbox-rollover-github-adapter.mjs',
  'scripts/canonical-mailbox-workflow-admission-v1.mjs',
  'scripts/canonical-mailbox-workflow-event-gate.mjs',
  'scripts/dispatch-protected-merge-from-mailbox.mjs',
  'scripts/operator-protected-merge-gate-v2.mjs',
  '.gitignore',
  '.gitattributes',
  'LICENSE',
  'README.md',
  'scripts/publish-battle-bridge-main-advance-signal.mjs',
  // Exact GitHub Actions-only review-probe helper; never a resident Windows
  // runtime, so it cannot obstruct independent Backend/Mission Worker reload.
  // The two Spatial resident paths retain their independent adoption hold.
  'scripts/exact-head-qualified-escalation-v1.mjs',
  'scripts/exact-head-review-dispatch.mjs',
  'scripts/exact-head-review-current-main-admission-v1.mjs',
  'scripts/bind-independent-review-handoff-provenance-v1.mjs',
  'scripts/retry-independent-review.mjs',
  'scripts/launch-missing-independent-review-v1.mjs',
  'scripts/recover-successful-independent-review-v1.mjs',
  'scripts/battle-bridge-mobile-recovery-attestation-v1.mjs',
  // One-shot PR-estate CLI: explicit invocation never adopts a resident service.
  'scripts/pr-estate-reconcile.mjs',
  'shared/agents/battleBridgeMainAdvanceSignalV1.mjs',
  'shared/agents/mailboxReceiptIndexGitHubMirror.mjs',
  'shared/agents/codexBankedResetTelemetryMirror.mjs',
  'scripts/operator-protected-personal-repository-merge.mjs',
  'shared/agents/operatorPersonalRepositoryMergeV1.mjs',
  // The existing guarded ignition invocation loads these sources afresh.
  // Classifying source adoption does not request another ignition or start AI.
  'scripts/ignite-stephanos-local.mjs',
  'scripts/ignition-cockpit-model.mjs',
  'scripts/run-battle-bridge-ignition.mjs',
  'scripts/battle-bridge-ignition-sync-preflight.mjs',
  // These are one-shot advisory/review children loaded afresh by their fixed callers;
  // source adoption must not restart a long-running runtime. Keep exact-only.
  'scripts/starfield-vr-project-performance-loop.mjs',
  'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
  // One-shot protected review entries. Adoption never installs/trusts the
  // launcher or invokes inference; their existing installation gates remain.
  'scripts/sovereign-high-risk-advisory-launcher-v1.mjs',
  'scripts/sovereign-high-risk-advisory-v1.mjs',
  'scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1',
  // Exact test fixtures have no production caller. Do not generalize this
  // allowance to neighboring native sources or PowerShell scripts.
  'scripts/fixtures/sovereign-directory-package-fixture-v1.mjs',
  'scripts/windows/stephanos-core-absent-bootstrap.test.ps1',
  'scripts/windows/test-starfield-vr-telemetry-invocation.ps1',
  // Hosted protected-review and bounded reviewer entrypoints load afresh;
  // adoption neither runs inference nor grants review or merge authority.
  'scripts/protected-ready-review-lifecycle-v1.mjs',
  'scripts/sovereign-reviewer-ollama-calibration-v1.mjs',
  'scripts/sovereign-reviewer-v1.mjs',
  'scripts/sovereign-reviewer-wsl-bridge-v1.mjs',
  // Browser registration compiles this native source only during an explicit
  // install. Checkout adoption does not update or attest the registered binary.
  'scripts/windows/SovereignBrowserWitnessHost.cs',
  'scripts/windows/install-sovereign-browser-witness.ps1',
  'scripts/windows/uninstall-sovereign-browser-witness.ps1',
  // Offline R7 build/test inputs and the hosted-only capacity probe have no
  // resident consumer. Signing, loading and native qualification stay gated.
  'scripts/windows/build-original-r7-native-qualification.ps1',
  'scripts/windows/inspect-r7-hosted-linux-lab-capacity.py',
  'src/windows/Stephanos.OriginalR7CustodyWitness/ProspectiveNativeScopeCapture.cs',
  'src/windows/Stephanos.OriginalR7CustodyWitness/ProspectiveProcessingClaimContext.cs',
  'src/windows/Stephanos.OriginalR7NativeQualification/.gitignore',
  'src/windows/Stephanos.OriginalR7NativeQualification/Client.c',
  'src/windows/Stephanos.OriginalR7NativeQualification/NativeQualification.c',
  'src/windows/Stephanos.OriginalR7NativeQualification/Protocol.h',
  'src/windows/Stephanos.ProspectiveProcessingClaimContext.Tests/.gitignore',
  'src/windows/Stephanos.ProspectiveProcessingClaimContext.Tests/Program.cs',
  'src/windows/Stephanos.ProspectiveProcessingClaimContext.Tests/Stephanos.ProspectiveProcessingClaimContext.Tests.csproj',
  // These Spatial wrappers load on explicit invocation; native C++ is consumed
  // only by an explicit build. Source adoption dispatches no preparation,
  // installer, launcher or restart, and never qualifies an installed binary.
  // The resident host and its static JS contract retain separate adoption debt.
  'scripts/windows/build-spatial-window.ps1',
  'scripts/windows/install-spatial-window.ps1',
  'scripts/windows/install-stephanos-spatial-workspace-shortcut.ps1',
  'scripts/windows/launch-stephanos-spatial-workspace.ps1',
  'scripts/windows/prepare-spatial-workspace.ps1',
  'scripts/windows/spatial-window-install-lock.ps1',
  'scripts/windows/start-spatial-window-host.ps1',
  'src/windows/Stephanos.SpatialWindow/SpatialWindow.cpp',
]);

const LAUNCHER_CRITICAL_SOURCE_PATHS = new Set([
  'main.js',
  'style.css',
  'modules/command-deck/command-deck.js',
  'system/module_loader.js',
  'system/workspace.js',
]);

const UI_BUILD_AND_PROOF_TOOLCHAIN_PATHS = new Set([
  'scripts/build-stephanos-ui.mjs',
  'scripts/browser-proof-runner.mjs',
  'scripts/sovereign-commander-ui-runtime-proof.mjs',
  'scripts/clean-stephanos-dist.mjs',
  'scripts/stephanos-build-utils.mjs',
  'scripts/verify-stephanos-dist.mjs',
  'scripts/serve-stephanos-dist.mjs',
  'scripts/refresh-stephanos-ui-4173.mjs',
  'scripts/battle-bridge-ui-4173-repair.mjs',
  'scripts/sovereign-commander-ui-4173-repair.mjs',
  'scripts/battle-bridge-ignition-supervisor.mjs',
  'scripts/launcher-readiness-live-facts.mjs',
  'scripts/launcher-readiness-planner.mjs',
]);

function normalizePath(value) {
  const path = String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!path || path.startsWith('/') || path.startsWith('//') || /^[A-Za-z]:\//.test(path)) return '';
  if (path.split('/').some((part) => part === '..' || part === '')) return '';
  if (!SAFE_RELATIVE_PATH.test(path)) return '';
  return path;
}

export function parseGitChangedPathStatus(stdout) {
  const paths = [];
  for (const line of String(stdout ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
    const parts = line.split('\t');
    const status = parts.shift() || '';
    if (!/^[ACDMRT][0-9]*$/.test(status)) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CHANGED_PATH_STATUS_INVALID', paths: Object.freeze([]) });
    }
    const expectedPathCount = /^[CR]/.test(status) ? 2 : 1;
    if (parts.length !== expectedPathCount || parts.some((entry) => !String(entry ?? '').trim())) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CHANGED_PATH_STATUS_INVALID', paths: Object.freeze([]) });
    }
    const removesCanonicalProbe = status === 'D'
      ? parts[0] === CANONICAL_WORKER_WATCHDOG_PROBE_PATH
      : /^R[0-9]*$/.test(status) && parts[0] === CANONICAL_WORKER_WATCHDOG_PROBE_PATH;
    if (removesCanonicalProbe) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_CANONICAL_WORKER_WATCHDOG_PROBE_REMOVED', paths: Object.freeze([]) });
    }
    const removesRequiredMailboxWrapper = status === 'D'
      ? parts[0] === REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH
      : /^R[0-9]*$/.test(status) && parts[0] === REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH;
    if (removesRequiredMailboxWrapper) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_REQUIRED_MAILBOX_WRAPPER_REMOVED', paths: Object.freeze([]) });
    }
    const removesRequiredLocalLauncher = status === 'D'
      ? LOCAL_LAUNCHER_FRESH_ENTRY_PATHS.includes(parts[0])
      : /^R[0-9]*$/.test(status) && LOCAL_LAUNCHER_FRESH_ENTRY_PATHS.includes(parts[0]);
    if (removesRequiredLocalLauncher) {
      return Object.freeze({ ok: false, blocker: 'POST_SYNC_REQUIRED_LOCAL_LAUNCHER_REMOVED', paths: Object.freeze([]) });
    }
    paths.push(...parts);
  }
  return Object.freeze({ ok: true, paths: Object.freeze([...new Set(paths)]) });
}

function isTestOrDocumentation(path) {
  return NO_RUNTIME_EXACT.has(path)
    || NO_RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix))
    || /(?:^|\/)[^/]+\.(?:test|spec)\.(?:c?js|mjs|jsx|ts|tsx)$/i.test(path)
    || /\.(?:md|mdx)$/i.test(path);
}

function isOpenClawPath(path) {
  if (NATURAL_EXACT.has(path) || OPENCLAW_APPROVAL_EXEMPT_EXACT.has(path)) return false;
  if (path.startsWith('stephanos-server/')) return false;
  return path.startsWith('integrations/openclaw/')
    || path.startsWith('openclaw/')
    || /(?:^|\/)[^/]*openclaw[^/]*\.(?:mjs|js|ps1|vbs|json)$/i.test(path)
    || path === 'scripts/windows/run-stephanos-scheduled-task-windowless.vbs';
}

function isUiPath(path) {
  return LAUNCHER_CRITICAL_SOURCE_PATHS.has(path)
    || UI_BUILD_AND_PROOF_TOOLCHAIN_PATHS.has(path)
    // This exact stylesheet is imported by stephanos-ui/src/main.jsx.
    // Classify it as a UI reload, not no-runtime or a generic styles allowance.
    || path === 'shared/styles/stephanos-card-layout.css'
    || path.startsWith('stephanos-ui/')
    || path.startsWith('system/apps/')
    || (path.startsWith('apps/') && !path.startsWith('apps/stephanos/dist/'))
    || path.startsWith('shared/ai/')
    || path.startsWith('shared/runtime/')
    || path.startsWith('apps/stephanos/dist/')
    || [
      'apps/stephanos/app.json',
      'apps/index.json',
      'system/apps/app_validator.js',
      'stephanos-ui/package.json',
      'stephanos-ui/package-lock.json',
    ].includes(path)
    || path === 'package.json'
    || path === 'package-lock.json';
}

function isVrAtlasProofPath(path) {
  return path.startsWith('apps/vr-capability-atlas/');
}

function isBackendPath(path) {
  if (NATURAL_EXACT.has(path)) return false;
  return path.startsWith('stephanos-server/')
    || path.startsWith('shared/ai/')
    || path.startsWith('shared/runtime/')
    || (path.startsWith('shared/agents/') && !NATURAL_EXACT.has(path))
    || [
      'scripts/windows/start-stephanos-backend.ps1',
      'scripts/windows/install-stephanos-backend-autostart.ps1',
      'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
      'package.json',
      'package-lock.json',
    ].includes(path);
}

function isMissionWorkerPath(path) {
  if (path === MISSION_WORKER_POST_SYNC_COORDINATOR_PATH || path === GOAL_DISCOVERY_HEARTBEAT_RUNTIME_PATH) return true;
  // The supervised worker statically imports this guardian and calls it on
  // recurring ticks; its CLI entrypoint does not make it invocation-only.
  if (path === 'scripts/completion-guardian.mjs') return true;
  if (NATURAL_EXACT.has(path)) return false;
  return (path.startsWith('shared/agents/') && !NATURAL_EXACT.has(path))
    || path.startsWith('scripts/mission-orchestrator-worker')
    || path.startsWith('scripts/battle-bridge-worker-watchdog')
    || [
      'scripts/windows/start-mission-orchestrator-worker.ps1',
      'scripts/windows/install-mission-orchestrator-worker-autostart.ps1',
      CANONICAL_WORKER_WATCHDOG_PROBE_PATH,
      'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
      'package.json',
      'package-lock.json',
    ].includes(path);
}

function isSovereignCommanderRuntimePath(path) {
  return SOVEREIGN_COMMANDER_RUNTIME_EXACT.has(path);
}

function isMailboxRuntimePath(path) {
  return path === 'shared/agents/postSyncRuntimeRefreshCoordinator.mjs'
    || path === 'scripts/battle-bridge-github-command-mailbox.mjs'
    || path === REQUIRED_MAILBOX_RECEIPT_INDEX_WRAPPER_PATH
    || path === 'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'
    || path === 'scripts/windows/install-battle-bridge-github-command-mailbox.ps1'
    || path === 'scripts/windows/run-battle-bridge-github-command-mailbox-hidden.ps1'
    || path.startsWith('shared/agents/battleBridgeGitHubCommandMailbox');
}

function isNaturalReloadPath(path) {
  return NATURAL_EXACT.has(path)
    || NATURAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function classifyPostSyncRefresh(changedPaths = [], {
  sovereignRelayRefreshRequired = false, governorRefreshRequired = false, spatialAdoptionRequired = false,
} = {}) {
  const safePaths = [];
  const unsafePaths = [];
  for (const rawPath of Array.isArray(changedPaths) ? changedPaths : []) {
    const normalized = normalizePath(rawPath);
    if (normalized) safePaths.push(normalized);
    else unsafePaths.push(String(rawPath ?? ''));
  }

  const targets = new Set();
  const noRuntimePaths = [];
  const unknownPaths = [];
  const openClawPaths = [];
  const spatialAdoptionPaths = [];

  for (const path of [...new Set(safePaths)]) {
    if (isTestOrDocumentation(path)) {
      noRuntimePaths.push(path);
      continue;
    }
    if (SPATIAL_RESIDENT_ADOPTION_PATHS.has(path)) {
      spatialAdoptionPaths.push(path);
      continue;
    }
    let classified = false;
    if (isOpenClawPath(path)) {
      openClawPaths.push(path);
      classified = true;
    }
    if (isUiPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.UI_4173);
      classified = true;
    }
    if (isVrAtlasProofPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF);
      classified = true;
    }
    if (isBackendPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.BACKEND_8787);
      classified = true;
    }
    if (isMissionWorkerPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.MISSION_WORKER);
      classified = true;
    }
    if (isMailboxRuntimePath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX);
      classified = true;
    }
    if (isSovereignCommanderRuntimePath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER);
      classified = true;
    }
    if (isNaturalReloadPath(path)) {
      targets.add(POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD);
      classified = true;
    }
    if (!classified) unknownPaths.push(path);
  }

  const relayRequired = sovereignRelayRefreshRequired === true
    || safePaths.some((path) => SOVEREIGN_RELAY_RUNTIME_EXACT.has(path));
  const governorRequired = governorRefreshRequired === true || safePaths.includes(GOVERNOR_RUNTIME_PATH);
  if (governorRequired) targets.add(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER);
  const spatialRequired = spatialAdoptionRequired === true || spatialAdoptionPaths.length > 0;
  // A later revert can remove a path from the net diff without proving that an
  // earlier partially refreshed relay stopped using it. Preserve its debt.
  if (relayRequired) targets.add(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER);
  const targetIds = TARGET_ORDER.filter((target) => targets.has(target));
  let classification = POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED;
  if (unsafePaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNSAFE_CHANGED_PATH;
  else if (unknownPaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_UNCLASSIFIED_RUNTIME_PATH;
  else if (openClawPaths.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW;
  else if (spatialRequired) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_SPATIAL_ADOPTION_REQUIRED;
  else if (targetIds.length) classification = POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_READY;

  return Object.freeze({
    schemaVersion: POST_SYNC_REFRESH_SCHEMA,
    classification,
    targetIds: Object.freeze(targetIds),
    changedPathCount: safePaths.length + unsafePaths.length,
    safePathCount: safePaths.length,
    noRuntimePathCount: noRuntimePaths.length,
    openClawPathCount: openClawPaths.length,
    spatialAdoptionPathCount: spatialAdoptionPaths.length,
    spatialAdoptionRequired: spatialRequired,
    unknownPathCount: unknownPaths.length,
    unsafePathCount: unsafePaths.length,
    openClawApprovalRequired: openClawPaths.length > 0,
    // Restarting Commander HTTP proves neither the Codex nor ChatGPT desktop
    // plugin host has loaded the new manifest/skills. Keep this a separate
    // physical acceptance requirement when either manifest changed.
    pluginHostActivationRequired: safePaths.some((path) => SOVEREIGN_COMMANDER_PLUGIN_MANIFESTS.has(path)),
    sovereignRelayRefreshRequired: relayRequired,
    governorRefreshRequired: governorRequired,
    automaticExecutionAllowed: unsafePaths.length === 0 && unknownPaths.length === 0,
    internal: Object.freeze({
      safePaths: Object.freeze([...new Set(safePaths)]),
      noRuntimePaths: Object.freeze(noRuntimePaths),
      openClawPaths: Object.freeze(openClawPaths),
      spatialAdoptionPaths: Object.freeze(spatialAdoptionPaths),
      unknownPaths: Object.freeze(unknownPaths),
      unsafePaths: Object.freeze(unsafePaths),
    }),
  });
}

function validHead(value) {
  return SHA_PATTERN.test(String(value ?? ''));
}

function resultPass(result, expectedHead) {
  return result?.ok === true
    && result?.exactHeadProofOk === true
    && (result?.blocker === undefined || result?.blocker === '')
    && String(result?.sourceHead || '').toLowerCase() === String(expectedHead).toLowerCase();
}

export function postSyncRefreshTargetResultPass(result, { targetId, plan, expectedHead } = {}) {
  if (!resultPass(result, expectedHead)) return false;
  if (result?.targetId !== undefined && result.targetId !== targetId) return false;
  if (targetId !== POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER) return true;
  return (plan?.sovereignRelayRefreshRequired !== true
      || projectPostSyncSovereignRelayProof(result.sovereignRelayProof, expectedHead) !== null)
    && (plan?.governorRefreshRequired !== true
      || projectPostSyncGovernorProof(result.governorProof, expectedHead) !== null);
}

export const POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA = 'stephanos.post-sync-target-failure-history.v1';
const TARGET_FAILURE_KINDS = new Set(['RESULT_UNPROVEN', 'INVOCATION_FAILED', 'HANDLER_MISSING']);
// Diagnostic vocabulary, never an execution/admission authority. Unknown child
// strings become a fixed code rather than entering durable/public history.
const TARGET_FAILURE_CODES = new Set([
  'REFRESH_TARGET_PROOF_FAILED', 'REFRESH_TARGET_INVOCATION_FAILED', 'REFRESH_TARGET_HANDLER_MISSING',
  'REFRESH_TARGET_IDENTITY_UNPROVEN',
  'SOVEREIGN_COMMANDER_OPERATOR_CONTEXT_UNPROVEN', 'SOVEREIGN_COMMANDER_NORMAL_OPERATOR_REQUIRED',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN', 'SOVEREIGN_MAINTENANCE_OWNER_BUSY',
  'SOVEREIGN_COMMANDER_MAINTENANCE_QUIESCENCE_UNPROVEN', 'SOVEREIGN_COMMANDER_SERVER_SCRIPT_MISSING',
  'SOVEREIGN_COMMANDER_TOKEN_MISSING', 'SOVEREIGN_COMMANDER_CANONICAL_NODE_MISSING',
  'SOVEREIGN_COMMANDER_STALE_CONTRACT_RECYCLE_FAILED', 'SOVEREIGN_COMMANDER_START_FAILED',
  'SOVEREIGN_COMMANDER_NOT_HEALTHY', 'SOVEREIGN_COMMANDER_REFRESH_RECEIPT_INVALID',
  'SOVEREIGN_COMMANDER_REFRESH_PROOF_INVALID', 'SOVEREIGN_COMMANDER_EXACT_HEAD_PROOF_FAILED',
  'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN', 'SOVEREIGN_GOVERNOR_REFRESH_PROOF_UNPROVEN',
  'GITHUB_MAILBOX_RESTART_FAILED', 'GITHUB_MAILBOX_RESTART_PROOF_INVALID', 'GITHUB_MAILBOX_EXACT_HEAD_PROOF_FAILED',
  'APPROVED_RUNTIME_RESTART_RESPONSE_INVALID', 'APPROVED_RUNTIME_RESTART_PROCESS_TIMEOUT',
  'UI_4173_EXACT_HEAD_PROOF_FAILED', 'VR_ATLAS_BROWSER_PROOF_RESPONSE_INVALID', 'VR_ATLAS_BROWSER_PROOF_BLOCKED',
  'NATURAL_RELOAD_HEAD_READ_FAILED',
]);
const strictHead = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const strictTimestamp = value => typeof value === 'string' && value.length === 24
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function projectPostSyncTargetFailureHistory(value, { expectedSourceHead = '', nowMs } = {}) {
  if (!value || Array.isArray(value) || value.schemaVersion !== POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA
    || !strictHead(value.expectedSourceHead) || (expectedSourceHead && value.expectedSourceHead !== expectedSourceHead)
    || !Number.isFinite(nowMs) || !Array.isArray(value.failures) || value.failures.length > TARGET_ORDER.length) return null;
  const seen = new Set(), failures = [];
  for (const row of value.failures) {
    // Reject the entire ambiguous list; a favorable prefix is not history.
    if (!row || Array.isArray(row) || !TARGET_ORDER.includes(row.targetId) || seen.has(row.targetId)
      || !TARGET_FAILURE_KINDS.has(row.failureKind) || !strictTimestamp(row.observedAtUtc)
      || Date.parse(row.observedAtUtc) > nowMs + 60_000
      || (row.reportedSourceHead !== '' && !strictHead(row.reportedSourceHead))
      || !TARGET_FAILURE_CODES.has(row.blocker)
      || (row.failureKind === 'INVOCATION_FAILED' && (row.blocker !== 'REFRESH_TARGET_INVOCATION_FAILED' || row.reportedSourceHead !== ''))
      || (row.failureKind === 'HANDLER_MISSING' && (row.blocker !== 'REFRESH_TARGET_HANDLER_MISSING' || row.reportedSourceHead !== ''))) return null;
    seen.add(row.targetId);
    failures.push(Object.freeze({ targetId: row.targetId, failureKind: row.failureKind,
      observedAtUtc: row.observedAtUtc, reportedSourceHead: row.reportedSourceHead, blocker: row.blocker }));
  }
  return Object.freeze({ schemaVersion: POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA,
    expectedSourceHead: value.expectedSourceHead,
    failures: Object.freeze(TARGET_ORDER.flatMap(id => failures.filter(row => row.targetId === id))),
    historical: true, diagnosticOnly: true });
}

// One bounded canonical memory for the last refusal of each target. Plans and
// unrelated checkpoints are identity transitions. Only a new exact-head success
// retires its own refusal; replayed/resumed rows never become new observations.
// This memory is never an input to resultPass, resumable results or debt proof.
export function reducePostSyncTargetFailureHistory(previous, {
  expectedSourceHead, observedAtUtc, nowMs, targetId, result, failureKind = '',
} = {}) {
  const retained = projectPostSyncTargetFailureHistory(previous, { expectedSourceHead, nowMs });
  if (!strictHead(expectedSourceHead) || !Number.isFinite(nowMs) || !strictTimestamp(observedAtUtc)
    || Date.parse(observedAtUtc) > nowMs + 60_000 || !TARGET_ORDER.includes(targetId)) return retained;
  // Processing time validates stored evidence; an older incoming observation
  // must not make unrelated stored rows appear future-dated and erase them.
  if (result?.resumed === true
    || Date.parse(retained?.failures.find(row => row.targetId === targetId)?.observedAtUtc) > Date.parse(observedAtUtc)) return retained;
  if ((failureKind === 'RESULT_UNPROVEN' && resultPass(result, expectedSourceHead))
    || (['INVOCATION_FAILED', 'HANDLER_MISSING'].includes(failureKind) && result != null)) return retained;
  const failures = (retained?.failures || []).filter(row => row.targetId !== targetId);
  if (!failureKind && resultPass(result, expectedSourceHead) && strictHead(result?.sourceHead)
    && (result.blocker === undefined || result.blocker === '')) {
    return projectPostSyncTargetFailureHistory({ schemaVersion: POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA,
      expectedSourceHead, failures }, { expectedSourceHead, nowMs });
  }
  if (!TARGET_FAILURE_KINDS.has(failureKind)) return retained;
  const blocker = failureKind === 'HANDLER_MISSING' ? 'REFRESH_TARGET_HANDLER_MISSING'
    : failureKind === 'INVOCATION_FAILED' ? 'REFRESH_TARGET_INVOCATION_FAILED'
      : TARGET_FAILURE_CODES.has(result?.blocker) ? result.blocker : 'REFRESH_TARGET_PROOF_FAILED';
  failures.push({ targetId, failureKind, observedAtUtc,
    reportedSourceHead: failureKind === 'RESULT_UNPROVEN' && strictHead(result?.sourceHead) ? result.sourceHead : '',
    blocker });
  return projectPostSyncTargetFailureHistory({ schemaVersion: POST_SYNC_TARGET_FAILURE_HISTORY_SCHEMA,
    expectedSourceHead, failures }, { expectedSourceHead, nowMs });
}

export async function executePostSyncRefreshPlan({
  beforeHead,
  afterHead,
  changedPaths,
  adapters = {},
  completedResults = [],
  sovereignRelayRefreshRequired = false, governorRefreshRequired = false,
  spatialAdoptionRequired = false,
  onTargetComplete,
} = {}) {
  if (!validHead(beforeHead) || !validHead(afterHead) || beforeHead === afterHead) {
    return Object.freeze({
      ok: false,
      classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
      blocker: 'POST_SYNC_HEADS_INVALID',
      exactHeadProofOk: false,
      results: Object.freeze([]),
    });
  }

  const plan = classifyPostSyncRefresh(changedPaths, { sovereignRelayRefreshRequired, governorRefreshRequired, spatialAdoptionRequired });
  if (!plan.automaticExecutionAllowed) {
    return Object.freeze({
      ok: false,
      classification: plan.classification,
      blocker: plan.classification,
      plan,
      exactHeadProofOk: false,
      results: Object.freeze([]),
    });
  }

  // Check raw multiplicity before filtering out stale or unsuccessful rows.
  // A favorable duplicate must never hide a contradictory stored observation.
  const checkpointEntries = Array.isArray(completedResults) ? completedResults : [];
  const seenCheckpointTargets = new Set();
  for (const entry of checkpointEntries) {
    if (!plan.targetIds.includes(entry?.targetId)) continue;
    if (seenCheckpointTargets.has(entry.targetId)) {
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_COMPLETED_RESULT_AMBIGUOUS:${entry.targetId}`,
        plan,
        exactHeadProofOk: false,
        results: Object.freeze([]),
      });
    }
    seenCheckpointTargets.add(entry.targetId);
  }
  const resumable = new Map(checkpointEntries
    .filter((entry) => plan.targetIds.includes(entry?.targetId)
      && postSyncRefreshTargetResultPass(entry, { targetId: entry.targetId, plan, expectedHead: afterHead }))
    .map((entry) => [entry.targetId, Object.freeze({ ...entry, resumed: true })]));
  const results = [];
  const handlers = {
    [POST_SYNC_REFRESH_TARGETS.UI_4173]: adapters.refreshUi,
    [POST_SYNC_REFRESH_TARGETS.VR_ATLAS_BROWSER_PROOF]: adapters.proveVrAtlas,
    [POST_SYNC_REFRESH_TARGETS.BACKEND_8787]: adapters.restartBackend,
    [POST_SYNC_REFRESH_TARGETS.MISSION_WORKER]: adapters.restartMissionWorker,
    [POST_SYNC_REFRESH_TARGETS.GITHUB_MAILBOX]: adapters.restartGitHubMailbox,
    [POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER]: adapters.refreshSovereignCommander,
    [POST_SYNC_REFRESH_TARGETS.NATURAL_RELOAD]: adapters.confirmNaturalReload,
  };

  const checkpoint = async observation => {
    if (typeof onTargetComplete !== 'function') return null;
    try {
      await onTargetComplete(Object.freeze([...results]), Object.freeze(observation));
      return null;
    } catch {
      // A successful handler followed by a failed status write is a persistence
      // failure, not a new native/target refusal. Preserve the observed result.
      return Object.freeze({ ok: false, classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_CHECKPOINT_PUBLICATION_FAILED:${observation.targetId}`,
        plan, exactHeadProofOk: false, results: Object.freeze(results) });
    }
  };

  for (const targetId of plan.targetIds) {
    if (resumable.has(targetId)) {
      results.push(resumable.get(targetId));
      continue;
    }
    const handler = handlers[targetId];
    if (typeof handler !== 'function') {
      const publicationFailure = await checkpoint({ targetId, failureKind: 'HANDLER_MISSING' });
      if (publicationFailure) return publicationFailure;
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_HANDLER_MISSING:${targetId}`,
        plan,
        exactHeadProofOk: false,
        results: Object.freeze(results),
      });
    }
    let result;
    try {
      result = await handler({ beforeHead, afterHead, targetId, plan });
    } catch (error) {
      const publicationFailure = await checkpoint({ targetId, failureKind: 'INVOCATION_FAILED' });
      if (publicationFailure) return publicationFailure;
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: `REFRESH_EXECUTION_FAILED:${targetId}`,
        error: error?.message || String(error),
        plan,
        exactHeadProofOk: false,
        results: Object.freeze(results),
      });
    }
    // The plan owns identity. Refuse a contradictory adapter response before
    // assigning that identity to the durable row; merely overwriting the ID
    // would manufacture a success that a later execution could resume.
    if (result?.targetId !== undefined && result.targetId !== targetId) {
      result = { ...result, ok: false, exactHeadProofOk: false, freshProcessLoaded: false,
        blocker: result?.blocker || 'REFRESH_TARGET_IDENTITY_UNPROVEN' };
    }
    // Normalize a generic HTTP-only success before publishing its checkpoint or
    // reducing failure history. Such a result cannot clear relay refresh debt.
    if (targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER && plan.sovereignRelayRefreshRequired
      && resultPass(result, afterHead)
      && !projectPostSyncSovereignRelayProof(result.sovereignRelayProof, afterHead)) {
      result = { ...result, ok: false, exactHeadProofOk: false, freshProcessLoaded: false,
        sovereignRelayProof: null, blocker: 'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN' };
    }
    if (targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER && plan.governorRefreshRequired
      && resultPass(result, afterHead) && !projectPostSyncGovernorProof(result.governorProof, afterHead)) {
      result = { ...result, ok: false, exactHeadProofOk: false, freshProcessLoaded: false,
        governorProof: null, blocker: 'SOVEREIGN_GOVERNOR_REFRESH_PROOF_UNPROVEN' };
    }
    const completed = Object.freeze({ ...result, targetId });
    results.push(completed);
    const passed = postSyncRefreshTargetResultPass(completed, { targetId, plan, expectedHead: afterHead });
    const publicationFailure = await checkpoint({ targetId, result: completed, failureKind: passed ? '' : 'RESULT_UNPROVEN' });
    if (publicationFailure) return publicationFailure;
    if (!passed) {
      return Object.freeze({ ok: false, classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: result?.blocker || `REFRESH_PROOF_FAILED:${targetId}`, plan,
        exactHeadProofOk: false, results: Object.freeze(results) });
    }
  }

  if (plan.openClawApprovalRequired) {
    return Object.freeze({
      ok: false,
      classification: POST_SYNC_REFRESH_CLASSIFICATIONS.APPROVAL_REQUIRED_OPENCLAW,
      blocker: 'OPENCLAW_REFRESH_APPROVAL_REQUIRED',
      plan,
      exactHeadProofOk: false,
      safeRefreshesCompleted: true,
      results: Object.freeze(results),
    });
  }

  if (plan.pluginHostActivationRequired) {
    // A service watchdog or a checkout SHA is not a desktop plugin-host
    // handshake. The live runtime supplies no plugin-host verifier yet,
    // therefore fail closed until an independently implemented adapter proves
    // the exact loaded source, manifest and fresh host session.
    let hostProof = null;
    if (typeof adapters.verifySovereignPluginHost === 'function') {
      // The private adapter is not commissioned yet. A future host transport
      // must not strand the original post-sync lock on an unanswered request.
      // This finite read-only deadline adds no retry or native mutation right.
      const abortController = new AbortController();
      let deadlineTimer;
      try {
        hostProof = await Promise.race([
          Promise.resolve().then(() => adapters.verifySovereignPluginHost({
            beforeHead, afterHead, plan, signal: abortController.signal,
          })),
          new Promise(resolve => {
            deadlineTimer = setTimeout(() => {
              abortController.abort();
              resolve(null);
            }, 3_000);
          }),
        ]);
      } catch {
        hostProof = null;
      } finally {
        clearTimeout(deadlineTimer);
      }
    }
    const hostVerified = sovereignPluginHostProofPass(hostProof, afterHead);
    if (!hostVerified) {
      return Object.freeze({
        ok: false,
        classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
        blocker: 'SOVEREIGN_DESKTOP_PLUGIN_HOST_ACTIVATION_UNPROVEN',
        plan,
        exactHeadProofOk: false,
        safeRefreshesCompleted: true,
        pluginHostActivationRequired: true,
        results: Object.freeze(results),
      });
    }
  }

  // All established target gates remain independent and run in their existing
  // order. There is deliberately no Spatial adapter or success predicate here.
  // A future qualified Spatial owner must implement actual adoption before this
  // durable hold can be discharged; a revert or cached target receipt cannot.
  if (plan.spatialAdoptionRequired) {
    return Object.freeze({
      ok: false,
      classification: POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_SPATIAL_ADOPTION_REQUIRED,
      blocker: 'SPATIAL_RESIDENT_ADOPTION_UNPROVEN',
      plan,
      exactHeadProofOk: false,
      safeRefreshesCompleted: true,
      results: Object.freeze(results),
    });
  }

  return Object.freeze({
    ok: true,
    classification: plan.targetIds.length
      ? POST_SYNC_REFRESH_CLASSIFICATIONS.REFRESH_COMPLETE
      : POST_SYNC_REFRESH_CLASSIFICATIONS.NO_RUNTIME_REFRESH_REQUIRED,
    blocker: '',
    plan,
    exactHeadProofOk: true,
    sourceHead: String(afterHead).toLowerCase(),
    results: Object.freeze(results),
    finalVerdict: 'POST_SYNC_RUNTIME_REFRESH_PASS',
  });
}

export function buildPostSyncRefreshProjection(result = {}, { beforeHead = '', afterHead = '' } = {}) {
  const plan = result.plan || {};
  return Object.freeze({
    schemaVersion: POST_SYNC_REFRESH_SCHEMA,
    beforeHead: validHead(beforeHead) ? String(beforeHead).toLowerCase() : '',
    afterHead: validHead(afterHead) ? String(afterHead).toLowerCase() : '',
    classification: result.classification || plan.classification || POST_SYNC_REFRESH_CLASSIFICATIONS.BLOCKED_REFRESH_FAILED,
    blocker: String(result.blocker || ''),
    targetIds: Array.isArray(plan.targetIds) ? [...plan.targetIds] : [],
    changedPathCount: Number(plan.changedPathCount || 0),
    noRuntimePathCount: Number(plan.noRuntimePathCount || 0),
    openClawPathCount: Number(plan.openClawPathCount || 0),
    spatialAdoptionPathCount: Number(plan.spatialAdoptionPathCount || 0),
    spatialAdoptionRequired: plan.spatialAdoptionRequired === true,
    pluginHostActivationRequired: plan.pluginHostActivationRequired === true,
    sovereignRelayRefreshRequired: plan.sovereignRelayRefreshRequired === true,
    governorRefreshRequired: plan.governorRefreshRequired === true,
    unknownPathCount: Number(plan.unknownPathCount || 0),
    unsafePathCount: Number(plan.unsafePathCount || 0),
    exactHeadProofOk: result.exactHeadProofOk === true,
    safeRefreshesCompleted: result.safeRefreshesCompleted === true,
    resultTargets: Array.isArray(result.results) ? result.results.map((entry) => {
      const governorProof = projectPostSyncGovernorProof(entry.governorProof, afterHead);
      const governorRequired = entry.targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER && plan.governorRefreshRequired === true;
      const relayProof = projectPostSyncSovereignRelayProof(entry.sovereignRelayProof, afterHead);
      const relayObservation = projectPostSyncSovereignRelayObservation(entry.sovereignRelayObservation, afterHead);
      const required = entry.targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER && plan.sovereignRelayRefreshRequired === true;
      const planned = Array.isArray(plan.targetIds) && plan.targetIds.includes(entry.targetId);
      const qualified = planned && postSyncRefreshTargetResultPass(entry, { targetId: entry.targetId, plan, expectedHead: afterHead });
      const missingRelayProof = required && resultPass(entry, afterHead) && !relayProof;
      return {
        targetId: entry.targetId,
        ok: entry.ok === true && qualified,
        exactHeadProofOk: entry.exactHeadProofOk === true && qualified,
        sourceHead: validHead(entry.sourceHead) ? String(entry.sourceHead).toLowerCase() : '',
        blocker: String(entry.blocker || (qualified ? '' : missingRelayProof
          ? 'SOVEREIGN_RELAY_REFRESH_PROOF_UNPROVEN' : governorRequired && !governorProof
            ? 'SOVEREIGN_GOVERNOR_REFRESH_PROOF_UNPROVEN' : 'REFRESH_TARGET_PROOF_FAILED')),
        ...(governorProof ? { governorProof } : {}),
        ...(relayProof ? { sovereignRelayProof: relayProof } : {}),
        ...(relayObservation ? { sovereignRelayObservation: relayObservation } : {}),
      };
    }) : [],
    arbitraryShellAllowed: false,
    arbitraryPowerShellAllowed: false,
    destructiveGitAllowed: false,
    unrelatedTaskMutationAllowed: false,
    liveOpenClawUpdateAllowed: false,
    pathValuesPublished: false,
    finalVerdict: result.ok === true ? 'POST_SYNC_RUNTIME_REFRESH_PASS' : 'POST_SYNC_RUNTIME_REFRESH_BLOCKED',
  });
}


// Startup may waive one optional hold; a displayed blocker is not a complete
// account of the canonical owner's remaining source-adoption obligations.
export const IGNITION_REFRESH_OBLIGATION_SCHEMA_V1 = 'stephanos.ignition-refresh-obligations.v1';
export const IGNITION_SETTLED_REFRESH_SCHEMA_V1 = 'stephanos.ignition-settled-refresh.v1';
const IGNITION_REFRESH_COUNTS = Object.freeze(['changedPathCount', 'noRuntimePathCount', 'unknownPathCount',
  'unsafePathCount', 'openClawPathCount', 'spatialAdoptionPathCount']);
const IGNITION_REFRESH_REQUIREMENTS = Object.freeze(['spatialAdoptionRequired', 'pluginHostActivationRequired',
  'sovereignRelayRefreshRequired', 'governorRefreshRequired']);
const IGNITION_COMPLETION_KEYS = Object.freeze(['schemaVersion', 'kind', 'statusId', 'phase', 'beforeHead', 'afterHead',
  'classification', 'finalVerdict', 'exactHeadProofOk', 'blocker', 'targetIds', 'resultTargets',
  ...IGNITION_REFRESH_COUNTS, ...IGNITION_REFRESH_REQUIREMENTS]);

function ignitionOwnData(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || nodeTypes.isProxy(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 128 || keys.some(key => typeof key !== 'string')) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string'
      || !Object.hasOwn(descriptors[key], 'value'))) return null;
    const data = Object.create(null);
    // Normalize every own data field to enumerable, including hidden future
    // authority fields. No inherited value or getter can fill a missing field.
    for (const [key, row] of Object.entries(descriptors)) data[key] = row.value;
    return data;
  } catch { return null; }
}
// Snapshot only the evidence consumed by startup proof admission. Legacy policy
// validators below receive this inert graph; no caller method, iterator, getter,
// proxy or nested reference crosses the boundary. This is not a repository-wide
// claim about every historical projection or executor.
export function projectIgnitionInertEvidenceV1(value, fields = []) {
  try {
    const selected = ignitionArray(fields);
    if (!selected || selected.length > 4 || selected.some(key => typeof key !== 'string')) return null;
    let input = value;
    for (const key of selected) {
      const row = ignitionOwnData(input);
      if (!row || !Object.hasOwn(row, key)) return null;
      input = row[key];
    }
    let nodes = 0, bytes = 0;
    const active = new Set();
    const account = value => { bytes += Buffer.byteLength(value, 'utf8'); if (bytes > 128 * 1024) throw Error('bounded'); };
    function copy(item, depth) {
      if (++nodes > 4096 || depth > 16) throw Error('bounded');
      if (item === null || typeof item === 'boolean') return item;
      if (typeof item === 'number') { if (!Number.isFinite(item)) throw Error('finite'); return item; }
      if (typeof item === 'string') { account(item); return item; }
      if (!item || typeof item !== 'object' || nodeTypes.isProxy(item) || active.has(item)) throw Error('inert');
      active.add(item);
      let result;
      if (Array.isArray(item)) {
        const rows = ignitionArray(item);
        if (!rows || rows.length > 256) throw Error('array');
        result = [];
        for (let index = 0; index < rows.length; index++) Object.defineProperty(result, index,
          { value: copy(rows[index], depth + 1), enumerable: true, writable: false, configurable: false });
      } else {
        const row = ignitionOwnData(item);
        if (!row || Object.keys(row).length > 128) throw Error('record');
        result = Object.create(null);
        for (const key of Object.keys(row)) { account(key); Object.defineProperty(result, key,
          { value: copy(row[key], depth + 1), enumerable: true, writable: false, configurable: false }); }
      }
      active.delete(item);
      return Object.freeze(result);
    }
    return copy(input, 0);
  } catch { return null; }
}

// Outer execution/stdout payloads are not proof inputs. Select the closed frame
// first using own descriptors, then snapshot every consumed nested field.
export function projectIgnitionPreflightResultV1(value) {
  try {
    const row = ignitionOwnData(value);
    if (!row) return null;
    const frame = Object.create(null);
    for (const key of ['ok', 'sourceHead', 'syncClassification', 'syncBlockerReason', 'blocker', 'finalVerdict',
      'pendingRefreshObserved', 'sourceForwardedBeforeRefresh', 'refreshDebtCoalesced', 'controlPlaneRepairObserved',
      'settledRefreshEvidence']) if (Object.hasOwn(row, key)) frame[key] = row[key];
    for (const key of ['sourceHead', 'syncClassification', 'syncBlockerReason', 'blocker', 'finalVerdict'])
      if (Object.hasOwn(frame, key) && typeof frame[key] !== 'string') return null;
    for (const key of ['ok', 'pendingRefreshObserved', 'sourceForwardedBeforeRefresh', 'refreshDebtCoalesced', 'controlPlaneRepairObserved'])
      if (Object.hasOwn(frame, key) && typeof frame[key] !== 'boolean') return null;
    if (Object.hasOwn(row, 'controlPlaneRepair')) {
      const control = ignitionOwnData(row.controlPlaneRepair);
      if (!control) return null;
      frame.controlPlaneRepair = Object.create(null);
      for (const key of ['ok', 'classification', 'repairAttempted', 'sourceHead'])
        if (Object.hasOwn(control, key)) frame.controlPlaneRepair[key] = control[key];
      for (const key of ['ok', 'repairAttempted'])
        if (Object.hasOwn(frame.controlPlaneRepair, key) && typeof frame.controlPlaneRepair[key] !== 'boolean') return null;
      for (const key of ['classification', 'sourceHead'])
        if (Object.hasOwn(frame.controlPlaneRepair, key) && typeof frame.controlPlaneRepair[key] !== 'string') return null;
    }
    if (Object.hasOwn(row, 'refreshes')) {
      const refreshes = ignitionArray(row.refreshes);
      if (!refreshes || refreshes.length > 256) return null;
      frame.refreshes = [];
      for (let index = 0; index < refreshes.length; index++) {
        const refresh = ignitionOwnData(refreshes[index]);
        if (!refresh) return null;
        Object.defineProperty(frame.refreshes, index,
          { value: Object.hasOwn(refresh, 'result') ? { result: refresh.result } : {}, enumerable: true });
      }
    }
    return projectIgnitionInertEvidenceV1(frame);
  } catch { return null; }
}

// Keep transport diagnostics outside the authority graph. Only these existing
// child-result fields participate in startup/debt admission.
export function projectIgnitionOwnerResultV1(value, kind = 'refresh') {
  try {
    if (!['sync', 'refresh'].includes(kind)) return null;
    const row = ignitionOwnData(value);
    if (!row) return null;
    const frame = Object.create(null);
    for (const key of ['ok', 'blocker', 'result']) if (Object.hasOwn(row, key)) frame[key] = row[key];
    if ((Object.hasOwn(frame, 'ok') && typeof frame.ok !== 'boolean')
      || (Object.hasOwn(frame, 'blocker') && typeof frame.blocker !== 'string')) return null;
    if (kind === 'sync' && Object.hasOwn(row, 'result')) {
      const result = ignitionOwnData(row.result);
      if (!result) return null;
      const selected = Object.create(null);
      // Unknown root keys must still defeat the exact non-owner busy refusal.
      // Their unused payloads, including fetch/merge stdout, are not authority.
      for (const key of Object.keys(result)) selected[key] = null;
      for (const key of ['ok', 'sourceUpdated', 'publication']) if (Object.hasOwn(result, key)) selected[key] = result[key];
      for (const key of ['ok', 'sourceUpdated'])
        if (Object.hasOwn(selected, key) && typeof selected[key] !== 'boolean') return null;
      if (Object.hasOwn(selected, 'publication') && selected.publication !== null && selected.publication !== undefined)
        selected.publication = false;
      for (const [key, fields] of [['evaluation', ['classification', 'exactNextAction', 'performsGitMutation', 'performsShellExecution']],
        ['facts', ['localHeadBefore', 'localHeadAfter', 'localHead', 'remoteHead', 'pendingRefresh']],
        ['receipt', ['statusRecord']], ['lock', ['ok', 'reason']]]) {
        if (!Object.hasOwn(result, key)) continue;
        const source = ignitionOwnData(result[key]);
        if (!source) return null;
        const target = Object.create(null);
        for (const field of fields) if (Object.hasOwn(source, field)) target[field] = source[field];
        selected[key] = target;
      }
      for (const key of ['classification', 'exactNextAction'])
        if (selected.evaluation && Object.hasOwn(selected.evaluation, key) && typeof selected.evaluation[key] !== 'string') return null;
      for (const key of ['performsGitMutation', 'performsShellExecution'])
        if (selected.evaluation && Object.hasOwn(selected.evaluation, key) && typeof selected.evaluation[key] !== 'boolean') return null;
      for (const key of ['localHeadBefore', 'localHeadAfter', 'localHead', 'remoteHead'])
        if (selected.facts && Object.hasOwn(selected.facts, key) && typeof selected.facts[key] !== 'string') return null;
      if (selected.lock && ((Object.hasOwn(selected.lock, 'ok') && typeof selected.lock.ok !== 'boolean')
        || (Object.hasOwn(selected.lock, 'reason') && typeof selected.lock.reason !== 'string'))) return null;
      frame.result = selected;
    }
    if (Object.hasOwn(row, 'execution')) {
      const execution = ignitionOwnData(row.execution);
      if (!execution) return null;
      frame.execution = Object.create(null);
      for (const key of ['status', 'errorCode']) if (Object.hasOwn(execution, key)) frame.execution[key] = execution[key];
      if ((Object.hasOwn(frame.execution, 'status') && frame.execution.status !== null && !Number.isSafeInteger(frame.execution.status))
        || (Object.hasOwn(frame.execution, 'errorCode') && typeof frame.execution.errorCode !== 'string')) return null;
    }
    return projectIgnitionInertEvidenceV1(frame);
  } catch { return null; }
}

function ignitionArray(value) {
  try {
    if (!Array.isArray(value) || nodeTypes.isProxy(value)) return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value)
      || length.value < 0 || length.value > 256) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length.value + 1) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(descriptors).length !== value.length + 1) return null;
    const data = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(descriptors, index)) return null;
      const descriptor = descriptors[index];
      if (!Object.hasOwn(descriptor, 'value')) return null;
      Object.defineProperty(data, index, { value: descriptor.value, enumerable: true, writable: true, configurable: true });
    }
    return data;
  } catch { return null; }
}

export function projectPostSyncRemainingIgnitionObligationsV1(value, expectedHead) {
  const record = projectIgnitionInertEvidenceV1(value);
  if (!record || typeof expectedHead !== 'string' || !/^[a-f0-9]{40}$/.test(expectedHead)
    || ![POST_SYNC_REFRESH_SCHEMA, 'shared-agent-workspace-record.v1'].includes(record.schemaVersion)
    || (record.schemaVersion === 'shared-agent-workspace-record.v1'
      && (record.kind !== 'stephanos.shared_workspace.status' || record.statusId !== 'post-sync-runtime-refresh-current'))
    || record.afterHead !== expectedHead || typeof record.beforeHead !== 'string' || !/^[a-f0-9]{40}$/.test(record.beforeHead)
    || record.beforeHead === record.afterHead
    || !Object.values(POST_SYNC_REFRESH_CLASSIFICATIONS).includes(record.classification)
    || typeof record.exactHeadProofOk !== 'boolean' || typeof record.blocker !== 'string'
    || !['POST_SYNC_RUNTIME_REFRESH_PASS', 'POST_SYNC_RUNTIME_REFRESH_BLOCKED'].includes(record.finalVerdict)
    || (record.finalVerdict === 'POST_SYNC_RUNTIME_REFRESH_PASS') !== record.exactHeadProofOk
    || (Object.hasOwn(record, 'ok') && (typeof record.ok !== 'boolean'
      || record.ok !== (record.finalVerdict === 'POST_SYNC_RUNTIME_REFRESH_PASS')))
    || IGNITION_REFRESH_REQUIREMENTS.some(key => typeof record[key] !== 'boolean')
    || Object.keys(record).some(key => key.endsWith('Required') && !IGNITION_REFRESH_REQUIREMENTS.includes(key))
    || Object.keys(record).some(key => key.endsWith('PathCount') && !IGNITION_REFRESH_COUNTS.includes(key))
    || IGNITION_REFRESH_COUNTS.some(key => !Number.isSafeInteger(record[key]) || record[key] < 0
      || (key !== 'changedPathCount' && record[key] > record.changedPathCount))
    || record.spatialAdoptionPathCount > 2 || (record.spatialAdoptionPathCount > 0 && !record.spatialAdoptionRequired)) return null;
  const targets = ignitionArray(record.targetIds), rawResults = ignitionArray(record.resultTargets);
  if (!targets || !rawResults || targets.length > TARGET_ORDER.length || rawResults.length > targets.length
    || new Set(targets).size !== targets.length || targets.some((id, index) => !TARGET_ORDER.includes(id)
      || (index > 0 && TARGET_ORDER.indexOf(targets[index - 1]) >= TARGET_ORDER.indexOf(id)))
    || ((record.governorRefreshRequired || record.sovereignRelayRefreshRequired)
      && !targets.includes(POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER))) return null;
  const results = rawResults.map(ignitionOwnData);
  if (results.some((row, index) => !row || row.targetId !== targets[index]
    || typeof row.ok !== 'boolean' || typeof row.exactHeadProofOk !== 'boolean'
    || typeof row.blocker !== 'string' || typeof row.sourceHead !== 'string'
    || (row.sourceHead !== '' && !/^[a-f0-9]{40}$/.test(row.sourceHead)))) return null;
  for (const row of results) {
    if (Object.hasOwn(row, 'governorProof') && (row.targetId !== POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER
      || !projectPostSyncGovernorProof(row.governorProof, expectedHead))) return null;
    if (Object.hasOwn(row, 'sovereignRelayProof') && (row.targetId !== POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER
      || nodeTypes.isProxy(row.sovereignRelayProof || {})
      || !projectPostSyncSovereignRelayProof(row.sovereignRelayProof, expectedHead))) return null;
  }
  const remaining = [];
  const pass = row => row?.ok === true && row.exactHeadProofOk === true && row.sourceHead === expectedHead && row.blocker === '';
  for (let index = 0; index < targets.length; index++) if (!pass(results[index])) remaining.push('target:' + targets[index]);
  const commander = results.find(row => row.targetId === POST_SYNC_REFRESH_TARGETS.SOVEREIGN_COMMANDER);
  if (record.governorRefreshRequired && (!pass(commander)
    || !projectPostSyncGovernorProof(commander.governorProof, expectedHead))) remaining.push('governor');
  if (record.sovereignRelayRefreshRequired && (!pass(commander)
    || nodeTypes.isProxy(commander.sovereignRelayProof || {})
    || !projectPostSyncSovereignRelayProof(commander.sovereignRelayProof, expectedHead))) remaining.push('sovereign-relay');
  if (record.spatialAdoptionRequired) remaining.push('spatial-resident');
  if (record.pluginHostActivationRequired) remaining.push('desktop-plugin-host');
  if (record.openClawPathCount) remaining.push('openclaw-approval');
  if (record.unknownPathCount) remaining.push('unclassified-path');
  if (record.unsafePathCount) remaining.push('unsafe-path');
  return Object.freeze({ schemaVersion: IGNITION_REFRESH_OBLIGATION_SCHEMA_V1, sourceHead: expectedHead,
    remaining: Object.freeze(remaining) });
}

// The wrapper supplies actual published canonical records and the bounded
// ancestry observations from its existing Git adapter. Replaying this contract
// grants no native, source, process, custody or refresh execution authority.
export function projectIgnitionSettledRefreshEvidenceV1(value, expectedHead) {
  const witness = projectIgnitionInertEvidenceV1(value);
  if (!witness || Object.keys(witness).sort().join(',') !== 'ancestry,refreshCompletionRecord,schemaVersion,sourceHead,syncStatusRecord'
    || witness.schemaVersion !== IGNITION_SETTLED_REFRESH_SCHEMA_V1 || witness.sourceHead !== expectedHead) return null;
  const sync = ignitionOwnData(witness.syncStatusRecord), refresh = ignitionOwnData(witness.refreshCompletionRecord);
  const ancestry = ignitionArray(witness.ancestry);
  if (!sync || !refresh || !ancestry || ancestry.length > 64
    || sync.schemaVersion !== 'shared-agent-workspace-record.v1' || sync.kind !== 'stephanos.shared_workspace.status'
    || sync.statusId !== 'battle-bridge-github-sync-current' || sync.classification !== 'SYNC_NO_CHANGE'
    || sync.localHeadBefore !== expectedHead || sync.remoteHeadObserved !== expectedHead || sync.pendingRefresh !== null
    || refresh.schemaVersion !== 'shared-agent-workspace-record.v1' || refresh.kind !== 'stephanos.shared_workspace.status'
    || refresh.statusId !== 'post-sync-runtime-refresh-current' || refresh.afterHead !== expectedHead) return null;
  const map = new Map(), rows = [];
  for (const input of ancestry) {
    const row = ignitionOwnData(input);
    if (!row || Object.keys(row).sort().join(',') !== 'afterHead,ancestor,beforeHead'
      || typeof row.beforeHead !== 'string' || typeof row.afterHead !== 'string'
      || !/^[a-f0-9]{40}$/.test(row.beforeHead) || !/^[a-f0-9]{40}$/.test(row.afterHead)
      || typeof row.ancestor !== 'boolean' || map.has(row.beforeHead + ':' + row.afterHead)) return null;
    map.set(row.beforeHead + ':' + row.afterHead, row.ancestor); rows.push(Object.freeze(row));
  }
  const obligations = projectPostSyncRemainingIgnitionObligationsV1(refresh, expectedHead);
  if (!obligations || obligations.remaining.length) return null;
  const completion = inspectPostSyncRefreshCompletion(refresh);
  const evidence = collectPostSyncRefreshDebt({ syncRecord: sync, refreshRecord: refresh });
  if (!completion.ok || !evidence.ok) return null;
  const resolved = resolvePostSyncRefreshDebt({ ...evidence, currentHead: expectedHead, requireCurrentCoverage: true,
    isAncestor(beforeHead, afterHead) {
      const key = beforeHead + ':' + afterHead;
      return map.has(key) ? { ok: true, ancestor: map.get(key) } : { ok: false, ancestor: false };
    } });
  if (!resolved.ok || resolved.debt !== null) return null;
  const resultTargets = refresh.resultTargets.map(input => {
    const row = ignitionOwnData(input);
    const governorProof = projectPostSyncGovernorProof(row.governorProof, expectedHead);
    const sovereignRelayProof = projectPostSyncSovereignRelayProof(row.sovereignRelayProof, expectedHead);
    return Object.freeze({ targetId: row.targetId, ok: row.ok, exactHeadProofOk: row.exactHeadProofOk,
      sourceHead: row.sourceHead, blocker: row.blocker, ...(governorProof ? { governorProof } : {}),
      ...(sovereignRelayProof ? { sovereignRelayProof } : {}) });
  });
  return projectIgnitionInertEvidenceV1({ schemaVersion: IGNITION_SETTLED_REFRESH_SCHEMA_V1, sourceHead: expectedHead,
    syncStatusRecord: Object.freeze(Object.fromEntries(['schemaVersion', 'kind', 'statusId', 'classification',
      'localHeadBefore', 'remoteHeadObserved', 'pendingRefresh'].map(key => [key, sync[key]]))),
    refreshCompletionRecord: Object.freeze({ ...Object.fromEntries(IGNITION_COMPLETION_KEYS.map(key => [key, refresh[key]])), resultTargets }),
    ancestry: Object.freeze(rows) });
}
