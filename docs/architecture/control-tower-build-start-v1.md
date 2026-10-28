# Control Tower: start the existing build cycle without issue comments

Owner: #2315 — Goal: Automatic canonical mailbox rollover before GitHub comment ceiling.
Builder admission: #2961 — Goal: Core Daemon Blocked-Goal Repair Steward and Proof-Gated Re-Admission.

The previous Control Tower could inspect goals but could not request a build.
Its read-only workflows and nomination proofs remain read-only. This change
adds a separate, owner-authenticated manual Actions request for exactly
BUILD_NEXT_ELIGIBLE_GOAL. The operator supplies no script, path, operation,
provider, goal grant, source scope, merge or runtime approval.

## Actual command path

1. Run **Stephanos Control Tower - Start Next Eligible Build** on protected main.
2. Its fixed request-build job verifies repository and numeric owner identity,
   workflow path, main, first attempt, empty inputs and current source before
   and after GETs. It retains one request artifact, valid for ten minutes.
3. The existing Sovereign relay reads that workflow through authenticated GETs,
   checks the exact run, both jobs, one artifact, digest, ZIP CRC and bounds,
   operator IDs, timestamps, request operation and unchanged current main.
   Only this acquisition path brands an immutable request for execution.
4. The relay uses the original command execution ledger under the original
   mailbox state root. An exclusive durable reservation precedes exactly one
   invocation of the existing authenticated maintenance owner, fixed action
   goal-discovery-heartbeat. No new executor, timer, scheduler, queue or grant.
5. That action invokes the original canonical admission and Mission Worker
   build pipeline. It retains source scopes, required tests, leases, provider
   qualification, gaming/resource checks and protected integration gates.
6. The ledger and existing sovereign-relay-current status carry the correlated
   wake outcome. Actual build progress remains in the original worker receipts
   and autonomy track. A successful wake does not prove a source build.

The existing relay heartbeat services this carrier while the legacy mailbox
child remains in flight. A saturated issue cannot prevent request acquisition.
Concurrent ticks share one observer; its 30-second cooldown also applies to
failures. Up to five recent requests are considered oldest first. Already
recorded IDs are excluded. More than five requests in the active window fail
closed with backpressure rather than silently dropping older work.

Crash, unknown outcome or incomplete terminal publication retain the original
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
refusal, lost terminal publication, and live polling during legacy carrier IO.

At preparation, native maintenance holds cycle
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
