# Codex Dependency Current Truth Report V1

## Purpose

This contract advances #1899 under #1898 by joining the existing repository discovery and parity-classifier slices into one bounded current-truth report. It does not create another scheduler, provider registry, review system, execution plane, issue database or authority source.

The report is deliberately evidence-only. It answers a narrow question:

> At this exact canonical `main` head, which active Codex/Work-coupled touchpoints have proven non-Codex parity, which remain gaps, and which observations are too ambiguous, incomplete or stale to classify safely?

## Canonical envelope

A report is bound to:

- repository `Cheekyfellastef/stephan-os`;
- branch `main`;
- one exact 40-character source head;
- one observation timestamp;
- `observationComplete=true` from the governed observation host;
- at least one durable coverage reference proving what estate was observed;
- a non-empty repository/goal observation estate;
- bounded repository entries consumed by `codexDependencyRepositoryDiscoveryV1`;
- optional explicit goal candidates using the same parity-candidate contract;
- current provider-route evidence bound to the same exact source head;
- current hard-external-boundary evidence when such an exception is claimed;
- existing canonical gap-owner observations.

The pure contract does not perform the crawl itself. A later governed host observation producer is responsible for gathering authenticated repository, goal, provider and proof records and for producing durable coverage references.

## Anti-empty-estate rule

An empty or unattested observation can never yield `CURRENT_PROVIDER_INDEPENDENT`.

Missing `observationComplete`, missing coverage refs or an empty repository+goal estate yields:

```text
BLOCKED_OBSERVATION_INCOMPLETE
```

This prevents “nothing was observed” from being confused with “no dependency gaps exist.”

## Provider evidence

Provider evidence must be explicitly marked as verified canonical route proof and contain exact:

- route/provider/capability identity;
- current source head;
- observation time and freshness expiry;
- source readiness;
- task-class qualification state;
- live-proof state;
- portable-checkpoint parity;
- execution-receipt parity;
- proof parity;
- operator-approval parity;
- durable proof references.

Repository or goal source may describe a route as source-ready, but source text cannot make that route live or production-qualified by assertion.

When no matching current provider evidence exists, the report deliberately downgrades the route to at most `SOURCE_READY`/`DISCOVERED`, fixes `liveProof=false` and `proofFreshness=UNKNOWN`, then lets the canonical parity matrix expose the missing live proof.

Provider evidence from another source head, from the future, without canonical verified-proof posture, with missing authority/evidence fields or with conflicting current route identity fails closed.

## Hard external boundaries

A source declaration such as `hardExternalBoundary=true` is not enough to remove a critical parity gap.

The report only preserves `HARD_EXTERNAL_BOUNDARY_ISOLATED` when a separate fresh verified `CANONICAL_HARD_BOUNDARY_PROOF` record binds the exact touchpoint and current source head and proves unrelated work isolation. Without that current evidence, the source-only exception is downgraded and the critical gap remains visible.

## Report states

```text
CURRENT_PROVIDER_INDEPENDENT
CURRENT_PARITY_GAPS
BLOCKED_OBSERVATION_INCOMPLETE
BLOCKED_SEMANTIC_CLASSIFICATION
BLOCKED_EVIDENCE_CONFLICT
```

`admissionReady=true` is possible only for `CURRENT_PROVIDER_INDEPENDENT`, with complete coverage attestation and a nested canonical parity matrix that is also admission-ready.

Raw `Codex` / `Remote Codex` / `Work agentic` prose remains an unclassified reference. It cannot become an operational dependency or a parity pass merely because the provider name appeared in text.

## Gap ownership

Current-truth gap-owner observations may fill an otherwise unowned touchpoint, allowing Stephanos to say “this gap is real and #1725 owns it” without creating another goal.

Conflicting owners fail closed. A known owner does not make an active critical parity gap admission-ready; it only removes duplicate-ownership ambiguity.

## Data-only boundary

Inputs are recursively restricted to plain data. Sparse arrays, symbol keys, custom prototypes, accessors, functions, non-finite numbers and prototype-shaping keys fail before truth evaluation. This prevents hidden caller behavior from participating in provider-admission evidence.

## Intended consumers

Later bounded integration may project this report into existing #1556 Mission Scheduler and #1694 Sovereignty views. Those consumers remain the owners of scheduling and provider-risk presentation.

The report itself performs no GitHub reads, writes or dispatch. A host observation producer may gather current repository/goal/provider evidence and pass it into this pure contract, but that host must remain separately governed and proof-bound.

## Authority boundary

Every report fixes all of the following to `false`:

- source mutation;
- dispatch;
- provider qualification;
- merge;
- deployment;
- runtime mutation;
- OpenClaw mutation;
- spending/account action;
- lease seizure.

The nested parity matrix remains equally non-authoritative.

## Initial proving cases

Focused regressions cover:

- fresh exact-main provider evidence proving parity;
- raw provider prose remaining unclassified;
- empty/unattested estate fail-closed behavior;
- source claims unable to self-promote live qualification;
- canonical evidence-class and verified-proof requirements;
- stale provider proof remaining non-green;
- wrong-source-head and future evidence failing closed;
- conflicting route evidence failing closed;
- compatible duplicate proof refs deduplicating safely;
- current gap-owner correlation without false admission;
- contradictory gap ownership rejection;
- source-only hard-boundary claims remaining gaps;
- fresh verified hard-boundary isolation proof;
- repository and goal candidates sharing one matrix;
- exact canonical repository/main binding;
- hostile sparse/symbol-shaped input rejection;
- zero authority widening.

## Truth boundary

This slice produces a deterministic current-truth report from supplied observations. It does not yet claim a complete live crawl of the repository, GitHub goals, Shared Workspace, OpenClaw, Forge or Battle Bridge has been executed or persisted.

A later host-side observation producer may populate the contract from current authenticated sources and persist the resulting report through existing canonical evidence/state machinery. That later step must not create another provider-control plane.
