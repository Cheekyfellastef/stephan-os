# Stephanos Forge Shadow M3 Runner Runtime Plan V1

## Purpose

This source-only slice converts the merged Forge M3 admission contract into one closed-world runtime plan for future isolated runner installation, registration, canary execution, proof publication and teardown.

It does not install, register, connect, start or execute a runner. It does not fetch an artifact. It does not issue or consume registration credentials. Every runtime step remains unexecuted and requires a separate exact-head runtime authorization.

## Prerequisite chain

The plan reruns the canonical `planForgeShadowM3RunnerAdmission` function from source. A caller-authored object that merely claims `FORGE_SHADOW_M3_RUNNER_ADMISSION_PLAN_READY` is not accepted.

The canonical admission planner must independently prove:

1. a fresh completed issue #1507 mailbox receipt for `INSTALL_FORGE_SHADOW_M2`;
2. exact current Git head and tree parity between canonical source and the Forge mirror;
3. Forgejo 15.0.6 and Podman 6.0.2 identities;
4. immutable Forgejo image identity;
5. rootless, loopback-only and sealed privilege posture;
6. content-addressed backup and successful restore drill;
7. no GitHub credential, runner registration, Actions execution or merge authority;
8. exactly one Linux runner pool and one isolated Windows proof pool with zero execution authority.

Any missing, stale, forged, blocked or widened prerequisite remains blocked.

## Immutable runner artifact resolution

The runtime plan accepts exactly two bounded artifact-resolution observations:

| Runner class | Logical artifact identity | Platform |
| --- | --- | --- |
| `linux-isolated` | `forgejo-runner-linux-amd64` | `linux/amd64` |
| `windows-proof-isolated` | `forgejo-runner-windows-amd64` | `windows/amd64` |

The logical identities are Stephanos contract identities, not caller-selected file names or URLs.

Both observations must:

- come from fixed source identity `forgejo-official-runner-release`;
- use stable semantic versions only;
- resolve to the same release version and release-manifest digest;
- carry immutable `sha256:` artifact, release-manifest, checksum-manifest and provenance digests;
- match the exact artifact digest already admitted for the corresponding runner pool;
- prove TLS, release-manifest and checksum verification;
- reject mutable references;
- use no registry or release credential;
- be no more than 24 hours old;
- include bounded safe proof references;
- remain below the fixed 512 MiB per-artifact ceiling.

The normalized pair receives one deterministic content digest so later runtime receipts can bind the exact artifact set.

## Fixed runtime identities

The runtime plan derives identities. Callers cannot choose them.

### Linux pool

- runner class: `linux-isolated`
- runtime boundary: `forge-linux-rootless-ephemeral`
- identities: `stephanos-forge-linux-runner-01` through the exact admitted pool count
- labels: `self-hosted`, `linux`, `x64`, `stephanos-forge`, `ephemeral`

### Windows proof pool

- runner class: `windows-proof-isolated`
- runtime boundary: `battle-bridge-windows-proof-sandbox`
- identity: `stephanos-forge-windows-proof-runner-01`
- labels: `self-hosted`, `windows`, `x64`, `stephanos-forge`, `proof-only`, `ephemeral`

Both classes are fixed to disposable Forge service `stephanos-forge-shadow-m3-canary` on `127.0.0.1:3342` and registration mode `one-time-local-contained`. The sealed M2 service remains separately bound to `127.0.0.1:3340` with Actions disabled.

## Disposable canary Forge boundary

The sealed M2 service at `127.0.0.1:3340` remains immutable and keeps Actions disabled. M3 never registers runners against that canonical service.

Instead, every authorised canary execution must:

1. copy the exact content-addressed backup named by the admitted M2 receipt into a new ephemeral volume;
2. start `stephanos-forge-shadow-m3-canary` from the same immutable Forgejo image at loopback `127.0.0.1:3342`;
3. enable Actions only in that disposable copy and allow only `.forgejo/workflows/forge-shadow-m3-isolation-canary-v1.yml`;
4. issue repository-scoped, ephemeral, one-job registration material;
5. run one fixed isolation canary for the exact authorised head and tree;
6. destroy registration material, runner workspace, outer runtime boundary, temporary Windows relay, canary Forge container and ephemeral volume; and
7. re-prove that the canonical M2 service is still sealed, Actions-disabled and unchanged.

Windows Sandbox cannot consume a host loopback listener directly. Its executor may therefore create one short-lived relay bound only to the Hyper-V internal adapter and restricted by firewall to the exact sandbox address. Public, LAN-wide and Tailscale bindings remain forbidden, and a successful receipt requires proof that the relay and firewall rule were removed.

## Fixed execution sequence

The plan emits only this ordered sequence, with every step marked `executed: false`:

1. verify current M2 and M3 admission evidence;
2. verify official immutable runner artifacts;
3. copy the proven M2 backup to a disposable canary volume;
4. start an Actions-enabled canary Forge without mutating M2;
5. create isolated ephemeral runtime boundaries;
6. install fixed runner artifacts;
7. issue contained one-time local registration credentials;
8. register fixed runner identities;
9. run a bounded isolation canary;
10. publish immutable content-addressed proofs;
11. unregister runner identities;
12. destroy ephemeral workspaces and runtime boundaries;
13. destroy the disposable canary Forge and private relay;
14. prove zero residual credential or authority state.

A future adapter must implement these named operations directly. The plan contains no arbitrary command, executable, path, URL, environment, shell or PowerShell surface.

## Teardown and proof boundaries

Every admitted runtime must:

- unregister after the canary and after every job;
- revoke and delete one-time registration material;
- destroy the workspace and runtime boundary after every job;
- destroy the disposable canary Forge, its data volume and any Windows-only internal relay;
- re-prove that canonical M2 remains sealed, Actions-disabled and unchanged;
- preserve only immutable proof artifacts;
- complete teardown within 300 seconds;
- quarantine on teardown failure;
- prove zero residual runner registration, credential material and workspace before success.

The future runtime receipt schema is:

`stephanos.forge-shadow-m3-runner-runtime-receipt.v1`

Proofs must bind exact source head and tree, exact artifact-set digest, fixed runner identities, teardown result and zero residual authority. Credentials or secret-bearing material are forbidden from receipts and logs.

## Authority

This slice grants no authority for:

- artifact network fetch;
- runner installation, registration or execution;
- workflow execution;
- source mutation or Git ref writes;
- canonical checkout, host process or container-socket access;
- GitHub credentials or secrets;
- public or Tailscale exposure;
- arbitrary commands;
- deployment;
- merge.

A separate exact-head protected runtime adapter, operator authorization and real acceptance receipt remain mandatory before any runner can become operational.
