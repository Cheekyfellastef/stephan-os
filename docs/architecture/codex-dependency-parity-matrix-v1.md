# Codex Dependency Estate Map and Non-Codex Parity Matrix V1 — classifier core

## Purpose

This is the first source-controlled classifier slice for #1899 under #1898. It turns already-discovered provider touchpoints and route evidence into one deterministic, provider-neutral parity matrix.

It does **not** delete Codex, scan arbitrary prose for the word `Codex`, qualify providers, mutate source, dispatch work, merge, deploy, touch Windows/OpenClaw/Forge runtime state or create a second scheduler/provider router.

## Input boundary

Each candidate is a semantic touchpoint record gathered by existing estate/repository/goal discovery machinery. A candidate identifies the underlying capability family, whether it is truly critical-path, the current provider role, the canonical owner and any claimed non-Codex routes.

A route only reaches `PARITY_PROVEN` when the exact capability class is active and has all of:

- `PRODUCTION_ELIGIBLE` task-class qualification;
- source readiness;
- fresh live proof;
- portable checkpoint parity;
- execution-receipt parity;
- proof parity;
- operator-approval parity.

Source-only or stale evidence cannot be painted green.

## Coverage verdicts

The classifier emits the canonical #1899 verdict family:

- `PARITY_PROVEN`
- `PARITY_SOURCE_READY_NEEDS_LIVE_PROOF`
- `NON_CODEX_ROUTE_EXISTS_NEEDS_QUALIFICATION`
- `MISSING_NON_CODEX_ROUTE`
- `HARD_EXTERNAL_BOUNDARY_ISOLATED`
- `LEGACY_NON_CRITICAL`
- `AMBIGUOUS_FAIL_CLOSED`

Multiple source references with the same `touchpointId` deduplicate into one capability family. Contradictory family identity or route evidence fails closed rather than selecting the most convenient claim.

## Safety and ownership

A missing critical-path route remains visible, including whether `missingGapOwner` is unresolved. The matrix itself never creates a repair issue and never grants authority. Existing goals such as #1574, #1657, #1671 or #1818 remain implementation owners.

Every matrix and touchpoint record publishes an all-false authority projection for source mutation, dispatch, provider qualification, merge, deployment, runtime mutation, spending/account actions and lease seizure.

## Follow-on slices

After this classifier is source-admitted, #1899 still needs bounded candidate discovery/correlation from repository and durable goal truth, machine-readable persisted matrix/report generation, stale-proof refresh and consumption by #1556 routing and #1694 Sovereignty. Those should extend this contract rather than create a competing dependency map.
