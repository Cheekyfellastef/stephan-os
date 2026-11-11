// Installation/code custody only. This profile never enrolls a specialist,
// supplies a signing key, or turns a local candidate into an independent review.
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_INSTALLED_REVIEWER_HOST_V1 = 'C:\\Program Files\\Stephanos\\SovereignReviewerV1\\host.exe';
export const SOVEREIGN_REVIEWER_DATA_ROOT_V1 = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
export const SOVEREIGN_REVIEWER_WORKSPACE_V1 = 'C:\\Users\\Stephan Callear\\Documents\\Stephanos-openclaw-workspace';
export const SOVEREIGN_REVIEWER_PROFILE_FILES_V1 = Object.freeze([
  'scripts/sovereign-installed-reviewer-v1.mjs',
  'scripts/sovereign-installed-reviewer-loader-v1.mjs',
  'scripts/build-sovereign-reviewer-installation-v1.mjs',
  'scripts/sovereign-high-risk-advisory-v1.mjs',
  'scripts/battle-bridge-github-sync-policy.mjs',
  'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
  'scripts/sovereign-review-coverage-v1-engine.mjs',
  'shared/agents/sovereignInstalledReviewerProfileV1.mjs',
  'shared/agents/sovereignWindowsCalibrationV1.mjs',
  'shared/agents/sovereignReviewerOllamaBindingV1.mjs',
  'shared/agents/sovereignWindowsCalibrationRemoteV1.mjs',
  'shared/agents/battleBridgeExecutionBoundaryV1.mjs',
  'shared/agents/battleBridgeWindowsHosts.mjs',
  'shared/agents/sovereignHighRiskReviewCandidateV1.mjs',
  'shared/agents/sovereignReviewCoverageV1.mjs',
  'shared/agents/sovereignAuthenticatedReviewDiffV1.mjs',
  'shared/agents/sharedAgentWorkspaceStore.mjs',
  'shared/agents/closedLoopLearningV1.mjs',
  'shared/agents/sharedWorkspaceRuntimeConfig.mjs',
  'shared/agents/sharedAgentWorkspace.mjs',
  'shared/agents/engineeringIncidentMethodMemoryV1.mjs',
  'scripts/windows/SovereignCoreJobCustodyV1.cs',
  'scripts/windows/SovereignReviewerProfileV1.cs',
  'scripts/windows/SovereignReviewerHostV1.cs',
  'scripts/windows/install-sovereign-reviewer-profile-v1.ps1',
]);

const keys = Object.freeze([
  'STEPHANOS_REVIEW_EXACT_HEAD', 'STEPHANOS_REVIEW_EXACT_BASE',
  'STEPHANOS_REVIEW_EXACT_BRANCH', 'STEPHANOS_REVIEW_REPOSITORY',
  'STEPHANOS_REVIEW_ISSUE', 'STEPHANOS_REVIEW_PR',
  'STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER', 'STEPHANOS_REVIEW_IMPLEMENTER_SESSION',
  'STEPHANOS_REVIEW_SESSION', 'STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL',
  'STEPHANOS_REVIEW_REVIEWER_PRINCIPAL', 'STEPHANOS_SOVEREIGN_REVIEW_MODEL',
]);
const id = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
export function installedReviewerRequestEnvironmentV1(input = {}) {
  const env = Object.fromEntries(keys.map(k => [k, typeof input[k] === 'string' ? input[k] : '']));
  const head = env.STEPHANOS_REVIEW_EXACT_HEAD, base = env.STEPHANOS_REVIEW_EXACT_BASE;
  const branch = env.STEPHANOS_REVIEW_EXACT_BRANCH;
  if (!/^[a-f0-9]{40}$/.test(head) || !/^[a-f0-9]{40}$/.test(base) || head === base
    || !/^[a-z0-9][a-z0-9._/-]{0,159}$/i.test(branch) || branch.includes('..')
    || branch.includes('//') || branch.endsWith('/') || branch.startsWith('refs/')
    || env.STEPHANOS_REVIEW_REPOSITORY !== 'Cheekyfellastef/stephan-os'
    || !['STEPHANOS_REVIEW_ISSUE', 'STEPHANOS_REVIEW_PR'].every(k => /^[1-9][0-9]{0,8}$/.test(env[k]))
    || !keys.slice(6,11).every(k => id.test(env[k]))
    || env.STEPHANOS_REVIEW_SESSION === env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION
    || env.STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL === env.STEPHANOS_REVIEW_REVIEWER_PRINCIPAL)
    throw Error('INSTALLED_REVIEWER_REQUEST_INVALID');
  env.STEPHANOS_SOVEREIGN_REVIEW_MODEL ||= 'qwen:14b';
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL))
    throw Error('INSTALLED_REVIEWER_REQUEST_INVALID');
  return Object.freeze(env);
}

export function buildInstalledReviewerLaunchPlanV1({env=process.env, platform=process.platform,
  entryPoint='advisory'}={}) {
  if (platform !== 'win32') throw Error('INSTALLED_REVIEWER_NATIVE_PROFILE_REQUIRED');
  if (!['advisory','windows-calibration','windows-calibration-remote','coverage'].includes(entryPoint))
    throw Error('INSTALLED_REVIEWER_FIXED_ENTRY_REQUIRED');
  const request=installedReviewerRequestEnvironmentV1(env);
  return Object.freeze({executable:SOVEREIGN_INSTALLED_REVIEWER_HOST_V1,
    args:Object.freeze(['--'+entryPoint]), root:SOVEREIGN_REVIEWER_DATA_ROOT_V1,
    env:Object.freeze({...createBattleBridgeMinimalChildEnvironment({}, {platform:'win32'}),
      SystemRoot:'C:\\Windows', WINDIR:'C:\\Windows', ...request})});
}
