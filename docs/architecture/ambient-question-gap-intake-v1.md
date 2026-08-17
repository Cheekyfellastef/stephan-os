# Ambient Question Gap Intake V1

## Purpose

Advance #1721 with a bounded deterministic intake contract for ordinary Shared Workspace questions. The contract turns a materially inadequate answer into a canonical gap *candidate* while preserving the existing #1290 conversation fabric, #1308 capability ladder, #1556 scheduler and #1607 compounding flywheel.

It does not create a second question database, backlog, scheduler or implementation authority.

## Question origins

The source contract recognises exactly:

- `FORMAL_TEN_QUESTION_ROUND`
- `AMBIENT_PARTICIPANT_CONVERSATION`
- `OPERATOR_QUERY`
- `SYSTEM_PROBE`
- `REGRESSION_REPLAY`

Ambient questions do not require a `roundId`, but retain question/correlation identity, asker/target, intent fingerprint, expected evidence class and observation time.

## Owner routing before gap creation

`UNSUPPORTED_BY_THIS_PARTICIPANT` does not become a platform defect while another qualified participant remains available. The result becomes `OWNER_ROUTING_REQUIRED` and preserves the candidate owners without manufacturing a gap.

## Buildable gaps and boundaries

Buildable answer verdicts reuse the canonical `STEPHANOS_BUILDABLE_GAP_VERDICTS` from `stephanosConversationalCapabilityLadderV1.mjs`. Root causes use the #1721 classes such as memory/retrieval, missing canonical state, participant connection, tool/data access, reasoning, freshness and proof/citation gaps.

External, intentional, privacy, authority, safety and insufficient-evidence boundaries are retained explicitly as non-buildable observations. They never request a permission expansion, purchase or source/runtime mutation.

## Stable deduplication

A buildable gap receives a stable SHA-256 signature over:

- root cause class;
- normalized affected capability;
- sorted affected participants;
- expected evidence class.

Equivalent misses can therefore aggregate under one signature even when the individual question IDs differ. `aggregateAmbientQuestionGapOccurrencesV1()` reports occurrence count, distinct participants, first/last observation and source-question references.

## Existing-goal-first mapping

The contract never creates a GitHub issue itself.

- exactly one existing goal candidate -> `GAP_DEDUPLICATED` and that goal is selected;
- zero existing candidates -> `NEW_CANONICAL_GOAL_REQUIRED` as a proposal only;
- multiple candidates -> `SAFE_HOLD_AMBIGUOUS_GOAL_OWNERSHIP` rather than choosing silently.

A later governed adapter may perform the existing-goal search and scheduler admission. Those actions remain outside this source slice.

## Authority boundary

All authority flags are false. The contract grants no Shared Workspace write, GitHub goal creation, scheduler admission, source mutation, command execution, approval, merge, deployment, runtime mutation, spending or authority widening.

## Focused proof

```bash
node --test shared/agents/ambientQuestionGapIntakeV1.test.mjs
```

The suite covers existing-owner mapping, signature stability, owner rerouting, non-buildable boundaries, new-goal proposal, ambiguous-owner safe hold, repeated-occurrence aggregation, unsafe evidence refs, zero authority and accessor-bearing hostile input.

## Next acceptance step

After the live ChatGPT-to-Stephanos proving route is separately authorised and demonstrated, ordinary Shared Workspace conversations can feed this intake contract. A real ambient miss must then be deduplicated against durable goals, admitted through existing scheduler machinery, repaired, and replayed from more than one participant before #1721 can be called complete.
