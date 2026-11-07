# Private Sovereign capabilities

Owner: **#2573 — Goal: Make Sovereign Commander absorb every Remote Commander capability**.

The existing Commander host previously offered only a repository search and no
session-local command history. This source contribution adds fifteen operations to
that host and its canonical command envelope. It does not introduce another
controller, worker, scheduler, durable store, public mailbox or execution owner.

## Operations

| Tool | Bounded contract |
| --- | --- |
| `start_search` | Literal filename or UTF-8 content search beneath one explicit local Windows directory; returns a search ID and actual state. |
| `get_more_search_results` | A stable indexed page from that handler's retained search result; no new path is accepted. |
| `stop_search` | Requests cancellation of that handler's named search, or releases a terminal snapshot. Cancellation is reported only from the scanner's actual terminal evidence. |
| `list_searches` | Metadata for searches belonging to the current handler. |
| `get_usage_stats` | Advisory local counters for calls observed by the current handler; no vendor quota, billing or machine-wide inference. |
| `get_recent_tool_calls` | Metadata for the current handler's retained calls, without arguments, paths, content or exception text. |
| `get_tool_result` | An eligible immutable copy of an original result from this handler, addressed by its opaque command ID; never a replay. |
| `list_remote_tool_calls` | The current handler's authenticated HTTP calls only; local stdio and other sessions are excluded. |
| `set_config_value` | Revision-checked read/write limits for this private handler, enforced by subsequent file calls within the original hard caps. |
| `move_file` | A regular file renamed within the same physical local Windows parent, with matching bounded pre/post SHA-256 observations and no destination replacement. Cross-directory moves remain unqualified. |
| `start_process` | A bounded asynchronous session for only the existing `status-recovery-mesh` and `status-worker-watchdog` read-only profiles; actual root launch evidence, no caller commands or input. |
| `read_process_output` | Stable pages of bounded stdout/stderr chunks from a process session created by this handler, including output observed before the child closes. |
| `list_sessions` | Only this handler's diagnostic process sessions and observed direct-child states; no host-wide terminal inventory or custody release. |
| `submit_feedback` | Unverified advisory feedback persisted in the existing local Shared Workspace, with bounded text and receipt-only history; no vendor submission, failure evidence, learning or execution grant. |
| `write_pdf` | Create one new bounded ASCII text PDF through a retained-parent Windows helper; no overwrite, existing-PDF editing, Unicode, HTML or image rendering. |

All fifteen require an actual MCP request after initialization and tool discovery.
The trusted transport must be local stdio or authenticated HTTP. Caller JSON
cannot provide transport proof, session state, an executor, a scanner or a history
store. Unknown fields, accessors, inherited arguments and coercible numbers are
rejected. Session operations through other command carriers are refused.

The capability catalog maps these precise source contracts and the already
implemented `create_directory`. Catalog mappings retain `SOURCE_CATALOG_ONLY`,
`runtimeParityProven: false` and `daemonMayReportGreen: false`. A legacy ledger
that routes a search-session operation to `search_project` cannot become a
physical-parity or Flywheel-learning receipt.

## Windows search confinement

The fixed PowerShell helper receives captured, hash-checked C# source and JSON
data on stdin. The executable, script bytes and native source are fixed by the
implementation; query/path data never becomes shell code or a command-line
executable. The child receives the existing minimal environment and the fixed
Windows module path. Native stderr is not returned to clients.

The native scanner opens the explicit local scope through retained ancestor
handles. Child opens and directory enumeration use those handles. It refuses
reparse points, hard links, nonregular objects, UNC/device paths, alternate data
streams, ambiguous names and known sensitive locations. Retained handles deny
write/delete sharing during the bounded observation. The scanner verifies final
object location and identity before returning file evidence. An unavailable or
busy object is an explicit omission, not permission to fall back to path-based
traversal. A repository-root Node search is not used as a Windows substitute.

Results are a **bounded observation, not an atomic snapshot of the entire tree**.
Budgets, permissions, changing entries, excluded material and binary/non-UTF-8
files produce explicit incomplete reasons. A running request has no completed
snapshot. A malformed or mismatched native receipt is rejected.

Default bounds per search are 10,000 directory entries, 1,000 files, 256 KiB per
file, 16 MiB of file reads, 1,000 results, 512 KiB of retained result data and
depth 12. Native scanning is bounded to five seconds, with a 20-second host
deadline. Pages contain at most 50 results and approximately 12 KiB of JSON.
Each handler retains at most four searches for five minutes. Native process
admission is additionally bounded across handlers; a timeout or failed kill
cannot manufacture process exit or free uncertain execution capacity.

The cancellation contract observes the fixed search host. It must not be
represented as independent proof of an entire Windows process tree's exclusion.
Windows PowerShell compilation and any compiler-descendant lifetime remain part
of native specialist qualification. This contribution grants no maintenance
custody release, source lease release or process-killing authority outside its
own fixed read-only search host.

## Private history and lifecycle

The history service is one in-memory object per existing MCP handler. Defaults
are 128 records, 512 KiB of serialized metadata and result data, 64 KiB per result,
32 pending responses and a 30-minute access age. Successful private results must
also pass bounded plain-JSON copying and sensitive-key/value checks. Failure and
exception bodies are not retained. Lists and usage return metadata only; the
original result requires an explicit `get_tool_result` call from the same
handler. Evicted, expired, oversized or rejected snapshots stay unavailable.

History queries do not recursively record themselves. Metadata distinguishes
pending, returned and thrown responses while retaining `nativeOutcome: UNKNOWN`;
a returned object is not independent evidence of native execution. Cache failures
cannot hide an original action receipt or alter maintenance custody. Age pruning
occurs on access; this is not a wall-clock memory-erasure guarantee.

HTTP admission allows at most 16 sessions including pending initialization. New
initializations reap sessions idle for 30 minutes, while in-flight requests keep
their session. DELETE, server close, failed initialization and stdio EOF dispose
private search/history state. These actions do not release the independent
maintenance owner or permit replay of an uncertain native command.

## Typed session configuration

Configuration belongs to one private MCP handler. `get_config` reports effective
values, their revision, accepted configuration ranges and the existing byte and
batch limits. `set_config_value` requires an
exact `expectedRevision`; concurrent stale changes are refused. Restoring a prior
value is another revision-checked change, not a replay of the old request.

`fileReadLineLimit` constrains both single and batch reads while their existing
request and shared output limits remain binding. Read ranges retain the existing
LF/CRLF parsing; bare CR is not a read-line delimiter. `fileWriteLineLimit` constrains
each supplied rewrite/append payload or edit replacement; it is not a promise about the total number of lines
already present in an appended file. Write-payload counting recognizes CR, LF and
CRLF; a final delimiter does not add another line. The write setting defaults to
`null`, which keeps the original byte-only limit. Defaults preserve the prior tool behavior.
These controls cannot change allowed paths, executable identity, shell selection,
environment, authentication, credentials, canonical ownership, review authority,
byte limits or mandatory receipts. Unknown keys and coerced values are rejected.

The effective configuration is captured for each admitted operation. A later
configuration change cannot rewrite an in-flight operation's policy. Successful
changes are eligible for the same private receipt history, including before/after
values, while another handler retains its own defaults. Closing the handler
disposes this configuration; persistent machine settings are outside the contract.

## Bounded diagnostic process sessions

The three process tools implement a deliberately limited asynchronous contract.
`start_process` accepts only a `profile` of `status-recovery-mesh` or
`status-worker-watchdog`. The canonical command builder verifies the profile's
existing read-only registration, fixed executable, exact script path and original
ten-second deadline. The new internal operation is `START_PROCESS_SESSION`;
the pre-existing `START_PROCESS` fixed-registry operation and its maintenance
ownership rules retain their original meaning.

The service captures and verifies the two existing PowerShell scripts before
launch, then executes those bytes in a separate fixed script block. Their
`[CmdletBinding()] param()` declarations stay intact. The scripts use only their
existing named task and user-profile status-file observations; neither depends on
repository-relative paths or source-location variables. The executable and system
module path are fixed. The user profile comes only from the trusted host's minimal
environment. No request may choose shell text, arguments, a working directory,
environment variables, input, arbitrary PIDs or an additional profile.

A successful start receipt requires observed child creation. It is a launch
receipt, not a completed diagnostic. Output chunks have stable sequence offsets
and can be read while the child remains alive. Each page reports truncation and
whether output is complete. The service separately records root exit and stdio
closure; it does not infer either from a timeout, disposal or a missing result.
The limits are two active hosts across handlers, four retained sessions per
handler, a five-minute access age, 16 KiB of output and 256 chunks of at most
1 KiB per session. Pages default to 20 chunks and stop at 50 chunks or 12 KiB of
serialized output. Expiry is pruned on access. The ten-second deadline requests
termination only of the owned child; a two-second grace observation cannot
establish termination when close has not been observed. Uncertain starts
never authorize automatic retries, and uncertain child lifetime keeps admission
held until the original child actually closes or a pre-spawn failure is proven.

Handler disposal removes private access to retained observations while preserving
unresolved process admission. It cannot release maintenance reservations, native
custody or source leases. Even a root exit and closed pipes do not establish zero
descendants: `descendantsExcluded` and `nativeCustodyQualified` remain false.
The production scripts normally emit their JSON near completion; a real-child
fixture separately proves that the transport can expose a chunk before exit.

The catalog and compiler keep all three general process outcomes as
`BUILDABLE_GAP`, with the precise two-profile partial scope. Interactive input,
general build/terminal profiles, arbitrary process termination and full process
tree custody need a separately qualified contract. A local status stream does not
close those outcomes or create a Flywheel learning receipt.

The same distinction applies to device inventory: `visibility-snapshot` describes
the local Battle Bridge host. It does not enumerate authenticated account devices,
so `list_devices` remains a partial local-visibility gap. Descriptive capability
metadata uses `privateTransportRequired`; it is not a session token or admission
proof, and publication still uses the unchanged shared workspace secret-field guard.

## Guarded regular-file rename coverage

The move contract requires exact `source`, `destination` and `expectedSha256`
arguments. This first slice accepts only a new basename in the same physical
parent. It does not accept shell text, a directory tree, overwrite permission,
cross-directory or cross-volume movement, copying or deletion instructions.
A fixed captured Windows helper retains the parent chain, binds the source
object, checks an observed content hash and uses a native no-replace rename with
no destination directory reopen. Cross-directory requests are refused before
mutation and remain a capability gap in the catalog and compiler.
Sensitive paths, aliases, reparse points, hard links and nonregular files are
excluded rather than passed to a path-based fallback.

The expected hash is a bounded content observation, **not atomic content CAS**.
Existing writable mappings can outlive their original file handle and cannot be
excluded by ordinary sharing restrictions or repeated hashes. A successful
receipt reports the same object renamed and matching bounded pre/post hash
observations; it does not certify absence of mapped writers or immutable content.
Atomic-content and cross-directory contracts require separate native work.

Mutation evidence is separate from process completion. A timed-out, disconnected
or malformed native result after admission retains an unknown effect unless a
valid terminal receipt establishes the outcome. Unknown effect never creates
automatic retry, rollback, custody-release or overwrite authority. Receipts carry
bounded private identity and hash metadata; file contents are not returned.

## Package, proof and adoption

### Advisory feedback in the existing workspace

`submit_feedback` accepts exactly `category`, `operation` and `message`. Category
is `problem`, `improvement` or `other`; the operation is a fixed feedback subject,
not an executable grant. Text is capped at 1,024 UTF-8 bytes before normalization
or redaction. The handler captures own data properties and sanitizes recognized
credential assignments, key blocks, addresses, URLs and absolute paths before
the canonical envelope sees the message. This pattern-based redaction cannot
recognize every possible secret; callers must not submit credentials.

The host supplies the existing Shared Workspace root. A caller cannot supply a
path, participant identity, event ID, timestamp, proof, approval or failure flag.
Only existing safe directories are used. Publication calls the unchanged
`createSharedWorkspaceEventRecord` and `writeAtomicJson`, then verifies bounded
record bytes through a regular-file read handle. This preserves the canonical
store's trusted-workspace assumptions; it does not claim atomic ancestor
namespace confinement against a hostile concurrent local writer.

Records have kind `sovereign-user-feedback`, canonical owner `#2573` and
`CALLER_SUBMITTED_UNVERIFIED` provenance. Authentication admits a private client;
it does not identify a human author. No capability-failure, learning-candidate or
build-proposal field is accepted or generated. Existing native-gap and Flywheel
readers demonstrably leave these events advisory. PR #2648 owns the separate
evidence-bearing capability-gap/automatic-learning work.

Each handler admits at most sixteen publications, with one in flight. An event
ID derives from sanitized feedback, so identical submissions reuse its record
and may refresh the advisory timestamp. This is neither an exactly-once nor a
first-seen claim. Only matching readback returns `PERSISTED`; lost acknowledgement
or uncertain readback returns `UNKNOWN`, with no automatic retry. Disposal blocks
new work without claiming to cancel a write already owned by the store. Receipts
and retained history contain event identity, stored-record digest/size, timestamp
and boundaries, never the message or workspace path.

The source catalog maps the vendor feedback outcome to this clearly named
Sovereign feedback destination. `externalVendorDelivery`, `automaticLearning`,
`verifiedFailureEvidence` and `runtimeParityProven` remain false.

### Create-only text PDF coverage

`write_pdf` accepts one explicit permitted local Windows `path` ending in `.pdf`
and `pages`, each containing only a `lines` array. The fixed recipe accepts one
to eight pages, up to sixty lines per page, eighty printable ASCII characters
per line and 16,384 total text characters. It renders at most 65,536 bytes of
PDF 1.4 with US Letter pages, Courier 10 point, twelve-point leading and fixed
margins. Hexadecimal text operands keep PDF-looking caller text inert. Stream
lengths and cross-reference offsets derive from final bytes. There is no runtime
package installation, system renderer, caller PDF/base64, font, image, script or
external resource input. Unicode is refused rather than silently replaced.

The fixed, captured PowerShell and C# helpers receive only internally generated
bytes and their hash. They retain local NTFS parent handles, refuse reparse and
alias paths, create a single basename with native `FILE_CREATE`, and hold the
new regular file exclusively through write, flush and same-handle length/hash
and identity verification. Existing targets are never replaced. The constructor
does not create a target; the explicit write method records mutation admission
before the create syscall. No pathname cleanup follows an uncertain attempt.

Successful completion is an observed `CREATED` receipt, not atomic visibility
of the whole document or permanent immutability. Failure or interruption after
creation may leave a partial new file and remains `UNKNOWN`; clients must not
automatically retry. The adapter has one cross-handler native admission slot,
a five-second native budget and twenty-second host deadline. A timeout or
requested kill does not release admission before actual child close. Root
closure does not prove compiler-descendant exclusion or maintenance custody.
Receipts omit raw paths and document text and bind generated byte count/hash,
page count and target hash. Retained history never reruns the creator.

The catalog and compiler retain `write-pdf` as `BUILDABLE_GAP` with
`CREATE_ONLY_BOUNDED_ASCII_TEXT_PDF` partial coverage. Existing-PDF editing,
Unicode, images and richer rendering remain unimplemented. Source renderer
validation uses independent strict PDF parsing, text extraction and rendered
page inspection; these checks do not establish Battle Bridge native execution.

### Finite source package and acceptance

The fixed-runtime closure grows from 266 to **281 exact members**: seven private
session/adapter modules, six search/move/PDF native helper files, and the two existing
fixed read-only status scripts. Every original member remains present. The preparer,
installer, native verifier and closure regressions carry the same bounded member
count. Captured helper reads are included in the parse-only dependency proof;
omitted or modified helper bytes must fail it. There is no dynamic discovery of
extra installer files.

Focused source tests cover argument and transport admission, scope binding,
pagination, cancellation uncertainty, session isolation, history privacy and
resource bounds. Process tests exercise actual output before child exit, isolated
session IDs, deadline/error/close races and retained admission under uncertainty.
Configuration tests exercise real file behavior, stale revisions,
rollback and independent handlers. Real disposable Windows fixtures compile the native helpers and
exercise plain reads, sensitive-file exclusion, reparse/hard-link refusal and
ancestor/file-handle races in the existing Windows CI job. Linux skips are not
Windows proof. Independent exact-head review and Windows/security adjudication
remain required before the protected merge and commissioning stages.

Neither a source commit nor passing hosted CI installs this change on Battle
Bridge. The current protected runtime package, private host attachment and each
per-operation terminal receipt remain separately required. This does not close
all of #2573: process/session interaction and termination, broader PDF editing/rendering,
broader move/configuration contracts, service/account equivalents and the original native
acceptance register retain their own implementation or commissioning work.

Reusable invariant: a session's capability state, receipt history, source catalog
mapping and native completion evidence are separate facts. Bounded metadata and
cache lifecycle must never create execution authority or substitute for native
termination evidence.
