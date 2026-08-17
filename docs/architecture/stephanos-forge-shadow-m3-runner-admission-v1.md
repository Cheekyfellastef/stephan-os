# Stephanos Forge Shadow M3 Runner Admission V1

## Purpose

This contract prepares the next source-only step of goal #1671: isolated local test and review capacity beside GitHub. It does not register, start, connect, or execute a runner.

GitHub remains the canonical public ledger, final hosted evidence boundary, protected merge authority, and disaster-recovery source. Forge M3 is additional construction capacity only.

## Required M2 proof

M3 planning fails closed until it receives one fresh completed `stephanos.battle-bridge-github-command-receipt.v1` for the existing `INSTALL_FORGE_SHADOW_M2` operation on issue #1507.

The receipt and its nested adapter result must prove:

- repository exactly `Cheekyfellastef/stephan-os`;
- exact current `main` head and tree parity between canonical GitHub source and the Forge mirror;
- Forgejo `15.0.6` and Podman `6.0.2`;
- immutable Forgejo OCI image digest;
- fixed rootless runtime identities and listener `127.0.0.1:3340`;
- content-addressed backup and successful restore drill;
- read-only root filesystem, all capabilities dropped, and `no-new-privileges`;
- no GitHub credential use or persistence;
- no existing runner registration, Actions execution, or merge authority;
- final verdict `FORGE_SHADOW_M2_READY` and `readyForM3=true`;
- non-empty bounded proof references;
- completion within the preceding 24 hours.

A caller-authored readiness object is not sufficient.

## Exact initial runner estate

The planner requires exactly two proposed pools:

1. `linux-isolated`
   - one to five rootless ephemeral runners;
   - fixed boundary `forge-linux-rootless-ephemeral`;
   - only the allowlisted workload identities:
     - `linux-shared-agent-tests`
     - `linux-stephanos-ui-build`
     - `linux-source-integrity-proof`.

2. `windows-proof-isolated`
   - exactly one limited-user proof runner;
   - fixed boundary `battle-bridge-windows-proof-sandbox`;
   - only the allowlisted workload identities:
     - `windows-source-controlled-proof`
     - `windows-edge-runtime-proof`.

Both pools require immutable runtime-artifact digests, bounded CPU/memory/disk/time/concurrency, ephemeral per-job workspaces, immutable content-addressed artifacts, and fixed read-only network policies.

## Denied authority

Every admitted plan explicitly denies:

- runner registration;
- runner or workflow execution;
- canonical checkout mounting;
- host-process or host-network access;
- Docker or Podman socket mounting;
- GitHub credential or secret access;
- public or Tailscale inbound exposure;
- source mutation or Git ref write;
- arbitrary command, shell, executable, path, environment, token, URL, or selector input;
- merge and deployment authority.

Every pool remains `executed=false`, `registrationAllowed=false`, and `requiresSeparateRuntimeAuthorization=true`.

## Next runtime boundary

A future separately reviewed adapter may consume this plan only after:

1. the real M2 receipt remains current and exact;
2. immutable runner artifacts are independently resolved and verified;
3. the runner installation/registration operation is source-controlled and closed-world;
4. a separate exact operator authorization is issued;
5. acceptance proves isolation, teardown, immutable artifacts, bounded receipts, and no authority leakage.

This V1 source slice performs none of those runtime actions.
