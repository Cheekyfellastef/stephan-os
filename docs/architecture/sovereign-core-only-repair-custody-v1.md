# Core-only repair custody (#2961 / PR #3188)

## 25 October 2026 live timeout and current-main convergence

At installed main `ca1dc9a8f634df7703e4d4815679d9d8fecdcdd4`, continuous cycle
`0a23c41a-124f-4776-97e8-e45ab0309b0b` ran from 09:55:02.674 to
09:55:56.241 UTC. Its canonical repair report records a successful caretaker
followed by `repair-goal-builder-flow` returning `ETIMEDOUT`. The HTTP owner
correctly retained `SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN`.
Manual `repair-ui-4173` is consequently unavailable. An idle health snapshot,
elapsed time, direct-child close or service reload cannot discharge that hold.

This continuation retains the existing branch/PR and integrates current main's
shared maintenance owner, terminal-receipt validation, worker admission and
reviewer pre-execution denial guards. Gaming checks and native-action
unenrollment are retained. No live process, task, lease or hold is changed.

The integrated source also distinguishes a fixed action rejected *before*
launch from a process whose exit status is unknown. A private in-process
identity marks the fixed runner's own no-launch denial. Its receipt records
`NOT_STARTED` without inventing a process exit code; actual launched failures
still carry their real status or null. Caller/child JSON flags cannot create
that private identity. The real repair-to-guardian regression verifies that
this denial stays BLOCKED while preserving manual admission, whereas an
actual observation timeout or forged no-launch claim retains the hold.

This prevents a new false hold after qualified activation; it does not recover
the already-held live cycle. That cycle still needs independently qualified
original-process exclusion and an admitted owner handoff. Existing Windows
native fixtures prove candidate containment only, not retroactive custody of
the uncontained live child. Do not add a clear-hold endpoint, substitute a new
request, restart around the hold, or enable the unenrolled native worker.

Durable invariant: no execution and unknown execution are different facts;
only the executor's own pre-launch decision can establish the former. Neither
fact may be turned into historical descendant-exclusion proof.

**Current disposition: SOURCE CANDIDATE ONLY, MUTATION UNENROLLED.** This
supersedes the earlier private-registration continuation below. Specialist
review of `085d0cd8087f038b26ab6d49c7d5462e59538b46` found uncontained Add-Type
compiler/scratch work, absent cross-process/restart exclusion and an unqualified
writable installed executor closure. The fixed action is removed from both
the production registry and advertised MCP actions. Even an authenticated
exact-head request cannot dispatch it. Candidate functions, fixtures and the
process-local admission work remain source preparation, not installed authority.

Structural decision: do not add another caller guard to paper over these three
missing trust roots. Before any future enrollment, independently qualify a
protected precompiled assembly (or contain the compiler's entire parent tree),
Windows-visible original-request exclusion surviving overlapping/restarted
Commander processes, and the complete protected/versioned installed executor
closure. Reuse the existing owner and receipts; no client flag or source hash
can commission those roots. No specialist or activation success is claimed.

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

## Fixed publication-directory repair candidate

The native implementation now includes a fixed mutating worker that creates only
missing `status` and `proof` directories underneath the existing OS-profile
`Documents/Stephanos-openclaw-workspace`. The production entry accepts no root,
command, executable or script. It never starts Core Daemon, dependency repair,
Flywheel, a writer, a service or a scheduled task. Existing files are preserved.
The workspace and all existing publication directories are pinned against rename;
reparse points and substituted files are refused. Directory handles use actual
read access: metadata-only handles did not enforce the required sharing denial,
as the adversarial rename fixture demonstrated.

Creation, cancellation and drain use the same native Job boundary as the probe.
Cancellation may leave a newly created directory: this is reported as uncertain
partial mutation on the original request, never rollback, success or a new retry.
Only a successful drained worker and final pinned directory witnesses produce
`CORE_DIRECTORY_REPAIR_SATISFIED_UNQUALIFIED`. This proves the narrow directory
postcondition, not Core health, builder recovery, R7 release or qualification.

Fixtures prove creation, idempotency with preserved R7/Core sentinel files,
junction/file refusal, rename denial and gaming cancellation. Core health now
also rejects coerced/missing heartbeat ages; governor permission requires fresh
version-3 evidence with all relevant activity flags explicitly false. Unknown,
stale or incomplete governor evidence protects gaming.

The worker remains an unregistered source candidate. Protected installed-parent
custody, authenticated exact-head action admission, independent Windows review
and physical acceptance remain open activation requirements. Generic continuous
repair still refuses mutation; no mailbox action or automatic retry is added.
The earlier statement that no mutating worker exists is superseded by this
section; no worker is yet admitted or installed. Hosted CI is source evidence,
not commissioning or specialist acceptance.

## Private action admission continuation

The existing private Commander MCP now registers the single fixed
`repair-core-publication-directories` maintenance action. Its only payload is
`expectedMain`; path, shell, qualification and scope extras are rejected. It is
not a public mailbox action, generic start-process route or guardian repair.
The installed executor requires authenticated, initialized MCP transport proof,
a clean current main checkout and an exact expected head. Dirty files are held
and preserved. Canonical Git configuration disables helper execution and object
substitution. Raw commit/tree/blob bytes are authenticated against their object
hashes; only the fixed regular C# blob is admitted. Its SHA-256 must match the
single captured installed native buffer before compilation. Raw canonical bytes
must be installed, including line endings; drift fails closed.

The native request identity derives from the existing command/mission identity.
Authenticated MCP cancellation addresses only the same session's pending request;
concurrent Core repair in that session is held. HTTP disconnect forwards abort
to the original request. Native cancellation, parent pipe EOF and OS Job drain
retain their existing bounded behaviour. No replacement mission, automatic retry,
new scheduler, source writer or R7 lease is introduced.

Tests cover protocol binding and cancellation, actual HTTP disconnection, dirty
and stale main, corrupted raw objects, symlink mode, forged scope/qualification
and a real Git checkout with hostile fsmonitor and hidden skip-worktree bytes.
The latter still binds the original committed source digest and never runs the
repository helper. A separate regression refuses installed-byte drift before
compilation. The earlier unregistered-source statement is superseded: private
source admission exists, but the action is not installed or independently
qualified on Battle Bridge. The generic continuous mutation refusal stays intact.

Protected installed-parent custody is an explicit external trust precondition,
not something candidate JSON, a caller flag or the writable checkout can certify.
Independent exact-head specialist review, operator merge, protected installation
and physical acceptance remain required before commissioning. This action proves
only directory restoration, not a healthy Core or recovered R7 builder. Other
Core faults still require their own resource-disjoint operation design.

## Shared completion admission

Fast directory-worker review also exposes a shared completion invariant: a
drained Job and exit zero cannot exempt any worker from interruption checks.
The native monitor now samples gaming/cancellation/deadline before testing for
completion. After positive OS drain and final directory pinning, the same
predicate must pass again before any probe or repair success field is set.
This extends final gaming/cancel acceptance to deadlines and every success path.

Native regressions let the real child exit during the first post-resume sample,
then cross the deadline, throw from cancellation or activate gaming at the
terminal sample. Exit remains zero and custody is proven drained, but the
receipt must remain HELD and preserve any attempted directory mutation. No
cancellation acknowledgement is invented after exit. This is completion
admission, not an atomic gaming transition, rollback, installed-parent
qualification or commissioning. Existing specialist/activation gates still bind.

Review follow-up: a fast directory worker can drain before the monitor polls.
Acceptance now rechecks governor and original-request cancellation after final
scope pinning and before setting any successful repair postcondition. Active,
unknown/throwing governor or late cancellation keeps HOLD and attempted-mutation
uncertainty even with exit zero and positively drained OS custody. A native
regression pauses the first post-resume poll until the real worker finishes;
the old implementation demonstrably reported success in the counterfactual
fixture, while the fixed implementation holds for gaming, unknown and cancel.

## Admission lifetime and terminal ownership

Structural follow-up: session identity is a cancellation boundary, not the
repair-admission owner. All MCP handlers in the existing Commander server now
share admission; each session retains only its own cancellation map. Equal
JSON-RPC IDs across sessions cannot cancel or replace an admitted request.

The native wrapper's deadline requests parent termination but does not resolve
the original operation until process close. Kill refusal, a thrown kill or a
synchronous close all preserve that ordering. A late green receipt never turns
the timed-out operation into success. The server releases its lane only when
the result does not carry unproven execution custody; a native result lacking
a bound positive zero-active witness (or explicit pre-launch denial) retains
the lane. An executor exception also retains it. No client clear/retry verb is
provided. This is server-process custody, not a durable cross-restart or
cross-process OS exclusion certificate. Those commissioning gates remain open;
the source candidate must not be activated on the strength of this registry.

The native C# file has an explicit LF Git attribute because admission compares
raw installed bytes to the authenticated Git blob. A real autocrlf Git fixture
checks that ordinary Windows checkout preserves those bytes; normalization is
not used to excuse executable source drift at runtime.

## Affirmative custody contract for the unenrolled candidate

The candidate does not infer release from the absence of a false flag. MCP
retains its modeled lane unless at least one own, explicit release claim is
true and every supplied outer/inner release claim is true. Missing, inherited,
null, string and contradictory claims remain unproven. A native invocation
rejection or missing terminal claim propagates false release and original
mutation uncertainty; it cannot become a successful candidate or a new request.

Only denials proved before any native parent launch receive affirmative
no-execution release, including the real production registry rejection. Tests
exercise callback rejection, ambiguous receipts, contradictory wrappers, cross-
session attempts and the actual unenrolled command rejection. Candidate action/
MCP composition tests inject only fixture executors; they do not enroll an action
or prove OS custody. The top-level unenrollment decision and all three missing
external trust roots remain binding. No clear/retry or activation path is added.
