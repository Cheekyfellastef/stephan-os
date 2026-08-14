# Octopus Wealth M1 Household Evidence Model V1

## Purpose

This bounded M1 slice establishes the provider-neutral, read-only household evidence contract beneath canonical goal #1565 and product programme #1776.

It does **not** render the Octopus Wealth landing-page tile, calculate net worth, recommend a financial action, connect a provider, import a statement, execute a transaction or claim that any live household evidence is present.

## Eight canonical tentacles

The M1 model keeps the complete intended estate visible from the beginning:

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

The epistemic status is one of:

```text
ACTUAL
ESTIMATED
PROJECTED
UNKNOWN
```

`UNKNOWN` requires `value=null`. A known datum requires a bounded finite number, boolean or non-sensitive bounded string. A `PROJECTED` datum remains projected and must come from an explicit manual or model-assumption source; it cannot masquerade as provider-observed actual truth.

The ownership boundary is retained independently for Stephan, spouse, joint, household, external-reference and unknown evidence. M1 never collapses those owners into one implied authority domain.

## Evidence identity and conflict handling

The canonical datum identity is:

```text
tentacleId + metricId + ownershipBoundary
```

Two records with the same identity do not silently overwrite each other:

- byte-equivalent records are reported as duplicate evidence;
- materially different records are reported as conflicting evidence;
- either condition keeps the projection in `SAFE_HOLD` until evidence is deliberately reconciled.

The model reports evidence coverage and readiness only. It does not calculate household totals from conflicting or incomplete inputs.

## Manual seed

`createOctopusWealthManualSeedTemplateV1()` emits one explicit `UNKNOWN` placeholder for each tentacle. The seed contains no real balances, pension values, mortgage figures, income, account identifiers or provider credentials.

Personal evidence belongs in a later protected local evidence store or separately authorised read-only adapter. It must not be embedded in repository source, GitHub comments, tests, screenshots or Shared Workspace summaries.

## Reconstructed-record boundary

Before validation or projection, the complete supplied model is converted into a bounded data-only snapshot.

The boundary rejects:

- accessor-backed values without invoking getters or setters;
- custom prototypes;
- cycles;
- symbol keys;
- reserved prototype-shaping keys such as `__proto__`, `prototype` and `constructor`;
- non-finite numbers;
- malformed collection or record shapes.

Accepted snapshots are recursively frozen before use.

## Source and privacy boundary

M1 accepts only bounded provider-neutral source references in these namespaces:

```text
manual://
document://
provider://
public://
dataset://
```

Raw web URLs, traversal, absolute paths, personal local filesystem paths and credential-shaped content are rejected. The contract also rejects secret, token, password, private-key, account-number, sort-code, IBAN and similar sensitive fields or text.

Externally changing evidence must carry an explicit canonical timestamp and freshness state. Future-dated evidence fails closed.

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
M1_MANUAL_SEED_READY
M1_MANUAL_RECONCILIATION_REQUIRED
M1_MANUAL_EVIDENCE_MODEL_READY
```

These states describe source evidence-model readiness only. They are not a claim that the Octopus Tile is rendered, connected, running, operator-visible or accepted.

## Focused proof

```bash
node --test shared/agents/octopusWealthHouseholdModelV1.test.mjs
```

The focused suite covers all eight tentacles, UNKNOWN preservation, actual/estimated/projected separation, duplicate and conflicting identity handling, future evidence, source-reference and sensitive-data rejection, unsafe reconstructed records, ownership boundaries and zero authority.

Hosted exact-head checks and independent semantic review remain authoritative for the published branch.

## Next bounded milestone

After M1 is reviewed and accepted, the next source milestone is a deterministic balance-sheet and cash-flow calculation layer that consumes only reconciled M1 evidence and keeps accounting net worth, accessible net worth, retirement-purpose assets, liabilities and flow categories separate.

Landing-page rendering, personal evidence ingestion, public-data adapters, scenario recommendations, monitor alerts, AI explanation and live household acceptance remain later milestones under #1565.