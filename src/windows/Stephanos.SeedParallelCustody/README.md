# Seed Forge native inventory custody components

Owner: #3096; foundation merged through PR #3097. This unadopted class library supplies bounded
input-snapshot and new-file lifetime components. It is not a worker, scheduler, executable installer,
source-owner grant, signing authority or host admission.

`PinnedNewFile.Create` copies at most 128 KiB of nonempty input, checks the exact
SHA256 expectation, and retains no-delete-shared handles from the local drive
root through every existing parent. Each child is opened relative to its
already retained parent using `NtCreateFile` and `OBJ_DONT_REPARSE`, rather than
reopening a checked absolute path. Reparse points, path aliases, wrong volumes,
unsupported names and absent parents fail closed. The final regular file is
created atomically with `FILE_CREATE` and no sharing; an existing name can never
be overwritten. Writes, flush and digest readback use that same private handle.
The returned object retains all handles until disposal and exports none of them.

`PinnedNewFile.Prepare` exposes the same operation in two phases. It freezes
the path, proposal bytes and digest and retains all existing parent handles,
without creating the output. Its parameterless `Create` then permits one
atomic create attempt through the same parent handle. The parent identities
and reparse state are checked again before creation. Creation failure disposes
the retained handles and is terminal; removing a conflicting leaf does not
make that prepared object reusable. The original static `Create` API composes
these phases and retains its existing immediate-create behaviour.

`SeedInventoryCustodySession.Acquire` composes a prepared output with exactly
two private input snapshots: the proposed manifest and canonical seed contract.
Each input is bounded to 1 MiB. Case-folded normalized input/input and
input/output path collisions are rejected before opening handles. Failure to
acquire either input releases the entire session without creating an output.
The output ancestry remains held even when it is separate from every input
parent. The session returns only copies of cached verified input bytes; a
pre-existing writable mapping cannot change those private snapshots. An
existing writer that prevents safe acquisition produces a hold instead.

Parameterless `CreateOutput` uses the proposal captured at acquisition. It does
not reopen source paths or accept replacement output bytes. Input and output
handles remain private until session disposal. Create, read, verify and dispose
are serialized; failed creation closes the session, and duplicate creation is
refused. The input digests and proposed bytes are caller expectations. This
component does not parse or authenticate the manifest, prove the output was
derived from it, or supply the complete execution dependency closure.

The input component is the existing `PinnedFileSnapshot` from the
`Stephanos.RescueIslandCustody` assembly at the same source tree. That assembly
also contains native output components; this session calls only its stateless
snapshot API. It never calls an Island host, worker, claim or ownership adapter.
No live state or authority is shared between Island and Seed. The Seed native
CI path filter includes the dependency's whole source directory, so changes to
that assembly also rerun these Seed component tests.

This scope intentionally excludes replacement of existing files and creation
of parent directories. Failed I/O may leave a partial new artifact for the
existing owner to reconcile. It does not delete by pathname or assert rollback.
Disposal releases the handles, preserves the file, and makes further `Verify`
calls fail. Parent-directory writes are still shared; sibling files are not
contained. A same-principal process capable of tampering with the host or
duplicating its handles is not excluded by this library.

The digest is a caller expectation, not authenticated source ownership. All
authority properties remain false. The production worker still refuses
`SEED_TARGET_WRITE_CUSTODY_UNIMPLEMENTED` before claims/worktrees/inference or
writes. Do not flip the capability constant or use this component as a receipt
for the complete operation. The independently protected executable/import,
Git/index/object, test, claim/receipt and target estate; original-principal and
alias/mapping exclusion; authenticated cross-system ownership; and revocable
gaming/model budget still need implementation and independent qualification.

The separate test executable creates only a disposable fixture beneath its
working directory. It exercises actual Windows exclusive write/delete/rename
denial, ancestor retention, concurrent replacement attempts, exact readback,
existing-file refusal, disposal, size/path/digest negatives and a real directory
junction. The junction is created by one fixed Windows PowerShell test command,
with fixture paths passed through its private environment. No privileged
symlink permission, account, ACL, service, signer or production state is used.
Sandbox ancestor-open denial is not a passed Windows proof.

The inventory-session suite additionally exercises distinct input and output
parents retained before creation, immutable caller/input buffers, failed later
input cleanup, a raced leaf preserved unchanged, terminal failed creation,
case-folded collisions, input size bounds, pre-existing writable handles and
mappings, concurrent creation, and create/dispose serialization. These are
hosted Windows component scenarios, not proof of Battle Bridge pickup or
commissioning. A source edit or successful compilation alone is not a native
test result.

```
dotnet run --project src/windows/Stephanos.SeedParallelCustody.Tests --configuration Release
```

Native API basis: Microsoft Windows `NtCreateFile` root-directory-relative
object attributes and create disposition, `CreateFile` sharing semantics,
`GetFileInformationByHandle` and `GetFinalPathNameByHandle`. Full writer custody
remains the acceptance contract in `docs/architecture/seed-parallel-target-write-custody.md`.
