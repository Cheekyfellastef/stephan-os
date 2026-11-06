# Private Sovereign search sessions and command history

Owner: **#2573 — Goal: Make Sovereign Commander absorb every Remote Commander capability**.

The existing Commander host previously offered only a repository search and no
session-local command history. This source contribution adds eight operations to
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

All eight require an actual MCP request after initialization and tool discovery.
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

## Package, proof and adoption

The fixed-runtime closure grows from 266 to **270 exact members**: the search and
history modules, the fixed search script and native source. The preparer,
installer, native verifier and closure regressions carry the same bounded member
count. Captured helper reads are included in the parse-only dependency proof;
omitted or modified helper bytes must fail it. There is no dynamic discovery of
extra installer files.

Focused source tests cover argument and transport admission, scope binding,
pagination, cancellation uncertainty, session isolation, history privacy and
resource bounds. Real disposable Windows fixtures compile the native helper and
exercise plain reads, sensitive-file exclusion, reparse/hard-link refusal and
ancestor/file-handle races in the existing Windows CI job. Linux skips are not
Windows proof. Independent exact-head review and Windows/security adjudication
remain required before the protected merge and commissioning stages.

Neither a source commit nor passing hosted CI installs this change on Battle
Bridge. The current protected runtime package, private host attachment and each
per-operation terminal receipt remain separately required. This does not close
all of #2573: process/session interaction and termination, moves, PDF output,
typed configuration, broader service/account equivalents and the original native
acceptance register retain their own implementation or commissioning work.

Reusable invariant: a session's capability state, receipt history, source catalog
mapping and native completion evidence are separate facts. Bounded metadata and
cache lifecycle must never create execution authority or substitute for native
termination evidence.
