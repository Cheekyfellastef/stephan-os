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
