# Goal #2315: guarded mailbox freeze, drain and epoch transition

The canonical authority module alone chooses the command issue. This protocol
continues the existing mailbox process, outer outbox guard, receipt index and
protected merge route. It installs no controller, scheduler, worker or queue.
The five hourly controller configurations and retired R7 audit are unchanged.

## Execution identity and provenance

Before an effect, the existing serialized executor durably reserves the exact
case-sensitive request ID in its mailbox state directory. A crash cannot turn
that reservation into a new command. Complete owner command/receipt inventories
seed prior epoch tombstones once per source-declared issue. Receipt-only private
deliveries are included. Corrupt, linked or partial ledger files fail closed.
Terminalization preserves the originating issue, and an existing reservation is
never reset to permit a replay. The old 500-item replay window is removed.

The receipt mirror reads current commands/receipts plus terminal receipts from
exactly the source-declared predecessor. It never executes predecessor commands
or imports predecessor ACCEPTED checkpoints as successor work. Existing bounded
truth carries older terminal provenance forward. No command comments are moved.

## Freeze and drain

`MANAGE_CANONICAL_MAILBOX_ROTATION` is a fixed owner-authorized CONTROL operation.
FREEZE binds a transition ID, inactive successor and exact reviewed activation
PR/head. The selected comment ID establishes the barrier. The local DRAINING
hold is persisted before publishing and reading back one deny-only fence comment
on the existing Goal #2315. A failed fence publication cannot certify a freeze.

Original pre-barrier work drains through the original executor. Later ordinary
commands remain visible and held with their original identities; they are not
silently rejected, copied or marked complete. DRAIN explicitly advances the
barrier. STATUS reads the original issue again. CANCEL can release a preparation
hold only before the source epoch changes; later rollback requires protected source.

Only the existing outer guard can certify FROZEN after the child returns. It
requires empty native ACCEPTED and publication state, an actually empty segmented
outbox, a complete command/receipt inventory with no early/late/orphan ACCEPTED
work, verified fence publication, and a recent complete inventory of queued,
running and approval-waiting production GitHub runs. A pending or unknown run
holds the transition; it is never cancelled by the migration. PR proof jobs have
no production execution authority and are excluded from that drain inventory.

The public fence cannot authorize an effect. Relaxation requires the real owner
FREEZE command, corresponding control command and matching native DONE receipt,
including source head, transition and activation identities. DRAINING blocks
privileged GitHub ingress; FROZEN permits only the already approved activation
PR/head through the original downstream protected validators. Receipt publication
continues. Bootstrap, observer, protected dispatch and final protected merge/check
completion recheck the same fence and fresh main source immediately before effects.
The bootstrap jobs gain only issue-read access on their existing GitHub job token
to inspect this fence; no new credential or secret is introduced.
The protected merge workflow remains byte-identical with its pinned permission
estate. Its merge-queue approval script reads only the fixed public Goal #2315
and referenced owner command/receipt evidence without an issue credential;
authenticated main readback and the original protected environment still bind
execution. Public API failure or ambiguity holds the required check closed.

## Protected activation and commissioning

Install this protocol while #3149 remains authoritative. A sequential activation
continuation then changes the active issue and appends its predecessor to retired
history atomically in the canonical module. It requires its own independent
specialist review, exact operator approval and original protected environment.
This protocol grants no standing merge approval and does not claim live cutover.

Before crossing epochs, the existing direct guarded source-sync route acquires
the same mailbox guard, rechecks the exact merged activation/main binding, full
predecessor inventory, native and segmented outbox drain, authentic FROZEN fence
and fresh Actions drain. It pins the actual sync target before fast-forwarding.
Missing transition evidence or newly arrived work blocks adoption. Normal source
sync within an unchanged mailbox epoch retains its existing guards.

The unattended GitHub Sync executor uses this same admission and mailbox guard,
rechecks custody after locking, and pins fast-forward to the exact reviewed SHA
instead of a moving remote ref. Changed local source, pending work, or unknown
drain prevents its merge. No new task or schedule is installed.

The long-lived private dispatch MCP sends each of its existing sync/update
operations to one bounded fresh Node child with fixed operations and closed
arguments. That child proves its source head unchanged around module loading,
using the canonical minimal environment and fixed Git executable/configuration
so inherited Node injection or Git repository selectors cannot redirect it,
then invokes the original implementation. It cannot retain a previous epoch's
cached authority import. Its returned adapter/source identity and the private
MCP process's captured script digest are commissioning evidence. An already
running legacy MCP process without this adapter is not presumed upgraded merely
because files changed; actual attachment/diagnostic readback remains required.

After adoption, only two fixed read-only probe classes are allowed until VERIFY.
VERIFY requires two distinct successor command IDs, real ACCEPTED and DONE
receipts from the exact new process/source head, source-declared predecessor
retirement, merged activation identity and another complete predecessor/Actions
readback. A late predecessor command remains an explicit hold. It is never
converted into executable successor work or discarded. Live producer and consumer
epoch readbacks, including each existing hourly producer, remain commissioning
evidence requirements; a deterministic test is not a live acknowledgment.

The authority-selected inactive successor preparation remains automatic at the
threshold through the existing serialized receipt mirror. Protected activation
continues to require exact approvals until a separately reviewed standing policy
is explicitly authorized. Lost-response provisioning, repeated A→B→C identities,
crash reservation, replay, stale workflow, forged fence, pending Actions and
partial-cutover cases are deterministic qualification scenarios.

## Reusable invariant

Transport capacity, source authority, execution ownership, terminal truth and
operator approval are separate facts. A durable reservation prevents replay;
a deny-only fence cannot grant privilege; unknown drain or readback stays held.
