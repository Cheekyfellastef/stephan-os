# Initial Core bootstrap: attended native proof consumption

Source preparation only. No live invocation, source lease, publication, installation, or native qualification is claimed.

## Existing owner and boundary

Continue Goal #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission. The original Core/native owner retains Windows custody and qualification. The coordinator must route this candidate to that owner before publication or specialist qualification. Do not borrow its R7 source lease or extend R7 operation purposes.

The existing recovery entry `scripts/windows/recover-stephanos-core-lock.ps1` already contains the limited-user Core parent, fixed executable and source admission, one attended UAC child, actual child-process exit consumption, and exact started-PID/lock/head/heartbeat verification. It explicitly assumes operator-invoked reviewed installed source, not protection against a malicious administrator. Reuse that entry and trust scope.

## Diagnosis

The historic e3239a40 diagnostic has no parameters and hardcodes two old process births. Its writable JSON has no consumer. The normal watchdog independently recomputes CIM inventory; hidden command lines remain unknown. Reusing the historic script or teaching the watchdog to trust JSON would expand authority without a native authentication contract.

## Selected bounded correction

Extend the existing attended recovery entry with an explicit absent-lock mode. This mode performs no lock retirement. Its elevated child takes two complete, bounded Node inventories, including process birth, executable and command digest identities, around source revalidation. Unknown identity, changed membership, PID reuse, changed command, source drift, elapsed expiry, or any lock object fails closed. The limited parent consumes only the actual successful child process it just launched, rechecks source/expiry/lock absence, then uses the existing fixed Core start and heartbeat path. A later competing compliant start remains arbitrated by Core's unchanged exclusive-create lock.

No saved report is an authorization token. No new key, pipe, persistent helper, service, scheduler, launcher or mailbox action is added. No caller-selected process IDs, executable paths or observations are accepted. No unattended UAC is added. The watchdog's inventory gate remains unchanged: it cannot consume a previous attended observation or report global health from one started PID. The parent can prove only its exact Core start/heartbeat, not global process exclusion forever, descendant custody, R7 release, worker admission or pickup.

## Alternatives rejected

- Merge elevated diagnostic JSON into limited CIM results: forgeable/replayable and race-prone.
- Add generic elevation, an inventory daemon or a new signed-key scheme: duplicate authority surfaces.
- Treat hidden Node rows as unrelated: a boolean absence waiver.
- Use future owned-successor fixture success for initial bootstrap: that candidate requires an initially admitted start and cannot recover an already absent Core.

## Required review and acceptance

Adversarial fixtures must exercise the actual shared policy: hidden/malformed/duplicate identities, PID birth reuse, process membership and command changes, access-denied lock inspection, source drift, old/negative elapsed time, nonzero/missing child exit, and replay attempts. Existing stale-lock handle fixtures must still pass. Native owner must review whether two bounded CIM captures and exclusive Core acquisition are sufficient within the existing attended trust scope; they do not establish kernel descendant exclusion. Independent Windows/security exact-head review, complete installed source closure qualification and exact operator runtime consent remain required. No candidate tests authorize execution.

The future 13-test successor candidate remains separate under `core-successor`; this repair does not merge its entrypoint change or modify the ordinary watchdog.

## Real Windows path-pinning regression

The absent-lock fixture exposed that the existing adapter's metadata-only ancestor handles did not prevent a parent directory rename when no lock file existed. The candidate reuses the same adapter with real read access for ancestor pins and a read-only absent-object mode. That mode accepts only native file-not-found, refuses existing objects and all other errors, and cannot archive or commit. The fixture now proves rename denial and preserves a competing newly created lock. The existing retirement fixtures are rerun against the strengthened adapter. This is a candidate correction, not a claim that any live lock or directory was inspected or repaired.

Native qualification must cover the existing attended Add-Type closure as well as this adapter change; no new compiler authority is granted. Original native/R7 ownership and unknown-claim holds are unaffected.

## Preserve the qualified shared inventory estate

Broader CI correctly refused the first published candidate because adding an attended-only capture function to the shared watchdog inventory helper changed its exact reviewed blob and observation estate. The correction restores that helper to original blob `9e00ce659859b0274fce36e13cb20045b1b337b1` with its original two functions. Attended identity capture belongs in the existing recovery policy, loaded by the existing recovery entry; at invocation it reuses the unchanged shared classifier. Both policy and helper remain in the entry's fixed captured-and-rechecked source closure. No reviewer allowlist, trusted hash, semantic pattern or failure code is changed. The ordinary watchdog receives no attended override or new observation operation.

An integration regression binds the original helper blob/function estate and actual production load ordering, alongside the unchanged watchdog adversaries and the actual source-estate qualifier suite. Fresh review must bind the complete corrected published head; the earlier review request and artifacts cannot clear changed policy/helper source automatically.

## Original-owner review round 1: stale terminal time

The original recovery owner acknowledged this scope and independently found a blocking defect in tree `8096e3c13e147075735563cdf4c12d6816f19f86`: a completion stopwatch created after WaitForExit could exclude time when the parent was suspended after the child exited. Its report is retained externally with SHA256 `844f8df02349c1a95dcdb839962c4d4c3e5e900f533cc12e6f42794906133460`; that candidate is preserved under `review-round-1`, not cleared.

The correction uses StartTime, ExitTime and PID from the actual Process returned by the fixed attended launch. Native exit age, retained birth identity, total monotonic attempt age, UTC kinds and observed wall/monotonic consistency are validated after source/path checks, immediately before fixed start. A 100ms clock-consistency tolerance is reserved inside the five-second budget, leaving at most 4.9 seconds of accepted native exit age. Backward/future or visibly discontinuous clocks fail closed. This relies on the existing attended Windows system-clock trust; it does not defend against a malicious privileged actor changing the clock transiently and restoring it between observations.

Actual parent-branch fixtures pause after child exit and during source validation for 5.1 seconds and require zero starts. A benign real native process fixture verifies OS terminal timestamps. No saved report supplies terminal time. No awaited operation follows the final freshness check before fixed start; an arbitrary OS scheduling suspension between those instructions is still possible. This is bounded sampled admission plus unchanged exclusive-create Core ownership, not an atomic global process-exclusion lease. Native specialist qualification must explicitly assess that residual race rather than treating the fixture as containment proof.
