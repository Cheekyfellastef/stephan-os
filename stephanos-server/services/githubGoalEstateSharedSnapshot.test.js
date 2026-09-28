import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  GITHUB_GOAL_ESTATE_SHARED_SNAPSHOT_TTL_MS,
  readGithubGoalEstateSharedSnapshot,
  writeGithubGoalEstateSharedSnapshot,
} from './programmeAuthorityService.js';

test('goal estate shared snapshot persists canonical truth and ages honestly', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'stephanos-goal-estate-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  await mkdir(repoRoot, { recursive: true });
  const nowUtc = '2026-09-28T12:00:00.000Z';
  const admittedIssue = {
    issueNumber: 2485,
    title: 'Controller capacity continuity',
    state: 'open',
    labels: ['goal'],
    repository: 'Cheekyfellastef/stephan-os',
    retrievedAt: nowUtc,
    creatorLogin: 'Cheekyfellastef',
    authorAssociation: 'OWNER',
    admission: {
      schemaVersion: 'stephanos.github-goal-admission.v1',
      issueNumber: 2485,
      repository: 'Cheekyfellastef/stephan-os',
      resourceIds: [],
      state: 'READY',
      route: 'OPENCLAW_LOCAL',
      prerequisites: [],
      sourceImplementationAllowed: true,
      mergeAuthority: false,
      deploymentAuthority: false,
      runtimeMutationAuthority: false,
      arbitraryShellAllowed: false,
    },
    admissionState: 'ADMISSION_PROVEN',
    admissionProofSource: 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT',
    schedulerEligible: true,
    operatorLaneContainment: { active: false },
  };
  const goalEstateRead = {
    ok: true,
    reason: 'GITHUB_GOAL_ESTATE_FETCHED',
    issues: [admittedIssue],
    discoveredIssues: [{ issueNumber: 2485, title: admittedIssue.title }],
    retrievedAt: nowUtc,
  };
  try {
    assert.equal(await writeGithubGoalEstateSharedSnapshot({ root, repoRoot, nowUtc }, goalEstateRead), true);

    const fresh = await readGithubGoalEstateSharedSnapshot({
      root,
      repoRoot,
      nowUtc: '2026-09-28T12:01:00.000Z',
    });
    assert.equal(fresh?.reason, 'GITHUB_GOAL_ESTATE_SHARED_SNAPSHOT');
    assert.equal(fresh?.issues?.[0]?.issueNumber, 2485);

    const expired = await readGithubGoalEstateSharedSnapshot({
      root,
      repoRoot,
      nowUtc: new Date(Date.parse(nowUtc) + GITHUB_GOAL_ESTATE_SHARED_SNAPSHOT_TTL_MS + 1).toISOString(),
    });
    assert.equal(expired, null);

    const stale = await readGithubGoalEstateSharedSnapshot({
      root,
      repoRoot,
      allowStale: true,
      nowUtc: new Date(Date.parse(nowUtc) + GITHUB_GOAL_ESTATE_SHARED_SNAPSHOT_TTL_MS + 1).toISOString(),
    });
    assert.equal(stale?.reason, 'GITHUB_GOAL_ESTATE_SHARED_SNAPSHOT_STALE');

    const snapshotPath = join(root, 'status', 'github-goal-estate-shared-snapshot.json');
    const corrupted = JSON.parse(await readFile(snapshotPath, 'utf8'));
    corrupted.goalEstateRead.issues = [{ issueNumber: 999, title: 'forged build pickup' }];
    await writeFile(snapshotPath, `${JSON.stringify(corrupted, null, 2)}\n`, 'utf8');
    const rejected = await readGithubGoalEstateSharedSnapshot({
      root,
      repoRoot,
      nowUtc: '2026-09-28T12:01:00.000Z',
    });
    assert.equal(rejected, null);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
