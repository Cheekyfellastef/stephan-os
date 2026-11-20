# Goal #2315: guarded activation of mailbox #3258

This is the sequential activation continuation after protocol PR #3259 merged
as `7197978b9b198c7c68d0f816acaeff325a9c7014`. Its terminal native receipt is
[6416417511](https://github.com/Cheekyfellastef/stephan-os/issues/3149#issuecomment-6416417511).
The source-only bridge sync observed that installed head and passed 186 checks.
Neither observation proves cutover or an upgraded long-lived dispatcher.

The proposed atomic authority change selects the existing inactive issue #3258
and appends #3149 to retired history. The receipt predecessor is derived from
that same retired list. All earlier mailbox identities remain historical
provenance. Current command fixtures and their comment URLs import the canonical
identity instead of retaining a permanent active issue literal. Historical
receipts retain their original identities. Repeated-epoch qualification preserves
the complete retired history, and the full command validator denies every
retired issue, including #3149.

## Execution order and evidence

1. Read fresh protected main, this activation PR's exact head/base/tree, the
   source authority, Goal #2315 continuation, inactive successor #3258 and live
   capacity. Confirm no competing active owner or source claim. Obtain exact CI,
   independent specialist review and the required operator approval. An earlier
   protocol approval cannot approve this activation commit.
2. Prove the connected private dispatch generation uses the fresh-process
   adapter and returns its captured script digest. Match that digest to installed
   source and require real source-operation readback. A file sync, old test count,
   user restart report or fresh isolated test process cannot substitute for the
   connected client's proof. Preserve maintenance custody and gaming holds.
3. Through the existing serialized native mailbox, issue `FREEZE` bound to this
   exact open activation PR/head and the existing #3258 nomination. Read back the
   durable local hold and authenticated deny-only Goal #2315 fence. Preserve the
   original five hourly configurations and obtain their actual acknowledgements.
4. Drain all original accepted work, complete command/receipt history and the
   publication outbox. Read all admitted queued/running/waiting Actions. Retain
   late commands; explicitly advance the barrier with `DRAIN` when needed.
   The outer guard, after the child exits, must certify `FROZEN` and empty drain.
   Quiet traffic or an ACCEPTED control receipt is insufficient.
5. Execute the existing protected merge route against the exact approved head,
   base, tree and immutable review artifact, then independently verify the actual
   merge/main identity. Use the existing guarded source/runtime convergence path;
   it must recheck the frozen proof under the same mailbox guard. Preserve dirty
   files and do not substitute the old cached private dispatcher.
6. Read back producer and consumer epoch identities. Send two distinct new
   owner-authorized successor requests: `READ_DEPLOYMENT_STATUS` and
   `READ_CAPABILITY_REGISTRY`. Preserve each request ID through matching
   ACCEPTED and DONE receipts at the exact new process/source head. Prove receipt
   dual-read and cross-epoch tombstones without copying predecessor commands.
7. Run `VERIFY` only after the complete predecessor/Actions recheck and both
   probe classes are proven. Confirm the authenticated terminal fence projection,
   old-new-command rejection, all producer/consumer acknowledgements and retained
   #1575 receipt truth before declaring retirement and completion.

No source proposal, draft PR, test, approval projection or inactive nomination is
a live migration receipt. Before a freeze, cancellation can release only the
matching pre-cutover hold. After the epoch changes, rollback requires a protected
source decision. No duplicate controller, queue, worker, goal or competing PR is
created, and the original R7 retirement audit remains unchanged.
