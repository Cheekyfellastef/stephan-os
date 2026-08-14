# Stephanos Shared Workspace Conversation Adapter V1

## Purpose

This slice advances the product-facing intelligence goals in #1308 and the Shared Participant Question and Answer Fabric in #1290 without creating a new transport, workspace, scheduler, dispatcher, memory store, chatbot or execution authority.

It connects two already-defined contracts:

1. `stephanosConversationalCapabilityLadderV1.mjs`, which defines the ten-question round, answer evaluation and capability-gap semantics.
2. the existing `sharedAgentWorkspaceStore.mjs` message record, which already provides durable bounded Shared Workspace records.

The adapter is deliberately a codec and lineage boundary. It does not deliver messages itself.

## Operator outcome

The intended flow becomes:

```text
ChatGPT participant
  -> ten-question round contract
  -> 10 existing Shared Workspace MESSAGE records
  -> Stephanos answers through the same message fabric
  -> 10 answer records
  -> deterministic round evaluation
  -> grounded pass, partial answer, retained boundary, or deduplicated buildable gap
```

This is a source-level step toward the live ChatGPT <-> Stephanos dialogue required by #1308. It does not claim that live transport or runtime delivery has passed yet.

## Existing machinery reused

The adapter imports and reuses:

- `SHARED_WORKSPACE_RECORD_SCHEMA_VERSION`
- `SHARED_WORKSPACE_RECORD_KINDS.MESSAGE`
- `validateSharedWorkspaceRecord`
- `validateStephanosCapabilityQuestion`
- `validateStephanosCapabilityRound`
- `validateStephanosCapabilityAnswer`
- `evaluateStephanosCapabilityRound`

No changes are required to the Shared Workspace store or the ChatGPT participant bridge in this slice.

## Record mapping

A capability question becomes one Shared Workspace message with:

```text
kind = stephanos.shared_workspace.record.message
channel = shared-participant-qa
recordSubtype = conversation-question
participantId = askerParticipantId
recipientParticipantId = targetParticipantId
correlationId = roundId
subjectId = questionId
relatedIssue = #1308 by default
body = versioned bounded question envelope
```

A Stephanos answer uses the same message kind and channel with:

```text
recordSubtype = conversation-answer
participantId = responderParticipantId
recipientParticipantId = original asker
correlationId = roundId
subjectId = questionId
body = versioned bounded answer envelope
```

The adapter verifies that participant, recipient, round and question identities still match the embedded contract when records are decoded.

## Authority boundary

Conversation records explicitly carry:

```text
sourceMutationAllowed = false
commandExecutionAllowed = false
approvalAllowed = false
mergeAllowed = false
deploymentAllowed = false
```

The decoder rejects a record if any of these become true.

A question remains a question. It is not a disguised command, approval, merge instruction or runtime mutation request.

## Ten-question flow

`buildStephanosWorkspaceQuestionRound(round)` validates the existing #1308 round contract and emits exactly ten correlated Shared Workspace messages.

`evaluateStephanosWorkspaceConversation({ round, answerRecords })` decodes exactly ten answer messages and passes the resulting answer contracts into the existing capability evaluator.

The adapter therefore preserves the existing outcome states:

```text
SETTLED
REGRESSION_PROVING
GAPS_IDENTIFIED
SAFE_HOLD
```

Buildable gaps continue to use the existing canonical goal-candidate mapping rather than creating a second backlog.

## Fail-closed behavior

The adapter rejects or safe-holds on:

- malformed question or answer contracts;
- invalid Shared Workspace records;
- corrupt JSON envelopes;
- participant lineage mismatch;
- recipient lineage mismatch;
- round mismatch;
- question mismatch;
- missing ten-answer estate;
- authority-bearing conversation records.

Unknown or incomplete conversational capability is not converted into a false green pass.

## Non-goals

This slice does not:

- configure a ChatGPT transport;
- start a Battle Bridge process;
- write directly to a live Shared Workspace path;
- modify the existing ChatGPT participant bridge allowlist;
- invoke a model;
- synthesize Stephanos answers;
- create repair goals automatically;
- mutate source or runtime state;
- grant any participant new authority.

Those later steps remain under their existing canonical owners and proof gates.

## Focused proof

```bash
node --test shared/agents/stephanosConversationalCapabilityLadderV1.test.mjs shared/agents/stephanosSharedWorkspaceConversationAdapterV1.test.mjs
```

The adapter tests cover:

- question-to-Shared-Workspace mapping;
- question round-trip decoding;
- exact ten-question fan-out;
- answer mapping and decoding;
- ten-grounded-answer settlement;
- buildable-gap propagation;
- recipient/participant lineage tampering;
- authority smuggling rejection;
- corrupt body and unknown-field fail-closed behavior.

## Next product slice

After this adapter and its dependency #1774 are accepted, the next product-facing intelligence step is to bind the existing ChatGPT participant bridge and Stephanos conversational response path to these records in a faithful Shared Workspace transport/canary, then execute the first real ten-question round without the operator acting as courier.
