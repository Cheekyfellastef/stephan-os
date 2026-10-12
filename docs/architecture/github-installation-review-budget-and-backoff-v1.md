# GitHub installation review-throttle repair (#2954)

## Physical failure

On 12 October 2026 GitHub's hosted independent-security and exact-head review
jobs failed their **first required GitHub PR GET** with HTTP 403
`API rate limit exceeded for installation`. Their preflights had just reported
more than 4,600 of 5,000 `resources.core.remaining`. This does **not** prove
that the primary core quota is exhausted or that the install token differs from
the preflight token. The effective cause may be secondary/abuse throttling,
stale budget reporting, competing installation consumers or another rate scope.

A larger reserve or immediate blind retry cannot solve this evidence.

## Bounded admission repairs

- The **exact-head-review-dispatch** fallback scan now runs at 15-minute
  intervals instead of every five minutes, reducing scheduled discovery
  activations from 288/day to 96/day. The two newest operator PRs are still
  considered every pass, while the 10-PR rotating window uses matching
  15-minute epochs. This avoids systematic starvation of old PR cohorts.
- Completed independent security reviews are now the **single**
  `workflow_run` event that wakes coordinator discovery. Previous distinct
  completions for five ordinary CI workflows (OpenClaw, PR Clean Guard, UI,
  Publisher and Dispatch Queue) also woke the same coordinator repeatedly.
  Their ordinary PR CI gates remain mandatory and unchanged.
- Within each coordinator matrix the concurrent PR recovery count drops from
  four to one. This bounds token/API bursts from one coordinator run, without
  eliminating immediate owner comments or direct PR verification triggers.
  Existing exact-PR locks, immutable handoff, qualified security reviewer and
  original merge policy are preserved.
- Periodic Pages fallback deploys every 30 minutes rather than 10 minutes.
  Its existing self-contained build and hosted hydration tests **still run**.
  Five independent PR suite jobs stop redundantly rerunning on each scheduled
  Pages deployment. They still run for PR/push/manual triggers.
- Review workflows **still fail closed** when they cannot obtain authenticated
  current-head or required specialist evidence. No rate-limit report is
  treated as a review pass; no alternate identity or unqualified source can
  certify a protected merge.

## Qualitative load reduction

- Scheduled exact-head fallback: approximately 67% fewer planner invocations.
- Periodic Pages catch-up: approximately 67% fewer scheduled deployments and
  no repeated five-job suite fanout on those fallback runs.
- Completed CI workflow-run notifications: five redundant review-planner
  trigger families removed; independent security-completion still wakes.
- Per coordinator: up to one simultaneous PR-scoped recovery worker instead
  of four.

These reductions are **not** a promise that GitHub will cease returning
installation 403s: other callers and GitHub's own secondary thresholds are
outside this slice. Proof requires stable first PR GETs in **both** independent
review types, clean immutable artifacts, and sustained meter telemetry
without rate-limit warning.

## Keep the Core Daemon rescue moving

Do **not** dissolve the parallel Core rescue work. Original #2962 r7 lease
binding remains HELD. Its actual Core singleton / loaded-code repair is PR
#3062. That independent protected review is a first-class validation target
of this throttle: gate success must precede protected merge, followed by
Battle Bridge `processCount=1`, upgraded bridge heartbeat and actual
`sovereign-outer-bridge-current.json` run evidence. Neither source sync nor a
fresh UI health light counts as physical worker pickup.
