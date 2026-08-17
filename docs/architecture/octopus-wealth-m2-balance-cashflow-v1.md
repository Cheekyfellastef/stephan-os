# Octopus Wealth M2 Balance Sheet and Cash-Flow Projection V1

Primary product owner: #1565. Programme umbrella: #1776. Parent source gate: #1789.

## Purpose

M2 turns the reconciled read-only evidence produced by `octopusWealthHouseholdModelV1.mjs` into a bounded household balance-sheet and recurring cash-flow projection.

It deliberately does **not** create another wealth store, financial-data connector, recommendation engine, trading assistant, mortgage adviser, pension adviser, provider writer, account integration or source-mutation path.

The product flow is:

```text
M1 reconciled household evidence
  -> fixed M2 metric roles
  -> explicit usable / missing / ambiguous / unusable components
  -> known subtotals
  -> complete totals only when every required component is usable
  -> zero-authority read-only projection
```

## Why this is a separate M2 slice

M1 answers: *what household evidence do we actually have, where did it come from, how fresh is it, and what remains unknown?*

M2 answers only the next arithmetic question: *given that reconciled evidence, what balance-sheet and recurring cash-flow totals can be stated without inventing missing values or silently reclassifying ambiguous metrics?*

The separation is intentional. M2 consumes M1; it does not weaken or duplicate M1 validation.

## Fixed balance-sheet roles

Current assets require these exact M1 metric IDs:

- `cash-liquid-assets`
- `isa-current-value`
- `pension-current-value`
- `home-current-value`
- `caravan-current-value`

Current liabilities require:

- `mortgage-outstanding`
- `debt-balance`

Balance-sheet components must be non-negative `GBP` values backed by current `ACTUAL` or `ESTIMATED` M1 evidence. `PROJECTED`, `UNKNOWN`, stale, negative, wrong-unit or multiply-represented metrics do not enter complete totals.

M2 reports a known subtotal even when a section is incomplete, but `assetsTotalGbp`, `liabilitiesTotalGbp` and `netWorthGbp` remain `null` until their complete evidence requirements are met.

## Fixed recurring cash-flow roles

Annual inflows require:

- `employment-net-income`
- `caravan-net-income`

Annual outflows require:

- `household-running-costs`
- `mortgage-debt-service`
- `consumer-debt-service`
- `caravan-running-costs`

Cash-flow evidence may be `GBP_PER_YEAR` or `GBP_PER_MONTH`. Monthly evidence is converted only by the explicit deterministic rule:

```text
annual = monthly * 12
```

The conversion is exposed on the component as `MONTHLY_X_12`. No inflation, tax, interest, investment-return, salary-growth, retirement, refinancing or other forecast assumption is applied.

`annualNetCashFlowGbp` remains `null` unless both inflows and outflows are complete.

## No semantic guessing

M2 does not reinterpret broad or ambiguous M1 metrics.

For example, M1's discovery seed metric `home-mortgage-position` is **not** silently treated as either `home-current-value` or `mortgage-outstanding`. Likewise a percentage such as `debt-weighted-cost` is not converted into a debt balance, and `external-base-rate` is not used to manufacture future borrowing costs.

The required component must exist under its exact M2 role or the projection stays partial.

## Double-count protection

M1 can validly retain evidence under different ownership boundaries. M2 will not guess whether two records with the same M2 metric are additive or overlapping.

If more than one M1 record exists for a required M2 metric, that component becomes `AMBIGUOUS_MULTIPLE_RECORDS`, the relevant complete total is withheld, and the projection moves to `M2_RECONCILIATION_REQUIRED`.

This is stricter than summing individual, joint and household records and accidentally double-counting the same asset or liability.

## Evidence gate

Before arithmetic, M2 requires the M1 builder itself to accept the packet. It then additionally requires:

- the canonical M1 schema and `READ_ONLY_EVIDENCE_COVERAGE` projection kind;
- current M1 projection freshness (`FRESH`);
- all eight intended wealth tentacles represented;
- zero unresolved ownership on known M1 evidence.

Failure of any of those gates returns `SAFE_HOLD` with no balance-sheet or net-cash-flow claim.

M1 `UNKNOWN` values are allowed to survive into a valid M2 partial projection. Unknown is not an error and is never converted to zero.

## M2 states

```text
SAFE_HOLD
  M1 is invalid, stale, structurally incomplete or has unresolved known ownership.

M2_RECONCILIATION_REQUIRED
  Relevant evidence is ambiguous, stale at the component boundary, has the wrong unit,
  or uses a sign that M2 cannot safely interpret.

M2_PARTIAL_EVIDENCE
  M1 is valid and current, but one or more required M2 metrics are missing, UNKNOWN or PROJECTED.

M2_BALANCE_CASHFLOW_READY
  Every required current balance-sheet and recurring cash-flow metric is usable.
```

`READY` means only that the deterministic read-only arithmetic is complete. It is not financial advice, affordability approval, a recommendation or permission to act.

## Provenance

Every M2 component retains only bounded lineage needed to explain the arithmetic:

- exact metric role;
- source M1 datum ID;
- safe M1 source reference;
- epistemic status;
- freshness;
- ownership boundary;
- explicit unit conversion, when one occurred.

M2 intentionally does not carry free-form M1 notes or provider/account details into the arithmetic projection.

## Authority boundary

Every M2 projection keeps these capabilities false:

```text
financialAdviceAllowed=false
recommendationAllowed=false
tradeAllowed=false
transferAllowed=false
borrowingAllowed=false
mortgageApplicationAllowed=false
pensionTransferAllowed=false
purchaseAllowed=false
credentialUseAllowed=false
providerWriteAllowed=false
sourceMutationAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
runtimeMutationAllowed=false
```

No projected number can grant authority.

## Focused source proof

The bounded test estate is:

```bash
node --check shared/agents/octopusWealthBalanceCashflowV1.mjs
node --test shared/agents/octopusWealthHouseholdModelV1.test.mjs shared/agents/octopusWealthBalanceCashflowV1.test.mjs
```

The M2 tests cover:

- complete balance-sheet and recurring cash-flow arithmetic;
- transparent monthly-to-annual conversion;
- UNKNOWN evidence preserving partial truth;
- PROJECTED evidence excluded from current totals;
- duplicate-role double-count protection;
- stale M1 projection rejection;
- all-eight-tentacle admission;
- negative-sign reconciliation;
- refusal to reinterpret ambiguous M1 seed metrics;
- descriptor-safe outer input and revoked-proxy failure;
- complete zero-authority output.

## Stacked delivery boundary

This slice is intentionally stacked on existing M1 PR #1789 while that root remains open. It adds exactly three M2 product files and must not be retargeted or promoted as if M1 were already admitted.

When #1789 is eventually admitted, this existing M2 branch should be preservation-converged onto the resulting canonical main, retaining the bounded M2 estate and obtaining fresh exact-head proof through the repository's ordinary assurance path.

## Truth boundary

M2 is source-only arithmetic over synthetic or already-reconciled evidence. It does not claim that real household accounts, pensions, mortgages, caravans, bank providers or investment platforms have been connected or read. It does not render an Octopus Tile, provide advice, execute a transaction, submit an application, deploy source or mutate a runtime.
