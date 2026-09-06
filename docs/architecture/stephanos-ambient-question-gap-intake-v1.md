# Stephanos Ambient Question-to-Goal Gap Intake V1

## Purpose

Advance #1721 by turning an ordinary Shared Workspace question outcome into one deterministic, inspectable **gap-intake decision** without creating another scheduler, private backlog, memory silo or source of programme truth.

This M1 slice is deliberately source-only and read-only. It classifies one question/answer result, routes unsupported questions to another qualified owner before declaring a platform defect, derives a stable cross-participant gap signature for buildable misses, deduplicates against existing gaps, and maps the result to an existing canonical goal when one unambiguous owner exists.

It does not write to Shared Workspace, create a GitHub issue, dispatch the scheduler or mutate source/runtime state.

## Governing invariant

```text
NO_BUILDABLE_UNANSWERED_QUESTION_DIES_IN_CHAT
```

The corresponding anti-spam invariant is equally important:

```text
ONE_ROOT_DEFECT -> ONE_CANONICAL_GAP -> ONE_CANONICAL_GOAL OWNER
```

## Durable question origins

The contract accepts the canonical #1721 origins:

- `FORMAL_TEN_QUESTION_ROUND`
- `AMBIENT_PARTICIPANT_CONVERSATION`
- `OPERATOR_QUERY`
- `SYSTEM_PROBE`
- `REGRESSION_REPLAY`

A question remains conversational evidence. Its text grants no command, source, merge, deployment or runtime authority.

## Owner routing before gap creation

When the target returns `UNSUPPORTED_BY_THIS_PARTICIPANT`, the intake contract first evaluates bounded participant capability candidates.

A route is eligible only when:

- it is a different participant;
- it advertises an answer-capable Q&A state;
- it owns the affected capability;
- its capability evidence is `FRESH` or `RECENT`.

If such an owner exists, the result is `OWNER_REROUTING` and **no platform gap is created**. If routing exhaustion is not proven, the contract fails closed rather than misclassifying a participant-local limitation as a platform defect.

## Buildable root-cause classes

The contract uses the canonical #1721 root causes, including knowledge ingestion, canonical-state projection, memory retention/retrieval, context routing, participant/transport connectivity, tool/data access, discoverability, reasoning/synthesis, freshness/observability, proof/citation, capability-contract and cross-participant coherence gaps.

Existing ten-question verdicts are mapped conservatively to root causes. `ANSWERED_PARTIAL` requires an explicit buildable root cause rather than guessing why the answer was partial.

## Stable deduplication

The stable gap signature hashes:

```text
rootCauseClass
affectedCapability
expectedEvidenceClass
```

It deliberately does **not** include participant identity or question wording. Equivalent failures exposed by Stephanos, OpenClaw or another participant therefore converge on one root defect rather than one issue per conversation.

A repeated equivalent miss increments occurrence count, adds participant/question evidence and reopens the same gap if it had previously been marked fixed.

Multiple existing gap records with the same canonical signature fail closed because the repository/workspace estate has already violated the one-owner invariant.

## Existing-goal lookup

The intake accepts a bounded projection of existing canonical goals with their owned root-cause classes and capabilities.

Selection priority is:

1. root cause **and** affected capability match;
2. root-cause match;
3. capability match.

A unique best match returns `ATTACH_TO_EXISTING_GOAL`. No match returns `NEW_CANONICAL_GAP_GOAL_REQUIRED` as a recommendation only. Equal best matches return `AMBIGUOUS_EXISTING_GOAL_OWNER` and fail closed rather than choosing arbitrarily.

This source contract itself has `goalCreationAllowed=false`.

## Boundary states

External, intentional, privacy, authority, safety and evidence-by-design boundaries remain explicit non-buildable observations. They cannot silently become permission widening, account linkage, spending, credential exposure or destructive authority.

## Authority boundary

Every output retains:

```text
sourceMutationAllowed=false
goalCreationAllowed=false
schedulerDispatchAllowed=false
sharedWorkspaceWriteAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
permissionWideningAllowed=false
```

The contract prepares deterministic intake state only. Later adapters may persist that state through the already-authorised Shared Workspace and Mission Scheduler machinery.

## Focused proof

```bash
node --test shared/agents/stephanosAmbientQuestionGapIntakeV1.test.mjs
```

The focused suite covers grounded answers, owner rerouting, unproven routing exhaustion, stable cross-participant signatures, existing-goal reuse, repeated-gap aggregation/reopen, duplicate-gap rejection, ambiguous-goal rejection, partial-answer root-cause requirements, retained authority boundaries, unsafe evidence refs and command-smuggling non-authority.

## What M1 does not prove

This slice does not prove:

- live observation of every Shared Workspace question;
- durable Shared Workspace gap writes;
- automatic GitHub issue creation;
- Mission Scheduler admission;
- repair dispatch;
- original/transfer-question replay;
- cross-participant propagation after repair;
- live first ten-question execution.

Those remain later #1721/#1290/#1308/#1556 proving stages.
