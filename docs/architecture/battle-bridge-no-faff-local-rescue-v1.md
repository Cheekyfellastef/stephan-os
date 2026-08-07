# Battle Bridge No-Faff Local Rescue V1

## Purpose

Provide one bounded local click that restores the existing Battle Bridge GitHub Sync, Recovery Mesh and GitHub Command Mailbox tasks when every remote recovery entrance is unavailable or unconfigured.

This is an entrance to the existing #1507 control plane. It is not another mailbox, worker, scheduler, recovery coordinator, truth store or Forge runtime.

## Why this exists

The independent Tailscale bootstrap remains valuable, but its first live prerequisite proof correctly stopped because the tailnet workload identity and Windows OpenSSH settings were not configured. Those credentials cannot be generated safely from repository source.

The local rescue avoids turning that one-time external identity setup into a permanent project stall. It requires no Tailscale credentials and delegates source mutation only to the already-reviewed canonical GitHub Sync task.

## One-click route

`Repair-Battle-Bridge-Control-Plane-Now.cmd` invokes the fixed PowerShell rescue from the canonical Windows checkout.

The rescue:

1. proves the canonical checkout, `main` branch and canonical GitHub origin;
2. reads public GitHub `main` through fixed `git ls-remote`;
3. invokes only `install-battle-bridge-github-sync.ps1 -StartNow`;
4. waits for the existing reviewed sync task to converge the checkout to exact public `main`;
5. proves the exact commit and tree;
6. invokes only the existing Recovery Mesh and GitHub Command Mailbox installers with `-StartNow`;
7. proves all three canonical tasks exist;
8. writes a bounded local receipt ending in `BATTLE_BRIDGE_NO_FAFF_RESCUE_READY`.

## Authority boundary

The rescue itself performs no source mutation and contains no `fetch`, `merge`, checkout, reset, clean, stash, rebase, push or branch operation. Source convergence belongs entirely to the existing reviewed GitHub Sync machinery.

It accepts no caller-selected path, repository, remote, executable, command, task name, credential or network target. The only network read is the fixed public GitHub `refs/heads/main` identity.

It does not:

- configure or read Tailscale credentials;
- expose a public listener;
- restart the PC;
- mutate OpenClaw;
- install or mutate Forge;
- register a runner;
- merge or write GitHub refs;
- create a second worker, mailbox, Recovery Mesh or truth store.

## Runtime continuation

Once the mailbox is restored, it consumes the already-existing owner-authored #1507 command lane. Forge M2 remains unproven until a fresh exact-head diagnostic resolves the real immutable Forgejo digest and the fixed installer returns `FORGE_SHADOW_M2_READY` with the complete Windows proof set.
