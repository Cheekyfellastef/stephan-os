# Goal #2315: mailbox-free Goal Discovery, Stage 2 source candidate

**Existing owner:** Goal #2315 — Automatic canonical mailbox rollover before GitHub comment ceiling. Downstream original owners: Goal #2961 (canonical Mission Worker), Goal #1574 (provider-neutral source builder and reviewer), Goal #2573 (Sovereign Commander). This is a source-only continuation of protected-merged PR #3286, not another controller, scheduler, worker, queue, mailbox, lease, source writer or acceptance authority.

## Why the second stage is necessary

A genuine protected-main workflow_dispatch of the read-only Control Tower already succeeded at GitHub Actions run **40573665291** (27 October 2026, 19:57 UTC), inspecting existing Goal #2961 from exact protected main c456bc0a0c97c7b267c8b4916fcd82ad90f52f8c. The inspect-goal job was successful, and the genuine immutable artifact 12765876671 carries READ_ONLY_OBSERVED. Archive SHA256: ee7610367d6ea027a31e7d6b03cdb691a15c3f85d8b2a6e9c1da723353dd0545. No canonical mailbox comment or Codex capacity was consumed by that event.

That output is **observation only**, not permission for a builder to start. The remaining dependency is a safe means for an independently trusted existing recipient to inspect that evidence without misclassifying it as task admission.

## What this PR provides

The pure shared module mailboxFreeGoalDiscoveryV1.mjs and focused tests:

- Correlate the original GitHub workflow ID, canonical repository/owner numeric IDs, event type, attempt 1, main SHA, actual completed inspect-goal job and intentionally skipped PR-only test job.
- Require the exact named, unexpired GitHub Actions artifact with matching run ID, SHA, bounded size and SHA-256 archive digest.
- Decode **one** bounded ZIP entry named stephanos-mailbox-free-readonly-proof.json in memory. Fail on extra ZIP entries, unexpected paths, inconsistent central/local metadata, invalid CRC, oversize compressed or inflated data, unknown input fields or malformed JSON.
- Verify the proof binds the same run, original goal, source, timestamp and exact read-only authority-denial flags. Confirm the original GitHub goal is still open and the trusted caller independently observed the same current protected main.
- Return a frozen DISCOVERY_CANDIDATE_ONLY projection that always explicitly denies source mutation, exclusive claim, native pickup, protected merge and execution.

**Important:** This classifier does not fetch or authenticate GitHub metadata or the archive by itself. Its input MUST be provided by a separately qualified, read-only existing host adapter that authenticated the GitHub API response and source, fetched exact artifact bytes and independently checked current owner, source and resource state. Synthetic injected test envelopes are only fixtures. Consequently even the positive classifier result sets independentlyAuthenticatedTransport=false. There is **no** automatic GitHub-to-physical intake, source task reservation, task execution, or native host installation in this PR.

## Exact limitations and next acceptance

- All work is additive and disjoint from the existing #3287 main-advance artifact producer. No edits to the mailbox-free pilot workflow, retired #3149, inactive #3258, existing original #3268 activation, Mission Worker or host executables.
- Focused command: node --test shared/agents/mailboxFreeGoalDiscoveryV1.test.mjs. Run the complete existing hosted CI and independent exact-head security review before a separately authorised protected merge.
- Stage 2 operational acceptance requires a REAL, authenticated trusted-host GitHub read of current run/job/artifact/main/goal; this deterministic classifier alone never claims it. The existing source executor must still obtain real original owner/task, resource and cross-plane custody, exclusive reservation, functional source edit and tests, immutable commit, independent review and protected merge.
- Keep gaming priority and source/OS leases. No R7 replay, no forced host process or lease release, no automatic retry of exhausted mailbox tasks, no source/worker claims from an Actions success, and no sixth hourly controller.
