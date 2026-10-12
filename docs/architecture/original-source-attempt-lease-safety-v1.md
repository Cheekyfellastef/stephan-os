# Original attempt quarantine and exact lease release (#2961)

## Receipt-before-lease dispatch invariant, 12 October 2026

The original missing-proof defect also has an I/O failure variant: validating a
queued receipt before claiming the global lease does not prove that receipt can
be persisted. The PR-head dispatcher now reads authenticated execution history
and persists the first canonical queued receipt before making a new lease claim.
Only a successful, exactly bound canonical claim permits queue publication.
Queued intent alone grants no execution, source-writer or lease-release authority.

A refused receipt write or unobservable history leaves the lease unclaimed. A
claim interruption/refusal leaves a durable intent that the same execution can
replay without replacing its sequence-one timestamp or duplicating its receipt.
Accepted/nonterminal executions without queue proof, terminal executions, an
in-flight action without its lease, and a mismatched claim still fail closed.
Existing leases and historic missing-proof holds retain their original recovery
requirements; this ordering cannot manufacture historic r7 terminal evidence.

Regression proof uses the real durable receipt writer/reader for interruption,
claim refusal, wrong claim identity and later replay, plus admission spies for
write/history failures. The live guarded `repair-goal-builder-flow` on deployed
main `50411d67c719292da85ff9e1263468d7894712dc` restarted the existing worker and
refreshed goal discovery successfully but remained blocked by
`REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN`. No new real-goal pickup,
Building transition, historical lease release or deployment is proven by these
source tests. Current-main ancestry must be restored before exact-head review;
independent Windows specialist qualification and protected merge remain required.

## Physical defect and preserved truth

The original #2962 r7 lease has no authentic r7 execution receipt or exact r7 terminal queue pair. Historical intake revision r0 was incorrectly classified as a current-attempt binding mismatch. Recognizing canonical r0 yields five historical terminal records and ORIGINAL_EXACT_TERMINAL_PAIR_NOT_FOUND; it grants no release authority. STOP on PR #2987 and an idle supervised worker do not prove detached-writer nonactivity.

The canonical consumed AGENT_RESULT_RECEIVED event instead identifies the actual original source action. Its authentic completed r1 receipt retains its original head, PR 0 and r1 lease. The pre-PR queue schema carries a null PR, empty PR head and an exact sourceRevision; the authentic receipt encodes that same pre-PR identity as PR 0 and sourceHead. Both representations are checked explicitly. Those identities must never be rewritten to resemble the later r7 PR-head lease. Provider result IDs remain opaque. Missing, duplicate or unprocessed consumed events HOLD.

## Existing authority, one bounded transition

This repair extends the existing owner-authenticated CANCEL_MISSION_ORCHESTRATOR_MISSION command with three indivisible fields: originalLeaseId, originalLeaseDigest and expectedMissionRevision. The canonical mailbox still checks owner identity, repository, expiry and exact current-main head. The handler adds that observed head and request ID to the durable audit. No generic command, path, process-kill, force-release, merge or scheduler authority is added.

Quarantine requires the exact expired canonical mission-worker lease, REPAIR_REQUIRED at its bound revision and complete original source dispatch. It verifies every authenticated execution chain on the held lease is terminal (an empty verified history is recorded as zero, never synthesized as completion); independently resolves the consumed source action; requires its authentic completed receipt and a complete, successful, tests-passed source queue/result pair with all original source identities; and inspects pending/processing in every known and physically present queue adapter. Unknown or active proof HOLD. The source pair is hashed without rewriting either file.

The positive source completion argument is bounded to the provider-neutral synchronous source pipeline: edits, required tests, escrow and authentic completion happen before movement of the source pair to completed. It does **not** prove that an admitted script did not spawn a detached descendant which can mutate source after the direct child exits. Therefore a completed pair and idle queues remain `SAFE_HOLD` unless an existing authority adapter authenticates positive writer-exclusion evidence bound to the exact mission, original source execution, whole lease digest, repository, branch and head. Missing, unauthenticated, replayed or mismatched evidence cannot create a fence. This repair adds only that fail-closed source gate; it does not claim that fleet evidence currently exists or perform a live release.

Under the existing mission lock and canonical lease-operation lock, the entire original lease record is compared again, then the existing mission cancellation event commits originalSourceAttemptFence in canonical storeMetadata. The event contains the same fence, source receipt/pair hashes, original lease hash/revision, source-main head and operator request/command identity. There is no second fence database. State-write/event-write interruption leaves cancellation in force but release blocked by the missing audit. Restart and duplicate-command replay preserve the same fence.

## Writer exclusion and release

Queue claim, processing pickup, action publication, result collection, source construction after provider response, source commit, lease claim and renewal consult the canonical cancellation/fence. Direct Forge publication holds the existing mission lock through all remote mutations, so cancellation cannot race a preflight check. Queue claims racing cancellation must acquire the mission lock before writer invocation. The existing supervised worker reloads after canonical source changes; no additional worker is created.

Only the original expired-lease reconciler consumes the fence. It rechecks canonical cancellation at original revision + 1, the unique consumed cancellation audit, authentic source receipt, unchanged terminal pair, terminal held-lease chains and all original queues, then calls Programme Authority's guarded exact-lease release with the whole original lease digest. The fence itself now durably binds the authenticated writer-exclusion receipt and digest. A changed/renewed lease, incomplete audit, active queue, altered pair, unknown history, or absent/mismatched physical containment proof HOLD. Ordinary STOP, parked phases and plain cancellation retain the strict receipt requirements. Parking can no longer bypass the original-owner guard.

The lease is not force-deleted. The original worktree, dirty source, artifact, outbox, receipt history and superseded PR remain preserved. Releasing this source attempt cannot establish goal acceptance or deployment.

## Goal and retry boundary

The same unfinished #2962 goal remains in existing canonical containment pending verified capability/blocker change and a legal new admission. Already merged #3000 stays accepted work. This patch does not invent automatic goal requeue, mark the goal complete, duplicate a scheduler or establish #2955 material pickup. Capability-aware deferred retry and two unattended refills require separate real conveyor receipts after safe lease release.

## Proof and risks

High-risk runtime authority change: specialist and independent exact-head review plus existing operator-protected merge are required. Focused regressions cover canonical history, opaque result namespace, an actual detached Node descendant, missing/mismatched writer-exclusion evidence, terminal-pair schemas, active exact r7 execution hidden by r1 completion, lease renewal/CAS race, queue uncertainty, canonical cancellation durability/replay, provider-response-to-edit fencing and a remote publisher/cancellation lock race. The complete relevant worker/lease/publication/mailbox suite must pass before publication; the existing symlink receipt test additionally needs the hosted Linux runner because Windows sandbox cannot create that symlink.

Architectural debt: the historical r7 attempt did not record a source execution receipt at its revision. The fix preserves that absence. Before claiming recovery, publish distinct real receipts for STOP acknowledgement, original attempt fenced, exact lease released, same goal deferred/requeued, next claim, material source/test result, protected merge and live proof. Source review is not physical completion.

## Windows Job Object source-custody candidate, 11 October 2026

Three concrete source components are now included in the same PR:
- scripts/windows/StephanosSourceJobCustody.cs and Invoke-StephanosSourceJobCustody.ps1 run individual allowlisted Node/Git commands with CREATE_SUSPENDED, AssignProcessToJobObject before ResumeThread, a non-breakaway job, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE and zero-active-descendant accounting. Missing assignment, timeout, failed accounting or active detached descendants fail closed and terminate the job.
- stephanos-server/services/sourceJobCustodyCommandService.js offers an opt-in strict source command adapter: STEPHANOS_SOURCE_JOB_CUSTODY_REQUIRED=1 replaces raw git/node commands with that runner. A trusted absolute Git path is required in STEPHANOS_SOURCE_CUSTODY_GIT_EXE; the Windows PowerShell executable, source-controlled runner and bounded clean worktree must exist. Any unavailable requirement means refusal, not fallback. Existing production behavior is unchanged unless the exact strict flag is enabled.
- stephanos-server/services/originalSourceWriterCustodyService.js now verifies domain-separated Ed25519 source writer receipts using a pinned public-key PEM and SHA-256 fingerprint. Legacy shared-HMAC V1 receipts are rejected. Neither the command runner nor public operator packet may mint a receipt, and no private signing key is present in the verifier/source-worker environment.

Actual hosted Windows evidence: run 38177375993 / job 114582498273, four tests passed and zero skipped (including detached grandchild delayed file write prevented). A later Windows run / job 114583603663 passed five tests, zero skipped/failures, including real source-builder JavaScript adapter to native command. Hosted Linux Node job 114583257288 passed six command adapter regressions plus 99 runtime regressions, zero failures. Hosted custody verifier/fence/mailbox job 114580690140 passed 96 focused regressions, zero failures. The temporary workflow edits for these proofs were restored to the original workflow source blob exactly; no CI workflow is changed in the final PR diff.

Mandatory SAFE_HOLD: command-scoped custody is not custody over the whole long-lived source worker, nor over alternative source writers. A separately privileged issuer with its own protected receipt signing key, exact-source worker lifetime custody and hostile Battle Bridge commissioning remain unproven. This source contains no authentic receipt for the historic original r1 writer or held r7 lease. No later code can retroactively establish that history. Do not release/quarantine the original lease, assume auto-build success, enable uncommissioned strict runtime mode, bypass an independent high-risk review or deploy from this source candidate.


### Qualified review P1 controls: key isolation and out-of-job process creation

Codex exact-head review at b3b5103 reported two material P1s: leaking symmetric verifier key material to source tests, and falsely treating Job Object zero active members as proof that no out-of-job writer exists. Both are addressed conservatively:
- The V2 receipt uses Ed25519 asymmetric signature verification, domain-separated exact claims, configured trusted public-key path and a separate expected SHA-256 fingerprint; source command child environments discard custody path/configuration, private signing key references and token/secret variables. The production system still requires a separately privileged **private-key issuer** with ACL/independent principal, not created by this PR.
- The Windows native runner's result is explicitly JobMembersExited, not WholeSourceWriterExclusionProven (always false). WMI Win32_Process.Create or a privileged external service can create out-of-job descendants. A valid V2 receipt requires a separately signed, positive, OS-backed externalProcessCreationDenied, worktreeAclIsolated, wholeWorkerLifetimeCovered, issuerObservedNoExternalWriters, isolatedWriterPrincipalSid and isolationPolicySha256 in addition to zero job members. The current Job Object prototype cannot issue those claims. No receipt for original r1/r7 or live lease release is possible on these tests alone.

Before use, independently commission source-worker token isolation, WMI/COM external-creation denial, source worktree ACL isolation, receipt issuer service principal and protected private key; verify hostile out-of-job spawn tests and real Battle Bridge proof. The original source lease remains SAFE_HOLD. Any changed source head invalidates prior qualified review evidence.


### Ambient-credential P1 containment follow-up

The strict source command runner now uses a **closed-world child environment**, never a blacklist of inherited operator environment variables. It makes one disposable profile for each command, overrides HOME/USERPROFILE/APPDATA/LOCALAPPDATA/XDG/TEMP/TMP, confines Git global/system config and npm config/cache paths to nonexistent or isolated files, disables interactive credential requests, clears NODE_OPTIONS and omits GIT_ASKPASS, SSH_AUTH_SOCK, API_PASSWORD, cloud credentials, custom tokens and similarly named unknown channels by default. The wrapper's executable locations remain trusted absolute paths. Missing trusted Git/SystemRoot/profile or failed profile cleanup blocks, never retries raw execution. Hosted hostile-variable tests must pass before considering this source change.

**This is not a full Windows sandbox.** A Node test still executing with the privileged operator Windows access token can open protected credential paths by absolute name, use COM/WMI to create an out-of-job writer, or target unrelated files. Before any real source-worker activation or positive custody receipt, run untrusted tests under a separately permission-restricted service principal and prove ACL/token restrictions with OS telemetry. Without that proof, native job exit and environment sanitization alone must not authorize a historical source lease release.


### Source-local Git config guard (11 October 2026)

Strict source containment must reject **repository-local** Git credential channels as well as child environment secrets. The sourceJobCustodyLocalGitConfigService makes a read-only bounded git -C <exact admitted worktree> config --local --null --list --no-includes inspection before any Node or Git source command, and allows only explicitly enumerated noncredential Git core, canonical origin and branch metadata. Any http.*.extraheader, credential helper, include.path, includeIf, URL rewriting, aliases, embedded remote credentials, unknown key, missing origin, malformed query, redirect or error causes LOCAL_GIT_CONFIG_UNSAFE; no raw retry. This validation takes place before test invocation and applies to commands that might spawn Git from Node. The provider-neutral strict adapter additionally refuses git -c, --config-env, alternate -C, --git-dir, --work-tree and executable override options.

**Residual limitations are explicit:** local Git config remains mutable by same-token untrusted Node, and another Git process could use a config changed between inspection and execution. Source code can also open files and invoke WMI/COM under that token. Therefore the local config guard is a fail-closed preflight, **not** a whole-worker security boundary or custody receipt issuer. The Windows source worker still requires separately restricted OS principal, protected read-only Git metadata or credential-free repository view, secure source-worktree ACLs, and independently inspected no-external-writer proof before activation or any source lease release. Historic #2962 remains SAFE_HOLD.

## Quarantine-first scope separation, 12 October 2026

To unblock independent review of the historical #2962 r7 repair, the unfinished **future-execution Windows Job Object source-custody prototype** is intentionally excluded from this PR's final diff. Earlier experimental commits remain in Git history for a separately qualified Windows-security build, but do not constitute installed functionality. The seven removed files were three scripts under scripts/windows (PowerShell runner, C# Job Object runtime, Windows tests) and four sourceJobCustodyCommand/LocalGitConfig modules and their tests. The provider-neutral source builder no longer imports or activates that optional unreviewed native runner; all canonical mission cancellation, output publication fences and original lease guards remain in this PR. The historical signed quarantine certificate verifier is separate and is **not** an OS process-writer installation. No user/operator authority, lease release or protected merge gate is relaxed.
