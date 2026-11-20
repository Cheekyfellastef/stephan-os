# Canonical worktree metadata invariant

## Structural review after repeated native inspection failures

The worktree-list path failed on installed Windows source before and after the
`-C` correction. PR #3252 replaced that unreliable diagnostic dependency with
a canonical filesystem guard. The live result then changed to
`CANONICAL_GIT_WORKTREE_CONFIG_LINKED_WORKTREES_PRESENT`; it did not establish
the number or custody of any linked worktrees.

The shared defect is conflating a registration namespace with a registration.
A real canonical repository with an empty `.git/worktrees` directory reproduces
the hold despite containing no linked registration. A new regression fails on
the installed implementation before this correction. Battle Bridge's actual
directory contents remain unknown until the reviewed implementation runs.

## Shared evidence model

Both inspection and fixed one-key repair use the same bounded classifier after
exact source/main and canonical `.git` topology are authenticated:

| State | Evidence | Fixed repair eligibility |
| --- | --- | --- |
| ABSENT | `lstat` reports ENOENT at the fixed namespace | Continue other guards |
| EMPTY | Real directory, one read returns no entry, stable metadata identity | Continue other guards |
| PRESENT | Any entry, including stale, locked or unknown metadata | Hold; preserve all entries |
| UNPROVEN | Permission/read failure, non-directory, link or changed identity | Hold |

The classifier reads at most one directory entry. It returns no names, paths,
config values or exception text and performs no filesystem mutation. It never
prunes metadata, guesses whether a writer is alive, or clears a source claim.
The fixed repair repeats this evidence immediately before its sole existing
config unset so newly appearing registrations hold it.

All other gates remain: exact main/head, canonical origin, sole rejected
extension category, exactly one true value, absent/empty main worktree config,
and canonical source/config postconditions. No lease, grant, gaming, custody,
worker or merge authority is added. This bounded trusted-operator recovery is
not hostile privileged-writer containment.

## Completion boundary

Qualification must include the actual empty-directory regression, retained real
linked-worktree refusal, unreadable/link/change negatives, hosted Windows and
independent exact-head specialist review. Protected merge and installed-host
readback remain separate. A PRESENT or UNPROVEN native result is not permission
to remove metadata. Productive Octopus building still requires the original
mission's authenticated grant/pickup, functional source, tests and commit.
