# Rescue Island native custody building block

Owner: #3109 â€” Rescue Island 01: authenticated one-shot intake and first physical source pickup (#3103)

`PinnedFileSnapshot` opens a bounded existing local file, retains no-follow
Windows handles to the file and each ancestor, denies delete sharing, rejects
reparse points and multiple hardlinks, and checks the final handle paths and
volume. File bytes are copied privately and matched against the supplied exact
SHA-256 before any snapshot is returned. `Read` copies only those verified
private bytes. It never reopens the pathname, exports a handle or mutable
buffer, executes a binary, writes a source path, changes an ACL or acquires a
canonical/Seed/Island claim. Disposal and failed acquisition release handles.

The expected digest is a caller expectation, **not authenticated authority**.
Directory writes remain shared. Existing writable mappings, new aliases,
same-principal process tampering, complete executable dependency closure and
the integrity of the host's own installation are not excluded by this library.
In particular, file sharing denial is not asserted to make the on-disk file
immutable. Private snapshot bytes prevent a mapping from changing a later
snapshot read, and a mapping already preventing open safely denies admission.

This supplies one concrete part of the missing Island host. It is not that
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
junction, invalid path, digest/size and disposal probes under the invoking
principal. No tests provision accounts, change permissions, install services,
read production custody state or touch the R7 lease. A sandbox that denies
ancestor handle opens cannot establish this OS behavior; do not label that
test failure as a pass or silently skip it.

API basis: Microsoft's
[CreateFile sharing and reparse semantics](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)
and [memory-mapped file behavior](https://learn.microsoft.com/en-us/windows/win32/memory/file-mapping).
