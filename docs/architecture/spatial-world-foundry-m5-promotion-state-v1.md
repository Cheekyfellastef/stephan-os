# Spatial World Foundry M5 Promotion State V1

## Purpose

Advance durable Spatial World Foundry goal #1760 from validation planning into the first bounded promotion-review state without introducing a promotion executor, registry writer, merge path, deployment path or live-world mutation surface.

This slice is stacked on the existing Validator Framework V1 lane and reuses its canonical `planSpatialFoundryValidation()` result. It creates no second validator framework and does not reinterpret failed or incomplete validation as readiness.

## Contract

`planSpatialFoundryPromotion(buildOrder, assetRecord, input)` first validates the existing M1 build order and asset contracts, then calls the existing validator framework with the supplied exact source head, validator catalogue and immutable evidence.

Promotion review is available only when the validator framework returns exactly:

```text
READY_FOR_PROMOTION_REVIEW
```

The first M5 slice accepts only an asset whose integration state is exactly `DRAFT` and whose live state is exactly `NOT_LIVE`. The only requested next state admitted is:

```text
DRAFT -> AGENT_TESTED
```

The output is a deterministic proposal, not a mutation. It records the proposed patch:

```text
validationState=passed
integrationState=AGENT_TESTED
liveState=NOT_LIVE
```

and binds it to the exact build order, asset identity, source head and validation evidence references. The proposal preserves the build order's `NONE`, `POLICY_GATED` or `OPERATOR_REQUIRED` approval posture rather than manufacturing approval.

## Fail-closed behavior

The planner blocks when:

- the M1 build order is invalid;
- the M1 asset record is invalid;
- required validation is missing or failed;
- validation evidence is bound to a different exact source head or asset/build identity;
- the asset is already beyond `DRAFT`;
- the asset claims any live state other than `NOT_LIVE`;
- a caller attempts to jump directly to a later promotion state such as `MAIN_ACCEPTED` or `LIVE_STAGED`.

No later promotion rung is inferred from validation alone. Integration, simulation, playtest, operator/policy approval, protected-main acceptance and live staging each remain separate future proof boundaries.

## Authority boundary

Every result keeps all of the following false:

```text
validationExecutionAllowed=false
registryMutationAllowed=false
assetMutationAllowed=false
promotionExecutionAllowed=false
sourceMutationAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
liveWorldMutationAllowed=false
```

The M5 planner cannot execute validators, alter an asset record, write the registry, merge source, deploy, stage content or change a live spatial world.

## Focused proof

The deterministic tests cover:

- complete PASS evidence reaching promotion review;
- missing validation evidence remaining blocked;
- wrong-head validation evidence failing closed;
- direct jumps to later promotion states being rejected;
- already-advanced assets not being re-promoted;
- live-state claims being held;
- operator and policy approval requirements being preserved without execution authority.

## Next rung

After source admission, the next bounded M5 continuation may model integration-candidate evidence and promotion receipts. It must reuse this proposal identity and the existing asset registry rather than create a second promotion store or writer. Any real asset mutation, registry write or runtime action remains separately reviewed and authorised.
