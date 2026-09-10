# Stephanos Working Memory Session Contract V1

## Purpose

This is the next bounded product slice of #1645. It projects current task state, immediate facts, hypotheses, open loops and explicit operator preferences from the existing Stephanos session-memory layer into one deterministic, provider-neutral, read-only working-context packet.

It does not create another memory store, write browser or Shared Workspace state, promote a memory durably, correct or forget a record, send context to an external provider, create a scheduler, or widen execution authority.

## Truth and source classes

Every item keeps separate:

- `CONFIRMED`
- `INFERRED`
- `UNKNOWN`

Confirmed items require operator-supplied, system-observed or canonical-project evidence. Model inference cannot self-certify a confirmed fact. A hypothesis cannot be confirmed, and an operator preference requires explicit operator-supplied confirmation.

## Retention boundary

All accepted items use exactly:

```text
WORKING_SESSION_ONLY
```

The public contract rejects attempts to relabel working context as durable memory. Session duration is capped at eight hours, current-item freshness at thirty minutes and future clock skew at five minutes. The source session schema must match the existing canonical session-memory V1 contract. Callers cannot widen those policies.

Expired, stale, resolved, rejected and superseded items remain visible for explanation but do not enter the current context pack.

## Data-only boundary

The complete packet is recursively captured before serialization, hashing or decision-bearing reads. Exact plain records and dense standard arrays are required. Accessor values and own `toJSON` hooks are never invoked; custom prototypes, symbols, sparse arrays, nested objects in scalar fields, unexpected keys and uninspectable or revoked proxies fail closed.

Accepted nested source-reference arrays are detached and frozen before projection.

## Context pack

The compact pack is bounded to 24 items and 32 KiB. Selection is deterministic and prefers:

1. current task state;
2. active or blocked open loops;
3. explicit operator preferences;
4. immediate facts;
5. hypotheses.

Sensitive details represented as `OMITTED_SENSITIVE` are counted but excluded. The contract rejects credentials, sessions, account identifiers, raw prompts/responses, local paths and psychological-profile or mental-diagnosis content.

## Existing memory-fabric integration

The projection emits one `ephemeral-working-context` adequacy-observation candidate compatible with the existing memory-adequacy model. It is always labelled `LOCAL_MIRROR`, never `SHARED_AUTHORITY`, and carries enforced session retention with unknown deletion, conflict and backup state until separately proven.

## Authority invariant

All authority flags are false:

```text
sourceMutationAllowed=false
memoryWriteAllowed=false
durablePromotionAllowed=false
sharedAuthorityClaimAllowed=false
correctionAllowed=false
forgetAllowed=false
providerPromptUseAllowed=false
commandExecutionAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
```

## Focused proof

```bash
node --check shared/agents/stephanosWorkingMemorySessionContractV1.mjs
node --test shared/agents/stephanosWorkingMemorySessionContractV1.test.mjs
```

The suite covers truth/source separation, exact source-session compatibility, explicit operator preference, fixed retention, exact expiry boundaries, stale exclusion, duplicate replay/conflict, accessor and `toJSON` non-execution, revoked proxies, sensitive/reference rejection, exact bounded context-byte accounting, deterministic ordering, deep immutability, invalid clocks, empty-context truth and zero authority.

## Deferred work

Later separately governed slices may add a candidate-promotion receipt, cross-surface continuity pack, correction/forget propagation and live Shared Workspace reconciliation. None is claimed by V1.
