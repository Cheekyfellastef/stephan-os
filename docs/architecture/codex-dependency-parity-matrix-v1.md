# Codex Dependency Estate Map and Non-Codex Parity Matrix V1

## Purpose

This is the first source-controlled #1899 implementation under #1898. It combines a deterministic parity classifier with a bounded repository-candidate discovery contract so provider references can be inventoried without pretending that a raw `Codex` or `Work agentic` string is automatically an operational dependency.

It does **not** delete Codex, qualify providers, mutate source, dispatch work, merge, deploy, touch Windows/OpenClaw/Forge runtime state or create a second scheduler/provider router.

## Discovery boundary

`codexDependencyRepositoryDiscoveryV1.mjs` consumes bounded repository-entry observations and separates four states:

- `STRUCTURED_TOUCHPOINT` — an explicit semantic contract says this is an operational provider dependency and supplies the fields needed by the parity classifier;
- `NEEDS_SEMANTIC_CLASSIFICATION` — provider-related text was discovered, but text alone is not dependency proof;
- `REFERENCE_ONLY` — the source explicitly records a historical, descriptive or observability-only reference that must not become a false critical-path gap;
- `EXCLUDED_GENERATED_OR_RUNTIME` — generated/runtime-only locations such as `apps/stephanos/dist/`, `runtime-activity/`, `.runtime/`, `.git/` and `node_modules/` are excluded from source dependency inventory.

Provider signals currently cover `CODEX`, `REMOTE_CODEX` and `WORK_AGENTIC`. Callers may supply an explicit provider signal when the dependency is represented structurally rather than by prose.

The discovery contract deliberately does **not** infer `criticalPath`, `codexUseClass`, owner, capability class or provider parity from a text match. Structured operational observations carry those semantics explicitly. Incomplete semantic records remain visible and flow to the matrix as fail-closed evidence rather than being guessed.

Discovery snapshots have deterministic finding identities and can be diffed. A newly introduced unclassified provider reference therefore becomes a visible semantic-refresh requirement instead of silently entering the estate.

## Parity classifier input boundary

Each matrix candidate is a semantic touchpoint record gathered by the discovery/correlation machinery. A candidate identifies the underlying capability family, whether it is truly critical-path, the current provider role, the canonical owner and any claimed non-Codex routes.

A route only reaches `PARITY_PROVEN` when the exact capability class is active and has all of:

- `PRODUCTION_ELIGIBLE` task-class qualification;
- source readiness;
- fresh live proof;
- portable checkpoint parity;
- execution-receipt parity;
- proof parity;
- operator-approval parity.

Source-only or stale evidence cannot be painted green.

## Coverage verdicts

The classifier emits the canonical #1899 verdict family:

- `PARITY_PROVEN`
- `PARITY_SOURCE_READY_NEEDS_LIVE_PROOF`
- `NON_CODEX_ROUTE_EXISTS_NEEDS_QUALIFICATION`
- `MISSING_NON_CODEX_ROUTE`
- `HARD_EXTERNAL_BOUNDARY_ISOLATED`
- `LEGACY_NON_CRITICAL`
- `AMBIGUOUS_FAIL_CLOSED`

Multiple source references with the same `touchpointId` deduplicate into one capability family. Compatible proof references are unioned. Contradictory family identity, route contracts or gap ownership fail closed rather than selecting the most convenient claim.

Any active critical gap keeps matrix `admissionReady=false` even when its correct existing repair owner is already known.

## Safety and ownership

A missing critical-path route remains visible, including whether `missingGapOwner` is unresolved. The matrix/discovery machinery itself never creates a repair issue and never grants authority. Existing goals such as #1574, #1657, #1671 or #1818 remain implementation owners.

Every discovery result, discovery diff, matrix and touchpoint record publishes an all-false authority projection for source mutation, dispatch, provider qualification, merge, deployment, runtime mutation, spending/account actions and lease seizure.

## Current proof surface

Focused fixtures now cover:

- raw provider prose staying unclassified until semantics are supplied;
- explicit reference-only and non-operational references;
- generated/runtime exclusion;
- Work-agentic constrained-provider discovery;
- declared provider signals without raw prose dependence;
- structured candidates feeding the parity classifier;
- incomplete semantic records failing closed;
- deterministic discovery identity/order;
- snapshot refresh detecting newly introduced unclassified references;
- proven, source-ready, unqualified and missing parity routes;
- stale proof and missing checkpoint/receipt/proof/operator-approval parity;
- hard external boundaries;
- duplicate source references, proof-ref union and contradictory route/gap-owner evidence;
- zero authority widening.

## Follow-on slices

#1899 still needs the bounded **repository/goal observation producer** that feeds this discovery contract from current durable truth, correlation to live provider capability cards and existing gap owners, persisted machine/human parity reports, stale-proof refresh, and consumption by #1556 routing / #1694 Sovereignty.

Those slices should extend these contracts rather than create a competing dependency map or provider-control plane.
