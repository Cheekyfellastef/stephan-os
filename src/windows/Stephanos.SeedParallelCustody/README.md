# Seed Forge native new file custody candidate

Owner: #3096, existing PR #3097. This unadopted class library supplies a bounded
new-file write primitive. It is not a worker, scheduler, executable installer,
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

```
dotnet run --project src/windows/Stephanos.SeedParallelCustody.Tests --configuration Release
```

Native API basis: Microsoft Windows `NtCreateFile` root-directory-relative
object attributes and create disposition, `CreateFile` sharing semantics,
`GetFileInformationByHandle` and `GetFinalPathNameByHandle`. Full writer custody
remains the acceptance contract in `docs/architecture/seed-parallel-target-write-custody.md`.
