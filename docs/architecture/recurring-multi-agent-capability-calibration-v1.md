# Recurring Multi-Agent Capability Calibration V1

Primary intelligence goal: #1308. Flywheel goals: #1607 and #1721. Shared Workspace owner: #1290. Scheduler/flywheel owner: #1556. Durable and reflective memory owner: #1645.

## Purpose

Turn the existing Stephanos ten-question proving machinery into a recurring learning loop for every registered participant without creating another scheduler, workspace, memory store, goal system or authority plane.

The loop is:

```text
real work and conversation
  -> Shared Workspace evidence
  -> recurring ten-class calibration
  -> grounded pass / partial / buildable gap / boundary hold
  -> existing goal search and repair/replay
  -> Flywheel improvement candidates
  -> reflective-memory candidates
  -> later Dreaming / memory consolidation under existing memory authority
  -> materially novel next round
  -> calibration-system review
```
## Participants

The orchestrator is participant-neutral. It does not hard-code a closed club of Stephanos and OpenClaw.

Any participant with a safe Shared Workspace identity may be calibrated, including Stephanos, OpenClaw Standalone, ChatGPT bridge participants, UI agents, specialist agents and future registered participants.

Each participant still receives exactly the same ten canonical capability classes:

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

The class contract stays stable. The actual questions must change.
## Recurrence

Default scheduled recurrence is seven days.

A calibration also becomes due immediately after a material:

- capability change;
- failure and recovery;
- operator correction;
- model/provider change;
- authority change;
- explicit manual request.

The cadence decision is deterministic and authority-free. It does not itself start an agent, write Shared Workspace or schedule a task.

Runtime scheduling remains with the existing controller/scheduler estate.

## Anti-benchmark gaming

Round 1 uses the existing ten-class contract.

Later rounds are not admitted merely because they contain ten questions or use new ids. They must pass the existing canonical question-novelty authority against the content-bound settled-round ledger.

The novelty authority rejects:

- repeated intent fingerprints;
- superficial lexical replay;
- fake or unknown novelty refs;
- failure to acknowledge the closest prior question;
- near-duplicate questions inside the new set.
The original evaluator still fails closed for later rounds by default.

A later round is evaluated only when trusted host context binds:

- the exact candidate round id and number;
- the canonical novelty-authority schema;
- verdict `NOVELTY_PROVEN`;
- the exact novelty ledger id;
- one or more proof refs.

Caller-shaped question, answer or round data cannot set this host context on itself.

This connects the previously separate novelty authority to the capability ladder without making novelty a caller-owned boolean.

## Shared Workspace

Each participant evaluation projects through the existing Shared Workspace participant-status schema and is bound to the existing Stephanos capability programme lineage.

The cycle also emits one existing-kind Shared Workspace event describing the calibration trigger, participant count and improvement-candidate count.

The V1 source module constructs and validates these records but does not write them. A runtime publisher must use the existing Shared Workspace store.

The existing Shared Workspace record store now exposes the latest participant-status records, and the existing ChatGPT Shared Workspace relay projects a compact calibration-readiness view during READ_CURRENT_STATUS. This makes due participants visible through the production conversation fabric without creating another participant registry, scheduler or writer.
## Repair and replay

The existing evaluator remains authoritative.

A buildable gap or partial answer means:

```text
nextNovelRoundAllowed = false
repairReplayRequired = true
```

Buildable gaps preserve the evaluator's existing-goal candidates. The recurring layer marks `requiresExistingGoalSearch=true`; it does not create a duplicate goal merely because a question failed.

After repair, the affected capability must be replayed and the round must settle before novelty progression.

Authority/safety boundaries remain boundaries. They are not converted into fake engineering debt.

## Flywheel learning

Every buildable gap becomes a bounded Flywheel improvement candidate.

Real learning events can also enter the cycle:

- failure/recovery;
- operator correction;
- success pattern;
- method improvement.
These events must carry evidence refs and an existing participant identity.

They become candidate lessons, not automatic truth.

Every calibration cycle additionally creates a `CALIBRATION_SYSTEM_REVIEW` candidate asking the Flywheel to inspect:

- question quality;
- evidence quality;
- participant routing;
- repair/replay effectiveness;
- memory consolidation quality;
- recurring-calibration machinery itself.

This makes the calibration system part of the Flywheel rather than a permanent fixed benchmark.

## Reflective memory and Dreaming

The recurring layer emits reflective-memory candidates for success, recovery, correction and method patterns.

Candidates are explicitly:

```text
promotionState = CANDIDATE
requiresIndependentValidation = true
durablePromotionAllowed = false
```

The calibration layer cannot write or promote memory itself.

Existing reflective-memory and Dreaming machinery may later validate, consolidate or reject recurring patterns under the canonical memory authority.
This prevents one bad answer or one model-generated interpretation from silently becoming durable memory.

## Authority boundary

The recurring calibration authority is fixed to false for:

- goal creation;
- work dispatch;
- source mutation;
- Shared Workspace writes;
- memory promotion;
- authority changes;
- approval or merge;
- deploy/runtime mutation;
- provider selection;
- account access or spending.

It is evidence and planning machinery.

## Focused proof

```bash
node --test shared/agents/recurringMultiAgentCapabilityCalibrationV1.test.mjs
node --test shared/agents/stephanosConversationalCapabilityLadderV1.test.mjs
node --test shared/agents/stephanosQuestionNoveltyAuthorityV1.test.mjs
```

The focused regression proves scheduled/event recurrence, exact ten-class coverage, copied-question rejection, genuinely novel later-round admission, trusted-host-only later-round evaluation, ledger extension, multi-participant evaluation, gap repair/replay, operator-correction learning and participant extensibility.
## Runtime acceptance still required

Source proof is not a live recurring calibration deployment.

The next runtime slice should reuse existing owners to:

1. discover currently registered Shared Workspace participants;
2. select those due for calibration;
3. prepare fresh candidate questions for each ten-class round;
4. run canonical novelty proof before later-round admission;
5. deliver questions and collect answers through existing Shared Workspace conversation paths;
6. publish the validated participant-status/event records through the existing Shared Workspace writer;
7. hand Flywheel candidates to the existing goal/flywheel deduplication path;
8. hand reflective candidates to existing memory review/Dreaming machinery;
9. persist settlement and novelty proof refs;
10. repeat on schedule or material-change triggers.

No second controller, scheduler, queue, memory store, workspace or goal system is required.
