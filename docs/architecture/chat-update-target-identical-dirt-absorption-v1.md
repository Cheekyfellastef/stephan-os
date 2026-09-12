# Chat update target-identical dirt absorption V1

The canonical chat update remains fast-forward-only and preserves local work. When the first exact-head fast-forward is blocked by tracked or untracked files, the route may retry only after proving every overlapping dirty worktree blob is byte-identical to the blob already present at the fetched target head.

The proof is fail-closed:

- the local branch must have zero commits ahead and the target is the exact `origin/main` observed after fetch;
- the failed merge must leave `HEAD` unchanged;
- candidate paths come only from the fixed Git diff between the current and target heads;
- each candidate must be a safe repository-relative path and currently dirty;
- the filtered worktree blob hash must equal the target commit blob hash;
- all candidates are staged together and the resulting index must be exactly equal to the target for those paths before the same target hash is retried;
- any mismatch, deletion, unreadable path, head movement, staging failure, or index mismatch blocks without a second merge attempt.

This operation changes only the Git index. It never edits or removes a worktree file, never invokes reset, clean, stash, checkout, restore, force, or a caller-selected path, and grants no new runtime or merge authority. A successful fast-forward makes the previously local bytes canonical and clean because the fetched commit now owns those exact bytes; unrelated dirt remains untouched.
