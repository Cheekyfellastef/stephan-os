# Goal #2315: mailbox-free Control Tower trusted-host readback, Stage 3 source candidate

Original upstream: PR #3286 (authenticated, proven read-only workflow_dispatch), PR #3287 (protected-main artifact instead of saturated issue comment), PR #3288 (protected-merged Stage 2 discovery-only classifier). Protected source at proposal: d39b6e6f5fab2e43c24c425b4d0a32798029e6f7.

## Current problem and bounded repair

The original real read-only run 40573665291 verified the operator, original Goal #2961, exact source at execution, immutable archive 12765876671 and READ_ONLY_OBSERVED. The Stage 2 classifier validates an already-read run/jobs/artifact/goal packet, but does not retrieve those envelopes or authenticate a live original host.

This Stage 3 proposal supplies a bounded GitHub GET-only reader factory that an existing independent host may install after its own qualified review. It is **not** installed or commissioned in the Mission Worker, Windows Battle Bridge, Sovereign Commander, Seed Forge, Rescue Islands or Control Tower scheduler.

## Trusted host contract

- A trusted original host supplies its own GitHub token, fixed HTTPS GET implementation and separately qualified bounded Actions ZIP downloader. It passes only a numeric run ID and expected original goal number. No task-supplied token, URL, path, command, shell or worker action is accepted.
- The source code reads protected main, an exact completed first-attempt, owner-authenticated workflow_dispatch Control Tower run, the complete exactly-two-job result, one bounded named Actions artifact and the one actual original GitHub goal. It checks main again after all IO and fails if it moved.
- Each GET endpoint is fixed or derived solely from validated numeric IDs. Responses are streamed under a 256 KiB ceiling and rejected on errors/redirects/invalid envelopes. There are no network retries, pagination loops, persistent writes or background process.
- The host-owned artifact downloader receives ONLY repository, numeric artifact ID and maxBytes, never bearer token or untrusted signed redirect URL. It must independently authenticate its own GitHub API/redirect/TLS boundary before production installation.
- The already merged Stage 2 SHA256/CRC/ZIP exact contract verifies the archive and produces DISCOVERY_CANDIDATE_ONLY, with independentlyAuthenticatedTransport=false, originalGoalAdmissionGranted=false, exclusiveClaimGranted=false, sourceMutationAllowed=false, executionAuthorized=false, nativePickupProven=false and protectedMergeAllowed=false. A passed source test or green workflow does not prove physical pickup.

## Original controller and authority separation

An independently qualified actual host implementation would still need to authenticate the private credential and downloader, existing original-goal source writer ownership, resource/gaming/lease custody, OS process identity, one-time claims and authority. This PR does not modify the current Mission Worker, controller, five schedules, original source checkout or existing canonical mailbox owner. Original #3268 legacy cutover remains separately held. No retired R7 release is attempted.

The next meaningful supervised source build requires original #2961/#1574 task admission with exact current head and scope, exclusive claim, real SELECT/CLAIM/PICKUP, material EDIT/TEST/COMMIT and independent protected integration. A current read-only discovery candidate is not equivalent.

## Focused tests and integration

Run node --test shared/agents/mailboxFreeGoalReadbackV1.test.mjs in the **existing** Control Tower pull_request-only contract-test job, alongside Stage 1+2 tests, with the same no-persisted-credentials checkout. Verify the real sanitized 668-byte Stage 1 ZIP and hostile fixtures: actor, workflow, repository, goal and source mismatches; stale/changed main, malformed/multiple jobs/artifacts, corrupt ZIP, network failures and oversized response. No change to existing manual workflow_dispatch or inspect-goal behavior.

Require complete current-head CI, independent qualified non-Codex review and separately authenticated original-owner protected merge approval. Previous approved emergency source-only exceptions for PRs #3286, #3287 and #3288 are not standing permission for this PR. No sixth controller, duplicate builder, queue, mailbox, new authority, paid Codex API, source lease release or runtime change.
