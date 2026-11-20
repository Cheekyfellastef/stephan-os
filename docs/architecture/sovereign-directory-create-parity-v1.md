# Private folder creation parity (#2573 / existing PR #3169)

The existing folder-creation candidate now creates one explicitly requested new
directory through Sovereign Commander's private MCP surface. It remains a source
candidate until exact-head review, protected merge, installed-host refresh and
physical acceptance are proven. This change adds no cloud arbitrary-file route,
scheduler, source lease, process-control gateway or R7 recovery authority.

## Contract

`create_directory` accepts exactly one own data property, `path`, with a literal
local Windows drive path. It rejects whitespace normalization, traversal, device
and network prefixes, alternate streams, DOS device names, recursive creation
and all extra properties before the command fabric. Trusted local stdio and
authenticated private HTTP retain their existing transport boundaries.

The source-bound adapter verifies the committed SHA-256 identities of its fixed
PowerShell runner and C# implementation, captures both buffers, and executes only
those captured bytes. Later helper replacement cannot change the launched code.
The runner also verifies the native buffer. Their LF byte format is pinned by
Git attributes. There is no caller-selected command, script or executable.

The Windows operation opens the drive root and checks the opened object's Volume
GUID as a fixed local volume. It holds every ancestor using real read access,
read-only sharing and no-reparse opens, then creates the single leaf relative to
the held parent handle. Native `FILE_CREATE` refuses existing targets. Success
requires `FILE_CREATED`, a real directory handle and volume/file identities;
ancestor and leaf handles stay open until receipt capture. No path is re-resolved
for the final create. Unicode path input/output uses strict UTF-8.

The operation is create-only and nonrecursive. Failure preserves existing files
and folders. A missing or contradictory terminal result remains `UNKNOWN`; it is
not proof that creation did not occur and must not prompt a blind fresh retry.
Observe the exact target before another attempt. No automatic deletion/rollback
is exposed. If rollback is requested, remove only the exact newly created empty
directory through separately authorized existing file tooling, after proving its
identity and absence of unrelated content.

These local handle checks protect this operation's path resolution. They are
not a security sandbox against a hostile privileged writer, an independent OS
signer, or proof that an original maintenance/source lease can be released.

## Source and runtime acceptance

Cross-platform tests cover literal path admission, strict MCP arguments,
source-byte replacement, captured execution, Unicode preservation in the
adapter, malformed receipts and unknown process outcomes. Windows fixtures run
the actual native calls against temporary directories: Unicode creation,
collision/no-overwrite, missing parent, file collision, junction refusal,
ancestor rename denial, write-handle denial, pre-existing writer refusal and
one-use operation identity. These fixtures run in the existing parity Windows
job. They are source tests, not Battle Bridge installation evidence.

After protected integration, the existing owner must verify loaded source/tool
identity and `tools/list`, invoke the tool against an explicitly authorized
temporary directory, read back its identity and negative boundary results, then
retain the terminal receipt and proof hash. Do not publish the private path or
contents in a public mailbox. Private host activation remains separate from
cloud/mobile transport availability.

## Reusable invariant

Validate the original requested target before any normalizing command fabric.
Bind helper execution to captured reviewed bytes, and perform the final create
relative to an OS-held parent. A source mapping is a partial-capability hint until
its scope matches the requested operation and the installed result is proven.

Native API references: Microsoft's [NtCreateFile contract](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile),
[GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew)
and [GetDriveTypeW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getdrivetypew).
