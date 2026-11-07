# Sovereign Reviewer publication race and ownership model

The local Sovereign Reviewer is a candidate-evidence producer, not an authority
source. Its Shared Workspace writer has one narrow ownership envelope: the
proof file for its captured PR/head and the current-status file for that PR.
It never gains review, specialist, approval, merge, deployment, or runtime
authority from publication.

## Directory ownership and substitution

Workspace path checks are admission checks, not confinement. Another process
can replace any checked ancestor before a later path-based `open`, so repeating
`lstat` cannot close the check/use race. Publication therefore opens the
approved workspace directory once with no-follow semantics, verifies the open
handle's device/inode against the admitted directory, and performs every child
operation through Linux's `/proc/self/fd/<fd>` stable-handle namespace.

The `status` and `proofs` directories are opened beneath that stable root and
remain open through temp creation, sync, link/rename, and cleanup. Canonical
paths are checked as an additional fail-closed signal, but confinement comes
from the handles: substitution can make publication fail or leave an artifact
in the previously admitted directory, but cannot redirect raw evidence outside
the admitted root. Lock creation and ownership validation use the same stable
status handle. A replacement lock is never removed as though it belonged to
this process.

Node does not currently expose a portable `openat`-style writer. Platforms
without an admitted stable directory namespace therefore return
`STABLE_WORKSPACE_WRITER_UNAVAILABLE` before opening an evidence temp file.
Adding a platform adapter requires equivalent handle-relative create, link or
rename, sync, and ownership guarantees; path revalidation alone is not an
acceptable substitute.

## Immutable proof and monotonic status ownership

Proof publication writes and syncs an exclusive temporary file, hard-links it
to the final name without replacement, syncs the pinned directory, and removes
only its own temporary name. Existing proof identity always wins.

Every run records observation identity at capture time. A successful snapshot
preserves its observed head; a capture failure records the requested head only
as non-authoritative request context and never claims it was observed. Model
timeouts, policy holds, and all other outcomes carry the same capture time.
Under the per-PR lock, status compares that capture time with the currently
published capture time. An older run cannot become newer merely because it
finished or attempted publication later, and environment values never replace
the captured head identity.
