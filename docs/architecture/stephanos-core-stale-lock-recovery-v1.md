# Attended Core stale-lock recovery

Continues #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.

After a Windows reboot, Core can be absent while its exclusive-create JSON lock
remains. The normal caretaker correctly refuses incomplete process inventory;
Core correctly refuses to unlink an existing lock during acquisition. Neither
rule is relaxed. The fixed local action is
`scripts/windows/recover-stephanos-core-lock.ps1`.

## Admission and operation

This is an attended, high-risk recovery action. Independent Windows/security
review, protected integration, exact installed main and separate operator
approval for that head and observed lock SHA256 are required before live use.
It is deliberately not added to an unattended/public mailbox or standing
elevated task. Caller-selected paths, PIDs, commands and process observations
are not accepted. Source-only tests do not authorise live recovery.

From a limited user process, supply `-ExpectedHead`, `-ExpectedLockSha256` and
`-OperatorApproved`. The entry must be the fixed canonical installed path.
The existing canonical ignition source-truth admission must accept that exact
main. Relevant source bytes are captured and rechecked across awaited work.
Node loader overrides are refused; PowerShell uses only its system module path.
Every inherited daemon path input (`USERPROFILE`, `HOME`, `LOCALAPPDATA` and
`STEPHANOS_SHARED_AGENT_WORKSPACE`) must be absent or resolve to the same fixed
canonical path. This is checked before elevation and on every source recheck,
so retirement and the launched daemon cannot target different state directories.

The limited parent requests one UAC child. The child only retires the fixed
Core lock. It never starts Core or alters services, scheduled tasks, source
leases, maintenance custody, credentials or other locks. An already-elevated
parent is refused, ensuring Core is not accidentally launched as administrator.

The native adapter pins every ancestor against rename and rejects reparse
points. It opens the exact regular, single-link, bounded lock with exclusive
read/delete access. Another recovery, writer, rename or new lock acquisition
cannot replace that held object. SHA256 binds the bytes to the operator's
approval. Valid Core identity, record start time, native creation time and
native write time must all establish a preboot lock. A complete fresh native
process inventory must contain zero canonical Core processes, and the recorded
PID must be absent even if it has been reused for an unrelated process.

The original bytes are fsynced into a create-only digest-named sibling archive.
Source, boot and process evidence are checked again while the same lock handle
remains held. Deletion uses Windows file disposition on that handle; it never
reopens/unlinks a path after closing the observation handle. Disposal commits
deletion of that original object only.

Only the actual successful child process exit allows the limited parent to
request the existing canonical Core start. A writable JSON report cannot grant
that continuation. Core's unchanged `wx` acquisition still arbitrates competing
starts. The parent requires a fresh, non-future heartbeat matching its actual
started PID, exact lock and expected source. Timeout, changed source or a dead
child is blocked/uncertain, with no kill, replay, second start or further lock
mutation. Heartbeat success is not builder pickup or overall runtime health.

## Scope and remaining acceptance

This action assumes the operator launches reviewed installed source; it is not
a commissioned protected signing service or a defence against a malicious
administrator. It creates no standing unattended recovery authority. A crash
after retirement can leave Core stopped; that is an explicit uncertain result,
not permission to remove a later lock or blindly repeat the old digest.

Native fixtures exercise the real handle operations on disposable files:
exclusive contention, denied write/rename, exact archive, digest mismatch,
hidden/live/reused processes, source and boot changes, same-boot records,
second-observation races, archive failure, hard links, junction ancestors and
survival of a subsequent owner's file. Heartbeat fixtures reject stale,
future, wrong-PID, wrong-source and malformed observations. The entry refuses
missing approval before touching native state.

After protected deployment, record the exact approved digest, terminal action
result and independently observed current Core heartbeat. Then use existing
fleet admission and require real same-worker source pickup/build receipts.
The dashboard specialized-status registry repair is a separate prerequisite;
neither repair grants source ownership or bypasses mission acceptance.
