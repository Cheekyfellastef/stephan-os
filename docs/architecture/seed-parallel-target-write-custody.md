# Seed Parallel Forge target-write custody

Owner: #3096, existing PR #3097. The remaining target substitution finding
cannot be repaired by adding another pathname check. The checked worktree,
parent or leaf can be replaced after the final check and before Node opens
the write. Avoiding model inference only shortens that window.

The structural admission invariant is now: without a separately qualified
target writer, neither model authoring nor deterministic inventory may reserve
a task/path, create a worktree, publish pickup, infer or write source. The
actual worker enforces this after authenticated owner approval and before
resource preflight or claims, with SEED_TARGET_WRITE_CUSTODY_UNIMPLEMENTED.
The source-controlled constant is false; there is no caller or environment
override. The independent model-router custody hold remains false as well.

This closes unsafe admission; it does not implement native stable handles or
commission any writer. A successor must independently qualify complete
operation-bound source/parent/leaf custody, existing-handle and reparse
substitution negatives, canonical/Island/Seed overlap checks, gaming custody,
and real host evidence before changing this gate. Candidate provenance,
independent review, protected operator merge and original R7 CAS remain
separate. No historical execution receipt or physical build is reconstructed.

The disposable Git integration fixture first runs the production worker with
authenticated fixture owner approvals for both generation modes. It requires
the typed hold, no task/path claim, no worktree, no model inference and unchanged
main. Subsequent construction tests modify only the fixture copy of the
custody constants; their Git commits are test artifacts, never host admission.

The unadopted `src/windows/Stephanos.SeedParallelCustody` class library now
implements one bounded new-file primitive: retained root/ancestor handles,
parent-relative no-reparse opens, atomic no-overwrite create and same-handle
write/flush/digest readback. Actual Windows fixture tests cover concurrent
replacement attempts and junction denial. It does not protect existing-file
replacement, sibling Git/test/claim/receipt state, the host process or its
principal. It is not yet called by the worker. Both production capability
constants remain false until complete operation-bound custody is independently
implemented, reviewed and physically admitted. A passed primitive test must not
be promoted to physical Seed pickup or R7 release evidence.

Supervisor status is now a passive claim/receipt projection while candidate
provenance is uncommissioned. It performs no Git worktree inspection, clean
filter, executable config read or local commit-proof promotion. The integration
fixture first proves a malicious clean filter executes under ordinary Git,
then verifies supervisor status does not execute it and remains unproven.
This removes the reachable executable-read path rather than adding a racy
config check before Git status. Physical candidate proof requires a separately
qualified reader bound to the complete operation.

## Deterministic inventory input and output lifetime

The next component slice is `SeedInventoryCustodySession`: two immutable,
digest-checked private input snapshots (manifest and canonical seed contract)
and one new output, retained for a single lifetime. It reuses the stateless
`PinnedFileSnapshot` primitive already present in the Rescue custody assembly;
this is a code dependency only, with no Island worker, host or ownership state.
The Seed test workflow now runs when that dependency changes as well.

The existing Seed new-file primitive has a prepare/create lifecycle. Preparation
freezes proposal bytes and retains existing output-parent handles without
creating an artifact. Those handles remain held while the input snapshots are
acquired, including when the output is outside the input parents. Creation is
one-shot and relative to the retained parent. A leaf installed by another
writer is preserved; a failure closes the session, rather than silently trying
again against a different namespace state. Input readers consume only verified
cached bytes; no path, native handle or mutable internal buffer is reopened or
exported. Locks serialize creation, reads and disposal.

This completes only that component lifetime. Caller-supplied hashes do not
authenticate the manifest or candidate provenance, and the two declared inputs
do not represent all executable/import, Git/index/object, test, claim/receipt
or principal dependencies. No existing production caller uses the component.
Both worker capability constants remain false; original R7 custody, qualified
host commissioning, independent review, protected merge and physical pickup
remain separate requirements. Do not turn component fixture success into a
live building claim or use it to skip the remaining host containment work.


## Bounded approval verification fairness

The supervisor collects valid unclaimed inbox entries before choosing up to four GitHub approval references. It rotates from a persisted filename cursor rather than restarting at the alphabetically first entry. Before each network lookup it writes and flushes a uniquely created temporary cursor file and atomically renames it over the fixed cursor entry. Unavailable, expired, wrong-task and thrown verification results therefore advance scheduling progress too. Failure to persist progress stops the invocation before that lookup.

The cursor is untrusted availability state, contains no approval, and cannot authorize execution. A corrupt or absent cursor resets ordering; an absent prior filename resumes at its sorted successor, wrapping when necessary. A finite unchanged queue receives bounded round-robin coverage across sequential foreground invocations. Concurrent invocations may overlap and are not serialized by this cursor. No claim, source ownership, daemon or scheduler lock is introduced. Every selected reference still receives fresh independent GitHub verification, and both production execution holds remain in force.

The real subprocess/HTTP regression places four schema-valid rejected references before a valid owner-approved task, verifies the first process makes exactly four lookups with no eligible task, then verifies a new process reaches the valid task without exceeding four lookups. It preserves the production no-claim/no-inference assertions. This is fixture proof, not host commissioning or live pickup.

