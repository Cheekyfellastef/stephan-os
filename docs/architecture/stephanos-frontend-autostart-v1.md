# Normal frontend startup through the existing guardian

The supervised 25 October recovery restored maintenance admission and the normal
4173 server. The existing startup tasks covered Commander and the backend, but
none requested frontend startup. This adapter adds that Windows lifecycle edge.

The limited S4U task runs at boot (30-second delay) and logon through the existing
windowless task host. It invokes only the existing authenticated guardian's fixed
`repair-ui-4173` action. No new executor, controller, scheduler, lease owner,
maintenance admission rule, recovery route or process-termination route is added.
The Windows task is a lifecycle client, not a second mission scheduler.

Canonical installed main is proved before dispatch and rechecked against served
proof afterward. A ready exact-head server is reused. Missing or held Commander
remains blocked; this client cannot bootstrap/recycle it or recover custody.
The existing fresh gaming/VR protection predicate must admit unattended work,
including a recheck immediately before dispatch; unknown protection stays held.
One conservative per-boot attempt file prevents startup/logon from resubmitting
an uncertain mutation. The file can deny an attempt; it cannot authorize one.
Deleting it cannot bypass the guardian's independent maintenance admission.
An uncertain transport result is observed for a bounded period, never retried as
a fresh mutation. The original command verdict and final served proof are distinct.
Build-bound historical observations and a native boot witness are appended with
the existing Shared Workspace event writer to
`events/stephanos-frontend-autostart.ndjson`. Observation time is separate from
append time. These events never contain current READY/success status and explicitly
have no current-readiness authority. Existing canonical ignition owns that truth.
The complete boot-observation/append operation stays inside full source validation;
source invalidation during append blocks finalization. A line already appended is
history of one build's observation, not stale current health. Publication failure
remains an explicit proof failure even if a server is running.

The installer requires the exact reviewed installed main and explicit runtime
approval. It refuses an existing task and uses no forced replacement. Boot-trigger
registration needs Windows administrator authority; the runtime task remains
limited, hidden and S4U. Installation creates no standing elevated executor and
changes no existing task, file, controller, grant, source lease or OpenClaw service.

Acceptance: focused fail-closed and duplicate-attempt tests, qualified independent
Windows/security review, protected merge and approved installation, real task
definition readback, manual task reuse proof and a separately approved later full
boot proving normal HTML/JS MIME/current marker and ignition. Source tests and a
task definition alone do not prove restart-on-boot operation.

## Source observation invariant after independent review

Two related review findings exposed the same model error: an invalidated source
observation was represented as ordinary frontend-not-ready, allowing fallthrough
to mutation. The startup client now shares one source-bound observation model
across reuse, guardian health, token/session setup, boot witness, waits, late
completion and lifecycle publication. Each awaited operation checks local HEAD before
and after, including its exception path. Source change or unreadability is a
distinct terminal `FRONTEND_AUTOSTART_SOURCE_CHANGED` state; it can never become
an invitation to claim/dispatch because a readiness probe returned false.
After the third related finding, structural review established that exceptions
alone were insufficient: a catch could discard a transient read failure. The
boundary now privately latches its first invalidation. Local and full-admission
readers derive from that same state, with no reset operation. INVALIDATED is
absorbing even if source later becomes readable/current. The dispatch catch
propagates invalidation; only genuine transport uncertainty may be observed late.
Final publication failure removes current success flags and retains prior served
proof only as explicitly historical information in the failed final result.

Adversarial sequence tests inject invalidation into every pre-dispatch awaited
observation and require zero boot claims and zero maintenance calls. The existing
guardian independently revalidates canonical source inside the registered repair;
this client model does not replace that authority or seize a source lease.
Full canonical admission (including fixed remote fetch and source hygiene) is
required initially, again before boot claim/dispatch, and before accepting served proof.
The local continuity checks reuse the existing fixed Git HEAD reader and do not
fetch remotely on every transport await. Lifecycle publication retains full source
admission around its entire native boot observation and event append. A stable HEAD cannot excuse dirty
or otherwise unprovable canonical source at an admission transition.

Structural review of the publication race removed the proposed duplicate durable
current-READY ledger instead of adding a compensating clear/green mechanism. No
source lease is seized to make workspace publication atomic with source changes.
Required live source/served checks, final post-publication source validation,
independent review and real-boot acceptance remain binding. Real-writer race tests
advance or invalidate source during append and require a blocked final result with
no persisted current READY assertion. The task never substitutes its history event
for canonical ignition's current runtime proof.
