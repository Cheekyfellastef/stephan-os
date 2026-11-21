# Stephanos Protected Workflow Dispatch Mailbox V1

Status: source-built; live only after protected admission and an exact receipt proves a real lifecycle action.

## Authenticated fast-mailbox actor handoff

The canonical mailbox is now the current source-defined canonical mailbox. Its owner-authored issue-comment event
dispatches the protected merge workflow using `github-actions[bot]`. That is a
carrier identity; it does not inherit `Cheekyfellastef`'s operator permissions.
The direct owner transport remains supported. Other carriers fail closed.

`prove-protected-workflow-actor-handoff.mjs` reads the exact comment from GitHub
and verifies the canonical issue, owner, comment ID, unchanged created/updated
timestamps, and every dispatched branch/head/tree/base and review
run/attempt/artifact/archive/payload hash. The workflow must start inside the
comment's ten-minute dispatch window. Its original server-authenticated start
time remains binding after an operator spends time at the protected approval
gate. Reruns cannot renew that window or execute a second attempt.

The initial trusted read produces a SHA-256 of the entire comment body. That
digest crosses the read-only evidence/approval handoff and is independently
rechecked by the existing final collector in evidence, approve and merge modes.
The evidence packet binds both the owner and the actual carrier to the digest.
No caller-supplied operator identity or overridden `GITHUB_TRIGGERING_ACTOR`
is used. Ready mode continues to require its existing direct owner actor.

Prior owner and bot transports both participate in the existing replay fence.
Only its existing complete all-attempt read-only failure proof can qualify a
prior failure for a fresh dispatch; missing jobs or any reached authority job
remain blocking. The protected environment, immutable independent review,
ruleset proof and exact final source checks remain required.

Incident: owner comment 6134973687 for PR #3085 dispatched run 38325327489,
which failed at the first actor gate because the carrier was the bot. That
expired command is evidence of the incident, not a fresh dispatch authority.
The separate `controller-lane-status` request
`plus-fast-mailbox-lane-proof-20261013-0006-v1` is terminal `BLOCKED` with
`SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_RECEIPT_INVALID` (comment
6134973771). This source repair makes no claim of live lane proof or release of
the original source lease.

The authenticated owner recovery run 38333422069, attempt 1, subsequently
passed both read-only actor/comment gates and received the real protected
environment approval. Final collection stopped with mutationAuthority=false
on personal-repository-check-run-not-exact-green. The captured 19-check estate
reproduces that rejection: the sole blocked check is pages-deploy in the
successful Build Stephanos UI pull_request run 38323074626. The source-controlled
Pages job explicitly excludes pull_request; requiring its live deployment to
admit a PR would contradict that separation.

The final validator now recognizes that one excluded PR deployment only after
exact repository/PR/head/base/suite/job binding, canonical workflow/path/name,
pull_request event, source head branch, and completed successful parent run
proof. Other skipped, failed or pending checks remain blocked; push, dispatch,
schedule and issue-comment deployment failures are not made neutral. Required
workflow and protected approval gates remain independently binding. Run
38333422069 reached an authority job and must not be rerun or treated as an
early read-only failure. This source correction is not admission of that run.

## Purpose

This is the existing #1507 GitHub-hosted owner-command bridge for the narrow lifecycle actions that otherwise strand Stephanos when an active client does not expose GitHub Actions `workflow_dispatch` or draft-to-ready mutation.

It remains one mailbox and one target repository. It creates no second scheduler, controller, worker, merge plane, generic GitHub API surface or arbitrary GraphQL endpoint.

## Closed-world operations

Exactly two operations are supported:

1. `MARK_PROTECTED_PR_READY` / `user-owned-pr-ready`
   - exact owner-authored command on the source-defined canonical mailbox (currently #3149; #1507 is historical);
   - exact repository, PR, branch, head, tree and current main/base;
   - a complete immutable independent review selection enables the authenticated review handoff below;
   - uses only the fixed GitHub `markPullRequestReadyForReview` mutation against the REST-proven pull-request node ID;
   - never requests `Repository.fullDatabaseId`;
   - idempotently returns `ALREADY_READY` when the exact PR is already ready;
   - re-reads PR and main after mutation and requires the identity to remain exact;
   - grants no merge, deployment, runtime or provider authority.

2. `DISPATCH_PROTECTED_OPERATOR_MERGE` / `user-owned-protected-squash`
   - preserves the original #1808 behavior;
   - dispatches only `.github/workflows/operator-merge-approval-gate.yml` on `main` with the existing exact 11 inputs;
   - requires the PR already be non-draft;
   - the protected target workflow remains responsible for merge evidence, approval and final exact-head merge validation.

## Operator and identity boundary

A command is accepted only when the GitHub issue comment is authored by `Cheekyfellastef` on the source-defined canonical mailbox, carries `operatorApproval=operator-approved`, expires within ten minutes of authorship and contains no fields outside the fixed schema.

Every action independently re-reads current GitHub state. Head, tree, branch, base/main, repository or PR movement blocks the action. Review run/attempt/artifact/digests remain mandatory for merge and for the new READY review handoff. Legacy READY packets without a complete selection retain their existing transition behavior and do not produce a review handoff.

## No arbitrary mutation surface

The ready route contains one source-controlled GraphQL mutation literal. Callers cannot supply a query, URL, workflow, ref, shell command, executable, token, credential or additional input. The merge route contains one fixed workflow/ref and fixed input set.

## `BLOCKED_WITH_OWNER` consequence

When an authorised lane is blocked only because Stephanos lacks a client-side ready/dispatch control, the canonical controller may reuse this source-defined canonical mailbox path. It must still re-read current identity and authority first, and it must never convert a genuine operator-approval/runtime/spend/credential boundary into automation.

The first live acceptance is a real exact #1951 draft-to-ready transition through this mailbox, followed by the ordinary protected source-admission path. That proves the automation debt is removed; it does not make five-lane runtime capacity live.

## Authenticated READY review lifecycle (#2094, #1802, #1574)

### Defect and scope

The fixed ready mutation uses `GITHUB_TOKEN`. GitHub does not start the required
`pull_request_target` review from that token's `ready_for_review` event. A genuine
independent clean review therefore coexists with the original draft-skipped
`exact-head-review` check. The original #2094 clean-boolean skip waiver is
superseded by a real, authenticated review execution and immutable provenance.

GitHub documents `workflow_dispatch` and `repository_dispatch` as explicit token
exceptions. Current documentation also describes approval-required
`pull_request` events for opened, synchronize and reopened; that exception does
not supply `ready_for_review` or `pull_request_target` review evidence. See
[GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token)
and [triggering a workflow](https://docs.github.com/actions/using-workflows/triggering-a-workflow).
This correction uses the existing token and existing exact-head workflow. It
does not need another credential or provider review request.

### Admission and immutable chain

The new route requires all five independent review fields in the original,
unchanged owner READY comment: run ID, run attempt, artifact ID, archive digest
and payload SHA-256. It reuses the canonical actor/comment validator and existing
independent workflow, job and artifact validators. Missing fields never authorize
selection of a different review later.

| Stage | Actual source and event | Required evidence |
| --- | --- | --- |
| READY producer `dispatch` | Exact event main SHA, `issue_comment` | Canonical unchanged owner comment, exact PR/head/tree/base, original ten-minute window, selected independent artifact; new draft transitions require clean review and zero unresolved threads |
| Fixed dispatcher `review-ready` | Same main SHA and producer run | Completed successful READY job and immutable single-file handoff; complete bounded duplicate inventory; one fixed dispatch followed by observation of its exact bound run |
| `exact-head-review` target | Exact main/base SHA, real `workflow_dispatch` | The same owner selection, completed producer job, active or successful producer transport job, current non-draft identity, full current PR diff |
| Protected merge collector | Existing trusted-main protected workflow | Completed successful target run/job/check and entire producer run/jobs, immutable artifacts and hashes, fresh owner and independent evidence, exact current identity |

Both source checkouts are pinned. The executing checkout, `GITHUB_SHA`,
`GITHUB_WORKFLOW_SHA`, workflow ref, repository, event, job, run and first attempt
must agree. A queued run cannot execute a later main checkout and label it as an
older source. The target never executes candidate-branch code.

The producer seals `protected-ready-review-handoff.json`. Upload occurs in the
READY producer job; a separate dependent job dispatches only after that job
completes successfully. The target's six fixed string inputs are `pr_number`,
`source_head`, `base_sha`, `ready_run_id`, `ready_artifact_id` and
`ready_receipt_sha256`. Branch, tree, owner comment and independent review
selection are derived from the immutable handoff. The fixed target is
`.github/workflows/stephanos-exact-head-review.yml` at ref `main`.

The target runs the unchanged deterministic engine over the complete live diff.
Actual findings still require the separate authenticated PR-owner escalation
comment and the unchanged qualification implementation. That escalation must
select the same five independent review fields as the READY packet. A READY
comment does not substitute for an escalation request, and independent evidence
does not supply an engine verdict.

The target uploads `protected-ready-review-receipt.json` as its own immutable
single-file artifact. The existing complete `review-proof/` artifact remains
available separately. The collector retains the strict one-entry ZIP parser,
256 KiB bounds, redirect rules, metadata identity, archive digest and canonical
payload hash. It binds the complete engine input by patch and changed-files
digests, preserves the actual engine receipt and qualification mode, and records
the original owner escalation identity when required. Receipt-derived run,
artifact and comment IDs are validated as positive safe integers before they
can select an API path.

### Clean draft admission and existing bootstrap boundaries

Before a new complete-proof route changes a draft to ready, its independently
verified artifact must be `clean-independent`, with a clean verdict, empty
findings and an empty blocker. A draft with `qualified-operator-bootstrap`
findings receives `DRAFT_BOOTSTRAP_READY_NOT_AUTHORIZED`. A clean specialist
verdict alone is not a clean whole-review result.

The new draft transition also consumes the unchanged READY planner's zero-thread
requirement. A fixed read-only GraphQL query binds every page to the same open
draft PR, repository, branch, head and base. It reads at most six pages of 100
threads, verifies a stable total and unique thread IDs, and requires a boolean
resolution state for every thread. Unresolved, missing, truncated, changed or
unknown thread evidence blocks the transition. The owner window is rechecked
after collection, and the existing live PR/main/tree read occurs before the
fixed ready mutation. The immutable handoff records the proven zero count.
An already-ready no-op records no draft-transition thread assertion.

A PR already independently non-draft can use the existing qualified review
escalation. Its receipt remains `qualified-operator-bootstrap` and its engine
findings remain visible. This does not authorize an earlier ready mutation,
remove the residual operator bootstrap gate, or allow this source repair to
admit itself. `planProtectedReadyExecutionRoute` keeps its clean-only transition
semantics. Legacy field-free READY behavior is preserved for compatibility; its
missing review consumer is not a bootstrap workaround for #2094 or another draft
authority change.

### Replay, final authority and acceptance

The dispatcher reads the complete bounded exact-base workflow inventory before
launch. Any prior execution for the same PR/head/base, including failed,
canceled or still-running executions, prevents a second launch. `ALREADY_READY`
does not reopen that fence. The target also requires a unique matching run;
the collector rejects ambiguous or later conflicting runs instead of selecting
an older success. Reruns cannot renew the first-attempt or original owner-window
constraints. Existing specialist response-delay limits remain unchanged.

The launcher makes one POST. After its 204 response it performs at most six
read-only inventory observations, separated by five seconds, and must identify
one exact handoff-bound run while the launcher job is still active. It checks
the actual run's workflow, main/base source, actor, first attempt and creation
time, then refreshes the PR and inventory. A queued run proves only launch;
the target and final collector still require their respective running and
completed successful evidence. Missing, conflicting or expired observation
fails closed without a second POST or a renewed authorization window.

The final collector refreshes the entire lifecycle proof after its final
authority snapshot. A producer canceled after uploading evidence still blocks
admission, even if the target finished. PR/head/tree/base or draft movement,
edited owner comments, stale artifacts, failed jobs and changed run inventories
all remain blocking.

The historical PR-target check is retained verbatim as `skipped`. Only that
exact canonical check can receive a `reviewed-ready-lifecycle` disposition,
with the distinct later workflow's artifact-bound identity recorded alongside
it. The main-headed dispatch never becomes a synthetic PR check or an aliased
event. All unrelated checks, commit statuses, required workflows and existing
protected merge gates remain binding. A clean boolean by itself still cannot
admit the original skip.

All authority paths added to this chain are registered in the existing approval
boundary inventory, including rename coverage. Future changes therefore require
qualified review. The focused lifecycle, archive, replay, draft, permission and
collector regressions run through the existing protected source-proof npm task.
Unit fixtures prove the source contract; live acceptance still requires genuine
hosted producer and target artifacts after this repair's separate protected
admission. No fixture, local PASS, or candidate policy is live admission proof.
