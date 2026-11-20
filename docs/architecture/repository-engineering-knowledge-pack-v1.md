# Repository Engineering Knowledge Pack V1

Status: source-built candidate under #1957 / #1956

## Purpose

A coding worker should not have to rediscover the complete Stephan OS repository before every bounded change. This contract creates one compact, immutable, exact-current engineering pack from already-authorised canonical evidence.

It is retrieval and projection, not model retraining and not a new repository index.

## Ownership and reuse

The pack reuses existing owners:

- #1308 for project and architecture intelligence;
- #1645 for governed semantic, procedural, episodic and retrieval-pack memory;
- #1556 for work routing and authority;
- #1607 for reusable methods and completion assets;
- GitHub exact-head, review and proof machinery for repository truth;
- Foundry/Forge for bounded construction.

The pack cannot crawl GitHub, inspect arbitrary files, create work, mutate source, choose a provider, approve, merge, deploy or alter runtime state.

## Contract

`stephanos.repository-engineering-knowledge-pack.v1` binds:

- originating goal/work identity;
- exact repository, base head and base tree;
- exactly one canonical owner;
- bounded relevant paths;
- interfaces and schemas;
- invariants and forbidden changes;
- dependencies;
- known incidents and failure modes;
- required tests;
- review/risk class;
- external evidence and method references;
- freshness, conflicts and omitted-sensitive-data truth;
- acceptance and proof write-back destinations;
- a declared byte budget;
- zero authority.

The pack ID is content-addressed from canonical JSON. Equivalent consumers therefore receive the same pack identity regardless of provider.

## Fail-closed rules

The builder rejects:

- malformed repository, head or tree identity;
- missing or ambiguous canonical ownership;
- unsafe, absolute, traversal, backslash or duplicate paths;
- stale or conflicting knowledge;
- missing invariants, forbidden changes, tests or proof destinations;
- oversized packs rather than silent truncation;
- any requested source, approval, merge, deployment, runtime, account, spending, provider-selection, lease or arbitrary-command authority.

A later base head or tree invalidates the old pack.

## Intended composition

```text
canonical goal / PR / repository / memory evidence
  -> Repository Engineering Knowledge Pack V1
  -> existing qualified implementation route
  -> bounded source and tests
  -> exact-head review and proof
  -> Knowledge / Method / Incident / Automation / Proof write-back
```

## First proof

The deterministic tests cover canonical construction, stable provider-neutral identity, unsafe/duplicate paths, malformed exact identity, ambiguous ownership, stale/conflicting knowledge, authority widening, byte-budget overflow and head/tree invalidation.

## Later integration

Later reviewed slices may build authorised evidence adapters that prepare this input from existing #1308, #1645 and GitHub projections. Those adapters must remain bounded and must not turn the pack into a second repository crawler or authority system.
