# Stephanos Semantic Memory V1

## Outcome

`STEPHANOS_SEMANTIC_MEMORY_V1` is the bounded read-only semantic continuity layer required by goal #1645.

It projects current claims about the operator, Stephanos, projects, architecture, runtime state and bounded world/provider subjects while preserving provenance, confidence, freshness, temporal validity, supersession and unresolved contradiction state.

This is not a new memory store. It consumes already-governed records and reuses the canonical authority classes exported by `shared/runtime/stephanosMemoryAdequacy.mjs`.

## Why this slice exists

Episodic memory answers what happened. Semantic memory answers what the governed evidence currently says is true.

Those are deliberately separate views. An old episode remains valuable history after the fact it once established has been replaced. Semantic retrieval therefore needs explicit temporal truth rather than treating the most memorable or most recent prose as canonical state.

## Exact contract

The source schema is:

```text
stephanos.semantic-memory.v1
```

The projection schema is:

```text
stephanos.semantic-memory-projection.v1
```

The pure builder accepts exactly:

```text
observedAtUtc
claims[]
```

Each claim carries exactly:

```text
schemaVersion
claimId
subjectRef
predicate
valueSummary
claimOrigin
authorityClass
confidence
freshness
state
validFromUtc
validUntilUtc
lastVerifiedAtUtc
supersedesClaimId
supersededByClaimId
sourceRefs[]
proofRefs[]
contradictionClaimIds[]
tags[]
```

No unrestricted object payload, provider transcript, raw prompt/response, credential, token, cookie or arbitrary local path is part of this contract.

## Authority reuse

The projection imports `STEPHANOS_MEMORY_AUTHORITY_CLASS` rather than creating a second authority vocabulary.

Canonical classes remain:

```text
SHARED_AUTHORITY
LOCAL_MIRROR
PENDING_LOCAL_INTENT
STALE_EVIDENCE
INFERRED
UNKNOWN
```

A `MODEL_INFERENCE` claim must remain `INFERRED`. The semantic layer cannot silently convert model reasoning into an authoritative operator or project fact.

Explicit `OPERATOR_TEACHING` cannot be labelled `INFERRED`; if the upstream fabric has not yet promoted it to shared authority it must retain the actual local/pending/unknown authority state supplied by that fabric.

## Temporal truth

Semantic claims distinguish:

```text
CURRENT
SUPERSEDED
UNKNOWN
```

and separately carry:

```text
validFromUtc
validUntilUtc
supersedesClaimId
supersededByClaimId
lastVerifiedAtUtc
```

A claim is projected into `currentClaims` only when it is both `CURRENT` and temporally effective at the supplied observation instant.

A claim that says `CURRENT` but starts in the future or has already expired is not treated as current truth. It remains visible as history/evidence rather than being promoted by its state label alone.

A claim whose `lastVerifiedAtUtc` is later than the supplied `observedAtUtc` is internally impossible evidence and fails closed rather than being projected as current truth.

Supersession must stay within one exact semantic key:

```text
subjectRef + predicate
```

and the old/new links must be reciprocal. Cycles fail closed.

This lets a current preference, architecture statement or project fact replace an earlier claim without deleting the earlier evidence needed for explanation and audit.

## Contradictions and duplicate evidence

Multiple current claims for the same semantic key are not automatically a conflict.

If they have the same normalized `valueSummary`, they may represent equivalent evidence with separate provenance and do not create a false contradiction.

If current claims for the same semantic key carry materially different values, the projection exposes an `unresolvedContradictions` entry. It does not choose a winner based on recency, confidence, provider identity or authority by itself.

The output records whether all cross-value conflicts were explicitly declared by the source claims. A later governed adjudication layer may resolve them; this layer may not.

## Provenance and freshness

Each claim keeps:

```text
claimOrigin
authorityClass
confidence
freshness
sourceRefs[]
proofRefs[]
lastVerifiedAtUtc
```

At least one source or proof reference is required.

The projection does not infer that `CURRENT` means fresh, that `SHARED_AUTHORITY` means recently verified, or that high confidence grants execution authority. These dimensions remain visible and independent.

## Boundedness

The contract is intentionally small:

```text
maximum claims: 512
maximum references per bounded list: 24
maximum normalized serialized claim payload: 256 KiB
```

The output is a context-building primitive, not an unrestricted memory dump.

## Hostile-input boundary

Before using authority-bearing fields, the implementation requires closed-world own enumerable data properties and ordinary/null object prototypes.

It rejects or safe-holds:

- accessors;
- symbol properties;
- custom object prototypes;
- sparse/custom arrays;
- duplicate or unsafe references;
- malformed timestamps and confidence values;
- verification timestamps later than the observation instant;
- cross-key or non-reciprocal supersession;
- supersession cycles;
- self-contradiction/self-supersession;
- missing referenced contradiction/supersession claims;
- secret-shaped text, raw prompt/response language and absolute local-path-shaped values;
- oversized claim sets and normalized serialized payloads.

## Read-only authority boundary

Every projection fixes all of the following false:

```text
sourceMutationAllowed
memoryWriteAllowed
durablePromotionAllowed
correctionAllowed
forgetAllowed
contradictionResolutionAllowed
providerPromptUseAllowed
commandExecutionAllowed
approvalAllowed
mergeAllowed
deploymentAllowed
runtimeMutationAllowed
```

`providerPromptUseAllowed=false` is deliberate. Selection for a provider context belongs to the separate bounded retrieval-pack contract, not to semantic memory itself.

Likewise, durable promotion, correction and forget require the existing authority-bearing memory pipeline and receipts. This source slice cannot manufacture them.

## Relationship to adjacent #1645 lanes

### Episodic Memory V1

Episodic memory preserves attributable events, outcomes, turning points and causal chronology.

Semantic memory may cite those episodes as evidence, but it does not replace the episodic timeline.

### Retrieval Packs M2

Retrieval packs select bounded task-specific context from governed memory.

Semantic Memory V1 prepares safe current/superseded claim truth for those packs. It does not decide what any model should receive.

### Future Procedural, Prospective and Reflective Memory

This slice does not model runbooks, future open loops or higher-order lessons. Those remain separate cognitive views so a procedure, promise or reflection cannot masquerade as a current factual claim.

## Focused proof

The focused deterministic suite covers:

1. current truth plus superseded history;
2. explicit unresolved contradictions;
3. equivalent duplicate evidence without a false contradiction;
4. model-inference authority preservation;
5. valid low-authority inference;
6. semantic-key and reciprocal supersession enforcement;
7. supersession-cycle rejection;
8. future/expired state not becoming current truth;
9. sensitive/raw/absolute-local-path rejection, including generic-token linking verbs;
10. verification-after-observation rejection;
11. accessor/custom-prototype/sparse-array rejection;
12. deterministic identity and zero mutation authority.

## Truth boundary

This is source-only cognitive-memory construction.

It does not prove that real Shared Workspace memory has been written, promoted, corrected, forgotten, compacted or synchronized cross-device. It does not claim provider prompt continuity, runtime installation, UI rendering or live fresh-observer reconstruction.

Those remain later acceptance evidence under #1645.
