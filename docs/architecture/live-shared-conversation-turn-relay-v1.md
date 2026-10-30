# Live Shared Conversation Turn Relay V1

## Purpose

Connect ordinary authorised ChatGPT conversation turns to the already-merged #2422 shared Stephan/ChatGPT/Stephanos conversation thread.

This is a transport seam only. It does not create another conversation model, memory store, scheduler, controller, agent or authority plane.

## Existing substrate

Protected main already contains:

- #2422 **Add shared Stephan/ChatGPT/Stephanos conversation, operator twin and aligned digital hands V1**;
- #2416 **Put Stephanos above the agent fabric with an executive command plane**;
- the authenticated ChatGPT Shared Workspace participant bridge;
- the GitHub/Shared Workspace relay;
- canonical Shared Workspace persistence and receipts.

## New bridge operation

```text
DELIVER_SHARED_CONVERSATION_TURN
```

Record kind:

```text
shared-conversation-turn
```

The bounded payload contains exactly:

```text
turnRecord
transportAttestation
```

The turn record must already be a valid `stephanos.shared-conversation-thread.v1` Shared Workspace message.

The transport can carry only:

```text
operator
chatgpt-bridge
```

It cannot carry a `stephanos` authored turn. Stephanos replies must originate from the Stephanos cognition/runtime path, not be impersonated by the ChatGPT transport.

## Transport attestation

The transport attestation records:

```text
sourceSurface
sourceMessageId
operatorAuthored
```

V1 accepts the authorised ChatGPT surfaces:

```text
chatgpt-web
chatgpt-app
```

For an operator turn, `operatorAuthored=true` is required. For a ChatGPT turn it must be false.

This flag means only **the source message was authored by the operator**. It is not an approval, memory-promotion receipt, mutation lease or command authority.

## Thread lineage

The outer authenticated request and the inner conversation record must agree on:

- one exact shared thread / correlation ID;
- related goal;
- related PR when supplied;
- the shared conversation channel;
- the conversation-turn subtype.

A mismatch fails before persistence.

The shared thread ID is intentionally separate from older capability-Q&A round IDs. A durable conversation may span many Q&A rounds, sessions, models and devices.

## Persistence and retry

Accepted turns are persisted through the existing Shared Workspace writer under a deterministic inbox record name derived from the message identity.

Retry behavior is idempotent:

- identical existing record -> resume;
- conflicting existing record -> fail closed;
- missing record -> persist once.

Normal relay audit, event and completion receipts remain canonical.

## Authority

A delivered conversation turn grants none of:

- source mutation;
- command execution;
- approval;
- merge;
- deployment;
- runtime mutation;
- memory write or durable promotion.

The already-merged Operator Knowledge Twin may later consume the conversation as context. Explicit durable learning still passes through #1645 **Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1**.

## Next rung

After this live transport is admitted:

1. persist ChatGPT↔Stephanos Q&A projection into the same caller-supplied long-lived thread;
2. assemble current authorised shared-thread turns into the Operator Knowledge Twin;
3. route explicit operator teaching candidates through #1645 memory governance;
4. render the common transcript in Conversation Canvas;
5. prove restart, provider-swap and cross-device continuity.

## Acceptance

```text
AUTHORISED_OPERATOR_TURN_CAN_ENTER_SHARED_WORKSPACE
AUTHORISED_CHATGPT_TURN_CAN_ENTER_SHARED_WORKSPACE
CHATGPT_TRANSPORT_CANNOT_IMPERSONATE_STEPHANOS
REQUEST_AND_THREAD_LINEAGE_MUST_MATCH
RETRY_DOES_NOT_DUPLICATE_SHARED_TURNS
CONVERSATION_AUTHORSHIP_DOES_NOT_GRANT_APPROVAL_OR_MEMORY_AUTHORITY
NO_SECOND_CHAT_OR_CONTROL_PLANE
```
