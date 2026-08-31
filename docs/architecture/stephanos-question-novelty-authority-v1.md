# Stephanos Question Novelty Authority V1

## Purpose

This is the bounded canonical novelty-authority slice for the recursive ten-question capability flywheel owned by #1607 and consumed by #1308.

It exists to replace benchmark theatre with inspectable evidence that Round N+1 is materially different from genuinely settled capability-round history. It does not generate questions, answer them, create goals, dispatch work, select providers, mutate source, approve, merge, deploy, mutate runtime, access accounts or spend money.

## Why this is a separate authority contract

Current `shared/agents/stephanosConversationalCapabilityLadderV1.mjs` deliberately rejects every round after Round 1 with:

```text
canonical-novelty-authority-unresolved
```

That fail-closed rule is correct until a durable novelty ledger can prove the next set is not an exact replay, superficial rewording or internally duplicated benchmark set.

This slice builds that missing proof boundary without weakening the existing ladder. Integration into the ladder is a later exact-head change after this contract is independently reviewed and admitted.

## Canonical settled-round input

The ledger builder does **not** accept a caller-supplied `roundState=SETTLED` flag.

Each `priorRounds[]` entry must contain:

```text
round
answers
settlementProofRefs
```

`round` is the complete existing `stephanos.conversational-capability-round.v1` snapshot. `answers` are the complete existing ten canonical answer records. The novelty authority reruns `evaluateStephanosCapabilityRound({ round, answers })` and admits the history only when that canonical evaluator itself returns exact `SETTLED`, `mayAdvanceToNovelRound=true`, no repair replay and no boundary adjudication.

At least one durable settlement proof reference is also required per round. These proof refs are content-bound into the ledger. They are evidence lineage, not permission for the novelty module to fetch or mutate Shared Workspace itself.

This avoids a second question format, a second round-state authority and caller-fabricated settlement truth.

## Ledger

The ledger preserves:

- exact prior round refs;
- per-round durable settlement proof refs;
- exact prior question ids;
- question classes;
- question text plus canonical normalized text;
- intent fingerprints;
- expected evidence classes;
- prior novelty refs;
- a fingerprint digest;
- a full content digest;
- a content-derived ledger id.

Tampering with a question, proof reference, digest, round sequence or ledger identity fails closed.

## Candidate-round proof

`evaluateStephanosQuestionNoveltyAuthorityV1()` accepts the complete existing `stephanos.conversational-capability-round.v1` candidate snapshot, not a private reduced question format.

The candidate must be exactly the next round after the highest settled round and contain exactly ten questions with at least eight capability classes.

Every candidate question must:

1. use a fresh intent fingerprint;
2. carry one or more real prior question ids in `noveltyRefs`;
3. explicitly include its closest prior lexical comparison in `noveltyRefs`;
4. remain below the global lexical replay threshold;
5. remain below the tighter same-class-and-evidence replay threshold.

The ten-question set must also avoid a near-duplicate pair.

V1 uses deterministic token-set overlap because it is provider-neutral, inspectable and reproducible. A future semantic model may add stronger evidence, but no model-owned score may silently replace the canonical ledger or weaken deterministic replay protection.

## Output

A passing result is:

```text
schemaVersion = stephanos.question-novelty-authority.v1
verdict = NOVELTY_PROVEN
mayAdmitNextRound = true
```

It includes per-question closest-prior evidence, exact-fingerprint replay truth, lexical overlap, novelty-ref verification, set diversity, thresholds and the exact ledger digests used.

A failing result is `SAFE_HOLD` with structured reasons and `mayAdmitNextRound = false`.

## Authority boundary

Every result fixes these authority flags to false:

```text
createsGoals
dispatchesWork
mutatesSource
approvesOrMerges
deploysOrMutatesRuntime
selectsProvider
spendsOrAccessesAccounts
```

Novelty proof is evidence only. It cannot widen authority, generate a question set or settle the preceding round.

## Relationship to #1896 systems-expert transfer fixtures

#1896 currently carries a source-only Round 2 transfer fixture suite. Its temporary `noveltyRefs` use transfer labels because the canonical Round 1 has not yet executed and therefore there are no real settled Round 1 question ids to reference.

Those labels are **not acceptable novelty evidence** to this authority contract. After the real Round 1 settles, the transfer set must be rebound to actual prior question ids and then evaluated against the content-bound ledger. Invented `transfer:*` refs cannot make the candidate round pass.

This is intentional anti-benchmark-gaming behavior, not an integration shortcut.

## Relationship to #1308 live peer-intelligence proving

The real `LIVE_CHATGPT_TO_STEPHANOS_ROUND_001` remains a later protected runtime/Shared Workspace proof. This slice does not execute it.

After Round 1 is genuinely settled and this authority contract is admitted into the capability ladder, the second ten-question set can be evaluated against the complete canonical Round 1 ledger instead of being unconditionally rejected. Failed questions continue through existing #1607/#1721 deduplication and normal #1556 construction/proof machinery. Cognitively correct but hard-to-use turns remain #1722 experience debt.

## Acceptance for this slice

Source acceptance requires:

- exact reuse of the existing canonical round/question/answer schemas;
- recomputation of settled eligibility through the existing canonical evaluator;
- durable settlement-proof lineage;
- content-bound ledger integrity;
- exact fingerprint replay rejection;
- superficial lexical replay rejection;
- fake novelty-ref rejection;
- within-set duplicate rejection;
- hostile/accessor caller rejection;
- zero mutation/dispatch/provider/approval authority;
- fresh exact-head hosted CI and provider-neutral review.

No live conversation, provider call, Shared Workspace write, merge, deployment or runtime mutation is implied by source proof.
