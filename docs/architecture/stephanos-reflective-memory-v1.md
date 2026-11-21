# Stephanos Reflective Memory V1

## Outcome

`STEPHANOS_REFLECTIVE_MEMORY_V1` is the bounded read-only cognitive-memory projection for evidence-backed higher-order lessons and recurring patterns required by #1645.

It synthesises across multiple cited episodes while preserving confidence, counterexamples, validation state, provenance and supersession. It cannot silently turn correlation into fact, promote itself into the Method Library or Shared Lessons Memory, widen authority or execute anything.

## Why this slice exists

Episodic memory preserves what happened. Reflective memory asks what pattern may be supported across several episodes.

That distinction matters because a plausible pattern is not automatically a fact. A reflection may be useful for future reasoning while remaining provisional, especially when it comes from model synthesis.

## Schemas

```text
stephanos.reflective-memory.v1
stephanos.reflective-memory-projection.v1
```

The pure builder accepts exactly:

```text
reflections[]
```

Each reflection contains:

```text
reflectionId
patternKey
reflectionKind
origin
promotionState
patternSummary
scopeSummary
authorityClass
confidence
freshness
state
createdAtUtc
validatedAtUtc
lastVerifiedAtUtc
sourceEpisodeRefs[]
evidenceRefs[]
counterexampleRefs[]
derivedCandidateRefs[]
supersedesReflectionId
supersededByReflectionId
```

## Reflection kinds

```text
SUCCESS_PATTERN
FAILURE_PATTERN
RECOVERY_PATTERN
CORRECTION_PATTERN
METHOD_CANDIDATE
GENERAL_LESSON
```

The kind describes the cognitive view only. It does not grant authority to alter methods, lessons, goals or runtime behaviour.

## Multi-episode grounding

Every reflection requires at least two distinct `episode://` source references plus at least one bounded evidence/proof reference.

This enforces the amendment's requirement that reflection synthesize across multiple episodes rather than converting one anecdote into a durable higher-order lesson.

Duplicate source episodes fail closed rather than creating artificial evidence weight.

## Candidate and confirmation boundary

Promotion states are:

```text
CONFIRMED
CANDIDATE
REJECTED
UNKNOWN
```

A `MODEL_SYNTHESIS` reflection must remain canonical authority class `INFERRED` and cannot self-confirm.

A confirmed reflection requires:

```text
authorityClass = SHARED_AUTHORITY
validatedAtUtc is present
```

That confirmation still does not make the reflection a semantic fact or executable method. It means only that the governed reflective record itself has been accepted as a useful evidence-backed lesson.

## Counterexamples are first-class evidence

`counterexampleRefs[]` remains visible in the projection even for a high-confidence confirmed pattern.

The module does not discard counterevidence or treat confidence as certainty. Later reasoning can therefore see where a pattern may not apply.

## Derived candidates

A reflection may reference bounded downstream candidates through:

```text
method://...
lesson://...
```

Those references remain candidates only.

The projection grants no Method Library write, method promotion, Shared Lessons write or lesson-promotion authority. Existing governance must independently validate and promote any downstream record.

## State and supersession

Reflection states are:

```text
CURRENT
SUPERSEDED
RETIRED
UNKNOWN
```

Supersession must remain within one stable `patternKey`, be reciprocal and acyclic. Historical reflections remain visible rather than being overwritten.

This permits a later body of evidence to revise an earlier lesson while keeping the old interpretation available for audit and explanation.

## Competing current reflections

If more than one confirmed current shared-authority reflection exists for the same `patternKey`, the module does not choose between them.

It returns:

```text
REFLECTIVE_MEMORY_PROJECTED_WITH_CONFLICTS
```

and exposes the competing record IDs under `patternConflicts`.

Resolution belongs to the governed correction/supersession path.

## Relationship to authority

Reflection is evidence for reasoning, not an autonomy score.

The module must never:

- widen execution authority based on repeated success;
- infer that high confidence allows commands or runtime mutation;
- convert a reflection into a current semantic fact without separate governance;
- promote a method candidate automatically;
- promote a Shared Lessons record automatically;
- rewrite scheduler priorities automatically.

This also preserves #1606/#1607's explicit boundary against smuggling in a Confidence Flywheel.

## Relationship and psychological boundary

Reflective memory must not become an opaque emotional or psychological dossier.

The source contract rejects psychological-profile, mental-diagnosis, personality-disorder and hidden-motivation-shaped text along with credentials, raw provider transcripts and local-path-shaped values.

Patterns about operator corrections or interaction preferences should remain limited to explicit evidence and operational relevance.

## Boundedness

```text
maximum reflections: 256
maximum references per list: 24
maximum normalized serialized payload: 256 KiB
```

No unrestricted conversations, source trees or telemetry dumps belong in reflective memory.

## Hostile-input boundary

The implementation requires closed-world own enumerable data fields on ordinary/null-prototype objects and dense ordinary arrays.

It rejects or safe-holds:

- accessors and symbol properties;
- custom object prototypes;
- sparse/custom arrays;
- malformed IDs, timestamps, confidence, states or authority;
- duplicate source/reference identities;
- fewer than two distinct source episodes;
- non-episode sourceEpisodeRefs;
- missing evidence refs;
- model synthesis attempting self-confirmation;
- confirmed records lacking shared authority or validation time;
- invalid derived candidate reference classes;
- cross-pattern, non-reciprocal or cyclic supersession;
- psychological, credential, raw-provider or local-path-shaped text;
- oversized reflection sets or serialized payloads.

Authority-bearing accessors are never invoked.

## Authority boundary

Every projection fixes all of these false:

```text
sourceMutationAllowed
reflectiveMemoryWriteAllowed
durablePromotionAllowed
semanticFactPromotionAllowed
methodPromotionAllowed
lessonPromotionAllowed
schedulerMutationAllowed
commandExecutionAllowed
approvalAllowed
mergeAllowed
deploymentAllowed
runtimeMutationAllowed
authorityExpansionAllowed
```

## Relationship to adjacent #1645 lanes

### Episodic Memory V1

Reflective records cite compact episodes as source evidence. They do not replace the chronology or causal event record.

### Semantic Memory V1

A confirmed reflection remains a reflection, not a current fact. Separate evidence and authority are required before any semantic claim can be established.

### Procedural Memory V1 / Method Library

A reflection may point to a method candidate, but candidate validation and Method Library promotion remain separate governed work.

### Prospective Memory V1

A reflection may suggest that something should be revisited, but it cannot create or confirm a future obligation by itself.

### Retrieval Packs

The separate `REFLECTIVE_LESSONS_PACK` may later select bounded relevant reflections. This module never decides provider prompt contents itself.

## Focused proof

The deterministic suite covers:

1. confirmed multi-episode reflection projection;
2. model-synthesis candidate isolation;
3. shared-authority and validation-time requirements;
4. minimum two distinct source episodes;
5. counterexample preservation;
6. same-pattern reciprocal supersession and history;
7. competing current pattern conflict visibility;
8. method/lesson candidate references without promotion authority;
9. psychological/local-path/accessor/sparse-array rejection;
10. deterministic identity and zero mutation/authority-expansion capability.

## Truth boundary

This source-only slice does not run a reflection scheduler, write Shared Lessons Memory, promote Method Library entries, alter semantic facts, mutate Shared Workspace, change goals, merge source, deploy or touch runtime state.

Live consolidation, candidate validation, downstream promotion and cross-provider reflective retrieval remain separately proven stages.
