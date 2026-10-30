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
exclude the attempt. Renewed live capacity versus an existing immutable pending
envelope also requires an ownership-preserving queue reconciliation contract;
removing receipt identity from agreement is not an acceptable workaround.

Reusable lesson: shared authority-bearing producers need composition tests,
and queue acquisition, execution, physical exclusion, retirement and outcome are
distinct lifecycle facts. A held processing result is never evidence of a build.
