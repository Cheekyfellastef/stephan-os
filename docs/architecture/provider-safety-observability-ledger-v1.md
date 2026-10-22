# Provider Safety Observability Ledger V1

## Purpose

This is the first source-only slice of #1563. It defines a deterministic, provider-neutral, read-only normalized evidence ledger over already-supplied sanitized provider-safety and accountability observations.

It does not observe a provider, call an API, scrape a browser, import an export, generate or submit a data-rights request, publish notifications, mutate the Monitor Multiplexer, access an account or reveal hidden provider state.

## Truth classes

The projection preserves these semantics independently:

- `CONFIRMED`
- `DISCLOSED`
- `INFERRED`
- `WITHHELD_OR_ABSENT`
- `ACCOUNTABILITY_PROCESS`
- `UNCLASSIFIED_EVIDENCE`
- `UNOBSERVABLE`
- `STALE`
- `TEST_FIXTURE`

`PROVIDER_SAYS_NO_RECORD`, `NOT_PRESENT_IN_EXPORT`, `REQUESTED_BUT_WITHHELD`, `EXEMPTION_CLAIMED` and unobservable internal state are not proof that no scan, intervention, access or record exists.

A slow request remains inferred unless visible notice, supported returned metadata, operator-supplied visible evidence or provider disclosure supports a stronger classification.

## Evidence compatibility

Every classification is bound to an allowlisted evidence type. Confirmed provider notices cannot be based on `UNKNOWN`; provider-disclosed human access requires provider disclosure, rights-request receipt or sanitized export-diff evidence.

Evidence-only `OPERATOR_SUPPLIED_VISIBLE_EVIDENCE` remains `UNCLASSIFIED_EVIDENCE` and non-confirming until the supplied material is classified as a specific supported claim. `SYNTHETIC_TEST_FIXTURE` is test-only and cannot establish live counts, current coverage, latest material event or a confirmed verdict; an all-fixture projection reports `TEST_FIXTURE_ONLY` / `TEST_ONLY` rather than fresh live evidence.

Raw request or account identifiers are never accepted. Correlation identifiers may appear only as pre-sanitized `sha256:<64 lowercase hex>` values.

## Data-only boundary

The input uses exact allowlisted fields and dense standard arrays. Sparse arrays, accessor-bearing arrays, custom array prototypes, symbols, nested payloads, unexpected fields, unsafe references and sensitive-shaped text fail closed without executing property getters.

Accepted evidence-reference and limitation arrays are detached and frozen before projection, so caller mutation cannot rewrite a published event or projection identity.

## Time and latency

One trusted evaluation clock controls future and stale classification. Callers cannot widen the freshness policy.

Measured latency is emitted only when explicit canonical start and completion timestamps exist and the supplied latency exactly matches their difference. Negative or impossible chronology fails closed.

## Deduplication

Exact replay of the same event ID or evidence fingerprint is deduplicated and recorded as replayed evidence. A conflicting reuse of an event ID or fingerprint fails closed.

## Projection

The current projection exposes:

- separate confirmed notice, request-metadata and block counts;
- provider-disclosed event and human-access counts;
- inferred anomaly counts;
- no-record, export-absence, withheld and exemption counts;
- accountability-process, unclassified and unobservable counts;
- stale and synthetic-fixture counts;
- latest confirmed material event;
- measured latency only;
- provider, surface and model distributions only from supplied evidence;
- evidence coverage, safe references, limitations and explicit unknowns;
- a deterministic explanation-ready verdict.

Missing provider, surface or model identity remains `UNKNOWN` rather than being fabricated.

## Authority invariant

All authority flags are permanently false:

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
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
runtimeMutationAllowed=false
```

The ledger classifies supplied evidence only. It does not make an observation happen or authorize an action.

## Focused proof

```bash
node --test shared/agents/providerSafetyObservabilityLedgerV1.test.mjs
git diff --check
```

The suite covers explicit notice versus inferred latency, confirmed blocks, replay and conflicting duplicate handling, proof-of-absence separation, stale/future/impossible time, freshness override rejection, input bounds, sensitive/raw/local-path rejection, unknown provider/model truth, sanitized disclosed human access, false authority, deterministic provider neutrality, evidence compatibility, measured latency, fixture non-live behavior, dense data-only arrays, deep immutability and hash-safe request correlation.

## Deferred work

Later separately governed slices may add an authorized local observer, account-export importer, data-rights request preparation/tracking, Monitor Multiplexer integration and Privacy Tile presentation. No such live or authority-bearing capability is claimed here.
