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

## Native backend source continuation

`SovereignCoreJobCustodyV1.cs` now implements a real Windows Job custody
qualification primitive. `PROC_THREAD_ATTRIBUTE_JOB_LIST` assigns the suspended
fixed child atomically at creation, closing even the parent-crash window before
traditional assignment. The non-inherited, unnamed Job has kill-on-close and a
one-process limit; breakaway is absent, so descendant launch is denied. The
worker is a closed benign PowerShell probe, never an installer, source writer,
service/task command, user script or caller-selected executable. The original
continuous mutation guard remains in force.

Hosted Windows exposed a test-boundary defect: `Start-Process` may use shell
launch behaviour, which is not a direct CreateProcess containment test. The
fixture now uses explicit `UseShellExecute=false` and requires the direct child
attempt to be denied. Job Objects are NOT a security sandbox: shell/COM/task/
service brokers must be excluded by the closed, independently reviewed worker
scope, not asserted to be contained by an active-process limit. No arbitrary
PowerShell/candidate script may be admitted through this primitive.

The native monitor rechecks the governor before creation/resume and every 25ms,
signals cooperative cancellation on gaming/cancel/deadline, waits boundedly for
acknowledgement, terminates only its own Job and queries zero active processes
plus a signalled process handle before releasing custody. Parent death closes
the kill Job; Commander pipe EOF/cancel also stops the same request. No missing
terminal receipt is interpreted as success or an automatic fresh retry.

The read-only preflight compiles the installed-parent C# dependency from a
single captured stdin buffer, not a mutable Add-Type pathname. It strips ambient
execution settings, reads only the fixed canonical governor location and pins
all ancestor directory identities and final file with native non-reparse
handles; the final file denies concurrent writers. Candidate receipt projection
requires exact request/head, acknowledgement, zero-active OS witness and all
authority flags false. It cannot enroll a backend or trigger repair.

Windows fixture tests exercise normal completion, game onset, operator cancel,
deadline, descendant denial, parent death, pipe EOF, governor ancestor junctions
and concurrent file writers. These are real kernel API tests using benign fixed
workers and temporary fixtures, not Battle Bridge repair/commissioning. Hosted
Windows repeats them; Linux exercises projection/denial tests.

Remaining semantic/activation gap: no fixed mutating Core-only worker is admitted
to this primitive. The full Core Daemon starts Outer Bridge, dependency repair
and Flywheel/writer paths, so placing that daemon in a Job would NOT make it
resource-disjoint from R7. Defining a strictly bounded Core-only mutation,
protecting/versioning its installed parent closure, independent Windows review
and physical governor/crash qualification remain required. Source presence and
a passing benign probe do not authorize live maintenance. No specialist review
is requested while this known gap remains.

API rationale: [Microsoft atomic Job-list launch guidance](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812)
and [Job accounting queries](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject).
