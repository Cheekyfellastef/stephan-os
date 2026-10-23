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
