# Stephanos Forge shadow Podman runtime V1

This document advances issue #1671 from the M2 deployment-admission contract into one fixed Windows runtime shape. It is additive capacity only. GitHub remains the canonical public ledger, final hosted review boundary and protected merge authority.

## Fixed runtime identity

- repository: `Cheekyfellastef/stephan-os`
- Windows host posture: Windows 10 client, x64, build 19043 through 21999 inclusive, with real WSL2 evidence, admitted only through `podman-desktop-windows10-wsl2-v1`
- WSL2 evidence: either `Default Version: 2` from `wsl.exe --status` or a version-2 distribution from `wsl.exe --list --verbose`
- container engine: Podman `6.0.2`
- machine: `stephanos-forge-shadow`
- machine provider: WSL
- machine mode: rootless
- machine resources: 4 CPUs, 4096 MiB memory, 40 GiB disk
- Forgejo line: `15.0.6` LTS
- image tag used only to discover/confirm release identity: `code.forgejo.org/forgejo/forgejo:15.0.6-rootless`
- runtime image authority: exact `code.forgejo.org/forgejo/forgejo@sha256:<64 hex>` only
- container: `stephanos-forge-shadow`
- data volume: `stephanos-forge-shadow-data`
- host listener: `127.0.0.1:3340`
- local Forge owner: `stephanos-shadow`
- canonical remote: `https://github.com/Cheekyfellastef/stephan-os.git`

The image tag is never sufficient to start the service. An exact digest must be observed and bound before runtime mutation.

## Credential boundary

The public GitHub source requires no GitHub token, cookie, session, SSH key or other GitHub credential.

A fresh Forgejo instance nevertheless needs a local owner to create its one pull mirror. The bounded bootstrap may therefore create exactly one random local Forge credential under these rules:

- generated only for non-admin user `stephanos-shadow` by the Forgejo administrative CLI;
- the random local password is never supplied on a Windows process command line;
- one temporary local access token is scoped only to `write:repository,write:user`;
- the raw token may exist only in memory of the fixed installer process while it calls the loopback Forgejo API;
- it is never persisted in the Stephanos repository, Shared Workspace, filesystem, logs, GitHub comments or runtime receipts;
- it is never reused as a GitHub credential and no GitHub credential is created;
- the token must be deleted immediately after the one mirror migration and before the runtime is sealed read-only;
- the retained local owner has an unknown random password after bootstrap, no retained access token and no administrator status.

Credential material is not proof. Receipts expose only the fact that containment and revocation checks passed.

## Exact progression

The runtime planner and fixed Windows adapter progress only through these states:

1. prove the allowlisted Windows host adapter, Windows 10 client identity, x64 architecture, exact build range 19043-21999, real WSL2 evidence, `main` and the exact source head;
2. prove Podman 6.0.2 from one of two source-controlled installation paths, or stop at a separately authorised host prerequisite;
3. initialise the fixed rootless WSL Podman machine if absent;
4. start that exact machine if stopped;
5. pull only the exact Forgejo OCI digest;
6. prove the digest-pinned image contains the fixed tar and SHA-256 backup helper tools;
7. create the fixed named Forgejo data volume;
8. require the fixed loopback port to be free;
9. start the fixed Forgejo bootstrap container with no host source or host socket mount;
10. create the contained non-admin local owner if absent;
11. create exactly one unauthenticated public pull mirror from the canonical GitHub repository;
12. revoke the temporary local migration token;
13. require the mirror `main` head to equal the authorised exact source head; when an otherwise exact existing container is already sealed at an older well-formed head, open one fixed loopback-only refresh window for only `stephanos-shadow/stephan-os`, create and revoke a fresh contained local token around the manual mirror-sync request, require `main` to reach `ExpectedHead`, and close the window;
14. recreate the same container from the same digest and data volume with registration, SSH, Actions, packages, migrations, push-create, forks, webhooks, Git hooks, local imports, new mirrors, periodic mirror updates, runner registration and public/Tailscale exposure disabled, including after the bounded refresh window;
15. prove the container itself is rootless, read-only-rootfs, capability-free and `no-new-privileges`, with exactly one persistent writable data volume plus three bounded ephemeral tmpfs surfaces;
16. prove exact Git head/tree parity;
17. create a bounded content-addressed backup using the same digest-pinned image as the copy helper;
18. restore that backup into an isolated temporary volume and start a temporary loopback Forgejo restore probe on port 3341 with its own exact `ROOT_URL` and the same privilege seal;
19. require the restored service to become healthy and expose the exact expected `main` head;
20. tear down the restore probe, restart the canonical shadow, and re-prove service health and privilege identity;
21. only then return `FORGE_SHADOW_M2_READY` and permit a separate M3 runner slice.

The host gate does not accept `wsl.exe` existence or command success as WSL2 proof. A WSL1-only or unconfigured host blocks before Podman or Forge runtime mutation. Build 22000 or newer is outside this Windows-10-only adapter even if a legacy registry product string still says Windows 10, and a non-x64 host cannot consume the fixed amd64 Podman asset.

A wrong mirror head on a new or unsealed runtime blocks. An existing sealed canonical mirror at an older exact head may use the explicitly approved one-shot refresh above only after its Forge API metadata re-proves the fixed owner, repository name, pull-mirror type and canonical GitHub remote; it cannot accept another owner, repository, remote, ref, URL, schedule or target head. The same metadata is re-proved after resealing. Failure to reach `ExpectedHead`, revoke the temporary token, reseal, or re-prove exact object/tree parity blocks M2 readiness.

## Network boundary

The canonical service publishes only `127.0.0.1:3340` and no SSH port. The temporary restore drill uses only `127.0.0.1:3341` and is removed before completion.

Forgejo migration/mirror configuration allows only `github.com` / `*.github.com` as migration domains, rejects local-network migration targets and keeps TLS verification enabled. After the canonical mirror is created, repository migrations are disabled, the mirror service is disabled so periodic pull updates stop, and creation of new pull or push mirrors remains disabled. A stale sealed mirror may be recreated briefly in the same fixed bootstrap posture solely to call the loopback API route for `stephanos-shadow/stephan-os` once. Cron remains disabled throughout, and the service is resealed before any readiness receipt is emitted.

No generic URL input exists in the runtime contract or Windows adapter.

## Forgejo write-surface seal

The final service configuration requires:

- registration disabled and registration button hidden;
- regular organisation creation disabled;
- new-user organisation creation disabled;
- per-user repository creation limit fixed at one, already occupied by the canonical mirror;
- push-to-create disabled for users and organisations;
- repository forks disabled and fork-limit bypass disabled;
- account deletion, SSH-key management, GPG-key management and password management disabled for the local user;
- webhooks disabled;
- custom Git hooks disabled;
- local-path imports disabled;
- issue, pull-request, wiki, project, package and Actions repository units globally disabled for this shadow;
- Forgejo Actions disabled;
- package registry disabled;
- federation disabled;
- SSH disabled and no SSH host port;
- repository migration disabled;
- mirror scheduler disabled;
- new pull/push mirror creation disabled;
- no runner registration or M3 authority.

## Podman privilege and writable-surface boundary

The machine is explicitly rootless and uses the WSL provider. Machine inspection is read with Podman's fixed JSON formatter and must report `Rootful=false`; the state must be `running` before Forge mutation continues. Runtime source does not accept a caller-selected machine name, provider, container name, port, image repository, data volume, network target or host path.

The Forgejo service and restore-probe containers are started with:

- `--user 1000:1000`;
- `--read-only` and `--read-only-tmpfs=false`;
- `--cap-drop ALL`;
- `--security-opt no-new-privileges`;
- bounded PID, memory and CPU limits;
- exactly three explicit ephemeral tmpfs mounts: `/run` 16 MiB, `/tmp` 64 MiB and `/var/tmp` 32 MiB, all `nosuid,nodev,noexec`;
- exactly one persistent writable volume at `/var/lib/gitea`.

After start, Podman inspect must independently prove the configured user, read-only root filesystem, dropped capabilities, `no-new-privileges`, exact data volume, absence of any unexpected writable mount and exact three tmpfs destinations. The same inspection is repeated on the restore probe and after the canonical container restarts.

No canonical Stephanos source path and no host Podman/Docker socket may be mounted into the Forgejo container. The rootless Forgejo data volume is mounted only at `/var/lib/gitea`, matching Forgejo's rootless image contract. Podman documents that read-only containers can use explicit tmpfs mounts for bounded writable runtime directories, leaving the image root filesystem read-only.

The source does not automatically install Podman. If fixed Podman 6.0.2 is absent, it returns `PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED`; host prerequisite installation must be a separately reviewed fixed operation. The Windows 10 adapter is replaceable and remains bounded to the immutable Podman Desktop `1.29.1` win32/x64 compatibility manifest that selects the same fixed Podman `6.0.2` Windows installer. Podman Desktop itself is not installed and does not become a second runtime or source of truth.

## Backup and restore boundary

Backup copies are named from a SHA-256 digest of the complete quiesced Forgejo data volume. A maximum of seven source-controlled backup identities is admitted; reaching the bound fails closed rather than silently deleting prior backups.

The copy and hash helpers use only the exact Forgejo OCI digest already authorised for the service. They receive fixed volume mounts and fixed literal shell programs; no caller-supplied command, executable, path or shell fragment is accepted. The helper containers also use read-only root filesystems, drop all capabilities and set `no-new-privileges`. Before backup begins, a fixed helper probe proves the digest-pinned image actually contains `tar` and `sha256sum`.

A backup is not called restorable merely because it can be hashed or copied. The adapter copies it into a fresh temporary volume, starts the exact sealed Forgejo image against it, proves the restored service health, privilege seal and exact expected repository head, then deletes only the fixed restore-probe container and volume.

## Strict runtime facts

The pure runtime planner treats observed runtime facts as typed evidence. Every declared boolean fact must be a JavaScript boolean; `windowsBuild` must be a non-negative safe integer; and `windowsHostAdapter`, `windowsProductName`, `windowsInstallationType`, `windowsArchitecture`, `wsl2Evidence`, `podmanVersion` and `mirrorSourceHead` must be strings. The Windows adapter additionally requires `InstallationType=Client`, a Windows 10 product identity, build 19043-21999, architecture `X64`, `wsl2Available=true`, and closed WSL2 evidence of either `default-version-2` or `distribution-version-2`. Stringified values, numeric truthiness, command-exists-only WSL claims, nulls or arrays fail closed and cannot be promoted into runtime authority.

## Fixed Windows adapter

`scripts/windows/install-forge-shadow-podman-v1.ps1` is the only M2 host mutation surface in this slice.

Inputs are limited to:

- exact 40-character `ExpectedHead`;
- exact OCI `ForgejoImageDigest`;
- explicit `OperatorApproved` switch.

It uses PowerShell `SupportsShouldProcess`, supports a non-mutating `-WhatIf` projection, selects Git/WSL/Podman only from fixed source-controlled paths, and emits a sanitized machine receipt. Its only update behaviour is the fixed one-shot refresh of the already-existing canonical mirror to the exact `ExpectedHead`; there is no generic URL, mirror owner/repository/ref input, scheduler, or continuous refresh authority. It has no merge, branch, GitHub-ref, runner, public-listener or arbitrary command authority.

## M2 acceptance

M2 is not complete from service health alone. `FORGE_SHADOW_M2_READY` requires all of:

- canonical repository identity;
- exact canonical `main` head;
- exact Forgejo OCI digest;
- allowlisted Windows host adapter;
- Windows 10 client product identity;
- build 19043 through 21999 inclusive;
- x64 OS architecture;
- parsed WSL2 proof, not command availability;
- Podman 6.0.2 proof;
- rootless machine proof;
- loopback-only published service;
- no GitHub credential;
- contained and revoked local bootstrap token;
- one exact public pull mirror;
- final sealed Forgejo write posture;
- read-only root filesystem;
- all Linux capabilities dropped;
- `no-new-privileges` proved;
- exactly one persistent writable surface `/var/lib/gitea`;
- only the three bounded ephemeral tmpfs writable surfaces;
- exact Git object/head and tree parity;
- bounded content-addressed backup;
- successful isolated restore drill against the exact head;
- current sanitized runtime receipt.

Until every item is current, the sidecar must not be described as running goal construction capacity.

## M3 boundary

M3 is a later slice. It may add isolated test/review runners only after M2 is proven ready. It must not register a runner in this M2 source slice, widen merge authority, expose the Forge publicly or let Forge state replace GitHub truth.
