# R7 retained capability observation preparation

This private component observes explicitly supplied retained Windows x64
subjects. It does not enumerate the global process/handle/section estate,
authenticate original source identity, establish zero writers, enforce a
continuous fence, sign a witness or authorize lease release. The production
service remains uncommissioned.

The process/token and native target identity readers are the existing R7
adapters. Shared principal identity/mutation digests reuse the canonical
privilege-aware stamp, including actual bounded privilege inventory; there is
no second TOKEN_STATISTICS implementation. The primary-only reader is not
silently broadened to impersonation tokens. Unknown or changed metadata
invalidates continuity, including privilege removal that leaves inconsistent
kernel statistics.

The canonical stamp now also binds the bounded actual group, restricting-SID
and capability-SID inventory digest, with native statistics checked again
after collection. A pure native inventory layer has no callback into the
stamp or high-level observer, avoiding recursion. All three sorted inventories
preserve full attribute bits and duplicate restricting SIDs. Enabled,
disabled and deny-only membership remain distinct. The separate observer
samples twice and uses the same canonical primary identity. Real owned
restricted-token coverage preserves the same group count while observing
different group/restriction metadata. No eligible nonmandatory enabled group
was present for AdjustTokenGroups; that optional case is zero, not a pass.
There is no real populated AppContainer capability-token positive case, and
the primary-only helper still rejects impersonation tokens. Native calls have
no hard deadline, and twice-read metadata is not atomic continuous custody.

The observation adapter receives retained process/file handles, expected
PID/creation/SID and at most16 existing handle values and16 view addresses.
DuplicateHandle never uses CLOSE_SOURCE. Actual granted rights and the native
file identity are read through the same duplicate, followed by another
duplicate and kernel object comparison. Mapping observations use
VirtualQueryEx/GetMappedFileName without reading process pages. A retained
writable view can survive closure of both its original file and section
handles; real owned fixtures exercise that case and an actual mapped write.
WRITECOPY and read-only views are distinct. PAGE_GUARD is a one-shot alarm;
a guarded READWRITE mapping retains its underlying shared-write capability.
The owned native regression verifies that observation leaves the guard intact
and that explicitly removing the guard on the owned mapping permits a real
shared-file write. The observer never touches subject pages.
A mapped name is not a kernel
backing-file ID: that binding remains explicitly unresolved.

The separate retained-region discovery adapter uses supported Windows Process
Snapshotting with exactly PSS_CAPTURE_VA_SPACE (0x800). It walks region metadata
without a caller-supplied address list, page contents, VA cloning, thread
contexts, object names or section-file-name capture. It binds one retained
native x64 process and its primary token before and after, caps the walk at
16384 rows and two cooperative seconds, and requires successful marker/snapshot
cleanup. Exact PID/creation/SID mismatches yield no rows. Reaching the end of
this one point-in-time region walk does not authenticate backing-file IDs,
handle tables, other processes, detached/re-entry capabilities or continuity.

The initial combined PSS handle/region experiment faulted inside native
PssCaptureSnapshot. Fresh isolated owned-process probes reproduced an access
violation for HANDLES (0x4) and HANDLES/basic/VA_SPACE (0x814), while NONE and
VA_SPACE-only exited normally. This is an observed host qualification failure,
not a claim that the documented API is universally unavailable. The failed
experiment and logs remain separate. The working adapter never requests handle
capture and explicitly reports HandleTableObserved=false. It cannot replace
the missing complete handle-table producer with an empty inventory.

A separate private handle-metadata discovery adapter uses dynamically loaded
NtQueryInformationProcess class51 with a fixed capped x64 buffer. The layout
is sourced from pinned primary phnt commit
53fbbdc5b5d2b08761db1c7b26bfa8c820924356, not inferred from handle numbers.
This is an internal, compatibility-sensitive Windows information class,
not a public API stability guarantee or an admitted complete-estate producer.
The observed Windows10 build19045/System32 ntdll SHA256
36b1a62e4bf6bf7d68458fff6e8a33b39f6527ec6a46e55ecdd12cde83894c8d
is test context, not a self-issued host qualification or protected image pin.
Unknown status/layout/count/reserved fields, truncated buffers, duplicates,
wrong subject or budget expiry return no candidate rows. The adapter reads
metadata only and does not duplicate or close source handles or query names.

Real owned fixtures discover writer candidates without supplying their handle
numbers, then pass bounded chunks through the existing native same-object/file-ID
reader. That positive pipeline finds actual data, WRITE_DAC and WRITE_OWNER
capabilities. Snapshot region candidates similarly find the shared and guarded
writable views without supplied addresses, while preserving the unresolved
backing-file ID. Metadata handle values may be closed/reused immediately after
capture; metadata is never joined directly to an authenticated target or
promoted to retained-object continuity. No successful one-process snapshot
establishes whole-estate completeness, continuous custody or zero writers.

The test-only owned-job fixture creates only this test image, suspended, with
an unnamed kill-on-close single-process job and no breakaway, reads the limits
back and assigns before resuming. A normal child and a deliberately stalled
owned child have actual terminal object readback. A timeout remains a timeout
even when job-close termination reports exit code zero. These are isolation
preparation tests, not an admitted production collector or a universal kernel
hang cancellation guarantee. The fixed native API diagnostic modes are never
called by the normal qualification suite or any production entry.

Primary Windows API references:
- https://learn.microsoft.com/en-us/windows/win32/memory/creating-guard-pages
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/ne-processsnapshot-pss_capture_flags
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/ns-processsnapshot-pss_va_space_entry
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-psswalksnapshot
- https://learn.microsoft.com/en-us/windows/win32/api/processsnapshot/nf-processsnapshot-pssfreesnapshot
- https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntqueryinformationprocess
- https://github.com/winsiderss/phnt/blob/53fbbdc5b5d2b08761db1c7b26bfa8c820924356/ntpsapi.h

SAME_ACCESS duplication temporarily confers the source handle's granted write,
WRITE_DAC or WRITE_OWNER capability on the observing process. No mutation is
performed by observation, but this is not a read-only-capability signing host.
A future admitted commissioning executor/protected disposable collector must
isolate this work from the least-privilege witness/operator signing processes,
close every copied capability before handback and prove cleanup. This does not
require a third signing root or account. It is a process/role boundary.

Two-second checkpoints are cooperative. Native/filesystem calls may block;
this library makes no hard cancellation claim. A real protected caller needs
qualified isolation/watchdog and exact owned-object cleanup before admission.
Any inaccessible, unsupported, stale, unbound or budget-exceeding subject is
incomplete. Successful observation is still bounded sample evidence.

The separate fixture project has only a fixed owned-child mode, an isolated
file, bounded protocol and noninteractive error handling. Its cleanup removes
two known fixture leaves and its empty own directory. It is not a production
cleanup/disposition primitive, and does not prove resistance to a hostile
same-principal parent reparse. No production process, ACL, service, key,
credential, controller or lease is changed by these fixtures.

The earlier isolated SDK first-run banner reported development-certificate
installation. Bounded follow-up found no attributable localhost development
certificate; no before-store snapshot exists, so attribution is uncertain.
No trust, private-key read/export or speculative certificate deletion occurred.
All subsequent qualifications disable development-certificate generation.

The process/thread metadata producer `R7ProcessEstateSnapshot` now obtains the
reported kernel table with bounded class-5 queries. It checks the actual own
process/thread birth fields against separate native calls, retains unknown
birth values and accounts for opaque row bytes by count and digest. A pinned
primary header documents the compatibility-sensitive layout. It does not open
foreign subjects or authenticate their retained identities, credentials, reentry
rights or protected-process scope. Reported rows and parent PIDs are discovery
metadata, never complete estate or original lineage proof. Its dedicated owned
fixture checks malformed geometry, native discovery and owned normal exits.

The new seed-creation transaction creates a fresh protected leaf with its DACL
already present, generates material afterward, flushes and verifies the retained
file, and clears owned buffers. Only owned-fixture entry points currently exist;
there is no admitted production key-creation wrapper. Ambiguous cleanup, extra
hard links, crash/orphan recovery and two-root commissioning remain unresolved
operational gates. Neither this transaction nor the census admits a signer.
