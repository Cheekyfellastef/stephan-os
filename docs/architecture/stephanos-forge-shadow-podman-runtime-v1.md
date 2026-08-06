# Stephanos Forge shadow Podman runtime V1

This document advances issue #1671 from the M2 deployment-admission contract into one fixed Windows runtime shape. It is additive capacity only. GitHub remains the canonical public ledger, final hosted review boundary and protected merge authority.

## Fixed runtime identity

- repository: `Cheekyfellastef/stephan-os`
- Windows host posture: Windows 11 or newer with WSL2 available
- container engine: Podman `6.0.2`
- machine: `stephanos-forge-shadow`
- machine provider: WSL
- machine mode: rootless
- machine resources: 4 CPUs, 4096 MiB memory, 40 GiB disk
- Forgejo line: `15.0.5` LTS
- image tag used only to discover/confirm release identity: `code.forgejo.org/forgejo/forgejo:15.0.5-rootless`
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

- generated only for `stephanos-shadow`;
- used only against the loopback Forgejo instance;
- never persisted in the Stephanos repository, Shared Workspace, logs, GitHub comments or runtime receipts;
- never reused as a GitHub credential;
- never grants runner registration or external service authority;
- any temporary migration token must be revoked before the runtime is sealed read-only.

Credential material is not proof. Receipts expose only the fact that containment and revocation checks passed.

## Exact progression

The runtime planner progresses only through these states:

1. prove Windows 11+, WSL2 and fixed source identity;
2. prove Podman 6.0.2 or stop at a separately authorised host prerequisite;
3. initialise the fixed rootless WSL Podman machine if absent;
4. start that exact machine if stopped;
5. pull only the exact Forgejo OCI digest;
6. require the fixed loopback port to be free;
7. start the fixed Forgejo bootstrap container with no host source or host socket mount;
8. create the contained local owner if absent;
9. create exactly one unauthenticated public pull mirror from the canonical GitHub repository;
10. seal the service so registration, SSH, Actions, packages, migrations, push-create, runner registration and public/Tailscale exposure are disabled;
11. prove the mirror is bound to exact canonical `main`;
12. prove exact Git object/tree parity and a current restorable backup;
13. only then return `FORGE_SHADOW_M2_READY` and permit a separate M3 runner slice.

A wrong mirror head blocks. It is not silently force-updated.

## Network boundary

The host publishes only `127.0.0.1:3340` and no SSH port.

Forgejo migration/mirror configuration must allow only `github.com` / `*.github.com` as migration domains. New pull mirrors are disabled after the canonical mirror is created. Actions, packages, webhooks, federation and runner registration remain disabled in M2.

No generic URL input exists in the runtime contract.

## Podman boundary

The machine is explicitly rootless and uses the WSL provider. Runtime source does not accept a caller-selected machine name, provider, container name, port, image repository, data volume or host path.

No canonical Stephanos source path and no host Podman/Docker socket may be mounted into the Forgejo container.

The source planner does not automatically install Podman. If fixed Podman 6.0.2 is absent, it returns `FORGE_SHADOW_PODMAN_PREREQUISITE_REQUIRED`; host prerequisite installation must be a separately reviewed fixed operation.

## M2 acceptance

M2 is not complete from service health alone. `FORGE_SHADOW_M2_READY` requires all of:

- canonical repository identity;
- exact canonical `main` head;
- exact Forgejo OCI digest;
- Windows 11+ and WSL2 proof;
- Podman 6.0.2 proof;
- rootless machine proof;
- loopback-only published service;
- no GitHub credential;
- contained local bootstrap credential;
- one exact public pull mirror;
- final sealed read-only posture;
- `stephanos.forge-shadow-parity.v1` exact object/tree parity;
- current restorable backup;
- Shared Workspace runtime and parity proof receipts.

Until every item is current, the sidecar must not be described as running goal construction capacity.

## M3 boundary

M3 is a later slice. It may add isolated test/review runners only after M2 is proven ready. It must not register a runner in this M2 source slice, widen merge authority, expose the Forge publicly or let Forge state replace GitHub truth.
