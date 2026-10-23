# R7 retained-object mutation core

This is an x64 Windows NTFS minifilter **component**, built against real WDK
headers and kernel import libraries. It supplies Filter Manager contexts and
pre-operation callbacks, with retained native handles and rundown ownership.
There is no enclosing production filter, enrollment channel, installer,
commissioning producer or signer. Nothing here can release a lease.

## Implemented operation boundary

The trusted kernel owner enrolls an actual kernel read handle. The core keeps
its own duplicate until explicit retirement; a FILE_OBJECT reference alone
would allow last-handle CLEANUP to invalidate a retained sharing guard. Actual
grants are queried with `ZwQueryObject(ObjectBasicInformation)`: read data is
required and data/EA/attribute/delete/security mutation grants are rejected.
Only NTFS, non-reparse, non-delete-pending objects with one hardlink are admitted.
The instance and file must resolve to the same referenced native volume.

A file context protects metadata; stream contexts protect each enrolled stream.
Each stream must match the file's native volume/file ID and exact file context.
Callbacks look up contexts and nonpaged policy only. They perform no name or
file-information query, allocation, process census or user-mode round trip.

| Enrolled-object operation | Policy |
| --- | --- |
| Ordinary cached/noncached write | Deny; Fast I/O redirects to the IRP gate |
| New MDL-write preparation, including WRITE/IRP_MN_MDL | Deny, including during preparation |
| Already-issued MDL completion | Allow cleanup and latch an irreversible fault; never treat drain as a protected mutation success |
| Paging write | Allow during preparation for old dirty-page drain; deny after the one-way policy switch |
| Security/EA change | Deny regardless of the caller's previously granted rights |
| Set-information | Allow handle-position updates only; deny other/unknown classes |
| Filesystem controls | Allow enumerated reads and the retained object's oplock protocol; deny other/unknown controls |
| Object with no enrolled context | Pass through |

Retirement drains this core's callbacks, removes its contexts and closes its
private handles. It does not drain operations already below the filter, revoke
another process's handles or establish that source writers have stopped.

## Native scope and per-object security transaction

`R7GateEnrollChild` opens one existing immediate child relative to the parent's
private retained kernel directory handle. Its access/share/disposition/options
are fixed: read-only, share-read, `FILE_OPEN`, no reparse traversal and no share
bypass. It captures and bounds a single leaf, rejects traversal/stream selectors,
and checks the actual native identity against the expected native enumeration
identity before installing contexts. The open is asynchronous so its retained
object can participate in the Read-oplock protocol. A file's unnamed stream is
enrolled before publication; partial acquisition retires the unpublished gate.
The child retains its parent; parent retirement refuses while children remain.
This binds acquisition, not a stable enumeration snapshot.

Directories can contain writable named data streams. Their directory-main
sharing guard does not exclude a writer to such a stream. `R7GateEnrollStream`
therefore accepts named data-stream objects on a directory when they report a
non-directory stream and match the actual native ID and exact file context.
The owned Windows regression demonstrates this distinction and a separate
stream guard refusing an existing writer. Every directory ADS still needs
explicit native enumeration and retained protection by the enclosing owner.

`R7GateSealSourceDacl` implements a fixed native owner/DACL transaction on one
already retained object. It requires a separate real commissioner metadata
handle with `READ_CONTROL | WRITE_DAC | WRITE_OWNER`, duplicates that capability
and verifies its actual file context and native identity. Read guards acquire
no metadata-write grant. The commissioner must also possess the actual Windows
authority to assign the new owner and, if needed, restore the previous owner;
`WRITE_OWNER` alone does not promise arbitrary owner assignment will succeed.

The helper captures the original owner/DACL, adds explicit per-object full-access
denials for the configured source SIDs ahead of the original ACEs, assigns the
distinct custodian and protects the DACL. It reads the native owner, ordered used
ACEs, protection bit and identity back. ACL free padding is excluded from policy
comparison. No new inherited denial is used as a substitute for enrolling an
existing child. This policy is a conditional native proposal, not adoption of
the older diagnostic's inherited-ACE policy shape.

Recovery ownership is attached to the gate before the first security-set call.
After an attempted set, failed mutation/readback retains the original descriptor,
metadata handle and guards, and retirement refuses. Explicit recovery restores
and verifies the original policy before releasing that state. Beginning recovery
permanently prevents re-arming this gate's paging policy. Recovery is never an
automatic response to a fault or permission to make an old writer writable
after release. Stop issuance and satisfy the separately admitted retirement
policy first. The native snapshot is currently memory-only: the production
commissioner must durably journal the exact recovery material in its protected
store **before invoking a mutation**. This helper supplies no crash-durable log.

These are real kernel operations in source, not an installed commissioning
entry point. The source-SID set, custodian, commissioner capability and target
scope must come from independently authenticated adopted host configuration.
No argument here authenticates an estate or grants that authority. Never seal
shared ancestors/control objects if the denial would affect unrelated work.

For a proven non-bypass source estate, NTFS parent/stream access checks offer a
concrete namespace-denial route alongside metadata callbacks and retained
guards. It avoids claiming universal pre-create path classification. Production
qualification must cover old DELETE_CHILD/metadata handles, low-access creates,
file and directory ADS, outside ordinary/POSIX replacements, aliases, pending
TxF work, old sections/MDLs and queued I/O. Disabled privileges or an unelevated
token alone cannot prove the non-bypass estate. None of this establishes that
Battle Bridge presently meets those requirements.

## Mandatory enclosing-owner obligations

Lifecycle calls are serialized, exactly-once retirement occurs outside callbacks,
and the owner retains its gate while using observations. Handles must originate
from ordinary share-tracked native opens without `IO_IGNORE_SHARE_ACCESS_CHECK`.
Observed FILE_OBJECT flags cannot authenticate that provenance. The retained
oplock object's request lifecycle is exclusively controlled by the owner;
pointer equality alone does not validate oplock request flags or continuity.

Before denying paging writes or creating a usable seed, the enclosing system
must close destructive CREATE, new stream/child, open-by-ID, rename/link
destination and ancestor replacement/reparse routes. It must enroll every
required stream and control object; exclude old writable handles, views, MDLs
and other bypass capabilities; then perform actual native flush and quiescence.
File contexts cannot make a pre-create namespace admission decision. Post-create
cancellation is too late to claim destructive CREATE prevention.

The MDL-drain latch is an observation, not readiness: FALSE proves no absence.
An unexpected completion invalidates any enclosing custody session. A future
issuer must synchronize continuous revocation with callbacks and instance
teardown; polling this observation cannot authorize signing. Instance references
do not prevent detach from removing contexts. Teardown must revoke issuance
before protection disappears, and unloading must obey the mandatory filter's
independently reviewed lifecycle contract.

This component does not exclude privileged debug, raw-volume, kernel-load,
token or re-entry capabilities and does not protect creator/signer memory. A
complete independently authenticated prospective estate may satisfy enrollment;
historical process identity is not invented. Each of the two independent signing
roles must create its own root only inside an established protected interval.
The existing fixture that sees both seeds cannot become that production producer.
Canonical mission-lock, idle-queue, cancellation and whole-record lease CAS
requirements remain separate from kernel operation denial.

## Development build and evidence

Requirements: existing VS2022 MSVC x64 tools, Windows SDK `10.0.26100.0`, and
the official `Microsoft.Windows.WDK.x64` NuGet archive `10.0.26100.6584`.
Use package material only according to Microsoft's license. Verify its Microsoft
and NuGet signatures with `dotnet nuget verify --all` before extraction. Extract
only `c/Include/10.0.26100.0/km/` and `c/Lib/10.0.26100.0/km/x64/` into a
development directory, preserving archive-relative paths. This needs no WDK
installer and executes no package build tasks. The build checks the entire
archive's pinned SHA512 and compares all 763 selected inputs to it before using
them. Installed compiler and SDK provenance remain host prerequisites.

```powershell
./scripts/windows/build-original-r7-scoped-mutation-gate.ps1 `
  -WdkRoot '<development-directory>' `
  -WdkPackagePath '<Microsoft.Windows.WDK.x64.10.0.26100.6584.nupkg>'
```

The build uses `/kernel /TC /std:c17 /W4 /WX /GS /Zl`, targets Windows 10
2004 or later, builds the static core, links its kernel imports, and executes
portable policy-property tests. `build/development-build.json` records source,
script and artifact SHA256 hashes plus tool versions and package binding.
`KernelLinkProbe.sys` exists solely to check linking: its entry point always
returns `STATUS_NOT_SUPPORTED`. **Never install or load that probe.** Neither
the library nor that probe is a commissioned driver.

The policy test enumerates operation, minor, state and information-class values.
Its checks distinguish new MDL capability issuance from cleanup and verify
unrelated objects pass. It does not execute Filter Manager callbacks, native
handle enrollment, context races or enforcement on NTFS. Development build
success is not physical custody proof.

## Required native qualification before any Battle Bridge commissioning

Use an isolated disposable Windows NTFS test machine and a separately reviewed
enclosing filter with genuine driver-signing/admission prerequisites. Prove old
file objects and ADS share the intended contexts; old WRITE_DAC grants cannot
alter enrolled metadata; new MDL preparations are refused; old completions drain
and revoke issuance; paging transitions do not strand dirty pages; and retained
duplicates survive closure of the caller's handles. Exercise partial enrollment,
allocation failure, retirement/callback races, detach, teardown and oplock
breaks under Driver Verifier. Confirm unrelated work continues throughout.

Then qualify the complete namespace closure, old-capability closure, authentic
source privilege estate, creator-memory isolation, protected audit and independent
signers together. No test signing, reboot, driver load or host policy change on
Battle Bridge is authorized by this source or its development build.

## Primary API references

- [ObReferenceObjectByHandle](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/wdm/nf-wdm-obreferenceobjectbyhandle)
- [ZwQueryObject](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwqueryobject)
- [Managing contexts](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/managing-contexts)
- [MDL preparation](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/flt-parameters-for-irp-mj-prepare-mdl-write)
- [MDL completion](https://learn.microsoft.com/en-us/windows-hardware/drivers/ifs/flt-parameters-for-irp-mj-mdl-write-complete)
- [Pinned WDK package](https://www.nuget.org/packages/Microsoft.Windows.WDK.x64/10.0.26100.6584)
- [Native relative opens](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltcreatefileex2)
- [Security query](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltquerysecurityobject)
- [Security set](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/fltkernel/nf-fltkernel-fltsetsecurityobject)
- [NTFS stream semantics](https://learn.microsoft.com/en-us/windows/win32/fileio/file-streams)
