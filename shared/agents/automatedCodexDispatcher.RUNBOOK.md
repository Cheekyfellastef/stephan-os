# Automated Codex Dispatcher V1 Runbook

## Scope

The dispatcher consumes records from the existing Codex Dispatch Queue and projects dispatcher state into the existing Shared Agent Workspace. It does not create another queue, proof system, shell runner, merge path, or browser automation surface.

## State flow

`IDLE -> SCANNING -> READY -> WAITING_FOR_OPERATOR | DISPATCHING -> WAITING_FOR_RESULT -> VERIFIED | FAILED | BLOCKED_BY_MISSING_INTEGRATION`

V1 exposes the state machine as structured records so supervisors and dashboards can truthfully show whether a queued job is waiting for manual operator dispatch, blocked by a missing integration, or dispatched through a proven adapter.

## Capability modes

- `MANUAL_ONLY`: the dispatcher emits a dispatch packet and `WAITING_FOR_OPERATOR`; it never claims the job started.
- `AUTOMATED_SUPPORTED`: all required capabilities are present and a supported adapter returns an accepted structured dispatch receipt.
- `AUTOMATED_UNAVAILABLE`: the dispatcher publishes `BLOCKED_BY_MISSING_INTEGRATION` with the exact missing capabilities.

## Manual dispatch procedure

1. Read the `dispatchPacket` for the queued record.
2. Operator sends that exact packet to a supported Codex surface.
3. Operator returns a structured dispatch receipt.
4. The dispatcher may verify the receipt through the Verification Harness, but it must not mark work started without that receipt.

## Automatic dispatch procedure

1. Confirm capability detection returns `AUTOMATED_SUPPORTED`.
2. Call only the supported adapter interface with the dispatch packet.
3. Require an accepted structured dispatch receipt.
4. Verify the receipt with the Verification Harness `CommandReceiptVerifier` and `ProofReferenceVerifier`.
5. Publish status/event records to the Shared Agent Workspace and wait for result proof.

## Codex meter / capacity outage procedure

An empty Codex meter, explicit usage-limit response, exhausted code-review quota, or equivalent Codex capacity error is a provider-capacity outage, not a programme stop condition.

1. Preserve the exact mission, goal, branch, PR, head/base/tree, proof and operator authority already in flight.
2. Do not keep retrying Codex after quota exhaustion is proven for that surface.
3. Route immediately through the existing provider-neutral Stephanos machinery using an already-qualified OpenClaw, Forge/Foundry, Stephanos Native, GitHub Actions independent-review, GitHub App publication, or Battle Bridge route that admits the task.
4. For review work, keep the same review class and exact-head/base requirements. Use the provider-neutral exact-head review coordinator and immutable-artifact recovery path rather than waiting for Codex.
5. If no qualified alternative can perform that exact task class, park only that lane with a typed capacity blocker and continue resource-disjoint eligible work.
6. Never create duplicate controllers, workers, schedulers, branches, PRs or review lanes merely to escape a Codex quota condition.
7. Never weaken merge, deployment, runtime, credential, spending or other operator gates because Codex is unavailable.
8. Report the condition as `CODEX_CAPACITY_UNAVAILABLE` or equivalent provider-specific truth. Do not describe GitHub, Stephanos, or the whole programme as blocked while another qualified route exists.

New chats and controllers should also follow `docs/codex-capacity-outage-runbook.md` and the repository-wide `AGENTS.md` **Provider/review capacity continuity** doctrine. The expected behavior is route-around and continue, not narration-and-wait.

## Safety boundaries

- No fake dispatch or simulated success.
- No arbitrary shell execution.
- No browser automation.
- No secret, environment, token, or session dumping.
- No merge authority.
- No operator approval bypass.
- No automatic writes outside the Shared Agent Workspace publication contract.
