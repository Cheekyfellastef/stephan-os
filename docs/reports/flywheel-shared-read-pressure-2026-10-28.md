# Flywheel shared read pressure and optional dependency repair

Updated 29 October: the same original PR #3300 source was reconciled without
rewriting history onto main `65ee8f787d00b91cd121032154e095646942e22a`. The original
`4475a685cd1e1433a70aa8671c2a446449716698` commit and its evidence remain in ancestry.
The prior review against `73e1a79c03cb9dafe8fb17d77a45a9ac502e32ce` does not qualify
the new combined head/base; a fresh independent review is required.

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

## Optional dependency invariant

The 29 October live diagnosis found both real data routes exceeding 10 seconds
while local records and the backend service with its diagnostic-only disabled
overlay returned within two seconds. A separate-process dependency trace spent
5,351 ms in GitHub authentication/telemetry; its environment did not reproduce
the production mission-operations configuration, so that measurement does not
attribute all live latency to GitHub. The old parallel join still waited for the
optional projection without a total budget. The earlier disk improvement alone
was therefore insufficient to establish live recovery.

The same shared backend service now gives the optional projection 2,500 ms.
Timeout or a busy reader returns an explicit unavailable live portfolio alongside
independently validated local evidence. No caller borrows another caller's result,
credentials, observation clock or authority. Late completion cannot modify an
already-returned feed, and the next admitted read obtains fresh evidence.

This is an aggregate admission bound, not a claim of cancelling underlying I/O.
The existing upstream timeouts retain cancellation ownership. At most one
unfinished optional read per reader function remains admitted, even after its
caller times out; subsequent callers use local fallback immediately. The slot
is released only when the underlying operation settles, including rejection.
A permanently stuck optional read thus remains unavailable without creating an
unbounded background queue. Other users of the direct live-projection service
are outside this dashboard adapter's admission scope. A blocked JavaScript event
loop cannot be preempted by a timer; live load acceptance remains required.

The complete dependency model is: required local records retain their validation
and freshness checks; optional upstream evidence has both a response deadline and
an unfinished-work bound. A local ready feed never upgrades unavailable GitHub
or maintenance authority. No frontend timeout or authority gate is loosened.

## Proof

- The reconciled combined revision passes all 126 tests across the nine suites
  listed below, including the new real-router deadline regression. The initial
  123-test result is retained as historical evidence of the original queue change.
- The old implementation fails the stalled-file regression and reaches 48 active
  reads in the three-directory regression. The corrected implementation passes
  both and keeps its peak at or below 16.
- A gated directory test proves independent directories start while an earlier
  directory remains blocked, with errors still in canonical order.
- The old backend service fails the gated conversation test. The corrected
  service starts it alongside history and preserves its unavailable fallback.
- New service regressions cover optional deadline, repeated polls while work is
  still pending, late completion, fresh retry, successful reads and rejection.
- A real Express router test exercises both Flywheel hydration and Goal Dashboard
  HTTP paths with GitHub deliberately stalled. Both deliver current local data
  with unavailable optional truth, their original scope and no-store headers;
  only one upstream read starts. It passes in about 2.6 seconds and fails against
  the preserved pre-deadline service. This is fixture route proof, not an installed
  production or browser acceptance result.
- Combined command: `node --test shared/agents/shared-workspace-dashboard-feed.test.mjs stephanos-server/services/sharedWorkspaceDashboardFeedService.test.js stephanos-server/services/sharedWorkspaceDashboardFeedService.goal-conveyor.test.mjs tests/shared-workspace-dashboard-api.test.mjs tests/shared-workspace-dashboard-cache-control.test.mjs tests/shared-workspace-dashboard-deadline-api.test.mjs shared/runtime/upliftWorkspaceProjectionV1.test.mjs shared/agents/sharedWorkspaceBrainStateDashboard.test.mjs stephanos-server/services/sharedConversationUpliftService.test.js`.
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
