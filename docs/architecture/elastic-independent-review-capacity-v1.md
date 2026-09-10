# Elastic Independent Review Capacity V1

## Purpose

This source-only slice widens the existing provider-neutral review fabric so several eligible exact-head reviews can be planned concurrently without creating another reviewer, scheduler, workflow, provider registry, merge path, or runtime executor.

It is deliberately subordinate to the recovery mission. `CRITICAL_RECOVERY` requests are planned before programme-critical and ordinary requests so Battle Bridge / ignition recovery work cannot be displaced by lower-priority product review demand.

Canonical ownership remains unchanged:

- #1574 owns provider-neutral exact-head review policy and receipt validity.
- #1637 owns elastic continuity capacity.
- #1556 owns provider / mission routing.
- existing exact-head review dispatch and Independent Merge Security Review workflows own dispatch and execution.
- existing specialist reviewers own high-risk acceptance.
- protected merge and runtime authority remain separate operator gates.

## Contract

`deriveElasticIndependentReviewWidth()` computes a bounded review width from active reviews, ready eligible reviews, critical-recovery demand and currently available reviewer slots.

Policy bounds are intentionally smaller than construction capacity:

- minimum healthy review slots: 2;
- maximum review slots: 12.

A baseline shortfall fails closed as `DEGRADED_CAPACITY`; malformed capacity evidence fails closed as `SAFE_HOLD_INVALID_CAPACITY`.

`planElasticIndependentReviewAssignments()` consumes only already-eligible exact-head review requests and currently qualified reviewer capacity. It does not decide whether a PR is otherwise ready for review. Upstream programme / dependency machinery remains responsible for that eligibility decision.

The planner:

1. validates exact repository, PR, branch, base and source-head identity;
2. sorts `CRITICAL_RECOVERY` before `PROGRAMME_CRITICAL` before `STANDARD`, then oldest request first;
3. rejects a request whose same repository / PR / exact-head identity is already active;
4. preserves implementer/reviewer independence by provider plus session identity;
5. requires the reviewer to be qualified for the request risk tier;
6. preserves the existing specialist rule for `high` risk;
7. respects each reviewer instance's bounded available slots;
8. caps assignments at the explicit caller-supplied policy limit;
9. holds unsupported, duplicate, conflicting or excess work with typed reason codes;
10. emits an inert assignment plan only.

## Recovery-first behaviour

The current primary programme mission is to restore the Battle Bridge ignition path and prove Stephanos running correctly. This contract therefore treats recovery review as first-class priority rather than another item in a FIFO queue.

When #1946 recovery-proof compatibility, #1919 ignition convergence, or a later canonical recovery successor is upstream-qualified as `CRITICAL_RECOVERY`, it is considered before ordinary product review requests. A high-risk recovery request still cannot bypass specialist qualification or reviewer independence. Capacity widening must never weaken exact-head or authority gates merely to increase throughput.

This source does not mutate #1946, #1919, Windows, OpenClaw, Battle Bridge state, Scheduled Tasks, services or the PC.

## Provider neutrality

Reviewer capacity is represented by qualified reviewer class, provider, session, risk tiers and available slots rather than by a hard-coded provider dependency. Codex capacity can participate when healthy and qualified, but exhausted Codex capacity is a routing event rather than a programme-wide stall. Qualified GitHub-first, OpenClaw, external or deterministic routes remain governed by the existing #1574 rules.

The planner itself does not qualify a provider and does not turn a paper capability declaration into production eligibility.

## Authority boundary

Every result keeps these capabilities false:

- review dispatch authority;
- source mutation authority;
- approval authority;
- merge authority;
- deployment authority;
- runtime mutation authority;
- provider qualification authority.

The existing trusted review-dispatch machinery must separately consume a settled plan before any review job can be launched. Exact-head review receipts, specialist verdicts and protected operator merge authorization remain mandatory.

## Initial acceptance

Source acceptance requires focused tests proving:

- elastic width scaling and fail-closed bounds;
- critical recovery precedence;
- implementer/reviewer independence;
- duplicate exact-head suppression;
- high-risk specialist preservation;
- bounded multi-review capacity and overflow hold;
- duplicate request fail-closed behaviour;
- zero merge/runtime authority.

Runtime wiring is intentionally deferred to a separately reviewed slice after this planner is protected-admitted.
