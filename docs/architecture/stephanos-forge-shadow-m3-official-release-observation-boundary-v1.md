# Stephanos Forge Shadow M3 Official Release Observation Boundary V1

> Live-source correction: Forgejo's stable Runner release does not publish a Windows executable. This source-only synthetic adjudication boundary remains non-executing and is not used by the #1507 live preparation route. See `stephanos-forge-shadow-m3-artifact-preparation-v1.md` for the truthful signed-Linux plus source-built-Windows estate.

## Purpose

This boundary prepares the next source-only step in Forge goal #1671. It admits a future read-only observation receipt for the official stable Forgejo runner release and converts it into the exact `releaseObservation` accepted by the merged M3 runner artifact resolver.

It does not observe a live release itself. It performs no network request, artifact download, binary intake, filesystem access, runner installation, registration, connection, execution, workflow execution, source mutation, Git-ref write, credential access, secret access, exposure, merge, or deployment.

## Canonical binding

Every receipt is bound to:

- repository `Cheekyfellastef/stephan-os`;
- the exact canonical `main` head and tree supplied to the boundary;
- one safe observation identity;
- observer class `source-controlled-readonly-official-release-observer`;
- source identity `forgejo-official-runner-release`;
- release channel `stable`.

The receipt must carry the deterministic SHA-256 source binding produced from those values. A receipt copied from another head, tree, repository, or observation identity fails closed.

## Fixed evidence estate

The receipt must represent exactly two metadata-only assets:

1. Linux construction runner
   - platform `linux/amd64`
   - artifact ID `forge-m3-linux-runner-artifact-v1`
   - logical identity `forgejo-runner-linux-amd64`
   - content type `application/octet-stream`
   - executable format `elf`

2. Windows proof runner
   - platform `windows/amd64`
   - artifact ID `forge-m3-windows-proof-runner-artifact-v1`
   - logical identity `forgejo-runner-windows-amd64`
   - content type `application/octet-stream`
   - executable format `pe`

Each asset requires an immutable artifact SHA-256, an identical checksum SHA-256, an immutable manifest-entry SHA-256, bounded size, and safe proof references. Artifact IDs, runner classes, and artifact digests must be distinct.

## Evidence posture

A valid receipt requires:

- explicit-timezone observation no more than 24 hours old;
- stable semantic version;
- immutable release-manifest, checksum-manifest, and provenance SHA-256 identities;
- TLS, release-manifest, checksum-manifest, and provenance verification;
- no mutable reference;
- no credential use;
- no caller-selected endpoint or asset location;
- no artifact download;
- no filesystem write;
- metadata-only assets with no binary content.

Recursive command, shell, PowerShell, script, path, URL, URI, endpoint, host, environment, token, credential, secret, registration material, binary, base64, blob, archive, file, download, body, content, data, and payload fields fail closed.

## Resolver compatibility

The boundary replays the merged `resolveForgeShadowM3RunnerArtifacts` function against its normalized release observation. It is ready only when that canonical resolver independently returns `FORGE_SHADOW_M3_RUNNER_ARTIFACT_RESOLUTION_READY` for the same repository, head, and tree.

The successful output includes:

- schema `stephanos.forge-shadow-m3-official-release-observation-boundary.v1`;
- verdict `FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_READY`;
- deterministic source-binding and observation-evidence SHA-256 identities;
- the exact resolver-compatible `releaseObservation`;
- a read-only artifact-resolution preview.

Rejected evidence produces `FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_BLOCKED`, bounded blockers, no release observation, no resolution preview, and no evidence digest.

## Authority

The boundary grants zero authority. A future metadata observer remains a separately reviewed and separately authorised execution step. Real artifact fetch, installation, registration, connection, canary execution, and teardown remain outside this source slice and stay blocked until the existing Windows and Forge M2 gates produce genuine receipts.
