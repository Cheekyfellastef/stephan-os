# Spatial Planet Design Genome V1

## Purpose

This slice gives Spatial World Foundry build agents one engine-neutral design target for a planet before geometry, code or assets are generated.

It advances goal #1760 without creating another scheduler, worker pool, asset registry, lease service, storage provider or runtime executor.

## Contract

`stephanos.spatial-planet-design-genome.v1` records:

- exact planet and genome identity;
- exact source head;
- research references;
- influences reduced to reusable principles;
- twelve required experiential and technical design dimensions;
- performance and comfort budgets;
- licence/provenance policy;
- creation time.

Influence records hard-code `copyingAllowed=false`. They may record principles learned from commercial games or other references, but cannot authorize copying proprietary assets, code, level data, characters or trade dress.

## Build-order binding

`planSpatialPlanetDesignGenomeBinding` accepts only a valid existing Spatial Build Order and a valid genome. The planet identity and `designGenomeVersion` must match exactly.

A successful result means only that the build order is bound to a coherent design contract. It grants no generation, storage, lease, source-write, merge, deployment, runtime or voice-execution authority.

## Intended next use

Later Foundry agents can consume the binding when they create M4+ candidates. Validation can compare a candidate against the same immutable genome version so visual and experiential drift becomes explicit evidence rather than an informal judgement.
