# Control Tower discovery preserves growing ledger history

The original execution ledger owns request identity, reservation and terminal
outcome. Control Tower discovery is a read-only projection of that same ledger.
History size must not be confused with one batch of work: a global 4,096-entry
ceiling prevented discovery when ordinary mailbox history reached 4,108 entries,
although only 93 records belonged to Control Tower.

Discovery now streams all records through the existing fixed 256-shard hashed
namespace. Each record remains bounded to four KiB and undergoes the same
canonical identity, phase and owner-issue validation. No records are deleted,
archived, skipped, upgraded or copied into an independent authority index.
Original legacy and malformed observation projections retain their existing
semantics; an unresolved build still takes precedence over later terminal work.

Only the newest build, newest inspection and oldest unresolved build are kept.
The retained filesystem evidence consists of at most 257 directory identities
and 256 SHA-256 metadata transcripts. After streamed payload validation yields, a second complete pass verifies the
first read set using precise device, inode, size, modification/change times and
link count. This closing verification and its final directory checks contain no
asynchronous boundary. Queued in-process writers therefore run before closing
or after the observation completes, never inside that closing critical section.
An ordering change holds conservatively.

The admitted writer contract is create-once insertion (`wx`) or replacement by
the existing atomic rename helper; terminal completion remains immutable. Those
writes change a directory identity, so final directory checks reject them even
when an early file was already verified. The repository's ordinary mailbox,
rotation and Control Tower consumers use that same ledger API. Tests exercise
all its mutation methods and an insertion after an early closing read.

This is not global filesystem serialization: an arbitrary external actor that
bypasses the admitted writer API and writes in place after its final identity
check is outside that guarantee, as with the original synchronous verification.
Do not claim a hostile-writer snapshot or present corruption after observation
completion as having been observed earlier. Encountered corruption and changed
identities still refuse the complete scan. No watcher, third identical pass or
new lock is substituted for this explicit observation boundary.

Payload enumeration is batched (128 entries by default, at most 4,096 per
batch), and the event loop yields between payload batches. A fixed monotonic ten-second
deadline bounds work; callers may choose a smaller deadline or explicit smaller
entry budget, but cannot widen the deadline. The ordinary scan has no lifetime
record-count ceiling. Large or changing estates that cannot be fully verified
within that work budget remain held; a partial scan never authorizes execution.
No cursor or partial result survives as authority across calls.

`discoverControlTower` is asynchronous. Every production caller must await it.
All failures return both observation projections as null with a typed blocker;
an unresolved promise must never be interpreted as successful empty discovery.
The consumer's existing observation-only fallback remains available on a hold.

This internal source repair does not itself prove native adoption, worker
pickup, a material build, or the full programme outcome. In particular, an
expired workflow request with no original ledger record remains expired and
unpicked. Neither this repair nor a later successful scan grants replay,
replacement-request, merge, deployment or native execution authority.

The regression contract covers history beyond the old ceiling with exact byte
preservation, unresolved reservations, corrupt historical rows, concurrent
in-place changes/new reservations/terminal renames, verification-pass races,
cooperative yielding, monotonic expiry after a yield, and asynchronous consumer
refusal. Existing replay, unsafe-link, original inventory and terminal-proof
tests remain applicable.
## BUILD admission is a ledger-owned transition

An asynchronous discovery result cannot authorize a later separate reservation:
two callers can observe the same empty estate before either resumes. The original
consumer therefore uses `discoverAndReserveControlTower` for BUILD. It shares the
bounded reader, checks the existing trusted source adapter immediately before
closing, and performs final read-set verification, unresolved-BUILD refusal and
the original create-once reservation without an asynchronous boundary. A missing
root is revalidated in that same continuation. The acceptance timestamp and
expiry check use the fresh final-admission clock, not a pre-scan timestamp.
Both supplied source and clock callbacks finish before closing verification.
Acceptance is timestamped at the entrance to this final uninterrupted admission;
the expiry check includes elapsed monotonic closing time without invoking caller
code again after the verified read-set and unresolved decision.

The consumer retains an independent MISSING-locator hold before mutation, uses
the returned original reservation without reserving again, and retains the
request locator with UNKNOWN outcome if a write may have committed. It never
calls the owner without the actual returned reservation. The existing source,
expiry and native-owner checks after reservation still apply. Plain discovery,
OBSERVE and rotation remain separate from this explicitly mutating operation.

This restores the original single-JavaScript-domain admission boundary across
different ledger handles. It is not a global lock or proof against arbitrary
external writers. No new lock, cursor, witness, queue, scheduler or claimant is
introduced. The regression model covers absent/existing history, distinct
authenticated requests, competing original writes, fresh source/expiry,
uncertain persistence and retained history gaps.
