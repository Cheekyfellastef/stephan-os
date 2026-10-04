# Stephanos Persisted Q&A → Shared Conversation Thread V1

## Purpose

Bridge the already-live #1506/#1896 persisted ChatGPT→Stephanos question/answer path into the new #2422 shared conversation thread without creating another transport.

The existing relay already persists:

```text
chatgpt-bridge question
        ↓
Stephanos answer
        ↓
Conversation Canvas handoff
```

This adapter adds:

```text
persisted question + persisted answer
        ↓
one caller-supplied canonical shared threadId
        ↓
chatgpt-bridge turn + stephanos reply turn
        ↓
Shared Conversation Thread V1
```

## Why the caller supplies threadId

The old Q&A `roundId` is not automatically treated as the new conversation identity.

A shared conversation may span multiple Q&A rounds, devices and model/provider embodiments. Therefore a higher-level conversation surface must supply the one canonical `threadId`. This prevents silently fragmenting one conversation into a new thread per capability round.

## Lineage

The adapter requires:

- question asker = `chatgpt-bridge`;
- question target = `stephanos`;
- answer responder = `stephanos`;
- answer recipient = `chatgpt-bridge`;
- exact round and question lineage;
- current, non-stale Shared Workspace records.

The new turn records retain the persisted Q&A message IDs in proof refs.

## Authority

The adapter is a projection only.

It grants no source/runtime mutation, command execution, approval, merge, deployment, memory write or durable promotion authority.

## Next live rung

After source proof, the existing GitHub/Shared Workspace relay should call this adapter after a Q&A pair is durably persisted and then persist the resulting shared-thread turns through the existing Shared Workspace writer.

That gives the live path one thread substrate for:

- ChatGPT messages;
- Stephanos replies;
- later operator turns from an authorised chat-intake transport;
- Operator Knowledge Twin projection;
- Conversation Canvas rendering.

## Acceptance

```text
PERSISTED_QA_FEEDS_CANONICAL_SHARED_THREAD
OLD_QA_ROUND_ID_DOES_NOT_SILENTLY_FORK_CONVERSATION_ID
QUESTION_ANSWER_LINEAGE_PRESERVED
STALE_QA_CANNOT_BECOME_CURRENT_THREAD_STATE
NO_SECOND_TRANSPORT_OR_AUTHORITY_PLANE
```
