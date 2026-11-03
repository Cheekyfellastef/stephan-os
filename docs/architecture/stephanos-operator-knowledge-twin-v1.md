# Stephanos Operator Knowledge Twin V1

## Purpose

This slice defines the governed knowledge model beneath the operator's request for Stephanos to become a digital twin that can increasingly know what the operator knows.

It extends the existing #1290 Shared Workspace conversation fabric and #1645 durable memory programme. It does not create another memory database, transcript archive, psychological profile, provider-owned memory or hidden authority plane.

## Product meaning of "digital twin"

The twin is a **knowledge, decision and continuity twin**, not a claim that Stephanos is literally the operator.

Stephanos should be able to accumulate and retrieve:

- facts and project knowledge explicitly taught by the operator;
- decisions and their later corrections;
- preferences that the operator explicitly states;
- reusable lessons;
- goals and open threads;
- historical beliefs that have been superseded;
- provenance showing which chat/message taught each item.

The twin must distinguish:

```text
seen in conversation
learning candidate
explicit durable teaching
current knowledge
superseded historical knowledge
unknown / conflicting
```

## Chat visibility versus durable learning

The operator may authorise visibility over:

```text
CURRENT_SHARED_THREAD
AUTHORISED_PROJECT_CHATS
ALL_AUTHORISED_CHATS
```

Broad visibility does **not** mean automatic permanent memory.

A chat item can be visible to Stephanos for conversational context while remaining `CONTEXT_ONLY`. A durable teaching candidate requires an operator-authored message, an explicit knowledge class, `REMEMBER_DURABLY`, explicit teaching intent and durable-learning consent.

The projection itself cannot write memory. Existing #1645 memory governance remains responsible for promotion, correction, forgetting, conflict handling, retention and retrieval.

## Knowledge classes

V1 supports:

```text
KNOWLEDGE
DECISION
PREFERENCE
LESSON
GOAL
OPEN_THREAD
CORRECTION
NONE
```

Corrections do not erase history. They carry `supersedesKnowledgeId`, allowing Stephanos to retain what used to be believed or preferred while selecting the corrected item as current after governed promotion.

## Privacy and sensitive material

The target is rich alignment without an uncontrolled dossier.

Therefore:

- secret-shaped text fails closed;
- psychological-profile or mental-diagnosis construction fails closed;
- high-sensitivity personal content can remain conversational context when explicitly shared, but is not promoted into durable learning by this V1 default;
- provider/model output cannot self-certify as operator teaching;
- all durable candidates retain exact source references.

This does not stop future operator-controlled vaults for sensitive domains. It prevents an ordinary conversation stream from silently creating one.

## Relationship to semantic memory

The output intentionally resembles the existing semantic-memory concepts:

```text
subjectRef
knowledgeClass
summary
origin
authorityClass
currentState
observedAtUtc
supersedesKnowledgeId
sourceRefs
```

Candidates use:

```text
origin=OPERATOR_TEACHING
authorityClass=PENDING_LOCAL_INTENT
currentState=CURRENT
```

until the existing governed memory path validates and promotes them. This source slice cannot claim `SHARED_AUTHORITY` by itself.

## Intended live pipeline

```text
authorised ChatGPT / Stephanos chats
          ↓
Shared Workspace conversation intake
          ↓
Operator Knowledge Twin projection
       ↙       ↘
context view   learning candidates
                  ↓
           #1645 memory governance
                  ↓
 semantic / episodic / procedural /
 prospective / reflective memory
                  ↓
      governed cognitive context
                  ↓
             Stephanos
                  ↓
          flywheel feedback
```

## Cross-chat visibility boundary

Source support for a visibility scope is not the same as live access to every ChatGPT conversation.

A later live transport must prove how an authorised conversation is supplied to the Shared Workspace, for example through the existing ChatGPT participant relay, a user-controlled export/sync source, or another explicitly connected source. The system must not claim it can silently enumerate private ChatGPT history without such a transport.

## Acceptance

```text
OPERATOR_KNOWLEDGE_TWIN_CONTRACT_READY
ALL_AUTHORISED_CHAT_VISIBILITY_IS_SEPARATE_FROM_DURABLE_LEARNING
EXPLICIT_OPERATOR_TEACHING_CAN_BECOME_A_GOVERNED_MEMORY_CANDIDATE
CORRECTIONS_PRESERVE_SUPERSEDED_HISTORY
PROVIDER_OUTPUT_CANNOT_SELF_CERTIFY_AS_OPERATOR_KNOWLEDGE
NO_HIDDEN_PSYCHOLOGICAL_PROFILE_OR_SECOND_MEMORY_SILO
```
