# Maintenance custody recovery through the existing guardian

The 25 October continuous-repair timeout cannot acquire retroactive Job custody.
A current process list, parent exit, PID reuse, elapsed time or restarting
Commander cannot establish that its descendants ended. The original cycle and
R7 authority remain distinct. The requested result is an admitted maintenance
owner and the existing `repair-ui-4173` action producing live exact-head proof.

## Structural decision

Persist an authenticated ACTIVE reservation **before** either guardian or manual
maintenance launches work. All HTTP sessions and restarted Commander processes
consult the same guardian state, anchored in the existing OS-owned Windows
PowerShell event log. The Shared Workspace JSON is a replaceable projection.
The native kernel compare-and-append admits only one owner; boot-scoped workspace
fences are conservative diagnostics. Unknown execution, process
death, persistence failure, absent OS evidence and malformed authority retain
admission. Known terminal completion publishes an OS-anchored IDLE certificate;
file absence never means idle.

Specialist review reproduced rollback of an older signed IDLE projection over a
new ACTIVE record. HMAC alone is authenticity, not freshness. The correction
moves the full authenticated state into the existing OS append log, not another
writable counter. A caller without the credential cannot forge an anchor. Each
anchor MAC binds the actual OS EventRecordId as well as workspace scope,
transition nonce and full state. Re-appending a valid old message acquires a new
record ID and is rejected. Reads consider the newest matching event, never skip
invalid new evidence to recover an older green record. A missing/rotated/cleared
anchor holds; the JSON projection cannot substitute for it. The original ACTIVE
record remains recoverable from the OS anchor even after projection rollback.

The fixed adapter reuses the pre-existing PowerShell source and Windows
PowerShell channel, verifies its ACL grants clear/owner/DACL control only to
privileged OS groups, and changes no source, channel, permission, service or
scheduler configuration. Windows enforces append/read versus clear rights.
Append is acknowledged only after readback of the exact newly assigned record;
concurrent record-ID races are bounded and otherwise hold before child launch.
State and audit authentication reuse the existing private Commander bearer-key
trust domain with separate MAC domains, not a new signer or credential. No claim
is made against an actor controlling that credential, OS administration or the
installed executor. Key changes and unavailable audit capacity fail closed.
The existing terminal-admission predicate remains binding;
no caller flag, child receipt or successful direct-child kill overrides it.

The existing unjournaled incident must be prepared while its original live HTTP
owner still reports the exact cycle hold. Preparation binds that health record,
the matching canonical repair report's bytes/digest, and a fresh local Windows
boot observation. Preparation only adds a fence; it cannot discharge one.

Recovery is a fixed, authenticated operation on the same guardian, not another
maintenance executor or scheduler. It admits only a separately operator-approved
exact reservation digest after a fresh local Windows observation proves the
same machine has completed a full boot **later than the preparation observation**.
Caller-supplied boot evidence is never accepted. A same-boot service reload,
unknown boot, different machine, altered reservation and concurrent recovery
all fail closed. The same native transition primitive serializes recovery against
all new reservations. The full original record and new boot proof are durably
archived before the state can become IDLE. Recovery reports prospective
termination across the boot boundary, never historical successful completion.

The boot observer executes only its fixed source-controlled read-only Windows
probe. The probe reads OS boot time and MachineGuid (hashed before output). It
does not control processes, services, scheduled tasks or leases. Windows Restart
requires separate operator approval; this source introduces no PC restart verb.
Both preparation and recovery bind canonical installed main; the HTTP owner
also pins the source it loaded, so source advancement requires deliberate owner
activation. The missing-state first-install posture is HOLD: this bounded
migration only seeds ACTIVE state from the matching original held incident,
never an invented idle certificate. Source review, exact-head merge, installation
and a real changed-boot witness are
required before live recovery. No patch may be loaded into the held process.

## Scope and acceptance

### Structural ownership review after the two authority findings

The rollback and replaceable-fence findings share a root cause: workspace
artifacts were treated as authority for freshness or exclusion. Stop adding
caller-side guards. Every state transition must instead compare its expected
previous OS anchor and append the successor inside one native critical section.

The fixed audit adapter creates/opens one key-derived Global Windows kernel
mutex, shared across interactive and S4U sessions. Creation applies a protected
ACL for the canonical user and SYSTEM; existing object owner/ACL are verified.
The Global namespace is OS-managed, not a workspace directory. Windows requires
privileged global symbolic-link creation, and an open mutex cannot be replaced
by deleting a workspace file. Wrong object type, unexpected ACL/owner, wait
timeout or native failure holds. A mutex becoming abandoned is never child
exclusion: the persisted ACTIVE OS anchor still holds the original request.

The mutex covers only compare-and-append, not the child lifetime. Before append,
the native adapter re-reads the newest scoped OS anchor while holding the mutex
and requires its EventRecordId to equal the caller's authenticated expected
previous identity (including the explicit no-previous bootstrap). It retains
the mutex through bounded append and exact readback. A second contender reading
the same IDLE identity must lose the compare, even if its workspace fence and
projection were replaced. Terminal IDLE and successor-boot recovery use the
same transition primitive; they cannot overwrite a foreign reservation.

The linearization point is the independently read-back OS append under that
kernel mutex. Source-model and real Windows concurrent-adapter tests must cover
two stale readers, deleted/replaced workspace state, stale terminal release and
recovery races. Existing file fences remain conservative crash diagnostics, not
the proof of exclusive ownership. This adds no executor, scheduler or signer.

Primary OS contracts: [kernel namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces)
and [mutex security](https://learn.microsoft.com/en-us/dotnet/api/system.threading.mutex.-ctor?view=netframework-4.8).

This restores maintenance admission following proven process extinction; it does
not release R7 source ownership, cancel durable scheduled jobs, enroll the native
directory worker, or qualify unattended builder mutation. Those retain their
existing gates. Existing manual `repair-ui-4173` remains registered and must be
executed and verified after recovery. A green source test or disabled repair is
not completion of the operator request.

Adversarial acceptance includes two owners, crash/restart, unknown terminal
execution, corrupt state, same-boot recovery, foreign machine, stale/forged
witness, changed digest, failed audit persistence and recovery/acquisition races.
Physical acceptance must preserve the original incident, prove the new Windows
boot and guardian identity, perform the existing UI repair, and obtain served
head plus browser proof. The durable lesson is: retaining custody needs a
persistent owner record and an explicit evidence-bearing recovery transition.
