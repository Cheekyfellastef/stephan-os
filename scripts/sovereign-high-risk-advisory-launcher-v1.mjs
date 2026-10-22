#!/usr/bin/env node
// Installed-parent entry, not candidate implementation. This launcher, its
// loader/Git boundary and OS binaries need independently protected installation.
// Arbitrary writable copies cannot certify that external trust precondition.
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { sovereignExactCommitLoaderV1 } from '../shared/agents/sovereignExactCommitLoaderV1.mjs';
import { resolveBattleBridgeGitExecution, createBattleBridgeMinimalChildEnvironment }
  from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const HIGH_RISK_ADVISORY_EXECUTION_FILES = Object.freeze([
  'scripts/sovereign-high-risk-advisory-v1.mjs',
  'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
  'scripts/sovereign-review-coverage-v1-engine.mjs',
  'shared/agents/sovereignWindowsCalibrationV1.mjs',
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
]);

const ENTRIES = Object.freeze({
  advisory: Object.freeze({file:'scripts/sovereign-high-risk-advisory-v1.mjs',
    method:'runSovereignHighRiskAdvisoryV1', prefix:'SOVEREIGN_HIGH_RISK_ADVISORY_RESULT',
    held:'SOVEREIGN_HIGH_RISK_REVIEW_HELD'}),
  'windows-calibration': Object.freeze({file:'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
    method:'runWindowsCalibrationCandidateV1', prefix:'SOVEREIGN_WINDOWS_CALIBRATION_RESULT',
    held:'WINDOWS_CALIBRATION_HELD'}),
  'windows-calibration-remote': Object.freeze({file:'scripts/sovereign-windows-review-calibration-v1-engine.mjs',
    method:'runWindowsCalibrationCandidateV1', prefix:'SOVEREIGN_WINDOWS_CALIBRATION_REMOTE_RESULT',
    held:'WINDOWS_CALIBRATION_HELD', remote:true}),
  coverage: Object.freeze({file:'scripts/sovereign-review-coverage-v1-engine.mjs',
    method:'runSovereignReviewCoverageV1', prefix:'SOVEREIGN_REVIEW_COVERAGE_RESULT',
    held:'REVIEW_COVERAGE_HELD'}),
});

export function buildHighRiskAdvisoryLaunchPlanV1({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  env = process.env, platform = process.platform,
  gitExecution = resolveBattleBridgeGitExecution({ platform }),
  entryPoint = 'advisory',
} = {}) {
  if (!Object.hasOwn(ENTRIES, entryPoint)) throw Error('FIXED_REVIEW_ENTRY_REQUIRED');
  const route = ENTRIES[entryPoint];
  const head = env.STEPHANOS_REVIEW_EXACT_HEAD;
  const base = env.STEPHANOS_REVIEW_EXACT_BASE;
  if (!/^[a-f0-9]{40}$/.test(head ?? '') || !/^[a-f0-9]{40}$/.test(base ?? '') || base === head)
    throw Error('HIGH_RISK_TRUSTED_LAUNCH_EXACT_PAIR_REQUIRED');
  const loader = sovereignExactCommitLoaderV1({ root, head, files: HIGH_RISK_ADVISORY_EXECUTION_FILES, git: gitExecution });
  const childEnv = { ...createBattleBridgeMinimalChildEnvironment(env, { platform }) };
  for (const key of ['STEPHANOS_REVIEW_EXACT_HEAD','STEPHANOS_REVIEW_EXACT_BASE',
    'STEPHANOS_REVIEW_EXACT_BRANCH','STEPHANOS_REVIEW_PR','STEPHANOS_REVIEW_ISSUE',
    'STEPHANOS_REVIEW_REPOSITORY','STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER',
    'STEPHANOS_REVIEW_IMPLEMENTER_SESSION','STEPHANOS_REVIEW_SESSION',
    'STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL','STEPHANOS_REVIEW_REVIEWER_PRINCIPAL',
    'STEPHANOS_SOVEREIGN_REVIEW_MODEL','STEPHANOS_SHARED_AGENT_WORKSPACE'])
    if (typeof env[key] === 'string') childEnv[key] = env[key];
  const entry = pathToFileURL(resolve(root, route.file)).href;
  const projection = pathToFileURL(resolve(root,'shared/agents/sovereignWindowsCalibrationRemoteV1.mjs')).href;
  const invoke = `const m=await import(${JSON.stringify(entry)});let r=await m.${route.method}();`
    + (route.remote ? `r=(await import(${JSON.stringify(projection)})).projectWindowsCalibrationForRemoteV1(r);` : '')
    + `process.stdout.write(${JSON.stringify(route.prefix+'=')}+JSON.stringify(r)+'\\n');`
    + `if(r.status===${JSON.stringify(route.held)}${entryPoint==='advisory'?'||!r.publicationOk':''})process.exitCode=1;`;
  return Object.freeze({ executable: process.execPath,
    args: Object.freeze(['--experimental-loader', loader, '--input-type=module', '--eval', invoke]),
    env: Object.freeze(childEnv), root });
}

export function runFixedSovereignReviewEntryV1(entryPoint, options = {}) {
  const route = Object.hasOwn(ENTRIES, entryPoint) ? ENTRIES[entryPoint] : null;
  const held = () => Object.freeze({ status:route?.held || 'SOVEREIGN_HIGH_RISK_REVIEW_HELD',
    reason:'TRUSTED_PREEXECUTION_CUSTODY_UNPROVEN', mergeAuthority:false,
    specialistAuthority:false, qualifiedWindowsSpecialist:false,
    protectedMergeAuthority:false, independentAttestationProven:false,
    reviewerEnrollmentAuthority:false, originalLeaseReleaseAuthority:false });
  try {
    if (!route) return held();
    const plan = buildHighRiskAdvisoryLaunchPlanV1({...options, entryPoint});
    const result = spawnSync(plan.executable, plan.args, {cwd:plan.root, env:plan.env,
      shell:false, windowsHide:true, timeout:13*60*1000, maxBuffer:65536, encoding:'utf8'});
    if (result.error || ![0,1].includes(result.status)) return held();
    const lines = result.stdout.trim().split(/\r?\n/);
    if (lines.length !== 1 || !lines[0].startsWith(route.prefix+'=')) return held();
    const value = JSON.parse(lines[0].slice(route.prefix.length+1));
    if (!value || typeof value !== 'object' || typeof value.status !== 'string') return held();
    if (result.status === 1 && value.status !== route.held) return held();
    return Object.freeze(value);
  } catch { return held(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--once'))
      throw Error('HIGH_RISK_TRUSTED_LAUNCH_FIXED_ARGUMENTS_REQUIRED');
    const plan = buildHighRiskAdvisoryLaunchPlanV1();
    const result = spawnSync(plan.executable, plan.args, { cwd: plan.root, env: plan.env,
      shell: false, windowsHide: true, timeout: 13 * 60 * 1000, maxBuffer: 65536, encoding: 'utf8' });
    if (result.stdout) process.stdout.write(result.stdout);
    // Never publish raw stderr. Missing terminal proof remains HOLD.
    process.exitCode = result.error || result.status !== 0 ? 1 : 0;
  } catch {
    process.stdout.write('SOVEREIGN_HIGH_RISK_ADVISORY_RESULT=' + JSON.stringify({
      status: 'SOVEREIGN_HIGH_RISK_REVIEW_HELD', reason: 'TRUSTED_PREEXECUTION_CUSTODY_UNPROVEN',
      approvalAuthority: false, mergeAuthority: false, specialistAuthority: false,
      independentAttestationProven: false, runtimeDeploymentProven: false,
    }) + '\n'); process.exitCode = 1;
  }
}
