# Stephanos Procedural Memory V1

## Outcome

`STEPHANOS_PROCEDURAL_MEMORY_V1` is the bounded read-only cognitive-memory projection for validated reusable methods, runbooks and problem-solving procedures required by #1645.

It is not a Method Library implementation and not an executor. It projects already-governed method records into a cognitive-memory view suitable for later bounded retrieval.

The canonical Method Library destination remains governed by #1607 and related learning-flywheel work. Procedural Memory consumes that record shape when available rather than creating a competing registry.

## Why this slice exists

Semantic memory answers what governed evidence says is true. Episodic memory answers what happened. Procedural memory answers which evidence-backed method has been proven useful for a class of problem.

Those concepts must stay separate. A fluent remembered procedure is not permission to execute it, and a model-generated technique is not automatically a validated method.

## Source and projection schemas

```text
stephanos.procedural-memory.v1
stephanos.procedural-memory-projection.v1
```

The builder accepts exactly:

```text
methods[]
```

Each method record contains:

```text
recordId
methodId
version
problemClass
methodSummary
validationState
state
authorityClass
confidence
freshness
validatedAtUtc
lastVerifiedAtUtc
supersedesRecordId
supersededByRecordId
prerequisiteRefs[]
evidenceRefs[]
applicableDomains[]
failureModes[]
steps[]
```

Each step is descriptive only:

```text
stepId
instructionSummary
expectedEvidenceClass
```

There is intentionally no command, executable, arbitrary path, URL, credential, environment variable, shell, process, task, approval or runtime-action field.

## Validation states

```text
VALIDATED
CANDIDATE
REJECTED
UNKNOWN
```

Only a method that is all of the following enters `reusableMethods`:

```text
validationState = VALIDATED
state = CURRENT
authorityClass = SHARED_AUTHORITY
freshness != CONFLICTING
validatedAtUtc is present
evidenceRefs is non-empty
```

A candidate remains in `candidateMethods` even if it sounds convincing or has high model confidence.

A validated method cannot be built from `INFERRED`, `LOCAL_MIRROR`, `PENDING_LOCAL_INTENT`, `STALE_EVIDENCE` or `UNKNOWN` authority. Upstream governance must establish shared authority first.

## Version and supersession truth

Procedural methods retain version lineage rather than overwriting history.

States are:

```text
CURRENT
SUPERSEDED
RETIRED
UNKNOWN
```

Supersession links bind exact method records and must be reciprocal. A record may supersede only another record with the same stable `methodId`. Cross-method supersession, missing records, self-supersession and cycles fail closed.

Superseded or retired versions remain visible under `historicalMethods` so later reasoning can explain why an older procedure stopped being preferred or which failure mode caused replacement.

## Multiple current versions

The projection never silently picks a winner merely because one version number is larger, fresher-looking or more confident.

If more than one validated current shared-authority record exists for the same stable `methodId`, the projection returns:

```text
PROCEDURAL_MEMORY_PROJECTED_WITH_CONFLICTS
```

and exposes the competing record identities in `methodConflicts`.

Resolution belongs to the governed Method Library / memory-correction path, not to this read-only projection.

## Failure-mode memory

A reusable method is incomplete without evidence about where it can fail.

Each record therefore carries bounded `failureModes[]` alongside prerequisites and evidence. This allows later retrieval to surface not only "what worked" but also conditions where the method should not be applied.

Failure-mode text remains descriptive and non-executable.

## Boundedness

```text
maximum method records: 256
maximum steps per method: 24
maximum references/list entries: 24
maximum normalized serialized method payload: 256 KiB
```

This is a compact memory projection rather than a repository mirror, runbook archive or prompt dump.

## Hostile-input boundary

The implementation requires closed-world own enumerable data fields on ordinary/null-prototype objects and dense ordinary arrays.

It rejects or safe-holds:

- accessors;
- symbol properties;
- custom prototypes;
- sparse/custom arrays;
- duplicate IDs and duplicate references;
- malformed versions, timestamps, confidence or authority;
- validated methods lacking shared authority, validation timestamp or evidence;
- invalid/cyclic/non-reciprocal/cross-method supersession;
- empty step sets;
- secret/credential-shaped text;
- executable command, shell, arbitrary path or process-shaped step text;
- oversized method inventories or serialized payloads.

Authority-bearing fields are never read through accessors.

## Authority boundary

Every projection fixes all of these false:

```text
sourceMutationAllowed
methodLibraryWriteAllowed
proceduralMemoryWriteAllowed
durablePromotionAllowed
methodValidationAllowed
methodRetirementAllowed
commandExecutionAllowed
arbitraryCommandAllowed
arbitraryPathAllowed
arbitraryExecutableAllowed
approvalAllowed
mergeAllowed
deploymentAllowed
runtimeMutationAllowed
```

Remembering a method never grants permission to apply it.

A later scheduler, executor or operator-approved action must obtain its own current authority and exact evidence. Procedural memory is one read-only input to reasoning only.

## Relationship to adjacent goals

### #1607 Method Library route

#1607 owns the canonical route for validated method candidates to become reusable Method Library records with problem class, prerequisites, procedure, evidence, failure modes, confidence/freshness, domains and supersession state.

Procedural Memory V1 deliberately mirrors those cognitive fields without implementing the library, validation workflow or promotion path.

### #1645 Retrieval Packs

The separate `PROCEDURAL_METHOD_PACK` retrieval class can later select the smallest relevant subset of this projection. This module does not decide which provider receives which method.

### Reflective Memory

A reflection may propose a method candidate after multiple cited episodes. That candidate remains `CANDIDATE` here until the independent Method Library governance path validates it.

### Episodic and Semantic Memory

Episodes may explain where a method came from, while semantic claims may describe current architecture or prerequisites. Neither automatically converts into a reusable procedure.

## Focused proof

The deterministic suite covers:

1. validated shared current method projection;
2. candidate isolation from reusable methods;
3. required shared authority, validation time and evidence;
4. superseded version history;
5. cross-method supersession rejection;
6. competing current version conflict visibility;
7. supersession-cycle rejection;
8. command/path-shaped instruction rejection;
9. accessor/custom-prototype/sparse-array rejection;
10. deterministic identity and zero execution/mutation authority.

## Truth boundary

This source-only slice does not claim that the canonical Method Library exists live, that any method has been executed, or that a method candidate has been promoted. It does not run commands, change source, operate Windows, invoke OpenClaw, dispatch Forge, merge, deploy or mutate runtime state.

Live method validation, Method Library persistence, retrieval-pack consumption and cross-provider application remain separately proven stages.
