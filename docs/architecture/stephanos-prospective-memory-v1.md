# Stephanos Prospective Memory V1

## Outcome

`STEPHANOS_PROSPECTIVE_MEMORY_V1` is the bounded read-only cognitive-memory projection for promises, deferred goals, revisit conditions, unresolved threads, reminders and follow-ups required by #1645.

It remembers future-facing commitments and open loops without becoming a scheduler, reminder service, trigger engine, mission dispatcher or goal mutator.

## Why this slice exists

A persistent conversational system needs to carry important unfinished threads across sessions and provider changes. Merely storing past episodes is insufficient: Stephanos also needs to know what remains open, why it matters, who owns it and what evidence should cause it to be revisited.

That continuity must not manufacture execution authority. An overdue item is evidence that attention may be needed, not permission to create a task, run a command or modify a goal.

## Schemas

```text
stephanos.prospective-memory.v1
stephanos.prospective-memory-projection.v1
```

The pure builder accepts exactly:

```text
observedAtUtc
openLoops[]
```

Each open-loop record contains:

```text
loopId
continuityKey
loopClass
origin
promotionState
summary
whyItMatters
state
authorityClass
freshness
openedAtUtc
dueAtUtc
closedAtUtc
triggerKind
triggerRefs[]
ownerRef
sourceRefs[]
proofRefs[]
supersedesLoopId
supersededByLoopId
```

## Open-loop classes

```text
PROMISE
DEFERRED_GOAL
REVISIT_CONDITION
OPEN_THREAD
REMINDER
FOLLOW_UP
```

These are memory classifications only. They do not register an automation or create an external reminder.

## Promotion boundary

Prospective candidates have explicit promotion state:

```text
CONFIRMED
CANDIDATE
REJECTED
UNKNOWN
```

Only `CONFIRMED` records with canonical `SHARED_AUTHORITY` can enter `activeOpenLoops`.

A `MODEL_PROPOSAL` must remain `INFERRED` and cannot self-confirm. This prevents a model from turning its own suggestion into an authoritative promise or future obligation.

Candidate and rejected records remain separately visible without affecting the confirmed open-loop view.

## Lifecycle states

```text
OPEN
BLOCKED
CLOSED
EXPIRED
CANCELLED
UNKNOWN
```

`OPEN` and `BLOCKED` records cannot claim a close timestamp.

`CLOSED`, `EXPIRED` and `CANCELLED` records require a close timestamp and remain in history rather than active work.

## Trigger descriptions

```text
NONE
AT_TIME
ON_CONDITION
ON_RECEIPT
ON_OPERATOR_RETURN
UNKNOWN
```

A trigger is declarative memory only.

- `AT_TIME` requires a bounded ISO timestamp.
- `ON_CONDITION` and `ON_RECEIPT` require bounded canonical references.
- `NONE` cannot carry trigger references.
- `ON_OPERATOR_RETURN` records conversational continuation intent without creating presence monitoring or notifications.

The module never subscribes to these conditions.

## Due and overdue truth

At projection time, an active confirmed loop may be labelled:

```text
overdue
dueNow
```

based on the supplied observation timestamp.

Those fields are visibility only. They do not create timers, notifications, scheduler entries, commands or dispatches.

This distinction lets a later bounded retrieval pack answer "what open loops are overdue?" without conflating memory with automation.

## Continuity and supersession

`continuityKey` groups revisions of one durable future-facing thread.

Supersession must be reciprocal and remain inside one continuity key. Missing links, cross-key replacement, self-supersession and cycles fail closed.

A superseded record cannot remain `OPEN` or `BLOCKED`.

Historical versions remain visible so Stephanos can explain how a promise, goal dependency or revisit condition changed over time.

## Conflicting active records

If more than one confirmed active shared-authority record remains for the same `continuityKey`, the module does not guess which one is canonical.

It returns:

```text
PROSPECTIVE_MEMORY_PROJECTED_WITH_CONFLICTS
```

and exposes the competing loop IDs under `continuityConflicts`.

Resolution belongs to the governed memory correction/convergence path.

## Boundedness

```text
maximum open-loop records: 512
maximum references per list: 24
maximum normalized serialized payload: 256 KiB
```

No raw conversation archive, unrestricted task payload or provider transcript is retained.

## Hostile-input boundary

The projection requires closed-world own enumerable data properties on ordinary/null-prototype objects and dense ordinary arrays.

It rejects or safe-holds:

- accessors and symbol properties;
- custom object prototypes;
- sparse/custom arrays;
- malformed IDs, timestamps, references, authority or state;
- secret, credential, raw-provider or local-path-shaped text;
- model proposals attempting to self-confirm;
- confirmed records without shared authority;
- active records claiming to be closed;
- terminal records without close evidence;
- malformed trigger requirements;
- non-reciprocal, cross-key or cyclic supersession;
- duplicate IDs/references;
- oversized record sets or serialized payloads.

Authority-bearing accessors are never invoked.

## Authority boundary

Every projection fixes all of the following false:

```text
sourceMutationAllowed
prospectiveMemoryWriteAllowed
durablePromotionAllowed
reminderCreationAllowed
scheduleCreationAllowed
triggerRegistrationAllowed
autoDispatchAllowed
commandExecutionAllowed
goalMutationAllowed
approvalAllowed
mergeAllowed
deploymentAllowed
runtimeMutationAllowed
```

Remembering a future obligation is not authority to fulfil it.

## Relationship to adjacent machinery

### Mission Scheduler and goal flywheel

The scheduler may later consume governed open-loop context, but Prospective Memory V1 neither creates nor modifies scheduler state. Existing mission/goal machinery remains the only execution owner.

### Retrieval Packs

The separate `PROSPECTIVE_OPEN_LOOPS_PACK` can select a bounded subset from this projection. This module does not push records into provider prompts itself.

### Episodic Memory

An episode may establish why an open loop exists. Prospective memory carries the still-open future obligation after the episode becomes history.

### Semantic Memory

Semantic memory represents current facts. Prospective memory represents unresolved future-facing commitments. A future intention must not masquerade as a current fact.

### Reflective Memory

A reflection may suggest a follow-up candidate, but it remains a candidate until normal memory governance promotes it.

## Focused proof

The deterministic suite covers:

1. confirmed shared active open-loop projection;
2. inferred model-proposal candidate isolation;
3. shared-authority requirement for confirmed loops;
4. overdue visibility without reminder/dispatch authority;
5. trigger reference requirements;
6. terminal-loop historical classification;
7. reciprocal same-continuity supersession;
8. active continuity conflict visibility;
9. sensitive/local-path/accessor/sparse-array rejection;
10. deterministic identity and zero mutation/automation authority.

## Truth boundary

This source-only slice does not create real reminders, scheduled tasks, automations, trigger subscriptions, Shared Workspace writes, goal edits or runtime actions. It does not claim that any follow-up will fire automatically.

Actual scheduling, condition watching, operator notifications and goal execution remain separate authority-bearing systems with their own proof and approval requirements.
