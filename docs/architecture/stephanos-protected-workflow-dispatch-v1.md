# Stephanos Protected Workflow Dispatch V1

Status: source-built, runtime-unproven

## Purpose

Close the controller/tooling gap proven during Forge commissioning when PR #1805 was fully reviewed and mergeable but the active ChatGPT GitHub connector exposed direct PR merge without exposing GitHub Actions `workflow_dispatch`.

The repair does not add a new mailbox operation, transport, worker, scheduler or merge engine. It extends the existing `EXECUTE_PROTECTED_OPENCLAW_PR_MERGE` Battle Bridge mailbox adapter with a second, clean-review mode.

## Modes

`qualified-operator-bootstrap` remains the existing path for approval-boundary self-changes. Its OpenClaw authorization and bridge behavior is preserved.

`clean-independent` is the new dispatch-only mode for an ordinary PR whose exact head/base already has a clean immutable Independent Merge Security Review.

The clean path:

1. revalidates the live PR identity and mergeability;
2. revalidates all required hosted checks;
3. revalidates the exact independent review run, attempt and job;
4. revalidates the immutable artifact metadata and payload SHA;
5. requires high-risk specialist assurance, `verdict=clean` and zero findings;
6. revalidates the exact current `main` SHA;
7. derives the exact source head tree from GitHub rather than caller input;
8. dispatches only `.github/workflows/operator-merge-approval-gate.yml` on `main` with the canonical `user-owned-protected-squash` inputs;
9. returns the resulting workflow run identity when immediately observable.

The mailbox does not call `gh pr merge`, write `main`, approve the protected environment, bypass rulesets, or replace the workflow's evidence/approval/merge jobs.

## Read-only failed-attempt continuity

A same-head/base workflow dispatch remains a replay by default. A later workflow may proceed only when live GitHub job evidence proves all of the following for each prior matching run:

- the run is completed with conclusion `failure`;
- GitHub's all-attempt job view contains one complete authority-job triplet for every run attempt;
- in every attempt, the exact `personal-repository-evidence` job completed with `failure`;
- in every attempt, the exact `operator-personal-repository-approval` job completed as `skipped`;
- in every attempt, the exact `operator-personal-repository-squash-merge` job completed as `skipped`;
- every authority job binds the same repository, parent run ID, attempt, dynamic workflow name, main head/branch, API job/run/check URLs and GitHub HTML run/job URL;
- the three jobs have unique positive GitHub job identities; and
- the summed attempt count across the complete prior-run job-proof estate stays within the fixed bound before hydration.

The normalized run, attempt and complete parent-job envelopes are included in the revalidated evidence packet and therefore in its SHA-256. Missing earlier-attempt jobs, cross-run substitutions, inconsistent URLs, an active, successful, cancelled, malformed, duplicate, unbounded, approval-started or merge-started prior attempt remains blocked. Failed run deletion is not an accepted recovery path.

## Approval separation

The two modes use different explicit approval tokens:

- bootstrap: `APPROVE_OPENCLAW_SQUASH_MERGE:<pr>:<head>`;
- clean workflow dispatch: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:<pr>:<head>`.

A clean review cannot carry a bootstrap finding code, and the bootstrap token cannot authorize the clean dispatch path.

## Forge consequence

After this adapter change is separately reviewed and protected-merged, the canonical #1507 mailbox can dispatch the already-trusted protected merge workflow for PR #1805 even when the current ChatGPT connector lacks a native workflow-dispatch action.

That removes the control-plane bottleneck without weakening merge governance. Forge commissioning then resumes at: merge #1805 -> exact-main Battle Bridge sync -> fixed Podman 6.0.2 prerequisite -> resolver-produced Forgejo digest -> fresh M2 -> M3 artifacts -> bounded M3 execution -> measured capacity -> first genuine Forge build.
