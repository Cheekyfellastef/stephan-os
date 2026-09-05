# Elastic five-lane recoverable lease shadow V1

This additive source-only acceptance slice advances #1637 beside the current
canonical #1557 controller. It creates no controller, scheduler, worker, lease
store, queue, receipt plane, signer, runtime command, or mutation authority.

The projector accepts at least five exact-source-bound lease records only when
their issuer and signature evidence is already verified, timestamps are
canonical and ordered, identifiers and nonces are unique, and each active
resource has one mutation writer. Hidden, symbol-keyed, accessor-backed,
forged, replayed, malformed, stale-source, expired-active, or contradictory
records fail closed to `SAFE_HOLD`.

An expired or proven-dead owner is only `SHADOW_RECLAIMABLE` when the fixed
recovery policy, resource-state revalidation, absence of a competing owner,
and a durable recovery receipt are all present. That classification grants no
lease acquisition, renewal, reclamation, seizure, dispatch, source/runtime
mutation, controller transfer, five-lane cutover, merge, or deployment.

The slice proves deterministic contract behaviour only. Real signed records,
protected local receipt storage, crash recovery, physical resource mutation,
cutover, rollback and provider qualification remain separate live gates with
their own exact authority and proof requirements.
