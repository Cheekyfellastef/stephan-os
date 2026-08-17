# Spatial World Foundry Validator Framework V1

## Purpose

This source-only slice advances #1760 M5/M6 preparation by defining one engine-neutral validation planning boundary for Foundry candidates.

It does not create a validator runner, playtest worker, engine adapter, scheduler or promotion authority.

## Validation classes

The framework recognizes bounded classes for source contract, asset integrity, dependency integrity, performance budget, comfort budget, semantic world validation and preview evidence.

A catalogue entry declares which classes one validator can prove, whether it is deterministic and whether it is engine-neutral. The planner never executes that validator.

## Exact-bound evidence

Evidence must bind the validator id/version, validation class, build-order id, asset id/version and exact source head. Wrong-head or mismatched evidence fails closed. One class cannot silently overwrite another receipt.

The default M5 posture requires source, asset, dependency, performance and comfort evidence, plus preview evidence whenever the build order requires preview. Semantic-world validation can be made mandatory explicitly for the later M6 chamber slice.

## Promotion boundary

Complete PASS evidence returns `READY_FOR_PROMOTION_REVIEW`, not promotion. A failure returns `VALIDATION_FAILED`; missing proof returns `VALIDATION_REQUIRED`.

The framework always retains `validatorExecutionAllowed=false`, `promotionAllowed=false`, and no source, asset, merge, deployment or runtime mutation authority.
