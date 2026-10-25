// #1574: one bounded execution on the existing manually invoked GitHub route.
// Host adapters are authority dependencies, never fields from a goal/comment.
import { createHash } from 'node:crypto';
import { readChatgptGithubGoalEstateV1 } from './chatgptGithubAuthenticatedDiscoveryV1.mjs';
import { planChatgptGithubGoalCandidatesV1 } from './chatgptGithubGoalPickerV1.mjs';
import { createExecutionReceipt, validateExecutionReceipt } from './executionReceiptV1.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const ROOT = `https://api.github.com/repos/${REPO}`;
const SHA = /^[a-f0-9]{40}$/;
const MARKER = 'stephanos-chatgpt-source-task';
const SCHEMA = 'stephanos.chatgpt-source-task.v1';
const COMMIT = `mutation($input:CreateCommitOnBranchInput!){
 createCommitOnBranch(input:$input){commit{oid tree{oid}}}
}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const stop = code => { const e = new Error(code); e.code = code; throw e; };
const positive = value => Number.isSafeInteger(value) && value > 0;
const overlap = (a,b) => a.toLowerCase() === b.toLowerCase()
  || a.toLowerCase().startsWith(b.toLowerCase() + '/') || b.toLowerCase().startsWith(a.toLowerCase() + '/');

/** No scheduler, new lease store, credentials in tasks, model invocation, shell,
 * merge or review implementation. Use the EXISTING canonical construction
 * authority and receipt store. A host must commission these adapters separately;
 * injected test adapters do not constitute production custody/qualification.
 */
export function createChatgptGithubGoalExecutorV1(host = {}) {
  const { token, fetchImpl = fetch, authority, readCustody, verifyReservation,
    appendReceipt, readExecution, confirmProtectedMerge, completeAndRefill,
    now = () => new Date().toISOString() } = host;
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('trusted GitHub credential required');
  for (const [name, fn] of Object.entries({fetchImpl, readCustody, verifyReservation,
    appendReceipt, readExecution, confirmProtectedMerge, completeAndRefill, now})) {
    if (typeof fn !== 'function') throw new TypeError(`trusted host adapter required: ${name}`);
  }
  if (typeof authority?.evaluateAdmission !== 'function' || typeof authority?.issueLease !== 'function')
    throw new TypeError('existing canonical construction authority required');

  async function request(url, method = 'GET', body) {
    let response;
    try {
      response = await fetchImpl(url, {method, redirect:'error', signal:AbortSignal.timeout(15_000),
        headers:{Accept:'application/vnd.github+json', Authorization:`Bearer ${token}`,
          'Content-Type':'application/json', 'User-Agent':'stephanos-chatgpt-source-executor-v1'},
        ...(body === undefined ? {} : {body:JSON.stringify(body)})});
    } catch { stop(method === 'GET' ? 'GITHUB_READ_FAILED' : 'GITHUB_WRITE_OUTCOME_UNKNOWN'); }
    if (!response?.ok) stop(response?.status === 403 || response?.status === 429
      ? 'GITHUB_QUOTA_OR_PERMISSION_HOLD' : 'GITHUB_REQUEST_REJECTED');
    try { return await response.json(); }
    catch { stop(method === 'GET' ? 'GITHUB_RESPONSE_INVALID' : 'GITHUB_WRITE_OUTCOME_UNKNOWN'); }
  }

  async function intake(issueNumber, commentId, {recoveryReadOnly = false} = {}) {
    if (!positive(issueNumber) || !positive(commentId)) stop('INTAKE_ID_INVALID');
    const comment = await request(`${ROOT}/issues/comments/${commentId}`);
    const clock = Date.parse(now());
    if (comment.id !== commentId || comment.issue_url !== `${ROOT}/issues/${issueNumber}`
      || comment.user?.login !== 'Cheekyfellastef' || comment.user?.id !== 267490109
      || comment.user?.type !== 'User' || comment.author_association !== 'OWNER'
      || comment.created_at !== comment.updated_at || !Number.isFinite(clock)
      || !Number.isFinite(Date.parse(comment.created_at)) || Date.parse(comment.created_at) > clock
      || (!recoveryReadOnly && clock - Date.parse(comment.created_at) > 600_000)
      || typeof comment.body !== 'string' || Buffer.byteLength(comment.body) > 64 * 1024)
      stop('OWNER_INTAKE_UNAUTHENTICATED_OR_STALE');
    const matches = [...comment.body.matchAll(new RegExp('```' + MARKER + '\\s*([\\s\\S]*?)```', 'g'))];
    if (matches.length !== 1) stop('OWNER_TASK_FENCE_INVALID');
    let task;
    try { task = JSON.parse(matches[0][1]); } catch { stop('OWNER_TASK_JSON_INVALID'); }
    if (!exact(task, ['schemaVersion','taskId','expectedMain','expiresAt','taskClass','edits'])
      || task.schemaVersion !== SCHEMA || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(task.taskId)
      || typeof task.expectedMain !== 'string' || !SHA.test(task.expectedMain)
      || !['docs-only','tests-only'].includes(task.taskClass)
      || !Number.isFinite(Date.parse(task.expiresAt)) || (!recoveryReadOnly && Date.parse(task.expiresAt) <= clock)
      || Date.parse(task.expiresAt) <= Date.parse(comment.created_at)
      || Date.parse(task.expiresAt) > Date.parse(comment.created_at) + 600_000
      || !Array.isArray(task.edits) || !task.edits.length || task.edits.length > 6
      || task.edits.some(edit => !exact(edit,['path','content'])
        || typeof edit.path !== 'string' || typeof edit.content !== 'string'
        || Buffer.byteLength(edit.content) > 8192 || edit.content.includes('\0')))
      stop('OWNER_TASK_SCOPE_INVALID');
    return {...task, issueNumber, commentId, commentSha256:hash(comment.body),
      branch:`chatgpt/goal-${issueNumber}-${task.taskId}`, paths:task.edits.map(e=>e.path)};
  }

  async function estate(task) {
    const observed = await readChatgptGithubGoalEstateV1({issueNumber:task.issueNumber,
      token, fetchImpl, nowUtc:now()});
    if (observed.disposition === 'HELD') stop(observed.blocker);
    if (observed.mainHead !== task.expectedMain) stop('MAIN_CHANGED_REAPPROVAL_REQUIRED');
    return observed;
  }

  async function live(task, lease) {
    if (Date.parse(task.expiresAt) <= Date.parse(now())) stop('OWNER_TASK_EXPIRED');
    if (await verifyReservation({task, lease}) !== true) stop('CANONICAL_RESERVATION_LOST');
    const current = await intake(task.issueNumber, task.commentId);
    if (current.commentSha256 !== task.commentSha256) stop('OWNER_TASK_CHANGED');
    await estate(task); // Complete current PR inventory, not a caller's empty list.
    const ref = await request(`${ROOT}/git/ref/heads/${task.branch}`);
    if (ref.object?.sha !== task.expectedMain) stop('BRANCH_MOVED_NO_OVERWRITE');
    // Slow paginated reads may consume the remaining authorization window.
    if (Date.parse(task.expiresAt) <= Date.parse(now())) stop('OWNER_TASK_EXPIRED');
    if (await verifyReservation({task, lease}) !== true) stop('CANONICAL_RESERVATION_LOST');
  }

  async function verifySource(task, head) {
    const compare = await request(`${ROOT}/compare/${task.expectedMain}...${head}`);
    if (compare.status !== 'ahead' || compare.ahead_by !== 1 || compare.total_commits !== 1
      || !Array.isArray(compare.files) || compare.files.length !== task.paths.length
      || compare.files.some(f=>!task.paths.includes(f.filename) || !['added','modified'].includes(f.status)))
      stop('PUBLISHED_SOURCE_SCOPE_UNPROVEN');
    // Recovery must prove approved bytes, not merely a similar path inventory.
    for (const edit of task.edits) {
      const file = await request(`${ROOT}/contents/${edit.path}?ref=${head}`);
      if (file.type !== 'file' || file.path !== edit.path || file.encoding !== 'base64'
        || typeof file.content !== 'string'
        || !Buffer.from(file.content.replace(/\s/g,''),'base64').equals(Buffer.from(edit.content)))
        stop('PUBLISHED_SOURCE_BYTES_UNPROVEN');
    }
  }

  async function publishPull(task, lease, head) {
    const fresh = await estate(task);
    if (fresh.openPrEvidence.claims.some(c=>c.paths.some(p=>task.paths.some(owned=>overlap(p,owned)))))
      stop('POST_COMMIT_PR_COLLISION_HELD');
    const current = await intake(task.issueNumber,task.commentId);
    if (current.commentSha256 !== task.commentSha256) stop('OWNER_TASK_CHANGED');
    if (await verifyReservation({task,lease}) !== true) stop('CANONICAL_RESERVATION_LOST');
    if (Date.parse(task.expiresAt) <= Date.parse(now())) stop('OWNER_TASK_EXPIRED');
    return request(`${ROOT}/pulls`,'POST',{base:'main', head:task.branch, draft:false,
      title:`Goal #${task.issueNumber}: ${task.taskId}`,
      body:`Bounded GitHub source task under #${task.issueNumber}. Owner intake comment ${task.commentId}; SHA-256 ${task.commentSha256}.\n\nCanonical reservation ${lease.reservationId}. Source head ${head}.\n\nExisting CI, independent exact-head review and operator-protected merge are required. No Battle Bridge pickup, deployment, lease release or unattended refill is claimed.`});
  }

  return Object.freeze({
    async runOnce({issueNumber, commentId} = {}) {
      let task, lease, head, prNumber = 0, phase = 'INTAKE', previous, sequence = 0, sinkFailed = false;
      const receipts = [];
      async function checkpoint(state, nextPhase, proofRefs, blocker = '') {
        const evidence = {phase:nextPhase, sourceRefs:proofRefs, commentSha256:task.commentSha256,
          reservationId:lease.reservationId, branch:task.branch, head:head || task.expectedMain, prNumber};
        const evidenceSha256 = hash(JSON.stringify(evidence));
        const evidenceRef = `proofs/chatgpt-${commentId}-${sequence + 1}-${evidenceSha256}.json`;
        const timestampUtc = now();
        if (!Number.isFinite(Date.parse(timestampUtc))
          || (previous && Date.parse(timestampUtc) <= Date.parse(previous.timestampUtc)))
          stop('EXECUTION_RECEIPT_CLOCK_NOT_ADVANCED');
        // #1568 chain identity is immutable. This execution began before a PR
        // existed; bind its later PR in the immutable evidence, not by changing
        // prNumber midway through the same execution.
        const receipt = createExecutionReceipt({repository:REPO, issueNumber, prNumber:0,
          branch:task.branch, sourceHead:head || task.expectedMain,
          workerId:'chatgpt-github', workerType:'github-first',
          executionId:`chatgpt-${commentId}`, leaseKey:`chatgpt-${commentId}`,
          timestampUtc, state, phase:nextPhase, sequence:sequence + 1,
          predecessorReceiptId:previous?.receiptId || '', blocker,
          proofRefs:[evidenceRef], expectedNextAction:'Continue the same canonical reservation and PR through existing CI, independent review and protected merge.'});
        if (!validateExecutionReceipt(receipt).valid) stop('EXECUTION_RECEIPT_INVALID');
        // Host writes via #1568 store; loss of durable checkpoint stops new writes.
        let persisted;
        try { persisted = await appendReceipt(receipt, {task, lease, head, prNumber, evidence, evidenceRef, evidenceSha256}); }
        catch { sinkFailed = true; stop('EXECUTION_RECEIPT_PERSISTENCE_UNPROVEN'); }
        if (persisted?.ok !== true || persisted.evidenceSha256 !== evidenceSha256) {
          sinkFailed = true; stop('EXECUTION_RECEIPT_PERSISTENCE_UNPROVEN');
        }
        previous = receipt; sequence++; receipts.push(receipt); phase = nextPhase;
      }
      try {
        task = await intake(issueNumber, commentId);
        const observed = await estate(task);
        const custody = await readCustody({task, mainHead:observed.mainHead});
        const plan = planChatgptGithubGoalCandidatesV1({mainHead:observed.mainHead, nowUtc:now(), candidates:[{
          issueNumber, issueTitle:observed.issueTitle, issueState:'open', taskId:task.taskId,
          sourceHead:observed.mainHead, taskClass:task.taskClass, riskTier:'low', paths:task.paths,
          ownershipEvidence:custody?.ownershipEvidence, openPrEvidence:observed.openPrEvidence}]});
        if (plan.decisions[0]?.disposition !== 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED')
          stop(plan.decisions[0]?.blockers[0] || 'SOURCE_SCOPE_HELD');
        const candidate = {id:`chatgpt-${commentId}`, goalId:String(issueNumber), branch:task.branch,
          baseSha:task.expectedMain, headSha:task.expectedMain, state:'ADMITTED',
          ownership:{paths:task.paths, contracts:[]}, capabilities:['SOURCE_WRITE'], dependencies:[]};
        const admitted = authority.evaluateAdmission(candidate, custody?.inventory);
        if (admitted?.status !== 'ADMITTED') stop('CANONICAL_CONSTRUCTION_ADMISSION_HELD');
        lease = await authority.issueLease(admitted, {laneId:candidate.id, inventorySnapshot:custody.inventory,
          issuedAt:now(), expiresAt:task.expiresAt});
        await checkpoint('queued','CANONICAL_CLAIMED',[`https://github.com/${REPO}/issues/${issueNumber}#issuecomment-${commentId}`]);
        await checkpoint('accepted','BRANCH_RESERVATION_PENDING', previous.proofRefs);
        if (await verifyReservation({task, lease}) !== true) stop('CANONICAL_RESERVATION_LOST');
        // Create-only reservation. Existing branch is held, never overwritten or renamed.
        await request(`${ROOT}/git/refs`, 'POST', {ref:`refs/heads/${task.branch}`, sha:task.expectedMain});
        await live(task, lease);
        await checkpoint('started','GITHUB_PICKUP_PROVEN',previous.proofRefs);
        // Explicit API compare-and-swap: REST PATCH refs alone is not expected-head CAS.
        await live(task, lease);
        if (Date.parse(task.expiresAt) <= Date.parse(now())) stop('OWNER_TASK_EXPIRED');
        const result = await request('https://api.github.com/graphql','POST',{query:COMMIT,variables:{input:{
          branch:{repositoryNameWithOwner:REPO, branchName:task.branch}, expectedHeadOid:task.expectedMain,
          message:{headline:`Goal #${issueNumber}: ${task.taskId}`},
          fileChanges:{additions:task.edits.map(e=>({path:e.path, contents:Buffer.from(e.content).toString('base64')}))}}}});
        head = result?.data?.createCommitOnBranch?.commit?.oid;
        if (result?.errors?.length || typeof head !== 'string' || !SHA.test(head) || head === task.expectedMain)
          stop('SOURCE_COMMIT_UNPROVEN_RECONCILE_SAME_BRANCH');
        await verifySource(task,head);
        await checkpoint('progress','SOURCE_COMMIT_PROVEN',[`https://github.com/${REPO}/commit/${head}`]);
        if (await verifyReservation({task, lease}) !== true) stop('CANONICAL_RESERVATION_LOST');
        const pull = await publishPull(task,lease,head);
        if (!positive(pull.number) || pull.head?.sha !== head || pull.head?.ref !== task.branch
          || pull.head?.repo?.full_name !== REPO || pull.base?.repo?.full_name !== REPO
          || pull.base?.ref !== 'main') stop('PR_PUBLICATION_UNPROVEN');
        prNumber = pull.number;
        await checkpoint('progress','PR_OPEN_AWAITING_CI_AND_INDEPENDENT_REVIEW',
          [`https://github.com/${REPO}/pull/${prNumber}`,`https://github.com/${REPO}/commit/${head}`]);
        return {verdict:'PR_OPEN', taskId:task.taskId, branch:task.branch, head, prNumber, receipts,
          githubPickupProven:true, battleBridgePickupProven:false, merged:false, unattendedRefillProven:false};
      } catch (error) {
        // No retry, lease release, branch deletion, replacement PR or false completion.
        // An uncertain write remains uncertain until the SAME reservation is reconciled.
        const blocker = error.code || 'HOST_ADAPTER_OR_RECEIPT_FAILURE';
        const failedAtPhase = phase;
        if (previous && !sinkFailed) {
          try { await checkpoint('failed','SOURCE_TASK_HELD',previous.proofRefs,blocker); }
          catch { /* Return the original blocker and preserve last durable checkpoint. */ }
        }
        return {verdict:'HELD', blocker, phase:failedAtPhase,
          taskId:task?.taskId, branch:task?.branch, head, prNumber,
          reservationId:lease?.reservationId, receipts, merged:false, unattendedRefillProven:false};
      }
    },

    async reconcile({issueNumber, commentId} = {}) {
      if (!positive(issueNumber) || !positive(commentId)) stop('INTAKE_ID_INVALID');
      // Never trust a caller's receipt or merge assertion, or re-parse expired
      // approval to create a new lane. Resolve the original persisted execution.
      let execution = await readExecution({issueNumber, commentId});
      if (!execution || execution.issueNumber !== issueNumber || execution.commentId !== commentId
        || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(execution.taskId || '')
        || execution.branch !== `chatgpt/goal-${issueNumber}-${execution.taskId}`)
        return {verdict:'HELD', blocker:'DURABLE_EXECUTION_UNPROVEN'};
      if (!positive(execution.prNumber) || !SHA.test(execution.head || '')) {
        try {
          // A write may have executed before its acknowledgment was lost. Inspect
          // the SAME reserved branch and all matching PRs before any new write.
          const task = await intake(issueNumber,commentId,{recoveryReadOnly:true});
          if (execution.commentSha256 !== task.commentSha256 || execution.branch !== task.branch
            || !execution.lease || await verifyReservation({task,lease:execution.lease}) !== true)
            stop('ORIGINAL_RESERVATION_OR_APPROVAL_UNPROVEN');
          const ref = await request(`${ROOT}/git/ref/heads/${task.branch}`);
          const head = ref.object?.sha;
          if (!SHA.test(head || '') || head === task.expectedMain)
            stop('SOURCE_NOT_STARTED_NO_REEXECUTION');
          if (SHA.test(execution.head || '') && execution.head !== head) stop('RECOVERY_SOURCE_HEAD_CHANGED');
          await verifySource(task,head);
          const pulls = await request(`${ROOT}/pulls?state=all&head=Cheekyfellastef:${task.branch}&base=main&per_page=2`);
          if (!Array.isArray(pulls) || pulls.length > 1) stop('RECOVERY_PR_AMBIGUOUS');
          const pull = pulls[0] || await publishPull(task,execution.lease,head);
          if (!positive(pull?.number) || pull.head?.sha !== head || pull.head?.ref !== task.branch
            || pull.head?.repo?.full_name !== REPO || pull.base?.repo?.full_name !== REPO || pull.base?.ref !== 'main')
            stop('RECOVERY_PR_IDENTITY_UNPROVEN');
          const evidence = {phase:'SOURCE_PUBLICATION_RECOVERED',commentSha256:task.commentSha256,
            reservationId:execution.lease.reservationId,branch:task.branch,head,prNumber:pull.number,
            originalExecutionId:`chatgpt-${commentId}`};
          const evidenceSha256 = hash(JSON.stringify(evidence));
          const evidenceRef = `proofs/chatgpt-${commentId}-recovery-${evidenceSha256}.json`;
          // A distinct read-only recovery receipt does not reopen a terminal
          // source execution, dispatch a writer, acquire a lease or replay CAS.
          const receipt = createExecutionReceipt({repository:REPO,issueNumber,prNumber:0,branch:task.branch,
            sourceHead:head,workerId:'chatgpt-github',workerType:'github-first',
            executionId:`chatgpt-${commentId}-recovery`,leaseKey:`chatgpt-${commentId}`,
            timestampUtc:now(),state:'queued',phase:'SOURCE_PUBLICATION_RECOVERED',sequence:1,
            proofRefs:[evidenceRef],expectedNextAction:'Continue the original PR through existing protected review and merge.'});
          if (!validateExecutionReceipt(receipt).valid) stop('RECOVERY_RECEIPT_INVALID');
          const persisted = await appendReceipt(receipt,{task,lease:execution.lease,head,prNumber:pull.number,
            evidence,evidenceRef,evidenceSha256});
          if (persisted?.ok !== true || persisted.evidenceSha256 !== evidenceSha256)
            stop('RECOVERY_RECEIPT_PERSISTENCE_UNPROVEN');
          execution = {...execution,head,prNumber:pull.number};
        } catch (error) {
          return {verdict:'HELD',blocker:error.code || 'RECOVERY_HOST_OR_RECEIPT_FAILURE',branch:execution.branch};
        }
      }
      const pull = await request(`${ROOT}/pulls/${execution.prNumber}`);
      if (pull.number !== execution.prNumber || pull.head?.sha !== execution.head
        || pull.head?.ref !== execution.branch || pull.head?.repo?.full_name !== REPO
        || pull.base?.repo?.full_name !== REPO || pull.base?.ref !== 'main')
        return {verdict:'HELD', blocker:'PR_IDENTITY_CHANGED'};
      if (pull.merged !== true || !SHA.test(pull.merge_commit_sha || ''))
        return pull.state === 'closed'
          ? {verdict:'HELD',blocker:'PR_CLOSED_UNMERGED_PRESERVE_SOURCE',prNumber:execution.prNumber}
          : {verdict:'AWAITING_EXISTING_CI_REVIEW_AND_PROTECTED_MERGE', prNumber:execution.prNumber};
      // Separate trusted collector proves actual protected workflow/environment,
      // exact reviewed head/base and immutable review artifact. We never approve.
      if (await confirmProtectedMerge({execution, pull}) !== true)
        return {verdict:'HELD', blocker:'PROTECTED_MERGE_RECEIPT_UNPROVEN'};
      const result = await completeAndRefill({execution, pull});
      return {verdict:result?.completed === true ? 'MERGED_SOURCE_TASK_RECONCILED' : 'HELD',
        blocker:result?.completed === true ? '' : 'CANONICAL_COMPLETION_OR_REFILL_UNPROVEN',
        mergedHead:pull.merge_commit_sha, prNumber:execution.prNumber,
        // The canonical controller must separately prove actual next pickup.
        unattendedRefillProven:false, battleBridgePickupProven:false};
    },
  });
}
