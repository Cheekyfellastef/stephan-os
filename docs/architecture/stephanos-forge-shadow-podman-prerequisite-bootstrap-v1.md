# Stephanos Forge Shadow Podman Prerequisite Bootstrap V1

Status: source-built, runtime-unproven

## Purpose

This slice closes the bootstrap gap discovered during the first exact-head Forge M3 commissioning attempt on canonical main `97da0cad9f9776da0b38606fdb551d324a587424`.

The existing Forge M2 runtime deliberately refuses to install Podman. Its fixed Windows installer requires Podman `6.0.2` to exist before it can resolve and consume the immutable Forgejo `15.0.6-rootless` OCI digest. The Battle Bridge commissioning receipt proved the user-scope prerequisite was absent and therefore returned `PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED` without mutation.

This repair adds the missing separately reviewed prerequisite rung without adding a mailbox, worker, scheduler, runtime lane, arbitrary command surface, or new GitHub authority.

## Canonical mailbox shape

The existing operation remains:

`INSTALL_FORGE_SHADOW_M2`

Its existing four operation-specific fields remain exactly:

- `forgejoVersion`;
- `forgejoImageDigest`;
- `runtimeBoundary`;
- `m2Only`.

The interpretation is now deterministic:

- an exact `forgejoImageDigest` means the existing normal M2 path;
- an omitted/empty `forgejoImageDigest` means prerequisite-only execution.

Prerequisite-only execution is admitted only with:

- repository `Cheekyfellastef/stephan-os`;
- exact 40-character canonical `expectedHead`;
- Forgejo version exactly `15.0.6`;
- runtime boundary exactly `podman-wsl-rootless`;
- `m2Only=true`;
- explicit mailbox operator approval and ordinary bounded command expiry.

No caller field selects a Podman version, URL, digest, installer path, executable, arguments, machine name, provider, cache, credential, command, shell or PowerShell fragment.

## Fixed Podman prerequisite identity

The source fixes exactly:

- Podman version: `6.0.2`;
- architecture: Windows amd64/x64 host path;
- official release asset: `podman-installer-windows-amd64.msi` from Podman's official `v6.0.2` GitHub release;
- official asset SHA-256: `c094059880f033656092f5fb4306457e42aa068ee32137162299817c5f79396f`;
- installation scope: current user only;
- resulting executable: `%LOCALAPPDATA%\Programs\Podman\podman.exe`.

### Windows 10 compatibility adapter

The Battle Bridge is Windows 10 Pro 22H2, so the prerequisite carries one replaceable host adapter, `podman-desktop-windows10-wsl2-v1`. It does not create a second Forge runtime or install Podman Desktop. It records the upstream compatibility authority that Podman Desktop supports Windows 10 build `19043+` and, at Podman Desktop `1.29.1`, selects the same Windows x64 Podman `6.0.2` installer already pinned above.

That upstream support floor does not make this adapter a generic future-Windows adapter. The executable admission boundary is deliberately narrower and exact:

- Windows client SKU only;
- Windows 10 product identity;
- x64 OS architecture only;
- build `19043` through `21999` inclusive;
- working WSL2 proved by either `Default Version: 2` from `wsl.exe --status` or at least one version-2 distribution from `wsl.exe --list --verbose`;
- the existing `podman-wsl-rootless` runtime boundary.

The authority is fixed to:

- Podman Desktop version `1.29.1`;
- source commit `a969ee0e0b07285122dd4988a58edb0a1a25d5fc`;
- bundled-Podman manifest blob `5acfedd1c3171414aa218a1d5d95ea7529687809`;
- host floor Windows 10 client build `19043`;
- host ceiling build `22000` exclusive;
- x64 architecture;
- the existing `podman-wsl-rootless` runtime boundary.

The upstream evidence is independently auditable through Podman Desktop's Windows installation support floor, 1.29 release record, and exact `podman.json` manifest at the pinned commit.

The adapter only changes host admission. Podman version, MSI URL, MSI digest, Authenticode verification, fixed executable path, user scope, WSL provider, machine identity, Forgejo digest and all no-authority receipts remain canonical.

The fixed adapter verifies canonical `main`, exact head, exact tree and the committed/working prerequisite-installer blob before mutation and repeats source identity proof afterwards.

The installer does not treat the presence of `wsl.exe`, or a successful WSL command exit code by itself, as WSL2 proof. A WSL1-only or unconfigured host therefore remains blocked. It does not enable Windows features, request elevation, reboot the host, create a Podman machine or alter system-scope Podman state. A host below the build floor returns `WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED`; a server, non-client, non-x64, Windows-11-build or otherwise out-of-adapter host returns the closed Windows-10 client blocker; unreadable product identity returns `WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE`; a compatible host without proved WSL2 returns `WSL2_NOT_AVAILABLE`.

If exact Podman 6.0.2 is already present at the fixed user path, the operation returns success without reinstalling it.

Otherwise it:

1. downloads only the fixed official MSI to a fixed temporary directory;
2. verifies the complete file SHA-256 against the source-pinned release digest;
3. requires a valid Windows Authenticode signature;
4. executes only the fixed Windows Installer binary with quiet, no-restart, per-user properties;
5. verifies `%LOCALAPPDATA%\Programs\Podman\podman.exe` exists and reports exactly Podman `6.0.2`;
6. re-proves canonical source head/tree;
7. deletes the temporary installer material.

## Digest handoff

The prerequisite installer itself does not choose or return a Forgejo digest.

After the prerequisite receipt is validated, the existing `resolveForgeShadowM2DigestOnBattleBridge` implementation is run unchanged. It performs only a TLS-verified `podman manifest inspect` of the fixed Forgejo tag and requires exactly one `linux/amd64` descriptor.

Only that canonical resolver may produce the `forgejoImageDigest` returned in the terminal prerequisite result.

A successful prerequisite result is:

`FORGE_SHADOW_PODMAN_PREREQUISITE_READY`

and proves `readyForM2=true` while still proving:

- no Podman machine mutation;
- no Forgejo container mutation;
- no image pull;
- no Forge runtime mutation;
- no GitHub credential use;
- no source mutation;
- no arbitrary shell or PowerShell authority.

## Commissioning continuation

After this source slice receives ordinary provider-neutral review and protected merge authorization, the Battle Bridge sequence is:

1. synchronize exact merged main through the existing #1507 path;
2. prove the exact Windows 10 x64 build range and real WSL2 evidence;
3. execute one prerequisite-only `INSTALL_FORGE_SHADOW_M2` command with no image digest;
4. require `FORGE_SHADOW_PODMAN_PREREQUISITE_READY` and record the exact resolver-produced Forgejo digest;
5. execute the separately authorized normal M2 command with that exact digest;
6. require genuine fresh `FORGE_SHADOW_M2_READY` proof;
7. prepare immutable M3 artifacts;
8. derive the canonical M3 runtime plan;
9. execute exactly one bounded M3 proof;
10. require `FORGE_SHADOW_M3_EXECUTION_PROVEN` and teardown truth;
11. only after capacity publication and a genuine machinery task completes without dependence on Codex may Forge be described as a usable production build lane.

## Shared invariant

Host compatibility is an adapter fact, never permission to weaken the canonical Forge runtime. A platform adapter may widen admission only when it binds immutable upstream compatibility authority to the already-pinned executable and then republishes the same bounded receipts. Missing OS features, elevation or a restart remain explicit operator prerequisites rather than hidden installer side effects.
