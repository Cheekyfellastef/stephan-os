# Stephanos Ten-Question Conversational Evaluation Contract V1

Primary goals: #1308, #1607, #1721. Shared-fabric owner: #1290. Durable-memory owner: #1645. Programme/flywheel owner: #1556.

This slice adds the deterministic evaluation contract for the conversational capability flywheel. It does **not** create another chatbot, scheduler, Shared Workspace, memory store, dispatcher or goal-creation authority.

## Why this slice exists

Stephanos should become more capable because real questions expose real missing capabilities, not because a fixed demo prompt is polished until it looks intelligent.

The contract therefore makes a capability round auditable:

```text
10 materially diverse questions
  -> evidence-backed answer records
  -> deterministic verdicts
  -> buildable misses become gap observations
  -> existing goal owners are searched first
  -> repair/replay remains required
  -> only a settled round may advance to a novel round
```

## Initial ten capability classes

Round 1 targeted at `stephanos` must cover all ten classes:

1. current programme truth;
2. architecture and relationships;
3. memory and continuity;
4. agent and tool capabilities;
5. blockers and proof;
6. why a decision was made;
7. what changed recently;
8. next best action;
9. cross-domain connection;
10. self-knowledge and unknowns.

Every round contains exactly ten unique question IDs and ten unique intent fingerprints. Later rounds require novelty lineage and at least eight distinct capability classes so paraphrasing the original set cannot satisfy the contract.

## Grounding contract

`ANSWERED_GROUNDED` requires:

- a grounded epistemic state (`KNOWN_FROM_CANONICAL_STATE`, `OBSERVED_FROM_RUNTIME_OR_PROOF` or `INFERRED_FROM_EVIDENCE`);
- `FRESH` or `RECENT` evidence;
- at least one evidence reference;
- at least one consulted source;
- no `cannotAnswerReason`.

Stale, conflicting, unknown or merely proposed material cannot be labelled grounded.

## Buildable question gaps

The deterministic buildable gap classes are:

- `GAP_KNOWLEDGE`
- `GAP_CONTEXT`
- `GAP_MEMORY`
- `GAP_RETRIEVAL`
- `GAP_TOOL_OR_DATA_ACCESS`
- `GAP_CONVERSATION_FABRIC`
- `GAP_REASONING_OR_SYNTHESIS`
- `GAP_FRESHNESS`

A buildable miss becomes a stable SHA-256-backed gap observation keyed by participant, gap class, intent fingerprint and expected evidence class. The observation suggests existing owner goals first, for example #1645 for durable-memory gaps and #1290/#1506 for conversation-fabric gaps. It does not create or approve a new goal by itself.

Intentional unsupported behaviour, genuinely external unbuildable conditions and authority/safety boundaries are retained as explicit boundaries rather than converted into fake engineering debt.

## Settlement rule

A round cannot advance when it has:

- a buildable gap; or
- a partial answer still requiring repair/replay.

Ten grounded answers, or grounded answers plus explicitly retained non-buildable boundaries, settle the round. A later materially different round is then required by the parent goals.

This module does not itself score style, warmth or peer-level conversational quality. The comparative dialogue evaluation in #1308 remains a later layer. This slice establishes the truth and gap substrate that such scoring must sit on.

## Focused proof

```bash
node --test shared/agents/stephanosConversationalCapabilityLadderV1.test.mjs
```

The focused tests prove:

- exactly ten and materially diverse initial questions;
- duplicate intent fingerprints are rejected;
- later rounds require novelty lineage;
- grounded answers require evidence, sources and fresh-enough epistemic state;
- a memory miss becomes one deterministic gap linked to existing owners;
- one buildable miss prevents round advancement;
- ten grounded answers settle the round;
- an authority boundary is retained without manufacturing build authority.

## Next integration slices

After this contract is independently proven, the implementation should reuse existing machinery in this order:

1. adapt #1290 Shared Workspace request/response records to these round/question/answer identities;
2. run the first live ChatGPT -> Stephanos ten-question exchange through #1506;
3. feed buildable gap observations into #1607/#1721 deduplication and #1556 scheduling intake;
4. replay repaired original questions plus transfer variants;
5. run a materially different round;
6. add #1308 peer-level dialogue scoring and real OpenClaw programme questions.

No claim is made here that the live ChatGPT-to-Stephanos conversation path or the ten-question acceptance round has already passed.