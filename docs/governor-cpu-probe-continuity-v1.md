# Governor CPU probe continuation v1

Risk tier: **high** (resource admission and native ownership). This is a bounded
policy change requiring qualified Windows-authority specialist review, protected
merge and qualified runtime adoption. Source publication is not commissioning.

The canonical governor withdraws model permissions before each read-only native
probe. A continuously checked Starfield CPU build previously interpreted this
intentional probe transition as permanent resource withdrawal and cancelled its
owned Job. A new build must still wait for a complete healthy observation.

The existing governor state may now contain `cpuProbeContinuity`, schema
`stephanos.governor-cpu-probe-continuity.v1`. It grants only an **already-admitted**
Starfield CPU Job continuation through one idle read-only reconciliation. It
creates no new controller, lease store, caller waiver or execution route. Shared
model permissions and other consumers retain their existing restrictive policy.

## Producer contract

The existing mutation owner may issue the record only from the exact unchanged
bytes of its own last complete state publication, at most ten seconds old. Raw
typed fields must prove NORMAL/AUTO/balanced, known healthy dependencies, both
model permissions, no custody hold, no game/VR activity, no preparation and no
cooldown. Fresh signal/effective-state evidence and independent override/prepare
checks must also allow it. Legacy defaults, copied state, duplicate or edited
JSON and a different owner cannot supply this prior observation.

The record contains exactly `schemaVersion`, `cycleId`, `phase`, `allowed`,
`observedAtUtc`, `expiresAtUtc`, `priorObservationAtUtc`, `ownerProcessId`,
`ownerCreationFileTime`, `machineHash` and `bootIdentifier`. Phase is
`IDLE_READ_ONLY_RECONCILE`; birth FileTime is a decimal string to preserve its
integer precision. Native identity comes from the existing in-process metadata
adapter. Expiry consumes the remaining existing five-second reconciliation
budget; it never adds time or renews a failing probe.

Only GpuSnapshot and OllamaInventory can overlap. A failed dependency, model stop,
abandoned/recycling owner or early reconciliation exception revokes the owned
record and keeps ordinary permissions restrictive. Revocation IO failure cannot
skip retained-child cleanup. Failure still propagates; a lost owner is denied by
the consumer and an unreadable or expired record cannot grant permission. Full
publication removes the continuation record instead of refreshing it.

## Consumer contract

Initial admission and pre-staging checks never accept continuation. Only the
source-owned callback monitoring an already-running native Job passes the
existing Win32 exact-PID-and-birth observer. The observer opens its own process
handle, verifies birth and liveness and closes the handle; a stored PID alone is
insufficient, including after exit or PID reuse.

The native Job adapter selects a separate running-policy callback only after
`ResumeThread` returns the expected success value. The ordinary callback remains
mandatory before Job creation, before process creation and before resume of the
contained suspended root. These prelaunch checks are never throttled by the
running monitor's one-second cache. A continuation grant appearing between final
staging admission and native launch therefore cancels without authorizing new
execution. Real Windows fixtures prove both no-launch and no-resume boundaries.

The consumer requires the closed record schema, strict types, a maximum
five-second interval, an observation no older than fifteen seconds in total and
an exact binding to the prior published timestamp. The canonical probe attempt
must be read-only and belong to that owner. BOUND requires identical machine,
boot, PID and integer birth. PREPARING is accepted only with its documented
pre-launch zero/UNOBSERVED shape and a held flag; the grant already carries the
independently observed live owner. This permits a controlled in-progress probe,
not unknown or abandoned custody. General model permissions remain false.

Permission is rechecked after native owner observation, and the complete state
must remain unchanged across that observation. Gaming, VR, preparation, override,
cooldown, malformed state, a failed observation or changed state always deny.
Normal admission also requires explicit custody-unheld and healthy dependency
fields, so contradictory healthy-looking model flags cannot bypass these checks.

## Proof and lesson

The governor suite exercises actual PowerShell functions, existing kernel-owner
and cleanup behavior, adversarial grant inputs, revocation failures and a real
Windows producer/consumer owner-lifetime test in isolated temporary state. The
Python suite covers schema/type mutations, expiry during observation, state
races, failed ownership, gaming and initial-admission separation. Genuine native
metadata tests require a normal non-administrator token; elevated hosted runners
explicitly prove refusal and report those native positives as inapplicable.

Reusable invariant: distinguish a positively owned, bounded read-only
reconciliation from uncertain execution custody using canonical evidence. Never
solve a false interruption by ignoring a hold, extending stale evidence, forcing
gaming mode off, restarting another owner or treating cancelled compilation as a
compiler failure. A successful native build still does not prove image capture,
GPU fence correctness, OpenXR submission or headset readiness.

## Structural timing review: idle census and continuation

The first live build after the continuation and owner-adoption fixes still
cancelled on main `474ebece697e4a7997acf9e45b5205c069b2c566`. The completed
observation at 21:59:44.8856152Z was 13.951 seconds old when the next read-only
probe began at 21:59:58.8370431Z on 18 November 2026. No game, VR or preparation
signal was present in the sampled records, but the prior observation exceeded
the ten-second producer limit, so no continuation grant was issued. The owned
build exited and released custody. This is correct denial, not permission to
raise the age limit or refresh the timestamp without observation.

Review the whole path: Watch acquires the existing mutex, checks real-headset
protection, gathers game signals, resolves effective policy, then reconciles
when the five-second idle heartbeat is due. The three-second scan cache measures
from scan completion. Slow discovery therefore delays both the next heartbeat
and recognition of new activity. A fresh continuation subrecord cannot repair
that scheduling delay. Tests that seed a fresh prior observation miss it.

Read-only measurements under the actual Windows PowerShell 5.1 host showed
4.587 seconds for flat-game discovery across 496 processes; reading their
`Process.Path` properties alone took 4.258 seconds. The same operation under
PowerShell 7 took 313 milliseconds, so the host is part of the proof. Framework
process-image discovery is paid for every background process even though the
existing predicate requires either a known game name or both a library path
and a window.

Preserve that predicate and inventory order, but observe the necessary window
before the expensive path for unknown processes. Known game names still win
without a window or readable path; excluded launchers remain excluded; custom
names, custom library roots, and Windows Game Presence fallback remain intact.
Only plausible candidates incur the path lookup. This changes observation
cost, not gaming policy, freshness, the five-second probe budget, custody,
initial admission, or the CPU continuation schema. No new cache, controller,
worker or independent authority is introduced.

The executable property model covers every combination of known/custom/unknown/
excluded name, built-in/custom/non-library/unreadable path, visible/absent/
unreadable window and presence fallback. A 500-background-process fixture proves
that irrelevant process count does not multiply path reads or change which game
is selected first. Real-host timing and a subsequent guarded build remain
commissioning evidence, separate from these deterministic proofs.

Three alternating read-only measurements on the same live Windows PowerShell
5.1 host observed baseline discovery at 3,363/4,602/3,864 ms and candidate
discovery at 188/168/170 ms, with 485–494 processes and the same inactive result.
These measurements establish the removed cost, not an absolute scheduling
guarantee or a successful native build.

Reusable lesson: bound observation work before depending on a freshness budget.
Test the classification model and the number of expensive observations in the
actual runtime host. An over-budget, changed, unreadable or expired observation
must still fail closed; lower latency is never authority to reuse stale truth.

## Adoption convergence under transient observation failures

After the discovery repair merged and canonical sync passed 192 checks, the
existing governor process still predated the new source. Its exact identity
was accepted, but the scheduled caretaker repeatedly returned exit 4. A bounded
110-second read-only census found 17 complete observations among 52 samples;
short-lived PowerShell processes made the remaining inventories opaque. At
22:34:34Z the scheduled task coincided with an opaque inventory; complete
observations appeared from 22:34:38Z. The next scheduled minute again coincided
with opaque processes. This does not prove every failure's internal branch;
it establishes that one observation per periodic invocation misses valid
windows even while the correct owner remains available.

The existing caretaker now re-observes only its two pre-mutation refusals:
mutation-owner busy and owner unproven. Each attempt recreates the complete
census, expected process/absence and progress evidence, then enters the same
unchanged lifecycle gate. Retries stop after 24 attempts or a 12-second
monotonic window, with 500 ms between attempts. Expiry is checked again after
observation and before entering the lifecycle. A slow OS observation can finish
after the window, but cannot then authorize lifecycle execution.

The lifecycle always releases its mutex before a retry delay. No retry is
allowed after a start/restart request, stopped process, started PID, child-custody
uncertainty, starting state, failed replacement, exception or successful result.
Both retryable refusal codes arise before custody recovery or process mutation;
the mutation flags provide additional defense. Timeout does not establish
absence, terminate a process, clear custody or authorize another owner.

This changes convergence in the existing caretaker, not its authority. It adds
no task, timer service, queue, lease, override or execution transport. The
executable state model covers transient refusal followed by fresh ownership,
all non-retryable terminal/mutation classes, finite attempt exhaustion and a
real elapsed-deadline refusal before lifecycle admission. Existing native
mutex, re-census, exact identity and retained-child tests remain mandatory.

Reusable invariant: retry transient observations before mutation, using fresh
evidence each time; never retry uncertain mutation as if it were observation.

## Build observation acquisition: structural review and convergence

At protected main `91fefbcf4835a7f252e02a9e644c8c9c11e70c09`, the existing
caretaker adopted a new governor owner at 23:05:17Z on 18 November 2026.
The fixed identity and source-age predicates passed, and that owner published
fresh ordinary observations. This proves source adoption, not overall caretaker
health; the scheduled task still reported an aggregate refusal.

The guarded build `starfield3535-paired-observer-build-91fefbcf-v1` compiled and
passed the first scoped-eye model test, then stopped after 5,105 ms with
`GAMING_STATE_CHANGED`. Its authenticated terminal proved native Job zero,
complete output, original-source preservation and released execution custody.
The observer sampled the governor's normal probe-record transitions during
that interval; it did not prove which of the reader's three changed-record
branches fired. A single fresh attempt, `...-v2`, was refused by the initial
gaming gate at 23:10:59Z while the governor published an idle native probe.
Ordinary permission returned at 23:10:59.587Z. Both denials were correct for
the samples read; neither is evidence of a compiler defect or an active game.

This related repair requires a structural admission model, not another widened
permission rule. The build has three distinct states:

1. **Before native execution:** no native work may run on a probe continuation
   grant. The existing ordinary predicate may be observed for at most one
   monotonic second and eleven attempts, with 100 ms between held observations.
   Only a fresh ordinary pass before the deadline admits progress. Unknown
   evidence, preparation and override errors remain refusals. The JavaScript
   adapter repeats only its canonical `permission-denied` result; the Python
   worker repeats only `GAMING_PERMISSION_HELD`. Neither predicate is weakened.
2. **Acquiring a snapshot:** atomic file replacement or a probe-record change
   discards the entire sample. The Python consumer may obtain and fully validate
   a fresh sample, at most three times within 100 ms. It rechecks every activity,
   freshness, override, preparation, grant and live-owner condition. An actual
   policy denial is terminal; a changed record is never treated as a pass.
3. **Monitoring a resumed Job:** the existing bounded CPU-only probe grant may
   continue that Job. A denied grant immediately cancels it. The one-second
   passive initial wait is never used for a running Job. The existing polling
   interval, expiry limits, cancellation and descendant-zero proof are intact.

Both acquisition windows check their deadline after observation, so an OS read
that finishes late cannot grant admission. Attempt limits also bound a stalled
clock in deterministic tests. No wait extends the grant, caches a successful
old sample, ignores a failed predicate, mutates governor state or creates a
second owner. Initial checks before staging, before Job creation and before
resume remain ordinary checks. Protected-main identity is still independently
rechecked after the adapter's final wait.

Executable model tests cover all 27 three-observation adapter traces over hold,
pass and unknown, both initial gates, elapsed and attempt exhaustion, main
movement, fresh probe transitions, each activity flag after a read race,
continuous replacement, unknown evidence and late reads. Existing native
custody and source tests remain required, followed by a new authenticated build.

Reusable lesson: observation acquisition, permission adjudication and execution
continuation are separate states. Bounded re-observation can improve progress
only when it discards the failed sample and obtains all required evidence anew.
Repeated source fixes are not programme completion; commissioning must still
prove the complete build and later installed-game and headset outcomes.
