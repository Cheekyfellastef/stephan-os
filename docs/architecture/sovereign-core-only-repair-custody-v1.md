# Core-only repair custody (#2961 / PR #3188)

Structural review: the broad control-plane reconciler is not disjoint from R7.
It starts controller installers and scheduled work outside a Node timeout's
custody. Sampling the governor before/after spawn cannot cancel active work.
The existing held-R7 branch remains observation-only and preserves its original
blocker. A matching degraded Core is projected separately with a typed
CORE_ONLY_CANCELLABLE_BACKEND_UNQUALIFIED blocker, never builder recovery.

The production continuous runner now refuses ALL mutating caretaker, builder
and control-plane children that lack native Windows Job custody, including the
caretaker launched before the original builder's lease state was known. It may
run the existing read-only Core status action. Neither a missing exit status,
timeout, parent exit nor a child-authored custody flag proves descendant
exclusion or releases custody. This deliberately reduces unattended repair
availability rather than admitting uncontained Windows work. Explicit manual
repair remains under existing operator/review gates; this is not deployment.

Automatic Core repair remains BLOCKED pending an independently qualified native
backend in the existing Commander executor. Its fixed scope must exclude R7
source/lease/writer operations, worker/watchdog/recovery controllers, Task
Scheduler and service-control escape paths. It must create a suspended fixed
child, assign it to a kill-on-close Job before resume, deny breakaway, observe
governor/cancel/deadline changes while running, await cancellation acknowledgement
and positively witness zero active descendants before releasing original
execution custody. Failure/timeout retains original ownership; never silently
retry as a new mission. Durable recovery must reuse existing canonical receipt
and owner machinery, not introduce another scheduler or lease. No status JSON
or caller boolean can enroll this backend. Qualified Windows review and physical
game-onset, descendant and crash acceptance remain required before activation.

The source regressions and exact-head Windows/Linux hosted jobs prove denials
and projection integrity only. They do not claim an installed Job Object backend,
cancellable Core repair, physical Windows custody or original R7 exclusion.
