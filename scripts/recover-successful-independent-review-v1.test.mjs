import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  buildSuccessfulReviewArtifactRecoveryV1,
  selectSuccessfulReviewRecoveryLaunchReceiptV1,
  waitForTerminalReviewReconciliationV1,
  validateOwnerHintReviewArtifactReadbackV1,
  selectRecoverableOwnerReviewHintV1,
} from './recover-successful-independent-review-v1.mjs';
import {
  buildIndependentReviewWorkflowDispatchLaunchReceiptV1,
  renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1,
} from '../shared/agents/independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

const HEAD = '1'.repeat(40);
const BASE = '2'.repeat(40);
const OTHER_HEAD = '3'.repeat(40);
const BOT = { login: 'github-actions[bot]', id: 41898282 };

function launchReceipt({ sourceHead = HEAD, baseSha = BASE } = {}) {
  return buildIndependentReviewWorkflowDispatchLaunchReceiptV1({
    launchPlan: {
      schemaVersion: 'stephanos.independent-review-missing-run-launch.v1',
      decision: 'LAUNCH_MISSING_RUN',
      repository: 'Cheekyfellastef/stephan-os',
      prNumber: 1944,
      sourceHead,
      baseSha,
      workflowId: 318073448,
      handoffBindingSha256: 'a'.repeat(64),
      operation: 'workflow-dispatch',
      mutationAllowed: true,
      workflowDispatchInputs: {
        pr_number: '1944',
        source_head: sourceHead,
        base_sha: baseSha,
        head_branch: 'fix/execution-receipt-heartbeat-proof-flake-v1',
        handoff_binding_sha256: 'a'.repeat(64),
        handoff_run_receipt_sha256: 'b'.repeat(64),
      },
      requiredRevalidation: {
        currentMain: true,
        pullRequestIdentity: true,
        workflowIdentity: true,
        coordinatorWorkflowRun: true,
        handoffComment: true,
        coordinatorHandoffRunReceipt: true,
        exactRunAbsenceImmediatelyBeforeDispatch: true,
      },
      authority: {
        reviewWorkflowDispatchAllowed: true,
        reviewExecutionAllowed: true,
        sourceMutationAllowed: false,
        approvalAllowed: false,
        mergeAllowed: false,
        deploymentAllowed: false,
        runtimeMutationAllowed: false,
        providerQualificationAllowed: false,
        leaseSeizureAllowed: false,
        arbitraryCommandAllowed: false,
      },
    },
    requestedAtUtc: '2026-08-22T10:10:05.632Z',
  });
}

function comment(receipt, overrides = {}) {
  return {
    id: 1,
    user: BOT,
    body: renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt),
    ...overrides,
  };
}

function terminalResultComment(receipt, overrides = {}) {
  return comment(receipt, {
    body: renderIndependentReviewWorkflowDispatchLaunchReceiptCommentV1(receipt)
      .replace(
        '## Provider-neutral independent-review missing-run launch receipt',
        '## Provider-neutral independent-review launch — terminal clean result',
      ),
    ...overrides,
  });
}

test('selects only the trusted exact PR/head/base launch receipt and ignores historical heads', () => {
  const current = launchReceipt();
  const historical = launchReceipt({ sourceHead: OTHER_HEAD });
  const selected = selectSuccessfulReviewRecoveryLaunchReceiptV1([
    comment(historical, { id: 2 }),
    comment(current),
    comment(current, { id: 3, user: { login: 'Cheekyfellastef', id: 267490109 } }),
  ], {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1944,
    expectedHead: HEAD,
    expectedBase: BASE,
  });
  assert.equal(selected.launchKeySha256, current.launchKeySha256);
});

test('ignores trusted historical terminal-result comments that reuse the launch marker prefix', () => {
  const current = launchReceipt();
  const selected = selectSuccessfulReviewRecoveryLaunchReceiptV1([
    terminalResultComment(current, { id: 2 }),
    comment(current),
  ], {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1944,
    expectedHead: HEAD,
    expectedBase: BASE,
  });
  assert.equal(selected.launchKeySha256, current.launchKeySha256);
});

test('fails closed when exact launch receipt evidence is missing or duplicated', () => {
  const current = launchReceipt();
  const options = {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1944,
    expectedHead: HEAD,
    expectedBase: BASE,
  };
  assert.throws(() => selectSuccessfulReviewRecoveryLaunchReceiptV1([], options), /count must be one/);
  assert.throws(
    () => selectSuccessfulReviewRecoveryLaunchReceiptV1([comment(current), comment(current, { id: 4 })], options),
    /count must be one/,
  );
});

test('only an exact successful terminal reconciliation requests immutable artifact recovery', () => {
  const recovery = buildSuccessfulReviewArtifactRecoveryV1({
    reconciliation: 'ALREADY_SUCCESSFUL',
    conclusion: 'success',
    runId: 32570000001,
    runAttempt: 2,
  });
  assert.deepEqual(recovery, {
    decision: 'RECOVER_SUCCESSFUL_REVIEW_ARTIFACT',
    recoveryRequired: true,
    runId: 32570000001,
    runAttempt: 2,
    artifactName: 'stephanos-independent-review-32570000001-attempt-2',
  });

  const waiting = buildSuccessfulReviewArtifactRecoveryV1({
    reconciliation: 'WAIT_RUNNING',
    conclusion: null,
    runId: 32570000001,
    runAttempt: 1,
  });
  assert.equal(waiting.recoveryRequired, false);
  assert.equal(waiting.artifactName, null);

  assert.throws(
    () => buildSuccessfulReviewArtifactRecoveryV1({
      reconciliation: 'ALREADY_SUCCESSFUL',
      conclusion: 'failure',
      runId: 32570000001,
      runAttempt: 1,
    }),
    /requires one exact successful run id and attempt/,
  );
});


test('bounded post-launch recovery waits for the exact running review to become terminal', async () => {
  const states = [
    { reconciliation: 'WAIT_RUNNING', runId: 10, runAttempt: 1 },
    { reconciliation: 'WAIT_RUNNING', runId: 10, runAttempt: 1 },
    { reconciliation: 'ALREADY_SUCCESSFUL', conclusion: 'success', runId: 10, runAttempt: 1 },
  ];
  let reads = 0;
  let sleeps = 0;
  const result = await waitForTerminalReviewReconciliationV1(states[0], async () => {
    reads += 1;
    return states[Math.min(reads, states.length - 1)];
  }, {
    enabled: true,
    sleep: async (milliseconds) => {
      sleeps += 1;
      assert.equal(milliseconds, 2000);
    },
  });
  assert.equal(result.reconciliation, 'ALREADY_SUCCESSFUL');
  assert.equal(reads, 2);
  assert.equal(sleeps, 2);
});

test('post-launch recovery does not poll unless explicitly enabled', async () => {
  let reads = 0;
  const initial = { reconciliation: 'WAIT_RUNNING', runId: 10, runAttempt: 1 };
  const result = await waitForTerminalReviewReconciliationV1(initial, async () => {
    reads += 1;
    return { reconciliation: 'ALREADY_SUCCESSFUL', conclusion: 'success', runId: 10, runAttempt: 1 };
  }, {
    enabled: false,
    sleep: async () => {},
  });
  assert.equal(result, initial);
  assert.equal(reads, 0);
});

test('recovery helper is read-only and delegates run discovery/reconciliation to canonical Stage-2 machinery', () => {
  const source = fs.readFileSync(new URL('./recover-successful-independent-review-v1.mjs', import.meta.url), 'utf8');
  assert.match(source, /loadWorkflowDispatchRuns/);
  assert.match(source, /reconcileExistingLaunchReceiptV1/);
  assert.match(source, /ALREADY_SUCCESSFUL/);
  assert.match(source, /enabled:\s*reconciliation\?\.reconciliation === 'WAIT_RUNNING'/);
  assert.match(source, /TERMINAL_RECOVERY_MAX_POLLS = 30/);
  assert.match(source, /stephanos-independent-review-\$\{runId\}-attempt-\$\{runAttempt\}/);
  assert.doesNotMatch(source, /method:\s*'POST'|\/dispatches|rerun-failed-jobs|execFile|spawn|child_process|shell:\s*true|git\s+(?:push|reset|clean|rebase)|\/merges|\/contents\//i);
});

const OWNER_RUN=40916781623,OWNER_ART=12916836185,OWNER_DIGEST='e'.repeat(64);
const OWNER_PR={number:3315,headSha:HEAD,baseSha:BASE,headRef:'original/review'};
const OWNER_WORKFLOW={id:318073448,name:'Independent Merge Security Review',path:'.github/workflows/independent-merge-security-review.yml',state:'active'};
const OWNER_RUN_OBJ={id:OWNER_RUN,workflow_id:318073448,path:OWNER_WORKFLOW.path,event:'pull_request_target',status:'completed',conclusion:'success',run_attempt:1,head_sha:HEAD,head_branch:OWNER_PR.headRef,pull_requests:[{number:3315,head:{sha:HEAD,ref:OWNER_PR.headRef,repo:{id:100}},base:{sha:BASE,ref:'main',repo:{id:100}}}]};
const OWNER_ART_OBJ={id:OWNER_ART,name:`stephanos-independent-review-${OWNER_RUN}-attempt-1`,expired:false,digest:`sha256:${OWNER_DIGEST}`,workflow_run:{id:OWNER_RUN,head_sha:HEAD,head_branch:OWNER_PR.headRef}};
const ownerReview=(changes={})=>validateOwnerHintReviewArtifactReadbackV1({workflow:OWNER_WORKFLOW,run:OWNER_RUN_OBJ,artifacts:[OWNER_ART_OBJ],pr:OWNER_PR,hint:{runId:OWNER_RUN,artifactId:OWNER_ART,sha256:OWNER_DIGEST},...changes});
test('owner-only exact review artifact readback recovers with no launch receipt',()=>{
 const result=ownerReview();assert.equal(result.recoveryRequired,true);assert.equal(result.runId,OWNER_RUN);
});
test('wrong head/base, failed run, forgery, bad digest, expiry, duplicates and missing binding deny',()=>{
 for(const bad of [{pr:{...OWNER_PR,headSha:OTHER_HEAD}},{pr:{...OWNER_PR,baseSha:OTHER_HEAD}},{workflow:{...OWNER_WORKFLOW,id:2}},{run:{...OWNER_RUN_OBJ,conclusion:'failure'}},{run:{...OWNER_RUN_OBJ,event:'untrusted'}},{run:{...OWNER_RUN_OBJ,pull_requests:[]}},{artifacts:[{...OWNER_ART_OBJ,expired:true}]},{artifacts:[{...OWNER_ART_OBJ,digest:`sha256:${'f'.repeat(64)}`}]},{artifacts:[OWNER_ART_OBJ,OWNER_ART_OBJ]}]) assert.throws(()=>ownerReview(bad));
});

const OWNER_REPO = 'Cheekyfellastef/stephan-os';
const OWNER_HINT_TIME = '2026-10-29T18:30:00.000Z';
const ownerEvidenceComment = (change = {}) => ({
  id: 6500000001,
  user: { login: 'Cheekyfellastef', id: 267490109, type: 'User' },
  author_association: 'OWNER',
  created_at: OWNER_HINT_TIME,
  updated_at: OWNER_HINT_TIME,
  body: `Original PR #3315, HEAD ${HEAD}, protected main ${BASE}. Independent security review CLEAN.
[review ${OWNER_RUN}](https://github.com/${OWNER_REPO}/actions/runs/${OWNER_RUN}).
[artifact ${OWNER_ART}](https://github.com/${OWNER_REPO}/actions/runs/${OWNER_RUN}/artifacts/${OWNER_ART}), sha256 ${OWNER_DIGEST}.`,
  ...change,
});
const selectOwnerEvidence = (changes = {}) => selectRecoverableOwnerReviewHintV1({
  comments: [ownerEvidenceComment()],
  repository: OWNER_REPO,
  pr: OWNER_PR,
  ...changes,
});

test('owner-only review is found without editing the protected workflow or inventing a launch receipt', () => {
  const selected = selectOwnerEvidence();
  assert.deepEqual(selected, { runId: OWNER_RUN, artifactId: OWNER_ART, sha256: OWNER_DIGEST });
  const source = fs.readFileSync(new URL('./recover-successful-independent-review-v1.mjs', import.meta.url), 'utf8');
  assert.match(source, /findExistingIndependentReviewEvidenceHintV1/);
  assert.match(source, /selectRecoverableOwnerReviewHintV1\(\{/);
  assert.match(source, /validateOwnerHintReviewArtifactReadbackV1/);
});

test('forged, edited, stale, incomplete, colliding and caller-supplied owner hints stay held', () => {
  const good = ownerEvidenceComment();
  assert.equal(selectOwnerEvidence({ comments: [] }), null);
  assert.equal(selectOwnerEvidence({ pr: { ...OWNER_PR, baseSha: OTHER_HEAD } }), null);
  assert.equal(selectOwnerEvidence({ comments: [{ ...good, user: { login: 'outsider', id: 123, type: 'User' } }] }), null);
  assert.throws(() => selectOwnerEvidence({ comments: [{ ...good, updated_at: '2026-10-29T18:31:00.000Z' }] }), /provenance not immutable/);
  assert.throws(() => selectOwnerEvidence({ comments: [{ ...good, author_association: 'CONTRIBUTOR' }] }), /provenance not immutable/);
  assert.equal(selectOwnerEvidence({ comments: [{ ...good, body: good.body.replace('sha256 '+OWNER_DIGEST, 'sha256 missing') }] }), null);
  assert.throws(() => selectOwnerEvidence({
    comments: [good, { ...good, id: 6500000002, body: good.body.replaceAll(String(OWNER_RUN), String(OWNER_RUN+1)) }],
  }), /invalid or conflicting/);
  assert.throws(() => selectOwnerEvidence({ suppliedHint: { runId: OWNER_RUN+1, artifactId: OWNER_ART, sha256: OWNER_DIGEST } }), /conflicts/);
  assert.throws(() => selectOwnerEvidence({ comments: [], suppliedHint: { runId: OWNER_RUN, artifactId: OWNER_ART, sha256: OWNER_DIGEST } }), /lacks original owner evidence/);
  assert.deepEqual(selectOwnerEvidence({
    suppliedHint: { runId: OWNER_RUN, artifactId: OWNER_ART, sha256: OWNER_DIGEST },
  }), { runId: OWNER_RUN, artifactId: OWNER_ART, sha256: OWNER_DIGEST });
});
