// Test-only external HTTP fixture around the real private producer/store.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBattleBridgeGitExecution } from '../../../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import { createSharedWorkspaceGoalRecord } from '../../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { readMissionRecord, reaffirmCurrentOrdinarySourcePlanV1 } from '../missionOrchestratorStore.js';

export async function prepareOrdinaryGoalFixtureV1(missionId, options) {
  const issueNumber = Number(/^critical-([1-9][0-9]*)-elastic-goal$/.exec(missionId)?.[1]);
  assert.ok(issueNumber);
  assert.ok(options.sharedWorkspaceRoot);
  const now = options.now instanceof Date ? options.now : new Date();
  await mkdir(join(options.sharedWorkspaceRoot, 'goals'), { recursive: true });
  const goal = { ...createSharedWorkspaceGoalRecord({ goalId: `goal-${issueNumber}`,
    timestampUtc: now.toISOString(), status: 'READY' }), repository: 'Cheekyfellastef/stephan-os', issueNumber };
  await writeFile(join(options.sharedWorkspaceRoot, 'goals', `goal-${issueNumber}.json`), JSON.stringify(goal));
  options.env = { ...(options.env || {}), STEPHANOS_SHARED_AGENT_WORKSPACE: options.sharedWorkspaceRoot };
}

export async function admitCurrentOrdinaryFixtureV1(t, missionId, options) {
  const { state } = await readMissionRecord(missionId, options);
  const issueNumber = Number(/^critical-([1-9][0-9]*)-elastic-goal$/.exec(missionId)?.[1]);
  assert.ok(issueNumber);
  await mkdir(options.repoRoot, { recursive: true });
  options.repoRoot = await realpath(options.repoRoot);
  const boundary = resolveBattleBridgeGitExecution();
  const git = args => {
    const result = spawnSync(boundary.executable, [...boundary.fixedConfigArgs, '-C', options.repoRoot, ...args], {
      encoding: 'utf8', env: boundary.environment, shell: false, windowsHide: true, timeout: 5000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  git(['remote', 'add', 'origin', 'https://github.com/Cheekyfellastef/stephan-os.git']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  const now = options.now instanceof Date ? options.now : new Date();
  await mkdir(join(options.sharedWorkspaceRoot, 'goals'), { recursive: true });
  const goal = { ...createSharedWorkspaceGoalRecord({ goalId: `goal-${issueNumber}`,
    timestampUtc: now.toISOString(), status: 'READY' }), repository: state.repository, issueNumber };
  await writeFile(join(options.sharedWorkspaceRoot, 'goals', `goal-${issueNumber}.json`), JSON.stringify(goal));
  const resources = state.allowedFiles.filter(path => !state.allowedFiles.includes(path.replace(/\/\*\*$/, ''))
    || !path.endsWith('/**')).map(path => `repo:cheekyfellastef/stephan-os:path:${path}`);
  const admission = { schemaVersion: 'stephanos.github-goal-admission.v1', repository: state.repository,
    issueNumber, resourceIds: resources, requiredTests: state.requiredTests,
    state: 'READY', route: 'OPENCLAW_LOCAL', prerequisites: [], sourceImplementationAllowed: true,
    mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false };
  const issueUrl = `https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/${issueNumber}`;
  const createdAt = new Date(now.getTime() - 120000).toISOString();
  const authority = { closed: false };
  t.mock.method(globalThis, 'fetch', async url => {
    const payload = String(url) === issueUrl ? { number: issueNumber, url: issueUrl,
      title: state.intendedOutcome, state: authority.closed ? 'closed' : 'open', body: 'Implement this existing ordinary bounded source contract.',
      labels: [{ name: 'goal' }], updated_at: createdAt, user: { login: 'Cheekyfellastef' },
      author_association: 'OWNER', created_at: createdAt }
      : String(url).startsWith(issueUrl + '/comments?') ? [{ id: 501, issue_url: issueUrl,
        user: { login: 'Cheekyfellastef' }, author_association: 'OWNER', created_at: createdAt,
        updated_at: createdAt, body: '```stephanos-goal-admission-v1\n' + JSON.stringify(admission) + '\n```' }]
        : String(url).startsWith(issueUrl + '/events?') ? [] : null;
    if (payload === null) throw new Error('UNEXPECTED_TEST_ENDPOINT');
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  options.env = { ...(options.env || {}), GITHUB_TOKEN: 'test-only',
    STEPHANOS_SHARED_AGENT_WORKSPACE: options.sharedWorkspaceRoot };
  const reaffirmed = await reaffirmCurrentOrdinarySourcePlanV1(missionId, options).catch(error => {
    throw new Error(`${error.message}:${error.reasonCode || 'UNKNOWN_REASON'}`, { cause: error });
  });
  assert.equal(reaffirmed.reaffirmed, true);
  return { state: (await readMissionRecord(missionId, options)).state, sourceHead: git(['rev-parse', 'HEAD']), git, authority };
}
