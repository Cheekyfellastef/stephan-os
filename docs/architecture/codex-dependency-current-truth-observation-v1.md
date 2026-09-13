# Codex Dependency Current-Truth Observation V1

## Mission

Advance #1899 under #1898 by adding the missing bounded observation-assembly layer between host-collected repository/goal/provider evidence and the existing `stephanos.codex-dependency-current-truth-report.v1` evaluator.

The purpose is to prevent a provider-independence report from looking current merely because a caller supplied some plausible records.

This contract answers a narrower question first:

> Did one governed observation execution prove what repository, goal, provider-proof, gap-owner and hard-boundary estate it examined at this exact current `main` head, and do the emitted evidence counts match that claimed coverage?

Only then is the existing current-truth report allowed to evaluate provider parity.

## Existing architecture reused

This layer reuses, rather than replaces:

- `codexDependencyRepositoryDiscoveryV1` for provider-reference discovery;
- `codexDependencyParityMatrixV1` for parity classification;
- `codexDependencyCurrentTruthReportV1` for the current provider-independence verdict;
- #1899 as the canonical estate/parity owner;
- #1900 for provider-independence admission policy;
- #1556 for scheduler consumption;
- #1694 for sovereignty/risk presentation;
- existing canonical evidence/receipt persistence machinery for later durable publication.

It creates no second scheduler, provider router, evidence store, goal registry, reviewer, provider qualifier or execution plane.

## Observation envelope

`stephanos.codex-dependency-current-truth-observation.v1` is bound to:

```text
repository=Cheekyfellastef/stephan-os
sourceBranch=main
sourceHead=<exact current 40-character main SHA>
observedAtUtc=<real observation time>
observer=<host-verified observer evidence>
coverage[]=<five required coverage classes>
repositoryEntries[]
goalCandidates[]
providerEvidence[]
gapOwners[]
boundaryEvidence[]
```

The module itself does **not** authenticate GitHub, Windows, OpenClaw, Forge or any other host. It consumes an already host-verified observer proof. A later canonical host wrapper must own actual collection and authentication.

Source tests may use simulated verified evidence only as deterministic fixtures; those fixtures are not production observation proof.

## Observer proof

The observer record must use:

```text
evidenceClass=CANONICAL_PROVIDER_INDEPENDENCE_OBSERVER_PROOF
verified=true
observerId
executionId
sourceHead
observedAtUtc
freshUntilUtc=<optional explicit narrower expiry>
proofRefs[]
```

The observer source head must equal the exact report head, its observation time cannot come from the future relative to the assembled observation, and it must carry durable proof references.

Observer proof is also freshness-bounded. `PROVIDER_INDEPENDENCE_OBSERVATION_MAX_AGE_MS` fixes the maximum trust lifetime to 15 minutes from the evidence observation time. A legacy record that omits `freshUntilUtc` receives that deterministic maximum expiry. An explicit expiry may only narrow the window: an invalid expiry, an expiry before the proof observation time, or an expiry beyond the fixed maximum fails closed. Once the assembled observation time is later than the effective expiry, the observer proof is stale even if `main` has not moved.

A caller-shaped `verified=true` is not by itself a production trust root. The production wrapper must create this record only after authenticating its own execution context. This source contract merely prevents downstream callers from silently omitting or changing that proof once supplied.

## Required coverage classes

Every observation requires exactly one record for each class:

```text
REPOSITORY_SOURCE
GOAL_STATE
PROVIDER_ROUTE_PROOF
GAP_OWNERSHIP
HARD_BOUNDARY_PROOF
```

Each coverage record binds:

```text
coverageClass
complete=true
sourceHead
observedAtUtc
freshUntilUtc=<optional explicit narrower expiry>
examinedCount
emittedCount
scopeRef
proofRefs[]
```

Rules:

- all five classes must be present;
- duplicate classes fail closed;
- every record binds the same exact current `main` head;
- future timestamps fail closed;
- every coverage attestation is freshness-bounded by the same 15-minute maximum and an explicit expiry may only narrow that window;
- expired, invalid, reversed or over-wide coverage freshness windows fail closed;
- `examinedCount >= emittedCount`;
- `emittedCount` must equal the actual collection length passed to the current-truth report;
- repository coverage must prove at least one repository item was examined;
- every class carries durable proof references.

A coverage class may emit zero relevant provider records while still being complete, but it must truthfully record that zero. This allows the difference between “we looked and found none” and “we did not look” to survive into canonical state.

The fixed freshness cap closes a replay seam that exact-head binding alone cannot close: if `main` remains unchanged for hours, an old coverage attestation must still expire rather than silently becoming current again in a later report.

## Report handoff

When observer and coverage validation succeeds, the assembler calls the existing:

`buildCodexDependencyCurrentTruthReportV1()`

with:

- `observationComplete=true`;
- the exact canonical repository/main/head/time;
- durable coverage references derived from observer + coverage proof;
- the bounded repository/goal/provider/gap/boundary evidence collections.

If observer or coverage proof is incomplete, stale or otherwise invalid, the assembler still produces the report for diagnostics but fixes `observationComplete=false`. The existing report must then remain `BLOCKED_OBSERVATION_INCOMPLETE` rather than accidentally looking provider-independent.

Observation completeness therefore does **not** imply provider parity. A fully observed estate may correctly return `CURRENT_PARITY_GAPS` when a non-Codex route is unqualified, stale or missing live proof.

## Digest-bound durable record

The assembler emits a compact:

`stephanos.codex-dependency-current-truth-observation-record.v1`

containing at least:

```text
observationId
reportDigest
repository
sourceBranch
sourceHead
observedAtUtc
observerId
observerExecutionId
observationComplete
coverageRefs[]
reportState
admissionReady
criticalGapCount
unownedCriticalGapCount
unclassifiedReferenceCount
authority
```

`observationId` and `reportDigest` are SHA-256 identities over the normalized observation/report state. Observer effective freshness and normalized coverage freshness participate in observation identity, and coverage records are sorted canonically, so input ordering does not create false state churn while materially different trust windows remain distinguishable.

This record is deliberately compact enough for later persistence through the existing canonical evidence/state machinery without requiring a second provider-dependency database.

## Anti-paper-parity rules

The observation layer specifically prevents these failure modes:

1. **No observer proof** → observation incomplete.
2. **Wrong/stale source head** → observation incomplete.
3. **Expired observer proof on an unchanged source head** → observation incomplete.
4. **Missing coverage class** → observation incomplete.
5. **Duplicate coverage authority** → observation incomplete.
6. **Expired coverage proof on an unchanged source head** → observation incomplete.
7. **Invalid, reversed or over-wide observer/coverage freshness window** → observation incomplete.
8. **Coverage count differs from emitted evidence** → observation incomplete.
9. **Zero repository estate examined** → observation incomplete.
10. **Provider proof collection completed but found no current live proof** → observation may be complete, but parity remains red.
11. **Raw source/goal prose claims production qualification** → still downgraded by the existing current-truth report unless separate canonical provider evidence exists.

## Data-only boundary

All caller data is recursively restricted to plain values, plain objects and dense plain arrays. Symbol keys, accessors, custom prototypes, prototype-shaping keys, sparse arrays, functions and non-finite numbers fail before observation or parity evaluation.

## Authority boundary

Observation, report and compact record all fix the following authority to false:

```text
sourceMutation=false
dispatch=false
providerQualification=false
merge=false
deployment=false
runtimeMutation=false
openClawMutation=false
spendingOrAccount=false
leaseSeizure=false
```

This source cannot authenticate a host, crawl GitHub by itself, qualify OpenClaw/Forge, mutate Battle Bridge/Windows, dispatch a provider, create/close a goal, merge, deploy or widen authority.

## Proving intent

Focused regressions cover:

- complete verified observation producing current provider-independent truth when the underlying evidence truly supports it;
- observer verification and exact-head binding;
- future observer rejection;
- bounded default freshness for legacy observer/coverage evidence;
- stale observer proof rejection even when source head is unchanged;
- stale coverage proof rejection even when source head is unchanged;
- reversed and over-wide explicit freshness-window rejection;
- narrower explicit expiry being respected;
- all five coverage classes being mandatory;
- coverage count/source-head mismatch rejection;
- zero examined repository estate rejection;
- duplicate coverage authority rejection;
- a complete observation still exposing a real parity gap when provider live proof is absent;
- proof refs flowing into the report coverage ledger;
- deterministic observation identity across input ordering;
- zero authority widening;
- sparse/accessor hostile input rejection.

## Next bounded integration

After this source contract is independently reviewed and protected-admitted, the next #1899 slice should connect **one existing trusted host execution surface** to produce these observer/coverage records from real current evidence and persist the compact record through existing canonical state/evidence machinery.

The host integration must prove its own authentication and collection completeness. It should emit an explicit `freshUntilUtc` no later than the fixed maximum, must not let a caller widen that maximum, and must not let a caller self-assert `verified=true`, choose arbitrary repository roots, invent provider qualification, or create a second scheduler/evidence store.

Only real persisted current-head observations whose observer, coverage and provider-route proofs are all still fresh may later feed #1556 admission and #1694 sovereignty as “current provider-independence truth.”
