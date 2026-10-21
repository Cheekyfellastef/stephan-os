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

export function buildHighRiskAdvisoryLaunchPlanV1({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  env = process.env, platform = process.platform,
  gitExecution = resolveBattleBridgeGitExecution({ platform }),
} = {}) {
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
    'STEPHANOS_SOVEREIGN_REVIEW_MODEL','STEPHANOS_SHARED_AGENT_WORKSPACE'])
    if (typeof env[key] === 'string') childEnv[key] = env[key];
  const entry = pathToFileURL(resolve(root, HIGH_RISK_ADVISORY_EXECUTION_FILES[0])).href;
  const invoke = `const m=await import(${JSON.stringify(entry)});const r=await m.runSovereignHighRiskAdvisoryV1();`
    + `process.stdout.write('SOVEREIGN_HIGH_RISK_ADVISORY_RESULT='+JSON.stringify(r)+'\\n');`
    + `if(!r.publicationOk||r.status==='SOVEREIGN_HIGH_RISK_REVIEW_HELD')process.exitCode=1;`;
  return Object.freeze({ executable: process.execPath,
    args: Object.freeze(['--experimental-loader', loader, '--input-type=module', '--eval', invoke]),
    env: Object.freeze(childEnv), root });
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
