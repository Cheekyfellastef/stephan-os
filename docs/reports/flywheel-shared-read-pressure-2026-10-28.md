# Flywheel shared read pressure repair

The first Flywheel latency repair (PR #3257) bounded each batch to 16 reads and
coalesced pending reads of one directory. Live hydration still sometimes crossed
the browser's 10-second deadline. A stalled member prevented a batch from
advancing, and three simultaneous directory scans could open 48 files. Directory
enumeration and the independent conversation read also added serial latency.

This second repair strengthens the shared read invariant: each reader function
has one FIFO allowance of 16 generic record reads across directories and roots.
Workers refill available slots without waiting for a whole batch. Independent
directories and the conversation projection start together. Results are assembled
in canonical directory order; record timestamps, validation, specialized-owner
exclusions, independent caller objects and pending-only coalescing remain intact.
There is no completed generic-record cache, history truncation or longer timeout.

Risk tier: standard source logic and shared projections. Review must cover queue
slot transfer after failures, deterministic ordering, current-state history
exclusion and freshness isolation. This source change grants no maintenance,
merge, deployment or source-lease authority.

## Proof

- The old implementation fails the stalled-file regression and reaches 48 active
  reads in the three-directory regression. The corrected implementation passes
  both and keeps its peak at or below 16.
- A gated directory test proves independent directories start while an earlier
  directory remains blocked, with errors still in canonical order.
- The old backend service fails the gated conversation test. The corrected
  service starts it alongside history and preserves its unavailable fallback.
- 122 tests passed across the feed, backend service, conveyor, dashboard API,
  brain state, Flywheel projection and conversation suites. The additional
  no-browser-cache test passed after supplying the isolated checkout's existing
  Express dependency (123 total passing tests).
- Three alternating, read-only comparisons against base
  `2c2e2e440551f21f93257d6b62f8d06a51d0597e` used the real workspace: 7,252 generic
  records and 358 conversation turns in every result, all ready with zero errors.
  Baseline durations were 4,718 / 3,749 / 3,311 ms; corrected durations were
  2,279 / 3,108 / 2,926 ms. The optional GitHub overlay was disabled and the
  conversation cache bypassed for these measurements. These separate-process
  comparisons do not prove live endpoint or browser stability under server load.

## Integration acceptance still required

Obtain independent review for the exact published head, pass required checks,
obtain exact-head operator merge approval, then use the existing guarded backend
update. Verify repeated real Flywheel polls and the browser's displayed state.
The separate maintenance-custody repair must prove release through its existing
owner before Control Tower build admission can be claimed. A faster feed cannot
establish that release or a productive build.

The reusable lesson is to bound aggregate I/O at the shared reader and replenish
slots independently. Bounding batches per consumer does not bound aggregate
pressure and makes unrelated work wait behind the slowest member. Full mission
closure remains pending live stability and Control Tower build evidence.
