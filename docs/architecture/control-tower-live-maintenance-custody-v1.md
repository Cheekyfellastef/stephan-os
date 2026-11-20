# Control Tower live maintenance observation

The Core daemon heartbeat and the maintenance executor on localhost port 18791
are different owners. On 28 October 2026 the Core heartbeat reset to
BOOTSTRAPPING while the maintenance executor still held cycle
2a5f269f-bc64-45da-a62c-ab0e4c772294 with MAINTENANCE_CUSTODY_STATE_MISSING.
Current source heads and healthy HTTP services did not discharge that hold.

The existing visibility snapshot now performs one fixed read-only health GET
against that executor, with a 1.5-second timeout, no redirects and a 64 KiB body
limit. It publishes only bounded hold flags, activity flags, last cycle identity
and blocker codes. Core status remains its own projection. A shared projection
also carries the same limited maintenance evidence through the guarded remote
snapshot; it strips extra fields and derives the state from the actual flags,
not a caller's claimed green state. A hold forces attention; missing or invalid
evidence prevents READY without blocking unrelated observation.

NOT_HELD_REPORTED describes an HTTP observation only. It is never an independent
custody-release witness, source/task admission, restart authorization or native
pickup receipt. Every projection keeps executionAuthority=false. This repair
does not change the custody store, OS audit channel, recovery protocol, worker
admission or any lifecycle action. The existing custody repair retains its
separate owner and consequential approval gates.

Reusable invariant: process-local health and source convergence cannot stand in
for a different executor's live custody state. Observe both; never infer a
release from a reset heartbeat. Regression coverage includes conflicting live
holds, malformed/unreachable/oversized responses, private-field filtering and
remote transport of a hold despite a contradictory green input label.
