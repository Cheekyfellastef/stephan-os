# Rescue Island native custody building block

Owner: #3109 — Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)

`PinnedFileSnapshot` opens a bounded existing local file, retains no-follow
Windows handles to the file and each ancestor, denies delete sharing, rejects
reparse points and multiple hardlinks, and checks the final handle paths and
volume. File bytes are copied privately and matched against the supplied exact
SHA-256 before any snapshot is returned. `Read` copies only those verified
private bytes. It never reopens the pathname, exports a handle or mutable
buffer, executes a binary, writes a source path, changes an ACL or acquires a
canonical/Seed/Island claim. Disposal and failed acquisition release handles.

`PinnedFileCreation` adds the host's create-only output primitive (maximum
8192 bytes). It copies and hashes the expected bytes before any creation,
retains a no-follow handle chain, and uses `NtCreateFile` with one relative
component and the retained parent handle for every descent and final creation.
`FILE_CREATE` never opens/truncates an existing leaf; the new leaf denies all
sharing. Writes, flush and exact length/digest/identity readback use that same
handle. Handles remain held until disposal. Failed creation never deletes by
pathname; a partial file must be held for authenticated isolated-estate recovery.
`Read` returns a copy of the private approved bytes, not a fresh pathname read.

Directory sharing flags did **not** deny a competing directory data-write
handle in the actual Windows probe. They are not original-writer exclusion.
The retained-parent relative-create design is tested with a live in-place
junction conversion: ordinary pathname IO reaches the outside fixture, while
the native primitive rejects or stays within its retained directory object.
The public creator rejects an existing junction before leaf creation.

The expected bytes, path and digest are caller expectations, **not authenticated authority**.
Directory writes remain shared. Existing writable mappings, new aliases,
same-principal process tampering, complete executable dependency closure and
the integrity of the host's own installation are not excluded by this library.
In particular, file sharing denial is not asserted to make the on-disk file
immutable. Private snapshot bytes prevent a mapping from changing a later
snapshot read, and a mapping already preventing open safely denies admission.

These supply concrete parts of the missing Island host. They are not that
host's completed admission path or a commissioned service. Do not remove
`RESCUE_ISLAND_EXECUTION_CUSTODY_UNIMPLEMENTED`, pass a snapshot as writer
exclusion evidence, or convert these tests into physical worker pickup proof.
The principal, complete executable/target/Git/receipt estate, authenticated
atomic cross-system ownership and revocable gaming budget still require the
implementation and independent commissioning described in
`docs/architecture/rescue-island-execution-custody.md`.

Run the standalone test project on Windows:

```
dotnet run --project src/windows/Stephanos.RescueIslandCustody.Tests --configuration Release
```

Tests create only a disposable temporary fixture and perform real ordinary
write/delete/ancestor-rename denial, pre-existing writer/mapping, hardlink,
junction, invalid path, digest/size, disposal, create-only incumbent preservation,
private-buffer isolation, competing/concurrent creation and in-place parent
reparse probes under the invoking
principal. No tests provision accounts, change permissions, install services,
read production custody state or touch the R7 lease. A sandbox that denies
ancestor handle opens cannot establish this OS behavior; do not label that
test failure as a pass or silently skip it.

API basis: Microsoft's
[CreateFile sharing and reparse semantics](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
and [memory-mapped file behavior](https://learn.microsoft.com/en-us/windows/win32/memory/file-mapping).
Relative object creation follows Microsoft's
[NtCreateFile contract](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile)
and [OBJECT_ATTRIBUTES no-reparse/root-directory contract](https://learn.microsoft.com/en-us/windows/win32/api/ntdef/ns-ntdef-_object_attributes).
