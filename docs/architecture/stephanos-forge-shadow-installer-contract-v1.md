# Stephanos Forge Shadow Installer Contract V1

Issue: #1671
Parent: PR #1683

## Purpose

This slice converts the accepted Forge shadow deployment plan into one fixed, source-controlled installer request for the Windows Battle Bridge. It is still a planner and contract, not an executor.

The route is intentionally narrow:

```text
Battle Bridge Windows host
→ dedicated WSL2 boundary `stephanos-forge-shadow`
→ rootless Podman
→ immutable Forgejo image by sha256 digest
→ 127.0.0.1:13000 → container port 3000
→ anonymous fetch-only mirror of Cheekyfellastef/stephan-os
```

No alternative host, WSL distribution, container engine, image repository, listener, Git remote or authentication mode is accepted by V1.

## Fixed runtime identities

- repository: `Cheekyfellastef/stephan-os`
- host: `battle-bridge`
- adapter: `forge-shadow-wsl2-rootless-podman-v1`
- WSL2 distribution identity: `stephanos-forge-shadow`
- container engine: `podman-rootless`
- Forgejo image repository: `codeberg.org/forgejo/forgejo`
- image identity: exact `sha256:` digest supplied by the reviewed parent plan
- listener: `127.0.0.1:13000`
- Forgejo HTTP container port: `3000`
- Forgejo SSH: disabled
- data volume identity: `forge-shadow-data-v1`
- Git source: `https://github.com/Cheekyfellastef/stephan-os.git`
- Git authentication: anonymous public read

The contract does not choose a mutable image tag or current Forgejo release. Runtime execution must be bound to the exact immutable digest admitted by the reviewed deployment plan.

## Container safety posture

The execution profile requires:

- read-only container root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges` enabled;
- one fixed writable data-volume identity only;
- no SSH listener;
- no public or Tailscale listener;
- no caller-supplied path, executable, command, argument, environment or credential.

The future executor must prove these settings from the running boundary before runtime readiness can be claimed.

## Git posture

The shadow remains manual fetch-only during M2:

- exact public GitHub remote only;
- anonymous read only;
- automatic synchronization disabled;
- push disabled;
- force update disabled;
- pruning disabled.

The installer contract therefore cannot become a second scheduler or publication authority.

## Backup and parity binding

The backup target identity must exactly match the parent deployment request. After execution, the existing parity contract must prove:

- exact canonical main head;
- exact Git object/tree parity;
- read-only service posture;
- current restorable backup;
- no ref-write authority.

Runtime truth remains fixed to:

- `status/forge-shadow-runtime.json`
- `proofs/forge-shadow-parity.json`

## Fixed execution steps

A valid request contains nine named, non-executed steps:

1. verify WSL2 isolation;
2. verify rootless container engine;
3. back up existing shadow state;
4. verify backup restore drill;
5. pull the immutable Forgejo image;
6. configure the loopback read-only shadow;
7. fetch canonical main anonymously;
8. verify object/tree parity;
9. publish bounded runtime proof.

Every step is emitted with `executed: false`, `mutationAllowedByContract: false`, and `requiresSeparateRuntimeAuthorization: true`.

## Authority boundary

This module grants zero authority for source mutation, GitHub/Forge ref writes, force push, branch deletion, merge, deployment, runtime/process/host mutation, runner registration, credentials, public/Tailscale exposure, scheduling, arbitrary commands or arbitrary filesystem access.

A later Battle Bridge execution adapter must map these fixed step IDs to separately reviewed handlers and obtain an exact operator-approved runtime command before any mutation begins.

## Validation

`shared/agents/forgeShadowInstallerContractV1.test.mjs` proves:

- deterministic request identity;
- canonical repository/head/digest binding;
- WSL2/rootless Podman route identity;
- fixed loopback ports and SSH disablement;
- read-only root filesystem and privilege reduction;
- anonymous fetch-only Git posture;
- backup identity continuity;
- rejection of unexpected command/path/secret/environment fields;
- zero execution authority.

This PR does not install Forgejo and makes no runtime or live claim.
