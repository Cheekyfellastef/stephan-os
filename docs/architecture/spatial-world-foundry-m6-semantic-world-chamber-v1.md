# Spatial World Foundry M6 Semantic World Chamber V1

Status: source-only, evidence-only

## Purpose

Advance #1760 through the exact `SEMANTIC_WORLD` implementation seam deliberately left by the existing Spatial World Foundry Validator Framework V1. This slice creates one engine-neutral semantic-world evidence evaluator and no second validator framework, runner, scheduler, promotion service, asset registry or runtime executor.

## Contract

The chamber consumes one exact Spatial Build Order, one exact asset record and one bounded semantic observation set for the same source head. It evaluates only semantic-world invariants that can be proven without mutating a world:

- required semantic anchors are present exactly once;
- declared interaction affordances have evidence-bound targets;
- navigation/occupancy semantics do not contradict declared blocked or traversable regions;
- required world-state labels are represented;
- evidence references are explicit, bounded and source-head bound;
- all observations come from one exact evaluator id/version and one exact asset/build-order identity.

A complete clean observation returns a `PASS` evidence record in the exact shape consumed by `planSpatialFoundryValidation()` for class `SEMANTIC_WORLD`. Missing evidence returns `SEMANTIC_WORLD_EVIDENCE_REQUIRED`; contradictory or failed evidence returns `SEMANTIC_WORLD_VALIDATION_FAILED`; malformed or widened caller input fails closed.

## Framework integration

The output is intentionally not a promotion decision. It is one validator evidence record for the existing #1845 framework. The existing validator framework remains responsible for composing source-contract, asset-integrity, dependency-integrity, performance, comfort, semantic-world and preview evidence and may only reach `READY_FOR_PROMOTION_REVIEW` when its own complete contract is satisfied.

## Authority boundary

The chamber performs no engine execution, file or asset write, registry update, promotion, deployment, runtime mutation, headset action, world mutation, merge, source mutation or arbitrary command. All authority fields remain false.
