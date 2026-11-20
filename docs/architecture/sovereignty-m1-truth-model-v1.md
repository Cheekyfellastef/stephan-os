# Sovereignty M1 Truth Model V1

## Purpose

Issue #1694 requires a first-class Sovereignty product surface that shows where Stephanos depends on providers and systems, where concentration risk exists, what alternatives are actually evidenced, and where evidence is missing. This M1 truth-model slice supplies the read-only product contract beneath that future tile and workspace.

It is intentionally not the rendered landing-page tile. The active UI Agent stack owns user-facing surface inventory and shared visual-language integration, so this slice avoids overlapping UI files while establishing the product truth that the tile can later render.

## Existing evidence reused

The model reuses canonical capacity evidence already published by Stephanos rather than creating another telemetry plane:

- `status/codex-capacity-current.json` from the authenticated Codex capacity publication;
- `status/chatgpt-github-build-capacity-current.json` from the governed GitHub build-lane receipt;
- `status/foundry-forge-build-capacity-current.json` from the governed Foundry Forge build-lane receipt.

Missing, stale, expired, future-dated, malformed or proofless evidence remains `UNKNOWN`. The model never manufactures throughput, failure rate, cost, latency, critical-path share or other metrics that the underlying evidence does not provide.

## Provider-neutral system model

A system observation identifies both a `systemId` and a `providerId`. This distinction is deliberate. Multiple routes backed by one provider do not count as independent diversification.

Each observation carries:

- system and provider identity;
- system class and evidence source kind;
- timestamp and declared truth state;
- derived effective truth state after freshness checks;
- bounded capacity posture;
- real evidence references;
- optional bounded metrics, where unsupported metrics remain `null`;
- a human-readable explanation.

The identifiers are provider-neutral. A future provider or a Stephan-owned implementation can enter the same model without changing the schema.

## Capability dependency model

A capability dependency names:

- the primary system;
- zero or more alternative systems;
- an optional local fallback;
- an optional native Stephan-owned option;
- criticality;
- evidence for the dependency mapping.

The projection computes one of four explainable postures per capability:

- `DIVERSIFIED`: at least two distinct providers have current usable evidence;
- `CONCENTRATED`: alternatives are declared but fewer than two distinct providers are currently evidenced as usable;
- `SINGLE_POINT`: only one system is declared;
- `UNKNOWN`: the primary system does not have current evidence.

Unobserved alternatives are retained as visible concentration risk rather than silently deleted.

## Explainable coverage, not a magic score

The model publishes two transparent percentages:

- `evidenceCoveragePercent`: the share of total declared capability criticality weight whose primary system currently has usable evidence;
- `diversificationCoveragePercent`: among capabilities with current primary-system evidence, the share of criticality weight that currently has at least two distinct evidenced providers.

Criticality weights are explicit and fixed in the contract: LOW=1, MEDIUM=2, HIGH=3. If no capability has current primary evidence, diversification coverage is withheld as `null` instead of displaying a fabricated number.

The overall posture fails conservatively: any unknown capability yields `UNKNOWN`; otherwise any single point yields `SINGLE_POINT`; otherwise any concentration yields `CONCENTRATED`; only a fully evidenced diversified set yields `DIVERSIFIED`.

## Authority boundary

Sovereignty is advisory and read-only. This contract never grants or infers authority to:

```text
installAllowed=false
purchaseAllowed=false
subscriptionAllowed=false
credentialChangeAllowed=false
providerAccountMutationAllowed=false
sourceMutationAllowed=false
mergeAllowed=false
deploymentAllowed=false
spendAllowed=false
routingMutationAllowed=false
```

Provider or routing recommendations remain future advisory product behavior and must continue through existing governed operator/controller contracts.

## Proof

Focused local proof for this slice is:

```bash
node --test shared/agents/sovereigntyWorkspaceProjectionV1.test.mjs
```

The initial harness covers canonical Codex/GitHub/Forge normalization, provider-level diversification, same-provider concentration, single-point visibility, stale/future/proofless evidence, bounded metrics, unobserved alternatives, future-provider neutrality and authority-smuggling attempts.

## Deliberate M1 remainder

This slice does not claim issue #1694 complete. Remaining M1 product work includes the first-class landing-page Sovereignty tile/workspace, navigation, visible provider/capability cards, and exact served-head runtime acceptance. Those rendered-surface changes should reuse this truth model and coordinate with the active UI Agent work rather than creating a competing UI language or private telemetry store.
