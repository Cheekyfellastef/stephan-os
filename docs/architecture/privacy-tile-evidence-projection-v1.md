# Privacy Tile Evidence Projection V1

## Purpose

This contract is the first source-only slice of #1564. It creates a deterministic, provider-neutral, read-only evidence projection for the future Stephanos Privacy Tile.

It consumes bounded normalized observations supplied by already-governed sources or synthetic tests. It does not observe providers, inspect devices, intercept traffic, import raw exports, connect accounts, submit legal requests, change settings, send messages, schedule work or render the landing-page tile.

## Truth model

The projection preserves four non-overlapping truth buckets:

- `CONFIRMED`
- `INFERRED`
- `UNKNOWN`
- `STALE`

Stale evidence cannot inflate confirmed counts. Provider opacity, `PROVIDER_SAYS_NO_RECORD`, `NOT_PRESENT_IN_EXPORT`, withheld evidence and unobservable internal state remain unknown rather than becoming proof that no processing occurred.

The contract represents the #1564 event classes, including confirmed collection/intervention/human-access/disclosure/deletion/restriction, operator-supplied evidence, inferred risks, consent states, requested-but-withheld evidence, provider no-record responses and stale evidence.

## Domains

The M1 projection accepts six bounded domains:

1. `AI_PROVIDER_TRANSPARENCY`
2. `DEVICE_DISPLAY_PRIVACY`
3. `CONSENT`
4. `DATA_RIGHTS`
5. `EXPORT_DISCLOSURE_DIFF`
6. `NETWORK_CONTACT`

A future source adapter may normalize evidence into this contract, but this module never becomes a collector or independent evidence authority.

## Network and display boundary

A sanitized network record may prove only that a device contacted a destination category at an observed time. It cannot prove encrypted payload content, viewing content, historical collection, filesystem access, credential access or human access.

A display or HDMI relationship grants no filesystem, account, credential or network authority. Missing ACR, telemetry or privacy-setting evidence remains `UNKNOWN`.

## Consent boundary

Missing or ambiguous consent becomes an explicit `CONSENT_UNPROVEN` gap. Consent withdrawal is not proof that historical data was erased. Consent proof, withdrawal and deletion evidence remain separate claims.

## Data-rights boundary

The projection can retain the #1564 rights-request lifecycle and calculate supplied deadline posture with one trusted evaluation clock. It cannot create, send, submit, escalate, appeal, delete, contact a controller or assert legal entitlement.

An overdue request produces a read-only review recommendation only.

## Freshness and chronology

The canonical stale boundary is fixed in source. Callers can supply only the trusted evaluation clock and cannot widen freshness or future-skew policy.

Materially future observations, impossible freshness chronology, rights requests opened after observation and deadlines before request opening fail closed.

## Input safety and bounds

The module accepts data-only plain records with exact allowlisted keys. It rejects:

- accessors, custom prototypes, symbols, cycles and prototype-shaping keys;
- non-array or oversized collections;
- duplicate record identities;
- unsupported domains, classifications, source classes and rights states;
- absolute or traversal paths;
- unsafe proof references;
- credentials, tokens, sessions, cookies, account identifiers and email-like identifiers;
- raw exports, prompt/response content, identity documents and arbitrary nested payloads.

The complete input and output are size-bounded. Output ordering and projection identity are deterministic.

## Posture

The projection emits one of:

- `PROTECTED`
- `ATTENTION`
- `HIGH_RISK`
- `UNKNOWN`

`PROTECTED` requires complete current domain coverage with confirmed evidence and no inference, unknown, stale, unproven-consent, open-rights or synthetic-fixture state. Inadequate evidence is `UNKNOWN`, never optimistic. A no-contact observation is not proof that no communication or processing occurred.

## Authority invariant

Every authority flag is false:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
accountAccessAllowed=false
deviceMutationAllowed=false
networkInterceptionAllowed=false
credentialAccessAllowed=false
legalSubmissionAllowed=false
deletionAllowed=false
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
runtimeMutationAllowed=false
```

A recommendation is advisory review text only. It grants no action authority.

## Focused proof

```bash
node --test shared/agents/privacyTileEvidenceProjectionV1.test.mjs
git diff --check
```

The focused suite covers truth-bucket separation, unproven consent, network-contact overclaim rejection, unknown display settings, provider no-record semantics, stale/future evidence, freshness-policy override rejection, duplicate IDs, bounded collections, unsupported states, sensitive/raw/local-path rejection, rights-deadline projection, unknown posture, zero authority and deterministic provider-neutral output.

After the recursive pre-serialization snapshot repair, the focused suite contains 29 tests. The one-shot repair and subsequent preservation-safe convergence onto canonical `main` both reran the suite successfully with 29 passed and 0 failed while preserving the repaired source and test blobs.

## Exact evidence and fixture boundary

A truth classification is accepted only with a compatible evidence-source class. In particular, a confirmed privacy claim cannot use `UNKNOWN` as its source. Operator-supplied material must either carry a specific supported claim classification with an appropriate visible-evidence source or remain the evidence-only `OPERATOR_SUPPLIED_EVIDENCE` class, which is projected as `UNKNOWN` rather than silently promoted.

`SYNTHETIC_TEST_FIXTURE` is supported for deterministic hostile tests only. Synthetic records remain visibly non-live, do not count as current domain coverage, cannot create a material latest-event claim and cannot establish `PROTECTED`, `ATTENTION` or `HIGH_RISK` posture.

## Data-only and immutability boundary

Top-level record collections, every record object, evidence-reference lists and limitation lists are recursively descriptor-snapshotted into owned frozen data before serialization, hashing, iteration or size measurement. Dense standard arrays and exact plain records containing data properties only are required. Sparse arrays, accessor-bearing arrays or records, own `toJSON` hooks, custom prototypes, symbols, proxies that cannot be safely inspected and unexpected fields fail closed without executing caller code.

Accepted arrays are detached and frozen before projection. Later caller mutation cannot alter a published record, evidence list, projection identity or posture.

Evaluation clocks must be safe canonical JavaScript date values. Out-of-range clocks fail closed rather than throwing.

## Later milestones

Later separately governed work may connect #1563 normalized provider-observability evidence, local-only export diffing, operator-controlled rights-request preparation, device/privacy evidence and the landing-page UI. None of those capabilities is claimed by M1.