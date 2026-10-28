# Saturated canonical mailbox: bounded rotation control adapter

Status: DESIGN ONLY / IMPLEMENTATION BLOCKED. Structural review 5688751020 found an
unresolved P1 native-producer provenance dependency. No recovery carrier is selected or
qualified by this document.

Canonical owner: #2315 — Goal: Automatic canonical mailbox rollover before GitHub comment ceiling.
Existing activation remains PR #3268 — Goal #2315: activate canonical mailbox #3258 and retire #3149.
This prerequisite does not replace that activation PR, its reviewed source artifact, executor,
scheduler, worker, lease, or ordinary command authority. The custody repair remains owned by
its existing recovery chat.

## Observed defect

At protected main 73e1a79c03cb9dafe8fb17d77a45a9ac502e32ce, canonical issue 3149 has
2500 comments and nominated issue 3258 is inactive. The installed FREEZE host requires a real
selectedCommentId; its fence verifier requires the original predecessor command and corresponding
native DONE receipt as predecessor/successor comments. Thus exhaustion blocks BOTH control
ingress and the evidence needed to relax the fence. Custody recovery does not repair this
transport dependency. Current private maintenance and dispatch inventories expose no qualified
rotation control adapter. Existing PRs 2990 (protected merge actor/base binding) and 3133
(single-action deadlines) address different defects and must not be repurposed as this carrier.

Never invent comment IDs, edit or replay historical commands, delete history to make space,
post executable commands on the inactive successor, treat a read-only Actions discovery run as
execution authority, or merge activation before real native freeze/drain.

## Proposed correction: one private adapter to the original transaction

Extend the existing private Sovereign fixed-operation registry, not a second listener,
daemon, queue, worker or controller. Admit only rotation CONTROL: FREEZE, DRAIN, STATUS,
pre-cutover CANCEL and final VERIFY. Reuse the original serialized mailbox/outbox guard,
execution reservation ledger, transition state, native executor, fence, action assessor and
source convergence. Ordinary command authority remains selected solely by
canonicalMailboxAuthorityV1.mjs. Public mailbox contracts gain no shell, file, process,
lease, restart, provider, spending or general command capability.

A fixed source entrypoint may support private bootstrap of the same registered adapter when
the desktop client lacks its schema. Source presence is not host activation. Its executable,
arguments, environment, source closure and operation enum must be fixed, captured and
independently authenticated at current protected main BEFORE execution. No caller script,
executable, path, issue number, authority boolean or arbitrary payload is admitted.
The connected fresh-process/source-digest proof remains required.

### Owner consent and single-flight identity

Require a fresh, exact, owner-authored control approval on the EXISTING activation PR, which
has capacity. This is a dedicated rotation approval schema, not an ordinary command mailbox.
Authenticate repository/owner numeric identity, real unedited comment, issue/PR identity,
phase-specific PR state, complete head/base/tree and canonical epoch identities using
canonical GitHub reads before and after admission. The phase table below is normative; Refuse edited, expired,
foreign, ambiguous or stale consent and changes in main/PR/source. The approval grants
only its closed phase; merge, source sync, native installation and restart gates stay separate.

The approval's immutable identity is the CONTROL origin. Do not label its PR comment as a
predecessor mailbox comment. Persist a tagged transport identity containing its repository,
activation PR, comment ID and digest, exact source and phase before effects. Derive a stable
request/transition identity and reserve it in the existing execution ledger; retries reconcile
the same reservation/result. A timed-out or uncertain effect cannot be retried with a new ID.
Comment-based V1 records and their replay tombstones remain valid and unchanged.

### Explicit barrier model

Separate control origin from command ordering. Under the SAME original mailbox/outbox guard,
read the COMPLETE predecessor command/receipt history, accepted ledger, outbox and admitted
Actions. Capture an authenticated predecessor barrier from the actual inventory and its
digest; never synthesize a selectedCommentId. A V2 tagged transition must distinguish:
control origin; predecessor inventory/barrier; exact activation identity; source generation;
and phase. Reject missing, mixed-version, substituted or mismatched records.

Retain later predecessor commands explicitly. DRAIN advances the barrier only through its
fresh authorized phase. Preserve both pre- and post-barrier work and historical outcomes;
do not declare unknown or queued work complete. Reuse the existing V2 Actions execution
quiescence predicates, immutable workflow/attempt/job evidence, complete pagination and
freshness bounds. Aggregate Actions status alone remains distinct from execution quiescence.

### Receipts and deny-only fence

The outer original guard alone certifies FROZEN after the child exits, empty native accepted
work, complete history, empty segmented outbox and fresh Actions proof. The private adapter
must return an authentic request-correlated terminal native receipt; ACCEPTED or process
success is insufficient.

Reuse the EXISTING fixed Goal 2315 fence publication/readback channel for bounded tagged
CONTROL evidence, because the predecessor is full. This is not an ordinary command channel.
Specify exact ownership and immutable reference checks for control approval, native receipt,
transition, source, barrier and phase. The fence reader must fetch and authenticate the
original references; a fence body or caller-provided receipt never supplies proof by itself.
A separate V2 parser/projector must reject ambiguous V1/V2 combinations and validate receipt
provenance at least as strongly as current native-published V1 evidence. Define this provenance
concretely during structural review; if the existing native publication trust cannot be
preserved through the fixed channel, implementation stays BLOCKED.

The fence is ONLY a locator/deny projection. Owner-authored comments and matching JSON fields
are not an independently established native producer trust root. Current V1 field matching
must not be cited as qualification for a new V2 producer. No current eligible rotation-receipt
producer/verifier enrollment has been proven. Capacity receipts and signed Observatory gates
have different domains and do not enroll a control signer. Do not generate a key, reuse a
capacity/gate signature as control authority, add a signer, or install this adapter under this
proposal. Until a separately qualified existing producer, explicit domain enrollment, original
immutable artifact store and independent verifier are identified and reviewed, the entire
adapter stays BLOCKED: NATIVE_ROTATION_PRODUCER_UNQUALIFIED. Publishing receipt-shaped bytes
on Goal 2315 cannot change that result.

DRAINING remains deny-only even when terminal publication fails. Relaxation requires
independently verified FROZEN evidence and admits only the exact activation PR/head through
the original protected validators. Cross-boundary state must survive crash/restart without
replay. No dual active ordinary mailbox authority is introduced.

## Phase-specific consent predicates

| Phase | Activation/epoch predicates |
| --- | --- |
| FREEZE | Exact open/unmerged activation PR and reviewed head/base/tree; current protected source still selects predecessor; exactly one nominated inactive successor; no other active transition. |
| DRAIN / STATUS | Same original transition and explicit current phase/source; before adoption require the open/unmerged activation and inactive successor. After adoption, STATUS is read-only and must prove the exact merged activation/new epoch; it grants no drain/effect permission. |
| CANCEL | Only the matching pre-cutover transition, current source still predecessor and activation unmerged. Deny after epoch change; no rollback authority. |
| VERIFY | Exact authenticated merged activation and merge/source tree; current main equals the admitted merged source; successor is active and predecessor retired; original frozen transition and both distinct fresh probe classes proven. Never require an open PR/inactive successor here. |

Consent binds the phase's current expected source main/tree separately from the immutable
activation branch head/base/tree and recorded merge identity. Drift refuses admission; do not
weaken the pre-cutover predicates to accommodate VERIFY.

## Saturated predecessor receipt debt: explicit applicability boundary

This first proposed recovery applies ONLY when native accepted work, ordinary publication
outbox debt AND complete predecessor history are independently proven empty/terminal under
the original guard. No such live proof is asserted here. CONTROL evidence routing cannot
pay ordinary ACCEPTED/terminal receipt debt: current postReceipt targets receipt.issueNumber,
failed publication is retained, and retry uses that same destination.

Any ordinary unpublished receipt, orphan ACCEPTED, incomplete history, corrupt/missing
outbox or ambiguous terminal blocks applicability as SATURATED_PREDECESSOR_RECEIPT_DEBT.
Never discard debt, relabel it DONE, redirect it to the successor, change its original epoch,
or teach the auditor to trust a synthetic terminal. Authenticated receipt-only reconciliation
would require its OWN complete canonical evidence design and independent qualification;
it is not an implicit part of this proposal.

## Durable phase transaction and crash reconciliation

Extend the original guarded transition transaction, not a second queue. A V2 transaction
must durably bind schema/version, transition ID, stable request ID, tagged control-origin
repository/PR/comment/body digest, phase, canonical command epoch, current source head/tree,
activation identity, predecessor barrier/digest, consent expiry and journal state. Required
states: PREPARED, RESERVED, EFFECT_INTENT, EFFECT_APPLIED, TERMINAL_STORED, PUBLISHED.
The immutable original terminal artifact digest/reference is recorded when available.
All writes use the existing safe atomic/fsynced state primitive under the original guard.

Ordering: persist PREPARED before existing-ledger reservation; then persist RESERVED after
matching reservation readback. Persist EFFECT_INTENT before effects. Effect state and
EFFECT_APPLIED checkpoint must be one canonical atomic transition generation, or a separately
authenticated native effect witness must identify their exact generation. Otherwise a crash
between effect and checkpoint is UNKNOWN and no automatic retry is allowed.
Persist the original terminal artifact before recording TERMINAL_STORED; publish/read back
that exact artifact before PUBLISHED and ledger terminalization. Native evidence still
requires the unresolved producer/verifier qualification above.

Recovery under the same guard must distinguish:
- PREPARED without reservation: no effect permitted; revalidate consent/source before a
  first reservation, or retire as nonexecuted when expired/edited.
- Matching RESERVED with no effect intent: revalidate unchanged consent/source/epoch before
  the first effect. Use an explicit read/reconcile path; never call reserve again.
- EFFECT_INTENT without exact authenticated applied-generation evidence: remain HELD/UNKNOWN.
  No new request ID, guessed rollback or automatic re-execution.
- Authenticated EFFECT_APPLIED/TERMINAL_STORED: return or republish ONLY the original immutable
  artifact; expiry/edit/source movement cannot authorize another effect. Historical
  publication must retain original epoch/source and pass its qualified provenance verifier.
- PUBLISHED: idempotent return of the same original result, with no new effect.

Conflicting digests, missing journal/artifact, mixed versions or an unprovable phase hold.
V1 RESERVED entries cannot be upgraded into resumable V2 work from their sparse fields.
V1 tombstones remain replay denials; they are not a phase journal. An expiry/edit before
effects forbids execution; after an uncertain effect it demands authenticated reconciliation,
never an assertion that nothing happened.

## Required delivery order

1. Independent structural review of this design, including concrete native receipt provenance,
   consent freshness/edit rules, bounded private bootstrap and origin/barrier separation.
2. Original-owner scoped implementation and adversarial tests on the SAME prerequisite branch.
   No runtime installation or activation is authorized by this document.
3. Complete exact-head relevant Windows/Linux proof and qualified Windows/security specialist
   review; exact operator integration approval and existing protected merge.
4. Guarded same-epoch source/runtime/plugin convergence and actual connected adapter readback.
5. Fresh exact phase consent; real FREEZE, five-controller acknowledgements and empty native/
   history/outbox/Actions drain under the original guard.
6. Requalify the EXISTING activation PR against current main; exact merge approval/protection.
7. Guarded epoch adoption, actual producer/consumer identities, two distinct new successor
   READ_DEPLOYMENT_STATUS and READ_CAPABILITY_REGISTRY ACCEPTED-to-DONE probes, and final VERIFY.

The original Seed task seed-receipt-identity-01 and its manifest remain unchanged.
Its supervised host placement, gaming budget, current ownership, task approval and physical
pickup remain separate admission facts. No build is claimed or dispatched by this proposal.

## Minimum hostile qualification

Test forged/edited/expired owner approval, wrong repository/PR/main/head/base/tree/phase,
inactive/retired/wrong successor, duplicate or late request, concurrent private/comment
ingress, crash after reservation or partial fence publication, substituted receipt, mixed
V1/V2 provenance, missing pagination, late accepted commands, nonempty outbox, stale Actions,
quiescence identity drift, wrong connected generation, changed local source and post-epoch
CANCEL. Include real Windows guard/singleton/receipt evidence, not fixture booleans.
Positive proof must use a full predecessor fixture without removing history, then an
authorized live exact transition. Safeguards stay closed until every relevant receipt exists.

## Shared invariant

Control origin, command ordering, execution ownership, terminal receipt, operator consent
and canonical epoch are separate identities. A finite ordinary transport must not be the
only carrier for its own guarded retirement. A recovery carrier inherits no additional
execution or merge authority.
