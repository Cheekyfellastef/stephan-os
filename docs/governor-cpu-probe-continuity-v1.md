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
