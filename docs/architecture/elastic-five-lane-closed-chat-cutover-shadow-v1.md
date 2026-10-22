# Elastic five-lane closed-chat cutover shadow V1

This source-only acceptance slice extends the coordinated #1557/#1637 rolling
native autonomy mission without creating another controller, scheduler, worker,
queue, lease store, receipt store, or mutation plane.

It reconstructs one candidate five-lane checkpoint after JSON persistence (the
closed-chat/new-chat boundary), binds every required proof to one exact source
head and checkpoint, retains the exact current #1557 controller as canonical,
and binds rollback to that controller's same source and lease identity.

The shadow gate requires four distinct proof identities:

- `CLOSED_CHAT_RECOVERY`;
- `BLOCKED_LANE_ISOLATION`;
- `FLEET_CONTROL_PROPAGATION`;
- `ROLLBACK_READINESS`.

Every proof must be verified, terminal `PROVEN`, exact-source-bound, and bound
to the same durable candidate checkpoint. The candidate must expose at least
five distinct lanes and no resource may have multiple mutation writers.
Missing, duplicated, stale, contradictory, or incomplete evidence forces
`SAFE_HOLD` while preserving the current controller and rollback target.

Even a fully satisfied shadow fixture grants no dispatch, source or runtime
mutation, controller authority transfer, five-lane cutover, rollback execution,
merge, or deployment authority. `cutoverEligibleInShadow=true` means only that
the deterministic source gate accepted its fixture. It is not a live acceptance
receipt and never means `FIVE_LANE_LIVE`.

Real closed-chat execution, protected canonical leases and receipts, physical
fleet-control propagation, one bounded authority cutover, and post-cutover
rollback proof remain separate exact authorization and live acceptance gates.
