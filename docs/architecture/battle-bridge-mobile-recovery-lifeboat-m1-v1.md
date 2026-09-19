# Battle Bridge Mobile Recovery Lifeboat M1

Status: source contract only; not installed and not live.

Issue: #1814

## Purpose

The 2026-08-16 Battle Bridge incident proved that in-band recovery is insufficient when the updater, checkout, backend, UI, mailbox and Recovery Mesh share enough assumptions to fail together. M1 defines the closed-world mobile recovery trust contract that later Windows and GitHub-hosted adapters must obey.

The end state is recovery from ChatGPT on iPad/iPhone, GitHub Mobile or an authenticated Tailnet route without local keyboard/mouse access.

## Independence boundary

The eventual lifeboat is required to run outside the mutable `stephan-os` checkout and must not require Stephanos UI 4173, backend 8787, OpenClaw, Mission Orchestrator, the #1507 mailbox, Recovery Mesh, Node application startup or a clean/latest repository checkout to be healthy.

M1 does not install that lifeboat. It defines the data and authority boundary first.

## Mobile request contract

`stephanos.battle-bridge-mobile-recovery-request.v1` is intentionally closed-world. A request is bound to:

- repository `Cheekyfellastef/stephan-os`;
- canonical recovery issue #1814;
- operator `Cheekyfellastef` with GitHub `OWNER` association;
- a bounded request ID and 128-bit hexadecimal nonce;
- one exact allowlisted recovery action;
- canonical UTC request/expiry timestamps;
- at most a five-minute authority window.

Extra fields, accessors, symbols, malformed objects, unknown actions, stale requests, future-skewed requests and replayed request IDs fail closed.

## GitHub attestation boundary

A raw owner comment is not execution authority.

The future GitHub-hosted workflow `.github/workflows/battle-bridge-mobile-recovery-attestation-v1.yml` must validate the GitHub event using trusted default-branch code and emit `stephanos.battle-bridge-mobile-recovery-attestation.v1` bound to the exact request SHA-256.

The local lifeboat may plan recovery only after the attestation proves:

- exact repository and issue;
- exact request ID/action/hash;
- exact trusted workflow path;
- `github-actions[bot]` reviewer identity;
- verdict `ATTESTED`;
- canonical non-expired timestamps matching the request authority window.

This makes ChatGPT/GitHub Mobile a request surface, not a remote shell.

## Fixed recovery actions

M1 admits only:

- `PROBE_BATTLE_BRIDGE`
- `REPAIR_CONTROL_PLANE_TASKS`
- `RESTORE_CANONICAL_MAIN_PRESERVING_RUNTIME_STATE`
- `RESTART_CANONICAL_BACKEND`
- `REBUILD_AND_RESTART_CANONICAL_UI`
- `WAKE_CANONICAL_MAILBOX`
- `WAKE_CANONICAL_RECOVERY_MESH`
- `ROLLBACK_LIFEBOAT_TO_LAST_KNOWN_GOOD`
- `FULL_BATTLE_BRIDGE_RECOVERY`

The resulting plan contains only fixed internal step identities. It grants no caller-selected shell, executable, path, URL, task, PID, Git ref or command.

Every plan keeps destructive Git, force-push, PC restart, merge, deployment and Podman/Forge execution authority false.

## A/B lifeboat banks

`stephanos.battle-bridge-lifeboat-bank-state.v1` models two installed recovery banks, A and B.

Promotion is allowed only when:

- the current active bank is known-good and has a fresh heartbeat;
- the inactive bank has a distinct immutable manifest;
- the inactive bank has passed deterministic self-tests and has a fresh heartbeat.

The planner requires an atomic active-bank switch, retains the former active bank as rollback and explicitly forbids overwriting both banks in one update.

This prevents an update to the recovery system itself from erasing the previous recovery root of trust.

## Runtime preservation

All repair actions that can affect source/runtime interaction are explicitly preservation-first. Later implementation must copy and hash the canonical runtime-owned state before any checkout promotion and verify those hashes afterward.

M1 deliberately does not define `git reset --hard`, `git clean`, stash, skip-worktree or assume-unchanged as recovery operations.

## Next slices

M2: GitHub-hosted issue-comment attestation workflow and immutable recovery receipt contract.

M3: checkout-independent Windows lifeboat package plus A/B installer/update state machine, installed outside the repo checkout.

M4: fixed local recovery executor for preservation, side-by-side canonical-main staging, task repair, backend/UI recovery and receipt publication.

M5: Tailnet-only mobile status/recovery surface terminating at the lifeboat.

M6: remote status projection plus ChatGPT/GitHub-Mobile request adapter.

M7: real Windows chaos drills proving remote recovery from iPad/iPhone for stopped/stale backend, UI, mailbox, Recovery Mesh, dirty runtime memory, broken checkout and failed new lifeboat bank.

## Truth boundary

This M1 slice performs no Windows installation, task registration, source repair, process restart, GitHub issue execution, Tailnet action, merge, deployment, Podman/Forge action or PC restart. It does not claim the Battle Bridge can already be recovered remotely.
