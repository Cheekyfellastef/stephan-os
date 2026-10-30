# Source worker grant composition and custody

Two production constructors previously emitted incompatible envelopes for the
same bounded action: one omitted provider intent and emitted null engineering
memory, while the other retained intent and omitted optional memory. Full-object
comparison then rejected the original action after its processing claim but
before its execution receipt chain. Tests that supplied identical handcrafted
grants did not exercise this production composition.

Both constructors now use the shared worker grant envelope. Provider intent,
capacity receipt, worker, route, source, mission revision, repository, branch,
action and negative authority bits stay exact. Compatibility normalizes only
absent versus null optional engineering memory. Non-null memory remains fully
compared and must validate its actual content identity, canonical records and
zero-authority contract. Unknown fields, non-enumerable properties, accessors,
symbols, non-JSON values and coercible hash values cannot establish agreement.
No differing receipt or memory payload is silently discarded.

The fixed worker validates actual pending grant agreement before acquisition
and repeats validation against the acquired claim. A later failure retains the
claim and source. It writes an issue-bound diagnostic containing bounded reason,
actual observed claim digest and whether this invocation entered its native
transport. The diagnostic explicitly grants neither physical exclusion nor
claim release and preserves historical execution outcome UNKNOWN. Publication
failure is itself visible. No diagnostic fabricates an execution chain.

The supervisor projects typed inner processing failures, distinguishes claim
activity from material progress, and rejects failed/held results as progress.
A source success additionally needs its successful typed outcome, passing tests,
released execution custody and preserved source/outbox references. This avoids
clearing a carried defect merely because an item was processed.

That distinction also applies to the ordinary queue consumers: their outer
`processed` flag records handling, while the typed terminal outcome lives in
`result`. Material progress and bounded logs consume that same nested outcome.
Only the producer's positive completion contract qualifies: successful execution,
an exact published Forge commit/PR, or grounded verification receipts. Missing or
unrecognised outcomes, failures and cancellation remain non-progress; extending
a denylist of failure strings cannot make absent success proof affirmative.
Composition regressions pass actual consumer results into the supervisor,
including failed escrow, rejected replay and ungrounded verification results.

Regression proof calls both actual production factories, mutates every bound
authority field, challenges memory and object shapes, verifies pending refusal
before pickup, and exercises real temporary mission/queue/receipt stores through
the native-parent isolation fixture. Fixtures grant no production qualification.

Recovery is not complete from these changes alone. The preserved original
processing claim needs reviewed prospective exclusion and crash-convergent
retirement; its history must remain UNKNOWN. A full boot preceding pickup cannot
exclude the attempt. No original claim identity or physical exclusion evidence
can be inferred from a pending-capacity repair.

## Refreshed capacity before pickup

The canonical publisher now re-admits refreshed capacity only while the original
mission is pending, at its unchanged revision. Both complete grants must validate
and differ solely in capacity receipt identity and its proof references. Source,
scope, provider intent, worker, route, memory, action, execution binding and all
negative authority bits remain exact. The existing controller still supplies the
currently qualified grant; this operation does not qualify capacity or weaken the
worker's independent current-grant and live-custody checks.

Before any granted source publication, including when pending is absent, the
publisher refuses any processing claim for that mission, any terminal queue truth
for that action, and any existing execution receipt for the unchanged lease.
It preserves the original raw bytes and the refreshed raw
bytes under SHA-256-addressed immutable names, then publishes an immutable,
sequence- and hash-bound admission record. The record grants no execution, claim
release, lease seizure or merge authority. Publication of complete immutable
files uses a same-directory temporary file and exclusive hard link; unsupported
filesystems fail closed. Only then does an atomic rename install the admitted
pending bytes. A repeated call does not rewrite an already-current envelope.

The refreshed envelope carries a deterministic sequence and predecessor binding;
the admission record binds its exact hash, without a circular self-hash. Losing
the journal cannot turn that envelope into ordinary unjournaled work.

This is data recovery after a process interruption, conditional on the original
mission lock and custody gate permitting re-entry. A killed owner can leave the
existing mission lock busy; this change neither reclaims that lock nor grants
release authority. It does not establish power-loss durability: file contents
are flushed, but directory-entry persistence is not separately proven.

If interrupted between admission and rename, an admitted publisher can resume
from the exact preserved bytes before considering newer capacity. The consumer refuses
old pending bytes while that admission is incomplete. Every superseded receipt
identity remains in the admission chain and cannot be selected again, even with
different proof references. Missing pending bytes, a broken chain or a changed
snapshot never authorizes reconstruction of a processing claim.

The publisher's existing mission-state lock also guards the consumer's final
pending read, admission check and pending-to-processing rename. Granted pickup
also requires the current stored mission revision, phase and action to agree;
refreshed work revalidates the complete target and source payload. A refreshed
envelope cannot be acquired using an older in-memory grant, and a processing
owner cannot be replaced by capacity renewal. Producer and consumer must run the
same reviewed source generation before commissioning this contract. The original
held UNKNOWN processing attempt remains outside it.

Regression proof composes the real elastic and durable-controller factories with
real temporary mission, queue and receipt stores. It checks original byte
preservation, strict scope/authority refusal, superseded-receipt replay,
interrupted admission recovery, damaged history, existing custody and concurrent
pickup. These source tests do not establish Battle Bridge execution or retirement.

Reusable lesson: shared authority-bearing producers need composition tests,
and queue acquisition, execution, physical exclusion, retirement and outcome are
distinct lifecycle facts. A held processing result is never evidence of a build.
