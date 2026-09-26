# Universal Project Chat Bootstrap V1

Owner: #1418 — Operator Attention & Completion Loop V1

## Purpose

Every Stephanos/OpenClaw project chat must recover current programme truth from canonical machinery before it denies capability, declares a global blocker, creates work, or selects a mutation lane. Chat-local memory is never the system of record.

The existing ChatGPT Shared Workspace `READ_CURRENT_STATUS` response carries the canonical `projectChatBootstrap` projection. A new chat should consume that projection before acting on the project.

## Mandatory startup order

1. Read `AGENTS.md` for repository-wide operating doctrine and authority boundaries.
2. Read this runbook.
3. Issue or consume canonical `READ_CURRENT_STATUS` and require a `projectChatBootstrap` projection.
4. Verify the projection is bound to an exact 40-character GitHub `main` head and that the Windows checkout reports the same head.
5. Inspect the embedded capability registry summary before saying a capability does not exist or asking the operator to do work manually.
6. Inspect Shared Workspace current goal/status/proof plus the operator-attention and active-execution-lane discovery routes before creating a goal, branch, pull request, controller, worker, scheduler, monitor or mutation lane.
7. Continue from the newest durable receipt when one exists. Do not rebuild verified work merely because one execution or publication surface failed.
8. Use an already-qualified alternate route when one exists. Only report a global blocker after registered routes have been checked and all applicable routes are unavailable or invalid.

## Fail-closed conditions

The bootstrap is blocked when any of these are true:

- canonical GitHub `main` head is unproven;
- canonical Windows checkout head is unproven;
- GitHub `main` and the Windows checkout do not agree;
- Shared Workspace aggregation is blocked;
- the capability registry is invalid.

A blocked bootstrap does not authorize guessing, duplicate work, or a bypass. It means the chat should repair or explicitly surface the typed bootstrap blocker while preserving existing mission/goal/branch/PR identity.

## No-orphan rules

Before creating new work, recover the current owner and active lane from shared truth. Preserve existing exact goal, issue, branch, PR, lease and receipt identities whenever they already exist. A route failure is not permission to create a second implementation lane.

Before declaring `cannot`, `blocked`, or `unavailable`, discover approved workspaces and registered capability routes. Missing `gh`, an exhausted provider, a failed ChatGPT GitHub write, or one broken UI path is route-specific evidence, not global incapability.

## Operator boundary

Operator approval must never be inferred from the bootstrap, chat memory or a previous run. Exact consequential approvals remain separately bound to their normal head/base/action identity and protected gate.

## Acceptance invariant

A new project chat that consumes `READ_CURRENT_STATUS` must receive enough source-controlled information to answer all of these without relying on a previous conversation:

- what exact `main` head is current;
- whether the physical checkout agrees;
- which canonical capabilities and alternate routes exist;
- where current Shared Workspace truth lives;
- where operator attention and the active execution lane are discovered;
- which runbooks govern operation;
- which actions are forbidden until bootstrap discovery has completed.

If a new chat cannot recover those facts, universal project-chat bootstrap is not complete.


## Work-conserving cycle requirement

Every project chat/controller using this bootstrap must consume the canonical shared policy owned by #1947/#1903 and elastic width owned by #1637. After every material action, recompute proven-safe free capacity and eligible resource-disjoint work. A waiting CI/review/provider/approval lane parks only that lane. Do not return while the shared policy reports safe eligible work plus proven-safe free capacity. Do not create a private scheduler, queue, worker, lease plane, or standalone scheduled controller to achieve this.
