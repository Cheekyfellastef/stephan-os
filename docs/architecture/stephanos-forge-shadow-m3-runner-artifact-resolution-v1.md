# Stephanos Forge Shadow M3 Runner Artifact Resolution V1

> Live-source correction: the official stable Forgejo Runner release publishes no Windows executable. The resolver remains the canonical two-artifact shape validator, but live evidence now comes from `stephanos-forge-shadow-m3-artifact-preparation-v1.md`: signed official Linux bytes plus a fixed Windows build from the exact official release source. No receipt claims an official Windows release binary exists.

## Purpose

This contract turns one bounded observation of an official stable Forgejo runner release into the exact two immutable artifact observations already required by the merged M3 runtime planner:

- `linux-isolated` on `linux/amd64`;
- `windows-proof-isolated` on `windows/amd64`.

It is a source-only adjudication boundary. It does not fetch, download, install, register, connect, start or execute a runner.

## Canonical identity

The resolver is fixed to:

- repository `Cheekyfellastef/stephan-os`;
- source identity `forgejo-official-runner-release`;
- release channel `stable`;
- stable semantic versions only;
- exactly one Linux AMD64 artifact and one Windows AMD64 artifact;
- exact logical identities expected by `forgeShadowM3RunnerRuntimePlanV1.mjs`.

No live runner version is selected in source. Versions and digests used in tests are synthetic deterministic fixtures, not production recommendations or runtime evidence.

## Required release evidence

The release observation must prove:

- explicit-timezone observation no more than 24 hours old;
- TLS verification;
- verified immutable release manifest;
- verified checksum manifest;
- immutable provenance digest;
- no mutable release reference accepted;
- no credential used;
- bounded safe proof references;
- exactly two assets with distinct immutable SHA-256 identities.

Each asset must additionally prove:

- exact platform, artifact ID and logical ID;
- exact artifact SHA-256 matching its checksum result;
- immutable manifest-entry SHA-256;
- bounded byte size from 1 MiB through 512 MiB;
- fixed executable identity (`elf` for Linux, `pe` for Windows);
- bounded safe proof references.

## Output contract

A valid result emits `artifactResolutions` in the exact closed-world shape consumed by `planForgeShadowM3RunnerRuntime`, plus a deterministic artifact-set SHA-256.

The output never contains a URL, path, command, executable, shell, environment, token, credential, secret, registration material or caller-selected runtime action.

## Authority boundary

The resolver grants no authority for:

- network fetch or artifact download;
- filesystem writes;
- runner installation, registration, connection or execution;
- workflow execution;
- source mutation or Git-ref writes;
- canonical-checkout, host-process or container-socket access;
- GitHub credentials or secrets;
- public or Tailscale exposure;
- merge or deployment;
- arbitrary commands.

Real artifact retrieval remains a separate read-only execution step. M3 runner installation and canary execution remain separately reviewed, exact-head authorised runtime actions and remain blocked until a genuine fresh `FORGE_SHADOW_M2_READY` receipt exists.
