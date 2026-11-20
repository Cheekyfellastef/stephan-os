# Goal #2315: repeatable preparation before protected mailbox cutover

The source authority remains `CANONICAL_MAILBOX_ISSUE` in
`shared/agents/canonicalMailboxAuthorityV1.mjs`. This change does not activate
the provisioned successor or retire the current mailbox.

## Implemented boundary

The existing serialized Mailbox Receipt Index job observes authoritative GitHub
capacity after publishing receipt truth. Below the configured threshold it makes
no lifecycle writes. At/above threshold it enumerates newer issues through REST,
reuses one owner/workflow-authored inactive nomination, or persists a provisioning
intent on the existing Goal #2315 before creating exactly one inactive issue.
Ambiguous/lost create responses remain held until the original owner reconciles
them; subsequent empty discovery cannot cause another creation. The successor is
read back through GitHub before its identity is published in the existing goal.
No new scheduler, controller, queue, worker, token, credential scope or main-write
route is added. Receipt publication precedes capacity preparation so a preparation
failure cannot prevent the current job from publishing terminal receipt truth.

The workflow imports the existing deterministic planner and canonical authority.
It does not interpret a public issue marker as an approval or switch authority.
The only automatic mutation is inert issue provisioning and a capacity-state
comment on the existing owner. There is no automatic merge or runtime cutover.

## Live 25 October checkpoint (observation, not freeze proof)

- Protected main: `3196c63aa886b3e39621844b9695118fcde2a6e3`, tree
  `1c451b03ae81a2234fecc1512dc20b92166aca7f`.
- Active source identity: #3149; 2,215 comments at observation; threshold 2,200.
- A complete 23-page REST read found 742 owner command comments and 1,218 owner
  receipt comments, covering 741 distinct request IDs (one ID appeared in two
  command comments). Every observed command request ID had a terminal receipt.
  This is a bounded observation; producers were not frozen and may publish later.
- Local state also showed empty `acceptedRequestIds`, no pending receipt
  publications, and no active receipt. These are corroborating observations,
  not an authorization or an exclusive transport freeze.
- One successor was provisioned under explicit operator instruction:
  [#3258 — INACTIVE canonical mailbox successor to #3149 — Goal #2315](https://github.com/Cheekyfellastef/stephan-os/issues/3258).
- Original source branch `goal/2315-mailbox-2808-to-3149-cutover` was advanced by
  a history-preserving merge with the exact current-main tree (zero source diff),
  after verifying old PR #3174 was merged and no open #2315 continuation existed.
  [PR #3259 — Goal #2315: qualify repeatable mailbox rollover and #3149 successor cutover](https://github.com/Cheekyfellastef/stephan-os/pull/3259)
  establishes the current continuation identity. The existing Programme Authority
  granted `goal-2315-pr-3259-rollover-20261025-v1` before implementation.

## Remaining activation gates

The registered Sovereign maintenance surface has no commissioned mailbox
freeze/drain/cutover action. The existing source planner and this provisioning
consumer confer no such authority. A quiet mailbox cannot substitute for that
missing mechanism. Do not switch two constants and call the migration complete.

Through this same owner and protected source lane:

1. Qualify the producer freeze barrier and obtain acknowledgement from every
   existing producer without replacing/reconfiguring the five hourly controllers.
2. Hold the existing mailbox's execution/publication guard, drain original
   ACCEPTED/in-flight work and its publication outbox, and capture a complete
   frozen command/terminal-receipt inventory with exact request identities.
3. Prove one durable cross-epoch deduplication ledger. Dual-read predecessor
   receipts for continuity only; do not pass predecessor commands into the new
   executor, copy commands, replay completed work or discard unresolved work.
4. Qualify an atomic canonical-authority change plus retired history under exact
   source/head/base/tree tests, independent high-risk specialist review, exact
   operator protected approval and existing environment gates.
5. Converge the canonical host using the existing guarded update path while
   preserving every dirty file and gaming/resource guard. Read back the installed
   source/process identity and each producer/consumer's canonical epoch.
6. Execute two fresh distinct owner-authorized read-only successor probes and
   retain each original request ID through ACCEPTED to its terminal receipt.
7. Prove predecessor rejection for new commands; keep all predecessor command and
   receipt evidence queryable in the existing receipt index/truth issue #1575.
   Only then mark predecessor retired/closed and unfreeze the existing producers.

No exact future merge approval or standing automatic-cutover policy is implied
by this preparation. Goal #2315 stays open until repeated automatic rollovers,
including partial-cutover, producer lag, lost response and replay scenarios, are
qualified and commissioned. Preserve the prior #2808→#3149 review exception as
historical audit; it is not a reusable review waiver.

## Reusable invariant

Durable intent precedes non-idempotent provisioning. Lost transport responses
must fail closed instead of producing a second successor. Inert transport
capacity, reviewed source, protected approval and live cutover are separate facts.
