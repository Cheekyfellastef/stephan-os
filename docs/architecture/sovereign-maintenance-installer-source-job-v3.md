# Goal #2961: bounded native custody for the installer source probe

Status: structural review accepted at f26efb43c161c26194ddaef838d1107e7bfe9c87 (authenticated response 6470717614). Implementation remains a candidate requiring exact-head specialist review and native proof. This follow-up repairs the real deployment refusal after PR #3295; it grants no installation, administrator, restart or recovery authority.

## Measured defect

Canonical main 0b30ed366725640c7c2dfb0911038a288c7eb7d3 contains the reviewed installer. Its fixed sanitized source child is killed after 10 seconds. The actual unchanged canonical collector passed at the exact approved source in 18,155 ms under the same sanitized environment, while the 10-second path refused at 10,061 ms. The existing collector performs several sequential fixed Git operations, each already bounded at 120 seconds. The harmless environment child test did not represent this workload. No production journal was registered or incident prepared.

The installer currently kills only its direct Node child on timeout. A source collector may have a Git descendant. Raising the deadline alone does not establish descendant cleanup. This related authority boundary needs structural review before another narrow patch.

## Proposed closed native adapter

Reuse the existing Windows native Job custody implementation in scripts/windows/SovereignCoreJobCustodyV1.cs. Add one sealed public source-proof operation; do not expose a command, executable, path, environment, timeout, process limit or arbitrary work directory argument. Its only caller value is an exact expected canonical main SHA. It is an adapter of the existing installer, not a scheduler, service, controller, worker, signer or custody-release mechanism.

The operation pins C:\Program Files\nodejs\node.exe, the canonical checkout, and scripts/sovereign-maintenance-journal-source-proof-v2.mjs. Preserve the reviewed cleared environment, fixed PATH and OS bootstrap allowlist; inherited Node/module/crypto/provider overrides never reach the child. Retain all canonical source checks unchanged.

Create a private unnamed Windows Job with KILL_ON_JOB_CLOSE, no breakaway, and a bounded descendant count sufficient for the fixed Node/Git collector (proposed eight). Launch Node with the existing JOB_LIST process-creation attribute so Job membership is atomic before any instruction executes. The Job is resource custody, not an arbitrary-code sandbox. The elevated installer remains outside that child Job and owns its handle until native drain is proven. Do not reuse or relax the Core-only worker's existing active-process limit of one.

Use a deliberate fixed total source-proof deadline of 120 seconds, measured monotonically from operation entry through setup, launch, pipe handling and final success adjudication, and a separate fixed five-second native drain budget. This is a total operation ceiling, not a caller option or success predicate. Delayed success beyond the deadline is refusal. Missing/failed source, malformed or oversized output, nonzero exit, cancellation, native API failure or deadline expiry refuses journal mutation. On interruption terminate only this owned Job, then positively query zero active processes and the direct child process handle while still holding the Job. Unknown cleanup is a typed held result and never success. Parent crash closes the Job and cannot admit installation.

Capture child output through bounded anonymous pipes with an explicit inherited-handle list and no inherited parent handles. Drain output concurrently so a child cannot deadlock on full pipes. Cap stdout/stderr to a small fixed budget; overflow cancels the Job. Only normal exact SHA output and zero exit, no interruption or forced termination, and positive native drain can satisfy source admission. Direct exit zero while a Git descendant remains is refusal; killing that descendant later cannot turn the result into success. Never publish raw stderr, credentials or arbitrary child data. The public receipt contains only closed reason codes, expected/observed exact source where valid, elapsed time, direct PID/birth identity, assignment-before-execution, deadline/cancellation state and native zero-active proof.

Factor or reuse existing private Job primitives rather than introducing a second generic executor. Preserve existing Core probe/repair behavior and tests. The installer invokes this closed operation and proceeds only when its complete native receipt proves exact source and released child custody. No Process.Kill fallback, PID-tree kill, task/service control or weakened Git classification is permitted.

## Independent bootstrap before elevated code

The existing authenticated GitHub exact-source route and operator-approved merge/tree supply the immutable source identity; a mutable local child reporting its own expected SHA does not. Before elevation, obtain the fixed probe/native host/policy and the complete reviewed transitive Node source-closure manifest from that immutable protected tree through the authenticated GitHub route. The existing trusted native execution host must compare the actual bytes and pin them against replacement through the complete elevated operation. Elevated bootstrap instructions themselves must come from those verified immutable bytes, not a newly read mutable workspace script. Compile the C# host only after its in-memory bytes and complete closure are authenticated; hold deny-write/delete handles or the existing equivalent source pinning throughout child execution. Refuse redirected paths, missing closure entries, replacement races or a caller-supplied manifest/hash presented as authority. This extends the existing operator-driven installer bootstrap; it adds no signer, public command or new execution lane. No existing bootstrap is claimed commissioned by this design: the exact reused trusted-host path, manifest binding and replacement-race proof must be identified and independently accepted before implementation is admitted. If that original authority cannot provide a pinned closure, installation stays held rather than executing a helper to prove itself.

## Regression and real acceptance

Before production use require Windows-native tests for success delayed beyond ten seconds but within the fixed total budget; timeout with a live direct child and descendant; parent death; pre-execution Job assignment; output overflow; nonzero or forged SHA; and unchanged hostile environment exclusion. Require positive OS zero-active/process-handle proof on every claimed terminal result. Add explicit direct-exit-with-live-descendant and failed/unknown Job-query cases; forced cleanup never rescues source success. Production expectedMain-only entrypoints must not accept fixture mode or variation. Require bootstrap tamper-before-compilation and replacement-race refusals. Exercise a private fixture adapter only from tests; production entrypoint keeps fixed paths and policy.

Run the real unchanged canonical source collector as an unprivileged read-only acceptance observation through the same sanitized Job adapter and record its actual exact source, duration and native drain. This is not administrator installation. Hosted tests use harmless fixed fixtures without touching a production journal; rerun all existing Core native custody and retained-journal suites. Register no new installed capability merely because fixtures pass.

Pin .gitattributes itself to LF in source and prove Windows checkout materializes its protected bytes: the previous deployment encountered a real CRLF-only false source-dirt refusal. Keep original bytes backed up; never suppress source status or hide index flags.

After exact-head independent Windows/security review, complete native proof and protected operator integration, obtain fresh changed-source administrator deployment/preparation approval. The prior approval was for 0b30ed3 and stops at this source defect. Preserve the same current held owner/cycle/projection, then produce a real ACTIVE preparation receipt before seeking a separate new full restart and authenticated recovery approval. Port 4173 reachability and material building remain separate acceptance claims.

## Durable lesson

An installer deadline and its process-custody contract must represent the full canonical validation workload. A fast stand-in child proves environment isolation only. Deadline expiry is not proof that a process tree has terminated, and increasing a timeout alone does not establish custody.
## Concrete implementation and diagnostic separation

The pure bootstrap candidate builder has no independent source or operator
approval authority. The existing authenticated GitHub/native operator route must
independently prove every fixed closure record belongs to the approved immutable
commit/tree before executing its literal encoded program. The candidate never
fetches credentials, elevates itself or installs a capability. It authenticates
all 40 closure snapshots before compilation, compiles only the captured verified
C# bytes, then pins physical non-reparse directories and single-link source files
and authenticates them again. Canonical HEAD, main ref, index and configuration
are held against replacement through journal mutation. Direct workspace installer
invocation refuses; the isolated hosted fixture remains separately guarded.

A real Windows receipt identified a live CONSOLE_HOST in the source Job. The
source profile therefore uses DETACHED_PROCESS with explicit inherited pipe
handles, not CREATE_NO_WINDOW. This does not enable job breakaway. Its priority
is NORMAL_PRIORITY_CLASS, matching the measured canonical workload rather than
copying Core's idle scheduling policy. Core's existing implementation, one-process
limit, idle profile and public repair/probe behavior remain unchanged.

The real descendant fixture is a small compiled benign program, not a detached
PowerShell host or Node's self-cleaning inner Job. Before root exit or parent
termination, the observer opens native root/descendant handles and captures UTC
birth identities; receipts bind the root PID and exact birth. Source admission
requires native zero-active accounting, never PID absence or a subtracted count.
A signalled root can briefly remain in the Job list; non-root entries are checked
through actual native membership and signalled process handles, while only a
positive final zero-active query admits success. Unknown native queries refuse.

Microsoft reference contracts:
- https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list
- https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information
- https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags

Historical individual passes and mixed diagnostic runs are not final proof.
Unchanged Core candidate failures on this desktop must be compared to immutable
main and reported separately rather than weakening Core's limit to hide them.

### Historical pre-split evidence

At implementation commit 589d0a0e6b26a19cf9b9e38d7131a77dd84547f3, the actual
canonical collector at 0b30ed366725640c7c2dfb0911038a288c7eb7d3 passed in
17,938 ms through the former combined native adapter, SHA256
3bc3ca2b593c88825db3cc6fcacc75f708430cccd3a69077be86779c292a5958.
That version's focused local run had 68 passes and four hosted-only skips out
of 72 tests. These are historical component observations, not proof of the
final split units or current-head production commissioning. Its hosted run
40715007616 failed four Core preflight cases because the combined source
exceeded existing loader bounds; those failures were not waived.

### Split-unit evidence and remaining acceptance

The split implementation at 667f9a4e63c1fcb8b542407de832b7f10aa3d6a1 has:

- Core unit: 21,949 bytes, SHA256
  b4a24d720c2acc9856d1d9f83a120adf30e490c33741d1c5bd27e36056550de1.
- Installer source unit: 16,515 bytes, SHA256
  12e9aae1f901a50f8231b8ad2f7d1de08691b8ca10b3de31f7efb4c8458c161b.
- Actual unchanged canonical collector at 0b30ed366725640c7c2dfb0911038a288c7eb7d3
  passed through those units in 17,814 ms. The native receipt records PID 34192,
  birth 2026-10-28T15:33:33.9492935Z, assignment before execution, normal exit zero,
  exact source SHA, no cancellation and positive zero-active accounting.
- Targeted source/bootstrap/Core-consumer run: 26/26 pass. Its retained TAP
  SHA256 is b52d32e0e37ff81a245e4d434003df1269b60dd9ee3b17e7d39d9f28fdd2fd99.
- Broader affected local run: 59 tests, 54 passes, four explicit hosted-journal
  skips and one unchanged Core completion-timing failure (deadline exit 77
  instead of the fixture's expected exit zero). Retained TAP SHA256 is
  3f43d3cb63dc9786ad7543fd47afd87aa8c590769ec3d978497b126122192db7.
  This is a disclosed failed local result, not a complete local pass.
- Complete hosted custody run
  [40717096307](https://github.com/Cheekyfellastef/stephan-os/actions/runs/40717096307)
  is terminal SUCCESS on Windows and Linux at that exact split implementation.
  Its Windows Core/admission step passes 155/155 with zero skips; the hosted
  native source and retained-journal steps also pass. Hosted proof is distinct
  from the local timing failure and does not erase its record.

This evidence correction changes no native code. The hashes and workload
observation above bind the split units; the hosted run binds commit 667f9a4e6,
not any later documentation commit. A later head still needs its own required
checks and complete-diff specialist acceptance.

The recorded 16:46:41 UTC review-surface observation found no current-head
terminal specialist response or submitted review. Request 6473326859 was
created at 15:35:01 UTC and exceeded the existing 30-minute response-causality
window at 16:05:01 UTC. A later clean response cannot qualify that expired
request pair. Preserve the bound, independent specialist class and no-duplicate
review rule; neither a running marker nor passing tests is review acceptance.
No protected integration, production journal registration, ACTIVE preparation,
restart, custody release or material build is established by these observations.

### Bounded compilation invariant

Hosted proof exposed a real consumer regression: placing the installer adapter in the existing Core source made its file exceed the unchanged 32,768-byte native loader bound. The installer adapter now lives in `SovereignMaintenanceSourceJobV3.cs`, a second bounded partial compilation unit. Ordinary Core loaders still compile their self-contained original unit; only the pinned installer bootstrap compiles both authenticated snapshots together. The Core unit changes its declaration to partial without changing Core statements, receipts, limits or execution policy. Both files belong to the fixed 40-file authenticated closure. Existing Core preflight and directory tests exercise their production source limits; an explicit regression additionally checks each unit stays bounded. No source or stdin bound is widened.

### Whole-closure byte materialization invariant

The fixed 40-member source manifest owns the raw-byte invariant. `.gitattributes` is a checked Git materialization projection of that manifest, not an independent source of approval. Every closure member must materialize byte-for-byte as its immutable approved Git blob under `core.autocrlf=true`. Do not normalize bytes in `Read-Pinned` or derive expected blob identities from a checkout.

Authenticated independent finding 4403861591 identified thirteen unpinned members. The pre-fix regression reproduced exactly those thirteen raw-byte mismatches. The correction adds their LF projection while the regression quantifies the entire forty-member closure. Expected source records now come from immutable Git objects through the existing sanitized Git execution boundary. The fixture preserves original source blob IDs when staging its private object store, then reads expectations back from its immutable tree into a separate actual Git checkout.

Positive proof compares all forty materialized files to those immutable records. A negative policy removes LF for every member and must expose conversion mismatches. On Windows the same fixture extracts and executes the actual bootstrap `Read-Pinned` function: converted bytes produce `SOURCE_PIN_DIGEST`; correctly materialized bytes pass. The authentication function itself remains unchanged.

An existing checkout needs a separate adoption check: changing attributes alone does not rewrite unchanged CRLF files, and ordinary Git clean status can conceal the raw-byte mismatch. The regression demonstrates this state, retains each original byte sequence, admits migration only for a proven CRLF-only difference, writes exact immutable blob bytes, and verifies the full closure and actual pin function again. This is fixture proof, not a claim that production files were adopted.

Before production UAC, after the approved source-only sync, inspect all forty physical files against records independently authenticated to the actual merged commit/tree. Preserve backups and before/after hashes for any authorized CRLF-only adoption. Refuse semantic changes, unexpected paths or changed identity; recheck the entire closure before the immutable bootstrap runs. Do not use force checkout, hidden index flags or bootstrap normalization as a substitute. No native custody code, forty-member scope, privileged admission, journal or full-boot gate is relaxed by this repair.

Pre-publication Windows proof for this P1 correction: the targeted source/bootstrap/Core-consumer suite passes 27/27 with zero skips. Final retained TAP SHA256 ed16fc7752d8b8cf825a0932b300f366bacc6c0fdb13c7f270cc4929e4761dda. The pre-fix failing TAP SHA256 40a8c1178298295c9ab21cb7a65cc351195c7f5284576f35c6959b717ab168a5 preserves the exact thirteen-file reproduction. These are working-candidate observations; a published head still requires its own complete hosted checks and independent specialist review.
