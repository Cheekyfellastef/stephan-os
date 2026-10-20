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
   - exact owner-authored #1507 command;
   - exact repository, PR, branch, head, tree, current main/base and immutable review identity;
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

A command is accepted only when the GitHub issue comment is authored by `Cheekyfellastef` on issue #1507, carries `operatorApproval=operator-approved`, expires within ten minutes of authorship and contains no fields outside the fixed schema.

Every action independently re-reads current GitHub state. Head, tree, branch, base/main, repository or PR movement blocks the action. Review run/attempt/artifact/digests remain mandatory so the same durable operator packet cannot be detached from its assurance evidence.

## No arbitrary mutation surface

The ready route contains one source-controlled GraphQL mutation literal. Callers cannot supply a query, URL, workflow, ref, shell command, executable, token, credential or additional input. The merge route contains one fixed workflow/ref and fixed input set.

## `BLOCKED_WITH_OWNER` consequence

When an authorised lane is blocked only because Stephanos lacks a client-side ready/dispatch control, the canonical controller may reuse this one #1507 path. It must still re-read current identity and authority first, and it must never convert a genuine operator-approval/runtime/spend/credential boundary into automation.

The first live acceptance is a real exact #1951 draft-to-ready transition through this mailbox, followed by the ordinary protected source-admission path. That proves the automation debt is removed; it does not make five-lane runtime capacity live.
