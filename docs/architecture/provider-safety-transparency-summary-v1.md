# Provider Safety Transparency Summary V1

Primary product goal: #1563. Programme umbrella: #1776. Parent evidence gate: #1795.

## Purpose

This M2 slice implements the compact **user-facing provider-transparency projection** named by #1563 without implementing the live provider observer, account connection, browser observer, Shared Workspace monitor, notification publisher or data-rights machinery.

It consumes only the already-normalized read-only M1 provider-safety ledger projection and selects bounded summary fields suitable for a future transparency surface.

```text
normalized M1 ledger input
  -> canonical Provider Safety M1 projection
  -> compact transparency summary
  -> no raw events or evidence refs
  -> zero action authority
```

## Reuse boundary

M2 calls `buildProviderSafetyObservabilityLedgerV1` directly. M1 remains authoritative for:

- exact input/event shape and bounds;
- deduplication;
- provider/surface/model identifier sanitation;
- confirmed versus inferred versus unobservable truth;
- classification/evidence compatibility;
- evidence-strength requirements;
- trusted evaluation clock and stale/future chronology;
- request-ID hashing rules;
- sensitive-content and local-path rejection;
- provider no-record/export-absence non-proof semantics;
- safe evidence references;
- event latency measurement;
- provider/model distributions and coverage;
- explicit unknowns.

M2 does not duplicate or weaken those rules.

## Compact user-facing fields

The summary exposes:

```text
sourceVerdict
freshness
confirmedInterventionEvidenceCount
confirmedBlockCount
confirmedRequestMetadataCount
disclosedHumanAccessCount
inferredAnomalyCount
accountabilityEvidenceGapCount
unobservableEventCount
staleEventCount
latestConfirmedEvent
observationCoverage
observedDuration
provider/model distributions
openEvidenceGaps
nextReviewAction
```

It also retains `sourceProjectionId`, `sourceSnapshotId` and `evaluatedAtUtc` so the compact view can be traced back to exact M1 truth.

## Confirmed intervention truth

`confirmedInterventionEvidenceCount` includes only M1 current live `CONFIRMED_PROVIDER_NOTICE` and `CONFIRMED_LOCAL_OBSERVATION` counts.

Confirmed blocks remain a separate metric and are not double-counted into that number. Confirmed request metadata also remains separate because returned request metadata is evidence about a request path and must not automatically be labelled an intervention.

Inferred anomalies never contribute to a confirmed count.

## Accountability gaps are not exoneration

The compact `accountabilityEvidenceGapCount` combines only these M1 gap categories:

- provider says no record;
- item not present in sanitized export;
- requested but withheld;
- exemption claimed.

The summary carries M1's explicit unknown strings, including the rule that provider no-record/export absence is **not proof that no event occurred**.

## Observed duration is not safety-check delay

#1563 asks for latency impact, but the available evidence cannot generally establish how much of a request duration was caused by a provider safety check.

M2 therefore exposes:

```text
observedDuration.measuredEventCount
observedDuration.totalObservedDurationMs
observedDuration.maximumObservedDurationMs
observedDuration.causalAttribution = NOT_ESTABLISHED
```

These values describe durations measured around M1 events only. M2 never creates `safetyCheckDelayMs`, “extra scan delay” or equivalent causal claims.

A future source with explicit provider timing evidence would require its own reviewed contract before stronger attribution is allowed.

## Latest confirmed event

The compact latest-event view retains only:

```text
classification
providerId
surfaceId
modelId
observedAtUtc
outcome
```

It intentionally drops the M1 event ID and evidence references. Detailed provenance remains owned by M1.

## Distribution and coverage

Provider/model distributions are copied from M1's bounded current-live distributions. The summary does not infer missing identities.

Observation coverage retains only:

- current live event count;
- unknown-provider count;
- unknown-surface count;
- unknown-model count.

Unknown/unobservable state remains explicit rather than being presented as “no scan”.

## Read-only review priority

The summary computes only a bounded review suggestion, in this order:

1. confirmed provider block;
2. provider-disclosed human access;
3. confirmed intervention evidence;
4. accountability evidence gap;
5. inferred anomaly;
6. unobservable provider state;
7. stale evidence refresh;
8. no current live evidence;
9. no action required.

Every action class means **review the existing evidence**. It grants no provider/account/browser/legal/export/notification authority.

## States

```text
SAFE_HOLD
  M2 input is malformed, the evaluation clock is invalid, or M1 rejects the evidence packet.

SUMMARY_EVIDENCE_INCOMPLETE
  M1 has no live evidence, test-only evidence, or stale-only evidence.

SUMMARY_READY
  M1 has valid bounded provider-safety/accountability truth that can be presented compactly.
```

`SUMMARY_READY` does not mean provider observability is complete and does not mean a live observer exists.

## No raw event republication

The M2 output does not expose the M1 `events` array and does not copy M1 evidence refs. This keeps the public transparency summary bounded and avoids turning detailed evidence identifiers into ambient UI state.

## Authority boundary

Every output keeps these capabilities false:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
providerAccessAllowed=false
accountAccessAllowed=false
browserObservationAllowed=false
networkInterceptionAllowed=false
credentialAccessAllowed=false
legalSubmissionAllowed=false
exportImportAllowed=false
notificationPublishAllowed=false
uiMutationAllowed=false
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
runtimeMutationAllowed=false
```

## Focused proof

```bash
node --check shared/agents/providerSafetyTransparencySummaryV1.mjs
node --test shared/agents/providerSafetyObservabilityLedgerV1.test.mjs shared/agents/providerSafetyTransparencySummaryV1.test.mjs
```

The M2 regression estate proves:

- confirmed intervention and inferred anomaly separation;
- confirmed block separation and review priority;
- provider no-record/unobservable state remain evidence gaps;
- observed durations carry `NOT_ESTABLISHED` causal attribution;
- latest event drops detailed evidence identity;
- stale confirmed evidence cannot stay current;
- provider/model distributions reuse bounded M1 truth without raw events;
- materially future M1 evidence fails closed;
- outer accessors are not invoked;
- deterministic identity and complete zero authority.

## Stacked delivery boundary

This slice is intentionally stacked on existing M1 PR #1795 while that root remains open. Its net child estate must remain exactly three additive product files.

It must stay draft until the parent is admitted and must not be represented as completion of the live observer, Monitor Multiplexer integration, notification path or accountability request workflow.

## Truth boundary

This source slice uses synthetic tests or already-supplied sanitized M1 observations only. It does not observe ChatGPT/Codex/provider APIs, scrape a browser, connect an account, inspect hidden provider state, import a raw export, submit a rights request, publish a notification, change the Monitor Multiplexer, deploy source or mutate runtime state.
