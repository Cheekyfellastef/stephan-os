# Codex Dependency Current Truth Report V1

## Purpose

This contract advances #1899 under #1898 by joining the existing repository discovery and parity-classifier slices into one bounded current-truth report. It does not create another scheduler, provider registry, review system, execution plane, issue database or authority source.

The report is deliberately evidence-only. It answers a narrow question:

> At this exact canonical `main` head, which active Codex/Work-coupled touchpoints have proven non-Codex parity, which remain gaps, and which observations are too ambiguous or stale to classify safely?

## Canonical inputs

A report is bound to:

- repository `Cheekyfellastef/stephan-os`;
- branch `main`;
- one exact 40-character source head;
- one observation timestamp;
- bounded repository entries consumed by `codexDependencyRepositoryDiscoveryV1`;
- optional explicit goal candidates using the same parity-candidate contract;
- provider-route evidence bound to the same exact source head;
- existing canonical gap-owner observations.

Provider evidence must contain exact route/provider/capability identity, source readiness, task-class qualification state, live-proof state, explicit freshness expiry, portable-checkpoint parity, execution-receipt parity, proof parity, operator-approval parity and durable proof references.

## Anti-paper-parity rule

Repository or goal source may describe a route as source-ready, but source text cannot make that route live or production-qualified by assertion.

When no matching current provider evidence exists, the report deliberately downgrades the route to at most `SOURCE_READY`/`DISCOVERED`, fixes `liveProof=false` and `proofFreshness=UNKNOWN`, then lets the canonical parity matrix expose the missing live proof.

A provider evidence record from another source head, from the future, with incomplete authority/evidence fields or with conflicting current route identity fails closed.

## Report states

```text
CURRENT_PROVIDER_INDEPENDENT
CURRENT_PARITY_GAPS
BLOCKED_SEMANTIC_CLASSIFICATION
BLOCKED_EVIDENCE_CONFLICT
```

`admissionReady=true` is possible only for `CURRENT_PROVIDER_INDEPENDENT` and only when the nested canonical parity matrix is also admission-ready.

Raw `Codex` / `Remote Codex` / `Work agentic` prose remains an unclassified reference. It cannot become an operational dependency or a parity pass merely because the provider name appeared in text.

## Gap ownership

Current-truth gap-owner observations may fill an otherwise unowned touchpoint, allowing Stephanos to say “this gap is real and #1725 owns it” without creating another goal.

Conflicting owners fail closed. A known owner does not make an active critical parity gap admission-ready; it only removes duplicate-ownership ambiguity.

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
- source claims unable to self-promote live qualification;
- stale provider proof remaining non-green;
- wrong-source-head and future evidence failing closed;
- conflicting route evidence failing closed;
- compatible duplicate proof refs deduplicating safely;
- current gap-owner correlation without false admission;
- contradictory gap ownership rejection;
- repository and goal candidates sharing one matrix;
- exact canonical repository/main binding;
- zero authority widening.

## Truth boundary

This slice produces a deterministic current-truth report from supplied observations. It does not yet claim a complete live crawl of the repository, GitHub goals, Shared Workspace, OpenClaw, Forge or Battle Bridge has been executed or persisted.

A later host-side observation producer may populate the contract from current authenticated sources and persist the resulting report through existing canonical evidence/state machinery. That later step must not create another provider-control plane.
