# Shared Stephan + ChatGPT + Stephanos Conversation Thread V1

## Purpose

Extend #1290 **Goal: Shared Agent Workspace V1** and its existing Shared Participant Question and Answer Fabric so Stephan can hold one durable conversation with both ChatGPT and Stephanos.

This slice deliberately reuses the existing Shared Workspace, #1506 bounded ChatGPT participant bridge, merged #1896 **Connect Shared Participant questions to Stephanos cognition**, and the existing Conversation Canvas path. It does not create a second chatbot, transport, mailbox, scheduler, memory store, provider router or authority plane.

## Canonical participants

V1 is intentionally closed-world around exactly three visible participants:

```text
operator
chatgpt-bridge
stephanos
```

A future agent can join only through a later explicit capability/participant contract. Merely writing a file cannot grant conversational membership.

## Turn contract

Every durable turn is a normal Shared Workspace message record with:

```text
channel=shared-stephanos-chat
recordSubtype=conversation-turn
correlationId=<threadId>
subjectId=<turnId>
participantId=<sender>
```

The body binds:

```text
threadId
turnId
senderParticipantId
replyToTurnId
text
visibleToParticipantIds
```

The visible participant list is fixed to all three V1 participants so a provider or caller cannot silently create a private fork of the conversation.

## Thread projection

`buildStephanosSharedConversationThread()` validates and reconstructs a bounded transcript.

It:

- sorts durable turns deterministically;
- rejects mixed thread lineage;
- rejects duplicate message or turn identities;
- requires replies to point to an earlier durable turn in the same thread;
- exposes per-participant turn counts and last-turn timestamps;
- preserves proof references on every turn;
- fails closed on stale, future, malformed, secret-shaped or authority-widening records.

The projection is read-only. It is a shared conversational state view, not a command queue.

## Authority boundary

Conversation is not authorization.

Every turn permanently keeps these false:

```text
sourceMutationAllowed
commandExecutionAllowed
approvalAllowed
mergeAllowed
deploymentAllowed
runtimeMutationAllowed
schedulerCreationAllowed
workerCreationAllowed
mailboxCreationAllowed
providerSelectionAuthorityAdded
```

Existing exact-head, approval, execution, flywheel and operator authority contracts remain authoritative.

## Integration sequence

This source slice establishes the shared-thread truth contract without pretending the UI is already live.

The intended next rungs are:

1. persist operator AI Console turns into this thread;
2. map the existing #1506/#1896 ChatGPT -> Stephanos Q&A pair into the same thread identity;
3. let ChatGPT read the bounded thread projection before answering;
4. let Stephanos consume the same thread plus governed cognitive memory;
5. present both participants in one Conversation Canvas;
6. prove restart, provider-swap and cross-device continuity;
7. feed teach/correct/learn events into #1645 memory and #1556/#1903 flywheel improvement machinery.

## Acceptance for this slice

```text
SHARED_THREE_PARTY_THREAD_CONTRACT_READY
OPERATOR_CHATGPT_AND_STEPHANOS_SHARE_ONE_THREAD_ID
EVERY_TURN_HAS_DURABLE_LINEAGE_AND_PROOF
PRIVATE_CONVERSATION_FORKS_FAIL_CLOSED
CONVERSATION_GRANTS_NO_EXECUTION_OR_APPROVAL_AUTHORITY
```

This does not claim the final live three-way chat is served yet. It provides the canonical state contract that the existing relay and Conversation Canvas can safely wire next.
