// Diagnostic vocabulary from the canonical source collector and its existing
// topology/configuration/runtime-directory checks. No source or custody proof.
import { projectBattleBridgeGitConfigurationDiagnosticV1 } from './battleBridgeGitConfigurationDiagnosticV1.mjs';
const sourceCodes = new Set([
  'CANONICAL_GIT_PROBE_DIRECTORY_UNPROVEN', 'CANONICAL_GIT_PROBE_FILE_UNPROVEN',
  'CANONICAL_GIT_PROBE_FILE_CHANGED', 'CANONICAL_GIT_PROBE_CONTEXT_CHANGED',
  'CANONICAL_GIT_PROBE_CONTEXT_CLOSED', 'CANONICAL_GIT_PROBE_ORIGINAL_CHANGED',
  'CANONICAL_GIT_PROBE_HEAD_UNSUPPORTED', 'CANONICAL_GIT_PROBE_INDEX_UNSUPPORTED',
  'CANONICAL_GIT_PROBE_INDEX_TIMESTAMP_UNPROVEN', 'CANONICAL_GIT_PROBE_CLEANUP_UNPROVEN',
  'CANONICAL_GIT_PROBE_CONTEXT_UNPROVEN', 'CANONICAL_GIT_PROBE_CONFIGURATION_NOT_EMPTY',
  'CANONICAL_GIT_PROBE_SUBMODULE_UNSUPPORTED',
  'CANONICAL_CHECKOUT_DIRTY', 'CANONICAL_GIT_CONFIGURATION_CHANGED', 'CANONICAL_GIT_CONFIGURATION_INVALID',
  'CANONICAL_GIT_METADATA_SCAN_FAILED', 'CANONICAL_GIT_METADATA_SCAN_LIMIT_EXCEEDED',
  'CANONICAL_GIT_REPARSE_POINT_PRESENT', 'CANONICAL_GIT_TOPOLOGY_CHANGED', 'CANONICAL_GIT_TOPOLOGY_INVALID',
  'CANONICAL_GIT_TOPOLOGY_UNPROVEN', 'CANONICAL_MAIN_NOT_CURRENT', 'CANONICAL_MAIN_SOURCE_UNPROVEN',
  'CANONICAL_REMOTE_TRUTH_INVALID', 'CANONICAL_SOURCE_STATUS_INVALID', 'CANONICAL_SOURCE_TRUTH_CHANGED',
  'CANONICAL_SOURCE_TRUTH_UNPROVEN', 'CANONICAL_TRACKED_VISIBILITY_CHANGED', 'CANONICAL_UPSTREAM_UNPROVEN',
  'FIXED_AUTHORITY_GIT_FAILED', 'GIT_COMMON_DIRECTORY_REDIRECT_PRESENT', 'GIT_GRAFTS_PRESENT',
  'GIT_OBJECT_ALTERNATES_PRESENT', 'HIDDEN_TRACKED_PATHS_PRESENT', 'IGNITION_RUNTIME_AGGREGATE_SCAN_FAILED',
]);
const sourceSteps = new Set([
  'source-config-before-fetch', 'source-tracked-visibility-before-fetch', 'source-status-before-fetch',
  'source-branch-before-fetch', 'source-upstream-before-fetch', 'source-head-before-fetch',
  'source-fetch', 'source-origin-head', 'source-divergence', 'source-status-after-fetch',
  'source-config-after-fetch', 'source-branch-after-fetch', 'source-upstream-after-fetch',
  'source-head-after-fetch', 'source-origin-head-after-fetch', 'source-tracked-visibility-after-fetch',
  'source-status-final', 'source-tracked-visibility-final', 'source-heads-final',
  'source-isolated-config-before-fetch', 'source-isolated-config-after-fetch',
]);

export function projectMaintenanceSourceDiagnosticV1(code, step, configuration) {
  const sourceCode = typeof code === 'string' && sourceCodes.has(code) ? code : 'UNKNOWN';
  return Object.freeze({ sourceCode,
    ...(sourceCode === 'FIXED_AUTHORITY_GIT_FAILED' ? {
      sourceStep: typeof step === 'string' && sourceSteps.has(step) ? step : 'UNKNOWN',
    } : {}),
    ...(['CANONICAL_GIT_CONFIGURATION_INVALID', 'CANONICAL_GIT_CONFIGURATION_CHANGED'].includes(sourceCode) ? {
      sourceConfiguration: projectBattleBridgeGitConfigurationDiagnosticV1(configuration),
    } : {}),
  });
}
