# Stephanos Protected Workflow Dispatch Mailbox V1

Status: source-built; live only after protected admission and an exact receipt proves a real lifecycle action.

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
