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

A tentacle with no known value remains explicit and `UNKNOWN`. Missing evidence is not interpreted as zero, healthy, paid, current or complete.

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

Known evidence requires a value compatible with its declared unit and a source class compatible with its epistemic claim. A model assumption cannot become `ACTUAL`. A provider observation cannot become `PROJECTED`. Count values must be non-negative integers, date values must be canonical timestamps, and text values reject sensitive or identifier-like content.

The ownership boundary is retained independently for Stephan, spouse, joint, household, external-reference and unknown evidence. M1 never collapses those owners into one implied authority domain.

## Freshness truth

Datum freshness is reconciled against `asOfUtc` and the model's `observedAtUtc` using one bounded vocabulary:

```text
FRESH    <= 24 hours
AGING    <= 30 days
STALE    <= 365 days
EXPIRED  > 365 days
```

A caller cannot label arbitrarily old evidence `FRESH`, and evidence dated after the model observation fails closed.

The projection itself is also evaluated against the trusted current clock:

```text
FRESH    <= 1 hour
AGING    <= 24 hours
STALE    <= 30 days
EXPIRED  > 30 days
```

Only a `FRESH` projection can report current evidence. Older otherwise valid snapshots remain inspectable but return `M1_EVIDENCE_REFRESH_REQUIRED` and zero current counts.

## Evidence identity and conflict handling

The canonical datum identity is:

```text
tentacleId + metricId + ownershipBoundary
```

Two records with the same identity do not overwrite each other:

- byte-equivalent records are duplicate evidence;
- materially different records are conflicting evidence;
- either condition returns `SAFE_HOLD` with an empty evidence projection and zero coverage counts.

No order-selected winner survives a conflict. Accepted records are sorted by canonical identity before the stable projection ID is calculated, so equivalent evidence sets receive the same identity regardless of caller order.

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
- non-finite numbers.

Arrays are inspected through own property descriptors before iteration. Sparse arrays, accessor-backed indexes, symbol keys, custom properties such as `mergeAllowed`, custom prototypes and cycles fail closed without executing caller code.

The public seed-options entry point uses the same boundary before reading `modelId` or `observedAtUtc`.

## Source and privacy boundary

M1 accepts only bounded provider-neutral source references:

```text
manual://
document://
provider://
public://
dataset://
```

Raw web URLs, traversal, backslashes, drive/path disguises, long identifier-like digit strings and credential/account-shaped references are rejected.

Sensitive detection covers separator, underscore and camel-style forms, including examples such as:

```text
client_secret
db_password
apiKey
access_token
bank_account_number
sort_code
IBAN
```

Invalid or sensitive records are never echoed into the output projection.

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

## Readiness states

```text
SAFE_HOLD
M1_EVIDENCE_INCOMPLETE
M1_EVIDENCE_REFRESH_REQUIRED
M1_MANUAL_SEED_READY
M1_MANUAL_RECONCILIATION_REQUIRED
M1_MANUAL_EVIDENCE_MODEL_READY
```

These states describe source evidence-model readiness only. They are not a claim that the tile is rendered, connected, running, operator-visible or accepted.

## Focused proof

```bash
node --test shared/agents/octopusWealthHouseholdModelV1.test.mjs
```

The focused suite covers all eight tentacles, deterministic explicit seeds, UNKNOWN preservation, actual/estimated/projected separation, derived freshness, duplicate/conflicting identity clearing, source and sensitive-data rejection, descriptor-safe objects and arrays, ownership boundaries, stable projection identity and zero authority.

Hosted exact-head checks and independent semantic review remain authoritative.

## Next bounded milestone

After M1 is reviewed and accepted, the next source milestone is a deterministic balance-sheet and cash-flow calculation layer that consumes only reconciled M1 evidence and keeps accounting net worth, accessible net worth, retirement-purpose assets, liabilities and flow categories separate.

Landing-page rendering, personal evidence ingestion, public-data adapters, scenario recommendations, monitor alerts, AI explanation and live household acceptance remain later milestones under #1565.