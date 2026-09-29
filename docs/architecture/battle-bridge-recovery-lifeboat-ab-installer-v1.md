# Battle Bridge Recovery Lifeboat A/B Installer V1

Issue: #1814
Parent recovery executor: PR #1820 / #1818

## Purpose

Move the Battle Bridge recovery root of trust outside the mutable `stephan-os` checkout.

This slice defines and implements the source for a limited-user Windows lifeboat installation rooted at the fixed local path:

```text
%LOCALAPPDATA%\Stephanos\BattleBridgeRecoveryLifeboat
```

After a separately authorized installation, its watchdog can start without the Stephanos UI, backend, OpenClaw Gateway, Node/npm, GitHub command mailbox, Recovery Mesh, or repository checkout being healthy.

## Installed shape

```text
BattleBridgeRecoveryLifeboat/
  run-battle-bridge-recovery-lifeboat-active-v1.ps1
  banks/
    A/
      version.txt
      manifest.sha256
      run-battle-bridge-recovery-lifeboat-bank-v1.ps1
      actions/battle-bridge-lifeboat-fixed-control-plane-actions-v1.ps1
    B/
      ...
  state/active-bank.json
  status/bank-A-heartbeat.json
  status/bank-B-heartbeat.json
  staging/
```

The Scheduled Task identity is fixed to `Stephanos Battle Bridge Recovery Lifeboat`. It uses the canonical Windows PowerShell executable, runs as the interactive user at `Limited` run level, starts at logon, and repeats every two minutes with `IgnoreNew` instance policy.

## A/B rule

A bank update never targets the current active bank.

Before the active pointer can change, the installer must:

1. prove the existing active bank has a fresh healthy heartbeat when one exists;
2. stage the candidate into only the inactive bank;
3. calculate the candidate payload manifest from the exact bank runner, fixed recovery adapter and version;
4. reject a candidate whose manifest equals the current active bank;
5. run the installed candidate bank from its final A/B path;
6. require that candidate to recompute and verify its own payload manifest;
7. require a fresh healthy heartbeat bound to that exact manifest;
8. only then atomically publish `active-bank.json`;
9. retain the previous active bank as rollback.

The first installation is deliberately classified as a single known-good bootstrap. It does not claim production A/B rollback until a second distinct version has been successfully staged and promoted.

## Immutable launcher boundary

The top-level active-bank launcher is intentionally tiny. Once installed, the ordinary bank installer will not silently replace it with different bytes. If reviewed source and installed launcher differ, installation fails closed. A future launcher change therefore requires a separately designed migration rather than silently weakening both banks at once.

The launcher accepts no arguments. It reads only the fixed active-bank state, allows only bank `A` or `B`, requires `selfTestVerdict=PASS`, binds the bank manifest to active state, and starts the fixed bank runner through the canonical Windows PowerShell path.

## Bank integrity

Each bank runner independently recomputes:

- its own SHA-256;
- the fixed Battle Bridge action adapter SHA-256;
- the version-bound manifest SHA-256.

It refuses to operate if these do not match `manifest.sha256`. A heartbeat is emitted only after payload verification and the fixed `PROBE_BATTLE_BRIDGE` adapter completes successfully.

## Relationship to OpenClaw

OpenClaw Standalone is one possible caller of the reviewed fixed recovery adapter when OpenClaw is healthy. It is not required for the lifeboat watchdog to start. The same installed bank remains usable by the independent sentinel when the OpenClaw Gateway is unavailable.

This avoids turning OpenClaw into a new single point of failure while still making it a useful additional recovery hand.

## Deliberate limits

This slice does not yet poll GitHub for the M2 attestation, consume a recovery lease, repair a missing lifeboat Scheduled Task, restore a broken checkout, preserve/restore runtime memory, restart backend/UI, or perform full recovery. Those remain later #1814 slices.

The source grants no arbitrary path, executable, task, URL, shell command, Git mutation, source mutation, merge, deployment or PC restart authority.

## Truth boundary

Source only. Creating this PR does not install the lifeboat or mutate the Windows Battle Bridge. Installation and live chaos acceptance remain separately approval-gated.
