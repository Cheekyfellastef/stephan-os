# Stephanos Control Tower Stage 4: automatic read-only evidence check

**Original goal:** #2315, mailbox-free transport and original ownership continuity.

## Why

The canonical issue-comment transport #3149 has already reached 2,500 comments, and legacy #3258 cutover is independently held behind PR #3268 freeze/drain and host-proven status. Real original `workflow_dispatch` run #40600537747 on protected main `b2b3391456f8adbb768a9b27b094af17bb84f891` has successfully read Goal #2961 and produced immutable artifact #12777961834. Stage 3, merged PR #3290, already contains a bounded and tested read-only GitHub GET/ZIP goal evidence reader. However, no automatically installed after-run evidence check consumes this reader yet.

This scoped PR adds **one event-only validation workflow**, not a persistent controller, scheduler, mailbox, queue, worker, source lease, command bus, new role or protected merge route. It keeps the current manual Control Tower workflow and its exact two-job contract untouched.

## Event contract

- Trigger only when the **existing** "Stephanos Control Tower - Mailbox-Free Read-Only Pilot" GitHub Actions workflow completes.
- On actual post-merge `workflow_run`, admit only the exact canonical repository/owner, first-attempt `workflow_dispatch` event, protected main source SHA and a completed successful run.
- Run source-controlled trusted-main code, never the original PR branch's scripts. No untrusted dynamic code, user-provided URL, shell command, path, token, issue text or source edits.
- Provide Actions/contents/issues **read** permissions only, with no credential persisted in the checkout. Use the already-merged `readMailboxFreeGoalEvidenceFromGitHubV1` to independently fetch main, run, exact two-job estate, the single ZIP artifact (bounded signed redirect without forwarding GitHub bearer), original issue and main again.
- Validate the original sealed Stage-2 classification. Any source drift, wrong owner/ID, duplicated/stale run, wrong artifact, unexpected job, failed API, run/head/ZIP mismatch or expired evidence becomes `HELD`. It is **never** a task or goal admission.
- Publish only fixed, public-safe provenance scalars and explicit false authority flags in a 30-day Actions artifact. No secrets, raw issue body, command source, OS paths or filesystem output.
- The same PR's pull-request test job is unprivileged; `workflow_run` cannot run candidate-branch code. An honest source-review failure leaves this proposal uninstalled.

## Reality boundaries

A successful `READ_ONLY_GITHUB_EVIDENCE_CORRELATED` means a GitHub-hosted read-only observer has authenticated the original run metadata and artifact at an unchanged current main. It does **not** mean an installed Windows instance, Sovereign Commander, mission worker or original source lease received that event. Positive records retain:

`originalGoalAdmissionGranted=false`, `exclusiveClaimGranted=false`, `executionAuthorized=false`, `sourceMutationAllowed=false`, `protectedMergeAllowed=false`, `nativePickupProven=false`, and `independentlyAuthenticatedNativeCustody=false`.

No claims about CPU/gaming availability, verified processor identity, source editing, builds, review, merge, SOURCE/BUILT/SERVED or autonomous refill can follow from this workflow.

## Acceptance

1. Exactly four added files and zero changes to the existing main/scheduler/mailbox/mission/worker/grant source. PR CI executes negative contracts on exact head.
2. Independent exact-head source/security review and separately authorised protected merge, **never** assume earlier exception to #3286/#3287/#3288/#3290 applies here.
3. Only after protected integration, the next original-owner manual `workflow_dispatch` on current `main` must trigger an authentic **separate** readback job and artifact with correlation to exactly that source/goal/run. An old run cannot be retroactively considered fresh if the main SHA advanced.
4. The existing #2961 source owner must then separately integrate the result into the existing Goal Conveyor as nomination, not scheduler authority. Actual work still requires exclusive original task/custody/lease, focused tests, a useful commit, independently qualified review and protected operator integration.
5. Keep exactly five current hourly controllers, the old/new command-epoch records, original #3268 legacy activation and all historical lease/receipt state intact. No executable command to the saturated or inactive mailbox.

**Known limitation:** This adds an automatic GitHub **readback** after an existing manual command, not automated command issuance or PC pickup. The next command still originates from the operator until a separately reviewed and commissioned original-owner fixed-action route exists.
