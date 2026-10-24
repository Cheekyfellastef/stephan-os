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
compatibility entry point does not parse or authenticate the manifest, prove
the output was derived from it, or supply the complete execution dependency
closure. Its callers and original byte/digest contract remain supported.

## Fixed canonical inventory derivation

`SeedInventoryCustodySession.AcquireCanonicalInventory` completes one fixed
data-to-output operation. It accepts the manifest and closed canonical projection
input descriptors, an exact configured workspace root, the expected relative
target, the expected protected base SHA, and the expected projection Git blob
identity. It accepts no caller output bytes, output digest, renderer callback or
executable. An internal parent-only preparation retains the target ancestry
before either input is read. The factory then reads only the two private
snapshots, validates their closed schemas and bindings, renders
`CANONICAL_INVENTORY_V1` in process, and binds one private output payload. The
same retained parents and input snapshots remain alive through `CreateOutput`,
same-handle verification and disposal. The internal preparation cannot create
an unbound output; a create attempt before binding is terminal.

The manifest's SHA256, base and target must come from the existing exact owner
approval boundary. The expected projection blob must be resolved from that same
independently qualified protected base and source estate. This library checks
those expectations; it cannot authenticate their caller or establish provenance
from a caller-supplied hash. The Git blob identity includes the actual UTF-8 byte
length and is not a signature. `OutputDerivedFromPinnedInputs` describes only
the fixed transformation. All ownership, whole-operation, lease-release and
commissioning properties remain false.

The closed file `shared/project/seedCanopyCanonicalInventoryV1.json` is derived
from the existing `HIGH_LEVEL_FLYWHEEL_SEEDS_V1` contracts. It is not a second
canonical seed registry. Its versioned rows contain only `seedId`, `title`,
`issue`, `source` and the renderer's selected `firstRung`, in canonical order.
No containing commit SHA, timestamp or self-authentication field is embedded.
The source parity test regenerates all bytes from the real canonical import
closure; the checked-in reference vectors are generated with the existing
JavaScript renderer. The native workflow runs that parity test before the
Windows suite and triggers for `shared/**`, including transitive agents imports.
The reference data lives at
`shared/project/fixtures/seedCanopyCanonicalInventoryV1.vectors.json`.

The fixed parser deliberately accepts a strict subset of the broad JavaScript
request profile: known properties only, no duplicates or type coercion, strict
UTF-8 and paired Unicode escapes, depth at most eight, a manifest at most 16 KiB,
a projection at most 1 MiB, and one to 64 unique canonical rows. Strings and
paths have explicit bounds. Optional authority flags must be absent or JSON
`false`; null, strings and numbers are refused. Generation mode, owner, contract,
base and target must match. Only a new approved architecture document with
`expectedTargetSha256: null` is supported; test paths are validated data and
are never executed. Unknown overrides, padded identifiers/paths and NUL text
are refused. Valid rendering preserves ECMAScript trim (including U+FEFF and
excluding U+0085), UTF-16 length, one-for-one scalar sanitization, BOM-free UTF-8,
LF and the final newline. The sixteen reference cases cover all nine canonical
seeds and the relevant whitespace, escaping and 2400-unit Unicode boundaries.

When canonical contracts change, regenerate the derived data through
`serializeSeedCanopyCanonicalInventoryV1(HIGH_LEVEL_FLYWHEEL_SEEDS_V1)` and
`serializeSeedCanopyInventoryGoldenVectorsV1(HIGH_LEVEL_FLYWHEEL_SEEDS_V1)` from
their modules, writing UTF-8 only to the two fixed JSON paths. Do not hand-edit
the data or expected outputs to make parity pass. Regeneration and parity are
source checks, not a production Node invocation or runtime admission.

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

Input digests are caller expectations, not authenticated source ownership. All
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

The fixed-derivation suite reports twelve scenarios separately from its sixteen
golden output cases. It exercises strict parsing and authority/path negatives,
canonical drift and duplicate identities, exact base/target/blob bindings,
immutable retained inputs and parents, raced leaves, disposal, and one-shot
payload binding. Existing new-file assertions and compatibility-session
scenarios remain separate counters. A passing fixture does not authenticate an
owner, run the declared tests, protect the executable/Git/claim/receipt estate,
contain a principal or prove a live Seed build.

```
node --test-reporter=tap shared/project/seedCanopyCanonicalInventoryV1.test.mjs
dotnet run --project src/windows/Stephanos.SeedParallelCustody.Tests --configuration Release
```

Native API basis: Microsoft Windows `NtCreateFile` root-directory-relative
object attributes and create disposition, `CreateFile` sharing semantics,
`GetFileInformationByHandle` and `GetFinalPathNameByHandle`. Full writer custody
remains the acceptance contract in `docs/architecture/seed-parallel-target-write-custody.md`.
