# Publisher failures must not terminate the conversational backend

On 28 October 2026, the backend's existing minute publisher exhausted the atomic
writer's EPERM rename retries for status/battle-bridge-current.json. The error
handler tried publishing STALE to the same failing sink. That second rejection
escaped the detached immediate/timer tick, and Node terminated the backend.
Port 8787 disappeared, interrupting ordinary Stephanos communication.

The existing loop now separates source collection, snapshot publication and
audit-event publication. Only a source failure produces a STALE slice. A failed
storage write returns BLOCKED; it is not retried as a second status publication.
An audit append failure also returns BLOCKED. The scheduler contains unexpected
tick rejection, retains its bounded result for inspection via getStatus(), and
logs only a constant failure code. Its original interval, single-flight guard,
stop operation and next normal tick remain unchanged. No alternate store,
in-place write, permission override or additional process is introduced.

Failed publication is not successful telemetry. Existing retained records keep
their original timestamps and freshness rules. No execution, admission, custody
release, source lease or merge authority is granted. This repair is separate
from the retained custody journal work and does not discharge the maintenance
hold.

Regression proof includes persistent EPERM through the real atomic writer,
unchanged previous status bytes, recovery on the same loop's next tick, a real
unavailable audit sink, and a separate HTTP process running Node with strict
unhandled rejections. That process must still answer after both detached
immediate and scheduled failures. This is deterministic process proof, not a
claim that production has been restarted or recovered.

Reusable invariant: a failure handler cannot depend on the same failed output
sink, and an advisory publication failure must not escape its scheduler into an
unrelated request-serving process. Report the loss of proof without inventing
freshness or disabling the canonical atomic writer's protections.
