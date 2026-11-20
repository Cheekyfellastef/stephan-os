# Goal #2315 | Mailbox-free Stage 3 authenticated GitHub reader (source-only)

This adds one bounded read-only GitHub evidence adapter, reusable by the existing original Goal #2315 Control Tower / Goal #2961 Mission Controller / Goal #1574 GitHub-first owner. It does not introduce a scheduler, queue, worker, lease, mailbox, source writer, native bridge or standing approval.

## Existing proven prerequisites

- Protected main already includes the original Goal #2315 Stage 1 Control Tower PR #3286 and the independently audited Stage 2 discovery classifier PR #3288.
- The first authentic manual GitHub workflow_dispatch run 40573665291 inspected original goal #2961, emitted READ_ONLY_OBSERVED and retained artifact 12765876671, independently verified ZIP digest ee7610367d6ea027a31e7d6b03cdb691a15c3f85d8b2a6e9c1da723353dd0545.
- A later protected main advance makes the original run a historical proof. The Stage 2 classifier rejects it for current execution/nomination. Never replay or relabel that old run as a fresh worker grant.
- Independently integrated main-advance observer PR #3287 produces a separate non-authoritative artifact without commenting on exhausted #3149; this adapter does not replace or consume it.

## New readback contract

The exported readMailboxFreeGoalEvidenceFromGitHubV1 accepts a positive numeric existing Actions run ID, an already-trusted host read-scoped GitHub token, a bounded fetch implementation, and a clock. It reads only canonical repository API endpoints:

1. Current protected refs/heads/main.
2. The exact Actions run and its authenticated owner/repository ID, source head, first-attempt workflow_dispatch metadata.
3. One exact two-job inventory and one bound original Actions artifact inventory.
4. The canonical single artifact ZIP endpoint, through precisely one authenticated GitHub API redirect to a bounded HTTPS artifact storage host, without forwarding the bearer token, and no arbitrary caller URL.
5. The original goal identified by the already bounded ZIP proof.
6. Current main again. Any drift, missing response, unknown status, oversized response, wrong actor, missing/extra job, wrong source, altered artifact, invalid ZIP or stale clock fails closed.

The reader reuses the existing Stage 2 classifyMailboxFreeGoalDiscoveryV1 and in-memory ZIP/CRC/SHA-256 proof, so the complete identity and authority-denial checks remain canonical. It performs GET only, has no write API, no configured task path, no repo override, no shell, no host filesystem mutation and no native execution.

Even a positive result remains DISCOVERY_CANDIDATE_ONLY, with independentlyAuthenticatedTransport=false, originalGoalAdmissionGranted=false, exclusiveClaimGranted=false, sourceMutationAllowed=false, nativePickupProven=false, executionAuthorized=false and protectedMergeAllowed=false. The false transport flag makes explicit that GET observations and injectable test fetchers are not an independently signed physical custody or command authority receipt. Only a separately qualified existing original host can attest and consume these readbacks.

## Verification and next operational gate

- Run the new 14 hostile tests alongside the original Stage 1 and Stage 2 contract tests, using the existing contract-test PR-only job. Leave the manual inspect-goal code, dispatch input, token permissions and runtime untouched.
- Require complete exact-head CI and independent security review. This is a SOURCE proposal; no merge is authorised by CI.
- After protected integration, prove a fresh real owner-initiated read-only workflow_dispatch on then-current main, then have an existing authenticated host perform the GET/ZIP/goal readback against the same run and current source. The original one-time 40573665291 run cannot pass the latest-main check by design.
- Stage 4, first useful supervised source build, separately requires a real original task grant, source/worktree and cross-plane custody, resource/gaming clearance, original lease/claim, physical pickup where native, functional edit, focused tests, committed ref, independent exact-head review, protected integration and installed SOURCE/BUILT/SERVED proof. No Stage 3 code or workflow success grants any of those.

Preserve #3149 as exhausted active command authority and #3258 as inactive until original legacy PR #3268's authentic freeze/drain and host convergence. Original R7 is retired with historical outcome UNKNOWN; never recreate its lease. Preserve all five original hourly controller identities and schedules.
