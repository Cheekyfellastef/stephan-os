# Battle Bridge Recovery Lifeboat M7: verification and crash-aware terminalization

## Purpose

M7 closes two truth gaps left by M6.

First, a successful `Start-ScheduledTask` request is not proof that the target Battle Bridge component is healthy. Second, the M6 create-new claim is deliberately replay-safe but a consumer process that dies after acquiring it can leave the request permanently ambiguous.

M7 keeps the existing closed-world R1 action set and adds bounded post-action proof plus at-most-once crash terminalization. It remains source-only until the stacked lifeboat is separately reviewed, merged, installed and accepted on Windows.

## Fixed action boundary

The executable recovery vocabulary remains exactly:

- `PROBE_BATTLE_BRIDGE`
- `WAKE_CANONICAL_MAILBOX`
- `WAKE_CANONICAL_RECOVERY_MESH`

M7 adds no backend restart, UI rebuild, checkout repair, task registration, arbitrary PowerShell, arbitrary task, Git operation, deployment, Podman/Forge operation or PC restart.

## Post-action verification

After a successful fixed wake, the consumer waits a fixed short interval and invokes only the existing read-only `PROBE_BATTLE_BRIDGE` action.

For a mailbox or Recovery Mesh wake, the target is considered *component verified* only when the fixed task still exists and its reviewed `wscript.exe` action identity remains exact. A task that is currently `Running` is accepted as current component evidence. A non-running task is accepted only when `lastTaskResult == 0` **and** its canonical post-wake `lastRunTimeUtc` is demonstrably newer than the exact pre-wake snapshot emitted by the fixed action receipt. If the task had never run before the wake, a new valid post-wake timestamp is sufficient. Unchanged, older, missing or malformed timestamps remain non-green, so a stale historical success can never certify a new wake.

This is deliberately narrower than whole-system recovery. A verified target component does not prove backend 8787, UI 4173, OpenClaw, source convergence or the complete Battle Bridge are healthy. Every receipt therefore retains `recoveredHealthClaimed=false` and remote status continues to require stronger later proof before whole-system green may be published.

A pure `PROBE_BATTLE_BRIDGE` request is terminalized as a verified read-only probe when the fixed probe returns a valid receipt. It does not claim healthy Battle Bridge state merely because the probe executed.

## Execution journal

Before any fixed action runs, M7 now persists both:

1. the existing exclusive create-new request claim; and
2. a create-new execution journal in `state/execution-journal/<requestId>.json` with state `CLAIMED`.

The journal progresses only through bounded states:

```text
CLAIMED
ACTION_RETURNED
TERMINAL
```

After the fixed action returns, `ACTION_RETURNED` is written before post-action verification. A terminal receipt, terminal journal and consumed-request record are then written for successful execution, failed execution and failed verification alike. The original request cannot be replayed after a terminal outcome.

## Crash-aware recovery

The installed task uses `MultipleInstances IgnoreNew`, so a new bank invocation cannot overlap the previous invocation. At the beginning of every new run, M7 scans a fixed bounded set of locally-created claim files.

A valid claim that has no consumed-request record and no terminal journal is treated as an interrupted previous owner. The new process does **not** repeat the potentially already-executed wake. Instead it:

1. performs only the fixed read-only Battle Bridge probe;
2. emits a deterministic interruption receipt;
3. terminalizes the journal with `RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY`;
4. writes the consumed-request record; and
5. requires a new owner request for any further mutation.

A malformed or semantically invalid interrupted claim is never silently skipped. M7 publishes `RECOVERY_LOCAL_STATE_BLOCKED` with a specific malformed, identity-invalid or action-invalid blocker and aborts before fetching or executing a new recovery request. This keeps corrupted local claim state visible and fail-closed rather than turning it into an unexplained permanent `EXCLUSIVE_CLAIM_EXISTS` tombstone.

This is intentionally at-most-once. Ambiguous execution is safer than silently performing a duplicate recovery mutation.

## Remote truth

The current mobile recovery status now carries the terminal verification verdict and whether the exact target component is currently healthy enough for the narrow R1 proof. It never turns that component proof into a whole-Battle-Bridge health claim.

Representative terminal outcomes are:

- `RECOVERY_PROBE_VERIFIED`
- `RECOVERY_ACTION_TARGET_VERIFIED`
- `RECOVERY_ACTION_DISPATCHED_VERIFICATION_FAILED`
- `RECOVERY_ACTION_BLOCKED`
- `RECOVERY_INTERRUPTED_CLAIM_TERMINALIZED_NO_REPLAY`
- `RECOVERY_LOCAL_STATE_BLOCKED`

Silence, malformed probe output, stale task-success evidence, corrupted interrupted-claim state and ambiguous interrupted execution remain non-green truth.

## Authority boundary

M7 does not merge or deploy source, install or activate the lifeboat, mutate Windows in this PR, install Podman, execute Forge M2/M3 or restart the PC. It preserves the existing owner request plus GitHub-hosted attestation boundary and adds no caller-selected URL, path, executable, task, PID, Git ref or shell command.

## Next rung

After the M1-M7 source stack settles, the next recovery milestone is broader fixed repair qualification: preservation-first control-plane task repair and exact canonical-main recovery, each behind separate reviewed executors and the same mobile attestation boundary. Real iPad/iPhone chaos acceptance remains required before #1814 is complete.
