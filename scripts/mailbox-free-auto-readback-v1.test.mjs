import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAILBOX_FREE_AUTO_READBACK_SCHEMA,
  MAILBOX_FREE_AUTO_READBACK_FILE,
  admitAutomaticReadbackEventV1,
  projectAutomaticReadbackResultV1,
} from './mailbox-free-auto-readback-v1.mjs';

const HEAD = 'a'.repeat(40);
const REPO = 'Cheekyfellastef/stephan-os';
function event() {
  return {
    action: 'completed',
    repository: { full_name: REPO, id: 1179385578, owner: { login: 'Cheekyfellastef' } },
    workflow_run: {
      id: 40600537747, workflow_id: 398609082,
      path: '.github/workflows/stephanos-mailbox-free-readonly.yml',
      event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
      run_attempt: 1, head_branch: 'main', head_sha: HEAD,
      repository: { full_name: REPO, id: 1179385578 },
      actor: { login: 'Cheekyfellastef', id: 267490109 },
    },
  };
}
function env() {
  return {
    GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_run',
    GITHUB_JOB: 'readback', GITHUB_REPOSITORY: REPO,
    GITHUB_REPOSITORY_OWNER: 'Cheekyfellastef',
    GITHUB_REF: 'refs/heads/main', GITHUB_SHA: HEAD,
  };
}
function admitted(e = event(), vars = env()) {
  return admitAutomaticReadbackEventV1(e, vars);
}
function candidate(overrides = {}) {
  return {
    disposition: 'DISCOVERY_CANDIDATE_ONLY', runId: 40600537747,
    goalNumber: 2961, sourceHead: HEAD, artifactId: 12777961834,
    archiveSha256: 'b'.repeat(64), independentlyAuthenticatedTransport: false,
    originalGoalAdmissionGranted: false, exclusiveClaimGranted: false,
    executionAuthorized: false, sourceMutationAllowed: false,
    nativePickupProven: false, protectedMergeAllowed: false,
    ...overrides,
  };
}
function checkHeld(value, blocker) {
  assert.equal(value.schemaVersion, MAILBOX_FREE_AUTO_READBACK_SCHEMA);
  assert.equal(value.verdict, 'HELD');
  if (blocker) assert.equal(value.blocker, blocker);
  for (const name of ['originalGoalAdmissionGranted', 'exclusiveClaimGranted',
    'executionAuthorized', 'sourceMutationAllowed', 'protectedMergeAllowed',
    'nativePickupProven', 'independentlyAuthenticatedNativeCustody']) {
    assert.equal(value[name], false, name);
  }
}
test('current first-attempt canonical owner run is admitted as readback only', () => {
  const v = admitted();
  assert.equal(v.ok, true);
  assert.equal(v.runId, 40600537747);
  assert.equal(v.originatingHead, HEAD);
  assert.equal(v.checkedOutHead, HEAD);
  assert.equal(v.executionAuthorized, false);
  assert.equal(v.originalGoalAdmissionGranted, false);
  assert.equal(Object.isFrozen(v), true);
  assert.equal(MAILBOX_FREE_AUTO_READBACK_FILE, 'mailbox-free-goal-readback.json');
});
test('authenticated metadata proof projects to observation, not source or native permission', () => {
  const v = projectAutomaticReadbackResultV1(admitted(), candidate());
  assert.equal(v.schemaVersion, MAILBOX_FREE_AUTO_READBACK_SCHEMA);
  assert.equal(v.verdict, 'READ_ONLY_GITHUB_EVIDENCE_CORRELATED');
  assert.equal(v.goalNumber, 2961);
  assert.equal(v.sourceHead, HEAD);
  assert.equal(v.originRunId, 40600537747);
  assert.equal(v.originatingArtifactId, 12777961834);
  assert.equal(v.sourceProofKind, 'GITHUB_RUN_ARTIFACT_AND_GOAL_GET_VERIFIED');
  for (const name of ['originalGoalAdmissionGranted', 'exclusiveClaimGranted',
    'executionAuthorized', 'sourceMutationAllowed', 'protectedMergeAllowed',
    'nativePickupProven', 'independentlyAuthenticatedNativeCustody'])
    assert.equal(v[name], false, name);
  assert.equal(Object.isFrozen(v), true);
});
test('issue comments, PRs, reruns and wrong execution jobs never trigger a readback', () => {
  for (const patch of [
    { GITHUB_EVENT_NAME: 'issue_comment' }, { GITHUB_EVENT_NAME: 'pull_request_target' },
    { GITHUB_JOB: 'inspect-goal' }, { GITHUB_ACTIONS: 'false' },
  ]) checkHeld(admitted(event(), { ...env(), ...patch }), 'TRUSTED_ACTIONS_EVENT_INVALID');
  checkHeld(admitted(null), 'TRUSTED_ACTIONS_EVENT_INVALID');
});
test('wrong original workflow ID/path and arbitrary workflow replay are held', () => {
  for (const patch of [
    { workflow_id: 42 }, { path: '.github/workflows/attacker.yml' },
    { event: 'pull_request' }, { run_attempt: 2 },
    { status: 'in_progress' }, { conclusion: 'failure' },
    { head_branch: 'untrusted' }, { head_sha: 'bad' }, { id: 0 },
  ]) {
    const e = event(); Object.assign(e.workflow_run, patch);
    checkHeld(admitted(e), 'TRUSTED_ORIGIN_RUN_IDENTITY_INVALID');
  }
});
test('foreign sender/repository/owner/head or nonmain execution is held', () => {
  for (const patch of [
    { actor: { login: 'stranger', id: 267490109 } },
    { actor: { login: 'Cheekyfellastef', id: 1 } },
    { repository: { full_name: 'stranger/fork', id: 1179385578 } },
    { repository: { full_name: REPO, id: 1 } },
  ]) {
    const e = event(); Object.assign(e.workflow_run, patch);
    checkHeld(admitted(e), 'TRUSTED_ORIGIN_RUN_IDENTITY_INVALID');
  }
  for (const patch of [
    { GITHUB_REPOSITORY: 'stranger/fork' },
    { GITHUB_REPOSITORY_OWNER: 'stranger' },
    { GITHUB_REF: 'refs/heads/untrusted' },
    { GITHUB_SHA: 'invalid' },
  ]) checkHeld(admitted(event(), { ...env(), ...patch }), 'TRUSTED_ORIGIN_RUN_IDENTITY_INVALID');
  const bad = event();bad.repository.owner.login = 'stranger';
  checkHeld(admitted(bad), 'TRUSTED_ORIGIN_RUN_IDENTITY_INVALID');
});
test('changed, unverified, stale or privilege-bearing Stage-3 result is never promoted', () => {
  for (const patch of [
    { disposition: 'HELD', blocker: 'PROTECTED_MAIN_MOVED_DURING_READBACK' },
    { runId: 1 }, { sourceHead: 'c'.repeat(40) }, { goalNumber: 0 },
    { independentlyAuthenticatedTransport: true },
    { originalGoalAdmissionGranted: true }, { exclusiveClaimGranted: true },
    { executionAuthorized: true }, { sourceMutationAllowed: true },
    { protectedMergeAllowed: true }, { nativePickupProven: true },
  ]) checkHeld(projectAutomaticReadbackResultV1(admitted(), candidate(patch)));
  checkHeld(projectAutomaticReadbackResultV1({ ok: false }, candidate()),
    'READBACK_EVENT_NOT_ADMITTED');
  checkHeld(projectAutomaticReadbackResultV1(admitted(), null));
});
test('static source and workflow are GET-only and source-controlled; no new command channel', () => {
  const script = readFileSync('scripts/mailbox-free-auto-readback-v1.mjs','utf8');
  const workflow = readFileSync('.github/workflows/stephanos-mailbox-free-auto-readback.yml', 'utf8');
  assert.match(script, /readMailboxFreeGoalEvidenceFromGitHubV1/);
  assert.match(script, /execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(script, /projectAutomaticReadbackResultV1/);
  assert.match(workflow, /workflow_run:\s*\n\s*workflows:\s*\n\s*- Stephanos Control Tower - Mailbox-Free Read-Only Pilot/);
  assert.match(workflow, /event == 'workflow_dispatch'/);
  assert.match(workflow, /head_branch == 'main'/);
  assert.match(workflow, /conclusion == 'success'/);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /if-no-files-found: error/);
  assert.doesNotMatch(workflow, /issues:\s*write|contents:\s*write|pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /schedule:\s*\n|cron:|workflow_dispatch:|secrets\./);
  assert.doesNotMatch(script, /method:\s*['"]POST['"]|fetch\(['"]http|execFileSync\('powershell|Start-Process/);
});
