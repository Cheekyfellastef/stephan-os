# Forge Shadow M6 Parallel Construction Default V1

Status: source-only, recommendation-only

## Purpose

Advance canonical Forge sidecar goal #1671 from M5 shadow acceptance into the M6 policy seam: once M5 has been genuinely proven, suitable resource-disjoint source construction should default to a `FOUNDRY_FORGE` recommendation instead of waiting for Codex capacity.

This slice is deliberately not another scheduler, dispatcher, worker, publisher, merge path, capacity truth store or runtime executor. It consumes the existing M5 acceptance result and produces a bounded routing recommendation for an already-known candidate.

## Defaulting contract

`planForgeM6ParallelConstructionDefault()` recommends `FOUNDRY_FORGE` only when all of the following are true:

- the supplied M5 result is the canonical `FORGE_M5_ACCEPTANCE_PASSED` result with two accepted real goals;
- the candidate is bound to the same repository and canonical main head/tree as the accepted M5 evidence;
- the candidate is source-only and belongs to a bounded source build, source repair or source verification class;
- requested operations are limited to source reading/writing, focused tests and review/proof packet preparation;
- the candidate requests no runtime, deployment, merge or credential authority; and
- resource scopes are explicit, bounded and do not collide with an already-active owner.

When those conditions hold the preferred construction route is `FOUNDRY_FORGE`, while the protected integration route remains `CHATGPT_GITHUB`.

## Active ownership rule

M6 does not steal work. If an active dispatch already owns the candidate or overlaps any of its resource scopes, that owner remains authoritative. The result becomes `PRESERVE_ACTIVE_OWNER`, and M6 does not recommend a route switch.

Disjoint active work does not prevent another eligible candidate from receiving the Forge recommendation.

## Safety boundary

Every result is recommendation-only. It grants no dispatch, source mutation, branch mutation, publication, merge, deployment, runtime mutation, Forge/Podman execution, credential access or arbitrary command authority.

This milestone does not prove Forge is commissioned by itself. It depends on genuine M5 acceptance and does not install, start or execute Forge/Podman, route a real task, publish capacity, merge or deploy anything.
