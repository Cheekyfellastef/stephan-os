# Control Tower: sovereign observation and the existing build cycle

Owner: #2315 — Goal: Automatic canonical mailbox rollover before GitHub comment ceiling.
Builder admission: #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.

The previous Control Tower could inspect goals but could not request a build.
Its read-only workflows and nomination proofs remain read-only. The existing
high-risk reviewed manual Actions request for exactly BUILD_NEXT_ELIGIBLE_GOAL
now accepts a **second, bounded trigger from the same original workflow**:
an authentic non-forced owner push to protected main. A merge on main can
therefore request the next eligible cycle without spending Codex or using the
saturated #3149 issue. Manual workflow_dispatch remains an optional fallback.
No additional worker, queue, lease, scheduler, endpoint, privileged instruction,
merge or runtime approval is introduced.

The owner supplies no script, path, free-form operation, provider, goal grant, source scope,
merge or runtime approval. The existing native caller still proves protected
source identity, independent signed artifact, original mission/worker custody,
gaming gates and execution permission before any native pickup.

## Actual command path

1. An owner-authenticated, non-forced push to protected main automatically
   invokes the existing **Stephanos Control Tower - Sovereign Control**
   workflow. The operator may use Run workflow on main to choose the fixed
   `BUILD_NEXT_ELIGIBLE_GOAL` (default) or `OBSERVE_CONTROL_SYSTEM` operation.
   The observation only reads the existing native inspectors; it never enters
   the maintenance executor. Never use a PR, fork, bot identity,
   branch creation, forced update or arbitrary command as a build request.
2. Its fixed request-build job verifies repository and numeric owner identity,
   the exact push after/before/head-commit or manual dispatch identity,
   workflow path, main, first attempt, closed fixed inputs and current source before
   and after GETs. It retains one request artifact, valid for ten minutes.
3. The existing Sovereign relay reads that workflow through authenticated GETs,
   checks the exact run, both jobs, one artifact, digest, ZIP CRC and bounds,
   operator IDs, timestamps, request operation and unchanged current main.
   Both the upstream run inventory and local candidate selection bind current
   main, so an older-source request cannot starve a newer valid request.
   The fixed filter uses GitHub's documented
   [workflow-run head_sha parameter](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow).
   Only this acquisition path brands an immutable request for execution.
4. The relay uses the original command execution ledger under the original
   mailbox state root. An exclusive durable reservation precedes exactly one
   invocation of the existing authenticated maintenance owner for a build,
   fixed action goal-discovery-heartbeat. An observation instead calls the
   checked-in read-only native inspector and stores its sanitized result in
   that same ledger. No new executor, timer, scheduler, queue or grant.
5. That action invokes the original canonical admission and Mission Worker
   build pipeline. It retains source scopes, required tests, leases, provider
   qualification, gaming/resource checks and protected integration gates.
6. The ledger and existing sovereign-relay-current status carry the correlated
   wake outcome. Actual build progress remains in the original worker receipts
   and autonomy track. A successful wake does not prove a source build.

The existing relay heartbeat services both allowed event classes through one bounded
current-head GET inventory (at most ten recent runs; overflow is a typed hold),
while preserving authenticated full run, job, artifact and payload checks. Other
event classes are not eligible; host source drift or an absent native consumer
continues to hold rather than assert construction.

The existing relay heartbeat services this carrier while the legacy mailbox
child remains in flight. A saturated issue cannot prevent request acquisition.
Concurrent ticks share one observer; its 30-second cooldown also applies to
failures. Up to ten recent workflow runs are inspected for authentic, eligible
requests oldest first. Already
recorded IDs are excluded. More than five requests in the active window fail
closed with backpressure rather than silently dropping older work.

Crash, unavailable/invalid owner response, unknown outcome or incomplete terminal publication retain the original
reservation. No timeout releases it or launches the request again. An owner
refusal is a blocked wake, not successful handoff or build. These transport
records never enter the Mission Worker's execution-receipt history, cannot
become scheduler/source completion evidence and do not acquire a source lease.

## Proof and live gates

Risk is HIGH: this introduces a remote trigger for an existing fixed native
build action. It requires independent exact-head security review, all affected
tests, protected source integration and deliberate adoption by the existing
relay owner. No source test, hosted request artifact or new workflow alone
installs this capability or grants maintenance recovery.

Tests exercise the full dispatch/artifact/reader/ledger/guarded-action path with
an explicitly mocked executor; those are source tests, not native pickup proof.
They cover forged/fork/rerun contexts, input injection, digest/ZIP tampering,
wrong job estates, main drift, expiry, concurrency, crash retention, custody
refusal, returned transport uncertainty after possible pickup, lost terminal
publication, stale-head starvation, and live polling during legacy carrier IO.

Historical preparation evidence (not current native proof): native maintenance held cycle
2a5f269f-bc64-45da-a62c-ab0e4c772294 with MAINTENANCE_CUSTODY_STATE_MISSING.
The original retained-audit repair owns its recovery. This build carrier must
report that hold without restarting the owner, clearing state, changing audit
policy, seizing a lease or claiming that a build started. A full native request
to material build acceptance requires that independently admitted recovery,
then one real worker pickup, material diff, required tests, independent review,
protected integration and installed/served proof. The original parent goals
remain open until their acceptance is independently met.

Reusable invariant: a carrier can request the existing build cycle without
owning admission. Exactly-once wake delivery and material source execution are
separate proofs, even when both belong to the same operator intent.

## Continuous-build convergence

This source addition changes only the existing read-only staging trigger and
native request verifier, not the underlying Mission Worker. It becomes
effective only after complete current-head CI, independently qualified HIGH
risk review, separately approved protected integration and physical installed
source reconciliation. A GitHub push without an authenticated 10-minute
native readback is not a live build. A signed wake response still is not
the original goal's SELECT/CLAIM/PICKUP/source/test/review/merge proof.

Every accepted protected-main owner push can cause at most one request ID
bound to its own GitHub run and first attempt. Existing durable command
ledger deduplication retains an ambiguous request without replay.
Foreign actor pushes are skipped before the job, and the JS producer and
native artifact reader independently fail closed on unexpected provenance.

## Conversational control and retained results

See [Sovereign conversational control](sovereign-conversational-control-v1.md)
for the existing AI route integration, read-only inspection, ledger-backed
historical results and source/live commissioning boundary. The operation
choice does not authorize mailbox rollover, runtime installation or owner
replacement. All earlier build admission and protected-main gates remain.
