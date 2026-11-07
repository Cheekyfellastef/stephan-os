# Octopus Wealth M1 Household Evidence Model V1

## Purpose

This bounded M1 slice establishes the provider-neutral, read-only household evidence contract beneath canonical goal #1565 and product programme #1776.

It does **not** render the Octopus Wealth landing-page tile, calculate net worth, recommend a financial action, connect a provider, import a statement, execute a transaction or claim that live household evidence is present.

## Eight canonical tentacles

The complete estate remains visible from the first seed:

1. `CASH_AND_LIQUIDITY`
2. `ISA_AND_INVESTMENTS`
3. `PENSIONS_AND_RETIREMENT_BRIDGE`
4. `HOME_MORTGAGE_AND_EQUITY`
5. `CARAVAN_PORTFOLIO`
6. `EMPLOYMENT_SALARY_SACRIFICE_AND_TAX`
7. `DEBT_AND_CREDIT`
8. `EXTERNAL_ENVIRONMENT`

A tentacle with no known value remains explicit and `UNKNOWN`. Missing evidence is never interpreted as zero, healthy, paid, current or complete.

## Datum contract

Every accepted datum carries exactly:

```text
schemaVersion
datumId
tentacleId
metricId
value
unit
asOfUtc
sourceType
sourceName
sourceRef
confidence
epistemicStatus
freshness
ownershipBoundary
manualOverride
notes
```

Epistemic status is one of:

```text
ACTUAL
ESTIMATED
PROJECTED
UNKNOWN
```

`UNKNOWN` requires `value=null`, `confidence=UNKNOWN` and `freshness=UNKNOWN`; it never contributes to current-evidence counts.

Known evidence requires a value compatible with its declared unit and a source class compatible with its epistemic claim. A model assumption cannot become `ACTUAL`. A provider observation cannot become `PROJECTED`. Count values must be bounded non-negative integers, year values must remain within a human planning range, percentages and currency values must be finite and bounded, dates must be canonical timestamps, and text values reject sensitive, control-character or identifier-like content.

The ownership boundary is retained independently for Stephan, spouse, joint, household, external-reference and unknown evidence. A known record with unresolved ownership can remain visible but keeps the model in reconciliation-required state. `EXTERNAL_REFERENCE` is resolved evidence only for the `EXTERNAL_ENVIRONMENT` tentacle; it cannot satisfy household cash, ISA, pension, home, caravan, employment or debt coverage.

## Validation context

A datum cannot self-certify freshness.

`validateOctopusWealthDatumV1()` requires an explicit canonical `observedAtUtc` validation context. The public validator uses the trusted current process clock and checks:

- observation time is not in the future;
- datum `asOfUtc` is not in the future;
- datum `asOfUtc` is not later than the observation;
- declared freshness exactly matches the derived evidence age.

The complete model builder captures one trusted current clock and applies it consistently to every record. Caller-supplied `nowMs`, stale-window or freshness-authority options are not accepted.

## Freshness truth

Datum freshness is reconciled against `asOfUtc` and the model's `observedAtUtc`:

```text
FRESH    <= 24 hours
AGING    <= 30 days
STALE    <= 365 days
EXPIRED  > 365 days
```

A caller cannot label arbitrarily old evidence `FRESH`.

The projection itself is evaluated against the trusted current clock:

```text
FRESH    <= 1 hour
AGING    <= 24 hours
STALE    <= 30 days
EXPIRED  > 30 days
```

Every result carries:

```text
evaluatedAtUtc
freshnessValidUntilUtc
projectionFreshness
```

Only a `FRESH` projection can report current evidence. Older otherwise valid snapshots remain inspectable but return `M1_EVIDENCE_REFRESH_REQUIRED` and zero current counts.

A freshly rebuilt projection does not make expired underlying evidence current. If any known tentacle lacks current known evidence, the complete estate remains refresh-required rather than becoming `M1_MANUAL_EVIDENCE_MODEL_READY`.

## Evidence identity and conflict handling

The canonical semantic datum identity is:

```text
tentacleId + metricId + ownershipBoundary
```

`datumId` is also globally unique within a model.

The model fails closed when:

- two records share one semantic identity;
- one `datumId` is reused across different semantic identities;
- identical evidence is duplicated;
- materially different evidence competes for the same identity.

Any such condition returns `SAFE_HOLD` with an empty evidence projection and zero coverage counts. No order-selected winner survives a conflict.

Accepted records are sorted with a fixed code-point comparator before projection identity is calculated, so equivalent evidence sets receive one stable ID regardless of caller order or host locale.

## Manual seed

`createOctopusWealthManualSeedTemplateV1()` requires an explicit canonical observation timestamp and emits one `UNKNOWN` placeholder per tentacle. Equivalent options produce the same seed records and projection identity.

The seed contains no real balances, pension values, mortgage figures, income, account identifiers or provider credentials. Personal evidence belongs in a later protected local evidence store or separately authorised read-only adapter; it must not be embedded in repository source, GitHub comments, tests or Shared Workspace summaries.

## Reconstructed-record boundary

Before any route or validation reads caller-owned data, the complete supplied model is converted into a recursively frozen data-only snapshot.

Objects reject:

- accessors without invoking getters or setters;
- custom prototypes;
- cycles;
- symbol keys;
- non-enumerable or non-data fields;
- prototype-shaping keys such as `__proto__`, `prototype` and `constructor`;
- non-finite numbers;
- over-deep, over-large or over-wide structures.

Arrays are inspected through one own-descriptor snapshot before iteration. Sparse arrays, accessor-backed indexes, symbol keys, custom properties such as `mergeAllowed`, custom prototypes and cycles fail closed without executing getters. Object and array descriptor snapshots reject symbol-keyed entries directly rather than relying on a separate, state-drifting property scan.

The public seed and standalone-validation option entry points use the same descriptor-safe boundary before reading their fields.

## Source and privacy boundary

M1 accepts only bounded provider-neutral source references:

```text
manual://
document://
provider://
public://
dataset://
```

Raw web URLs, traversal, backslashes, drive/path disguises, account-like digit sequences, sort-code shapes, IBAN shapes and credential/account-shaped references are rejected. Account-like identifiers are also rejected from `modelId`, `datumId`, `metricId` and `sourceName`, so moving a sensitive identifier out of `sourceRef` cannot bypass the privacy boundary.

Sensitive detection covers separator, underscore and camel-style forms, including examples such as:

```text
client_secret
db_password
apiKey
access_token
oauth_token
session_token
credential
bank_account_number
sort_code
IBAN
```

Invalid evidence is never echoed into the output. Even a sensitive top-level `modelId` is redacted from the invalid projection.

## Bounded estate

M1 accepts at most 256 evidence records. Canonicalization also enforces bounded array length, object width, traversal depth, node count and string size before evidence is projected.

This is a product truth boundary, not an arbitrary document store.

## Coverage and readiness

Coverage keeps separate counts for:

```text
representedTentacleCount
knownTentacleCount
currentKnownTentacleCount
staleKnownTentacleCount
unresolvedOwnershipDatumCount
actualDatumCount
estimatedDatumCount
projectedDatumCount
unknownDatumCount
```

Readiness states are:

```text
SAFE_HOLD
M1_EVIDENCE_INCOMPLETE
M1_EVIDENCE_REFRESH_REQUIRED
M1_MANUAL_SEED_READY
M1_MANUAL_RECONCILIATION_REQUIRED
M1_MANUAL_EVIDENCE_MODEL_READY
```

`M1_MANUAL_EVIDENCE_MODEL_READY` requires all eight tentacles to have current known evidence, no explicit unknown data remaining in the accepted estate and no unresolved known-evidence ownership.

These states describe source evidence-model readiness only. They are not a claim that the tile is rendered, connected, running, operator-visible or accepted.

## Authority boundary

Every M1 projection retains:

```text
tradeAllowed=false
transferAllowed=false
borrowingAllowed=false
mortgageApplicationAllowed=false
pensionTransferAllowed=false
purchaseAllowed=false
credentialUseAllowed=false
sourceMutationAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
```

A model, datum, note, scenario or recommendation can never grant financial or platform authority.

## Focused proof

```bash
node --test shared/agents/octopusWealthHouseholdModelV1.test.mjs
```

The focused suite covers all eight tentacles, deterministic explicit seeds, observation-bound direct validation, UNKNOWN preservation, actual/estimated/projected separation, derived freshness, complete expired-estate handling, semantic and datum-ID conflicts, source and sensitive-data rejection, descriptor-safe objects and arrays, structural bounds, ownership reconciliation, stable projection identity and zero authority.

Hosted exact-head checks and provider-neutral independent review remain authoritative.

## Next bounded milestone

After M1 is reviewed and accepted, the next source milestone is a deterministic balance-sheet and cash-flow calculation layer that consumes only reconciled M1 evidence and keeps accounting net worth, accessible net worth, retirement-purpose assets, liabilities and flow categories separate.

Landing-page rendering, personal evidence ingestion, public-data adapters, scenario recommendations, monitor alerts, AI explanation and live household acceptance remain later milestones under #1565.
