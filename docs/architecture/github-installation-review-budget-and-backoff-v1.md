# GitHub installation review admission cooldown (#2954)

## Verified failure: primary quota is not reliable admission evidence

On 12 October 2026 both protected review jobs returned HTTP 403
`API rate limit exceeded for installation` during their first authenticated
PR GET. The rate-limit preflight had reported more than 4,600/5,000
primary-core requests available. This is evidence of an installation 403
not explained by *that* primary quota reading. We have **not** proven
whether the cause is secondary/abuse throttling, other installation consumers,
quota reporting disagreement, token scope, or another GitHub control.

Repeating the same review immediately does not repair this.

## Source-only review-admission throttle

Do not modify approval/security workflows to fix their own budget. That would
need a separate escalated independent review. The protected
`.github/workflows/exact-head-review-dispatch.yml`, independent security,
and exact-head gate files remain unchanged.

Instead `shared/agents/exactHeadReviewTriggerThrottleV1.mjs` applies
a **fail-closed, read-only admission decision before any coordinator API
read** inside `scripts/exact-head-review-dispatch.mjs`, only for its
`STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY` path:

1. Existing every-five-minute schedule: allow discovery in one five-minute
   window out of each fifteen-minute period. Return an explicit
   `REVIEW_DISCOVERY_TRIGGER_HELD` with empty targets otherwise.
   The 10-PR rotating discovery horizon is also fifteen minutes now, so
   the scheduled fallback cannot keep skipping specific old PR cohorts.
2. Existing `workflow_run` CI fanout: allow discovery **only** for an
   authenticated GitHub event with the original canonical Independent Merge
   Security Review workflow ID/name, completed and successful. Existing five
   redundant ordinary CI completions are no longer allowed to trigger an
   expensive PR-estate scan, although they still run all of their own tests.
3. Manual `workflow_dispatch`, direct owner PR comments and PR-target
   verification: **unchanged**. The operator's high-priority repair is not
   forced to wait for the fallback scanner.
4. Actual per-PR coordinator mutation, trusted review identity,
   independent/security/specialist review and protected merge: **unchanged**.
   The throttle never accepts a review or creates another reviewer identity.

The source-only path needs no new secret, credential, workflow trigger,
GitHub-token privilege, scheduled task or hosted service.

## Anticipated operational effect

For schedule-only traffic, roughly two-thirds fewer scans of the expensive
PR/comment/check estate. For ordinary CI `workflow_run` fanout, five
redundant trigger families produce zero complete-estate scans, while one
qualified completed security review still triggers immediately. The exact
resource saving must be measured from real GitHub calls and CI events.

This does **not** promise that GitHub cannot still return secondary
installation 403 from other consumers; reviewers continue to fail closed.

## Keep real Core Daemon repair as the next recipient

PR #3062 must remain in its original guarded lane until an independently
qualified exact-head review passes. Its purpose is to reduce two physical
Core Daemon processes to one and require a fresh loaded bridge heartbeat.
After protected merge/sync, the live recovery acceptance is:

1. One physically confirmed Core process and loaded bridge contract.
2. Fresh `outerBridgeRunCount >= 1` from Battle Bridge.
3. A separate source-head-bound `sovereign-outer-bridge-current.json`
   showing the original #2962 r7 lease terminal forensics.
4. Proof of canonical guarded lease release, material worker pickup,
   and two **unattended** refill cycles.

A source GitHub merge, healthy UI, or daemon heartbeat alone is not success.
