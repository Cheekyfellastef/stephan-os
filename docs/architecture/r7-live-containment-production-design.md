# R7 production containment while Battle Bridge remains usable

Status: design review required. A retained-object kernel mutation core now exists
in source; the complete production containment implementation is still absent.
This record and its owned native regressions grant no custody,
key access, installation, cancellation, source-fence or lease-release authority.

Owner: #3123 — Goal #2961 child: commission protected Windows r7 custody
witness and independent signer. Parent: #2961 — Goal: Core Daemon Blocked-Goal
Repair Steward and Proof-Gated Re-Admission.

## Operator constraint and exact historical subject

Battle Bridge must remain fully usable. Do not propose an automatic reboot,
account-wide denial, broad service pause, termination of unknown processes or
freezing unrelated worktrees as the implementation of this requirement.

The original mission, lease revision, source and consumed-result identities
remain bound to their existing private canonical records. Those identifiers,
the original worktree's absolute path and machine principal details stay in
private host evidence. Never rename the authentic consumed result to match a
later repair revision. Historical execution outcome remains UNKNOWN.

The merged host still unconditionally refuses
`WINDOWS_WITNESS_PHYSICAL_CONTAINMENT_UNCOMMISSIONED`. Its bounded observation,
crypto and proposal components are useful source preparation; their fixed-false
custody fields must not be flipped to manufacture a production producer.

## Actual in-place kernel experiment

`Stephanos.OriginalR7LiveFence.Tests` operates on newly created owned NTFS
fixtures only. It opens a read handle with no write/delete sharing and requests
a real asynchronous Read oplock. It retains pending I/O storage until actual
cancellation completion, without acknowledging a break as a custody claim.

The following are observed counterexamples and controls, not source exclusion:

| Scenario | Native result required by the fixture |
| --- | --- |
| Existing ordinary stream, retained guard | New data-write open fails with sharing violation; Read oplock is granted |
| New WRITE_DAC open | Metadata-write handle can still open despite the guard |
| Writable mapped view after original file and section handles close | View remains writable; guard or oplock acquisition refuses it |
| Same file after the owned writable view is unmapped | Read guard and oplock are granted |
| Existing writable file handle | New restrictive guard fails with sharing violation |
| New named alternate data stream | Stream creation succeeds while the unnamed-stream oplock remains pending |
| New child under a directory Read oplock | Child creation succeeds; oplock notification is advisory |

These results rule out replacing the production startup refusal with a loop
over ordinary read handles or Read oplocks. The native fixture never opens the
real original worktree, impersonates an original actor, changes a production
DACL, closes another process's handles, creates keys or releases a lease.
The fixture uses no package dependency. The existing read-only native Windows
workflow executes it alongside the original owned regressions.

## Production transaction that still needs a qualified implementation

The [retained-object mutation core](../../src/windows/Stephanos.OriginalR7ScopedMutationGate/README.md)
implements actual Filter Manager operation callbacks and native handle/context
ownership, native relative child acquisition, directory data-stream enrollment
and a bounded per-object owner/DACL sealing/recovery primitive. Its portable
policy tests and kernel compilation/link check do not
establish NTFS runtime enforcement. Namespace closure, existing capability
closure, privileged source-role separation and independently protected creators
remain required components. The existing production startup refusal remains.

A concrete conditional route now delegates fresh namespace authorization to
NTFS DACL enforcement, with retained ordinary share guards and kernel metadata
operation denial. It requires independently authenticated non-bypass source
capabilities, complete stream/old-capability closure, native quiescence and a
protected durable commissioning journal. It is not a universal normalized-name
filter and does not pass unresolved name requests as physical exclusion.
The owned regression now covers directory ADS: their writer can coexist with
the directory-main guard, but conflicts with a separate stream read guard.
The native component and all unresolved production prerequisites are described
in its linked README. No production entry or authority is enabled.

An independent Windows/security design review must identify a concrete live
enforcement mechanism for **all** of the following together. A partial
mechanism is insufficient to enter seed creation or issue a witness.

1. Derive the exact original worktree and its control scope from the retained
   canonical mission/lease and consumed event. Resolve worktree `.git` indirection
   and shared-control dependencies without treating another worktree as owned.
   No path from an untrusted request selects the protected source estate.
2. Authenticate/adopt the original-principal estate through the existing
   enrollment policy. A current process name, SID match, absent command line or
   zero PID count does not identify historical writers. Unknown actors, tokens,
   privileged bypass, mappings and alternate launch authority remain explicit.
3. Establish and retain kernel-enforced denial for ordinary data, every named
   stream, new entries, deletion/rename/reparse, hardlink/alias routes, security
   metadata, parent replacement and the source's actual Git control scope.
   Already-granted handles, mapped sections, detached children, impersonating
   threads, duplicated tokens and privileged actors need concrete disposition.
   A rejected lock must abort; no actor may be killed merely to obtain a lock.
4. Deny prospective direct/task/service/WMI/COM re-entry and access to the
   witness, commissioner, loaded code, audit/replay state and signer memory.
   A disabled task flag alone is not a continuous barrier. Privileged source
   actors cannot be declared contained by a DACL they can bypass or replace.
5. Prove source-role/commissioner separation **before usable signing material
   exists**. Use the two independent witness/operator roles and existing protected
   owner/OS ceremony; do not require a circular third pre-existing signing root.
   Preserve partial-failure/recovery evidence. No seed may be created first and
   promoted after later containment.
6. Maintain continuous fence ownership, protected monotonic audit/freshness,
   negative tests under authentic original capabilities, fail-closed revocation
   and exact source/lease bindings through canonical reconciliation. Never replace
   live handle ownership with serialized proof booleans. The signer must consume
   a native retained capability, not caller-written claims.
7. Keep `authenticateLegacyOrphanQuarantine` eligibility-only. The existing
   mission lock, source fence, genuinely idle queues, durable cancellation and
   whole-record lease CAS independently decide release. Real worker pickup,
   source edits/tests and two unattended refills are separate final receipts.

Before privileged execution, prepare exact host changes, fixed target identities,
preserved local-work hashes, failure/rollback behavior and independent specialist
qualification for operator review. No installation recipe is admitted by this
document. If no qualified live mechanism meets the usability constraint, report
that incompatibility; do not silently substitute a maintenance boot.

## Questions the independent design decision must settle

- Can a retained native fence plus a separately protected policy actually cover
  directory/stream/security and original privileged re-entry on this host without
  interrupting its ordinary use? Identify the exact OS mechanism and prerequisites.
- If a kernel policy/driver or another privileged component is necessary, specify
  genuine source/signing/installation and unload/recovery requirements. Do not
  assume such a component is installed or invent its qualification.
- Which original capabilities are presently unobservable, and which independently
  authenticated enrollment route can close them without fabricating history?
- What concrete end-to-end native callgraph must replace the current startup
  refusal? Its review must cover creation custody, continuous enforcement,
  independent signing, canonical consumption and fail-closed teardown together.

## Primary Windows references

- [FSCTL_REQUEST_OPLOCK](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_request_oplock):
  directory content-change breaks are advisory and do not block the change.
- [Requesting and granting oplocks](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/granting-oplocks):
  granted asynchronous requests remain pending until broken.
- [Grant conditions](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/granting-oplocks#conditions-for-granting-oplocks):
  writable user-mapped sections prevent the applicable stream oplock grant.
- [Sharing files and memory](https://learn.microsoft.com/en-us/windows/win32/memory/sharing-files-and-memory):
  mapping lifetime must be handled separately from ordinary file handles.
- [File-system privileges](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/privileges):
  restore and other privileges can bypass ordinary discretionary access checks.
