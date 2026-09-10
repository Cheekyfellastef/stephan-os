# OpenClaw Standalone Battle Bridge Recovery Executor V1

Issues: #1814, #1818

## Purpose

Add OpenClaw Standalone as another bounded entrance into the Battle Bridge recovery system without making OpenClaw a second recovery control plane.

This M3 slice consumes the M1/M2 mobile lifeboat request and GitHub-hosted attestation contracts. It qualifies only three checkout-independent operations:

- `PROBE_BATTLE_BRIDGE`
- `WAKE_CANONICAL_MAILBOX`
- `WAKE_CANONICAL_RECOVERY_MESH`

The same fixed adapter is designed to be callable by OpenClaw Standalone when OpenClaw is healthy and by the independent lifeboat sentinel when the OpenClaw Gateway is not healthy. The adapter itself does not need the Stephanos repository checkout in order to start.

## Why this is useful

The Battle Bridge has several recovery surfaces, but many previously shared the same mutable checkout and runtime assumptions. A stopped mailbox or Recovery Mesh should not require the mailbox or Recovery Mesh to repair itself.

This slice gives the future installed lifeboat bank one tiny fixed Windows adapter that can inspect and wake the two canonical Scheduled Tasks directly. It therefore adds a separate recovery entrance while preserving one canonical recovery target set.

## Trust chain

```text
owner request on canonical issue #1814
  -> GitHub-hosted M2 attestation
  -> M1 closed-world recovery plan validation
  -> OpenClaw M3 qualification check
  -> active known-good lifeboat bank
  -> fixed control-plane adapter
  -> canonical task only
  -> fresh post-action proof still required
```

Raw issue/comment text never becomes execution authority.

## OpenClaw role

OpenClaw is a provider for this operation, not the mission owner and not the root of trust.

The executor packet fixes:

- provider: `openclaw-standalone`
- adapter: `battle-bridge-lifeboat-fixed-control-plane-actions-v1`
- installed-bank relative adapter path: `actions/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1`
- executor root policy: `ACTIVE_KNOWN_GOOD_LIFEBOAT_BANK_OUTSIDE_REPOSITORY`

No caller chooses an executable, path, URL, task name, PID, Git ref or shell command.

The installed adapter is intentionally usable without the OpenClaw Gateway. This means OpenClaw can invoke it when available, while the lifeboat sentinel can still invoke the same reviewed action family if port 18789 or the gateway itself is down.

## Fixed Windows adapter

`scripts/windows/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1` has one required enum input and no path/executable/task parameters.

It knows only these Scheduled Tasks:

- `Stephanos Battle Bridge GitHub Command Mailbox`
- `Stephanos Battle Bridge Recovery Mesh`

Before a wake it proves the task has exactly one action and that the action still points to the canonical fixed `wscript.exe` + windowless Battle Bridge launcher identity. A missing task or changed action identity fails closed.

The adapter does not:

- install or re-register a missing task;
- edit source;
- run Git;
- clean/reset/stash a checkout;
- stop arbitrary processes;
- restart the PC;
- merge or deploy source;
- accept a generic PowerShell/script payload.

A successful wake result means only that the fixed task was safely dispatched. `freshPostActionProofRequired=true` prevents the wake itself from being painted as recovered Battle Bridge health.

## Current qualification boundary

M3 deliberately does **not** qualify these actions yet:

- `REPAIR_CONTROL_PLANE_TASKS`
- `RESTORE_CANONICAL_MAIN_PRESERVING_RUNTIME_STATE`
- `RESTART_CANONICAL_BACKEND`
- `REBUILD_AND_RESTART_CANONICAL_UI`
- `ROLLBACK_LIFEBOAT_TO_LAST_KNOWN_GOOD`
- `FULL_BATTLE_BRIDGE_RECOVERY`

Those require later independent lifeboat-bank installation, preservation, source staging/promotion and rollback machinery. Returning `OPENCLAW_RECOVERY_ACTION_NOT_YET_QUALIFIED` is the correct behavior until those layers are independently reviewed and proven.

## Required live acceptance later

After the independent A/B lifeboat bank installer is reviewed and separately authorized for Windows installation:

1. install this exact adapter into the inactive lifeboat bank;
2. self-test and promote the bank through the M1 A/B contract;
3. deliberately stop the canonical mailbox task;
4. submit one owner request through #1814 and obtain the GitHub M2 attestation;
5. have OpenClaw Standalone invoke the fixed adapter from outside `stephan-os`;
6. prove the mailbox task action identity before dispatch;
7. wake it;
8. require a fresh mailbox receipt-index advance before declaring recovery;
9. repeat for the Recovery Mesh;
10. prove the same adapter remains callable by the lifeboat sentinel with the OpenClaw Gateway unavailable.

## Truth boundary

This PR is source-only. It does not install the lifeboat, stop/start Windows tasks, repair the current Battle Bridge, mutate runtime state, merge source, deploy anything, execute Forge/Podman or restart the PC.
