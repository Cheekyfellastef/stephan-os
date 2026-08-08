# Stephanos Forge Shadow M3 Official Release Observation Execution Contract V1

## Purpose

This source-only contract prepares the next bounded step in Forge goal #1671 after the official-release observation boundary. It creates one deterministic request envelope that a future, separately reviewed read-only observer can consume to inspect official Forgejo runner release metadata.

This slice does not perform the observation. It performs no network request, source discovery call, artifact fetch or download, binary intake, filesystem access, runner installation, registration, connection, execution, workflow execution, source mutation, Git-ref write, credential access, secret access, exposure, merge, or deployment.

## Fixed official-source discovery

The request fixes discovery to the source-controlled route identity:

`forgejo-official-runner-stable-release-metadata-v1`

That route is bound to:

- repository `Cheekyfellastef/stephan-os`;
- observer class `source-controlled-readonly-official-release-observer`;
- source identity `forgejo-official-runner-release`;
- release channel `stable`;
- selection policy `highest-stable-semver-only`;
- metadata scope `official-runner-release-and-verification-manifests-only`.

The caller cannot provide an endpoint, host, URL, URI, path, artifact location, selected version, mutable reference, command, script, environment, credential, secret, binary, archive, file, body, content, data, or payload. Hidden and recursive forms fail closed.

No live release is selected by this contract. The future observer must discover and verify the highest stable semantic version through its own fixed source-controlled implementation and return only the already-defined metadata-only observation receipt.

## Exact request binding

The request is bound to:

- the exact canonical `main` commit;
- the exact canonical `main` tree;
- one safe request identity;
- one distinct safe observation identity;
- a strict, calendar-valid ISO request timestamp with an explicit timezone;
- the fixed observer, discovery route, source identity and stable channel.

A deterministic SHA-256 request-binding digest seals those values. The observer receipt must echo the exact request identity, timestamp and digest, and the canonical observation boundary recomputes and verifies all three. Copying a request or receipt to another repository, head, tree, identity or timestamp therefore changes the digest or fails validation.

## Fixed artifact observation estate

The request requires exactly two metadata-only observations:

1. Linux construction runner
   - runner class `linux-isolated`
   - platform `linux/amd64`
   - artifact ID `forge-m3-linux-runner-artifact-v1`
   - logical identity `forgejo-runner-linux-amd64`
   - content type `application/octet-stream`
   - executable format `elf`

2. Windows proof runner
   - runner class `windows-proof-isolated`
   - platform `windows/amd64`
   - artifact ID `forge-m3-windows-proof-runner-artifact-v1`
   - logical identity `forgejo-runner-windows-amd64`
   - content type `application/octet-stream`
   - executable format `pe`

Each observation requires immutable artifact, checksum and manifest-entry SHA-256 evidence, exact artifact/checksum equality, a size from 1 MiB through 512 MiB, bounded safe proof references, and no artifact payload.

## Receipt requirements

A future observer receipt must retain the merged observation boundary requirements:

- explicit timezone and maximum age of 24 hours;
- exact request ID, request timestamp and request-binding digest echoed from the authorised execution request;
- stable semantic version;
- TLS verification;
- verified release, checksum and provenance manifests;
- immutable release-manifest, checksum-manifest and provenance SHA-256 identities;
- no mutable reference;
- no credential use;
- no caller-selected source;
- no artifact payload;
- no filesystem mutation;
- bounded safe proof references.

The receipt is not accepted by this contract itself. Acceptance remains the job of the already-merged `forgeShadowM3OfficialReleaseObservationBoundaryV1` boundary after a separately authorised observation action returns evidence.

## Output

A valid request emits:

- schema `stephanos.forge-shadow-m3-official-release-observation-execution-contract.v1`;
- verdict `FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_READY`;
- one request with schema `stephanos.forge-shadow-m3-official-release-observation-execution-request.v1`;
- the fixed discovery contract;
- the exact two-artifact metadata estate;
- the existing receipt requirements;
- one deterministic request-binding SHA-256;
- explicit zero-authority posture.

Invalid input emits `FORGE_SHADOW_M3_OFFICIAL_RELEASE_OBSERVATION_EXECUTION_CONTRACT_BLOCKED`, bounded blockers, no execution request, no request digest and no runtime action.

## Authority

This contract grants zero authority. A genuine metadata observation remains separately reviewed and separately authorised. Real artifact fetch, installation, registration, connection, canary execution, teardown, Windows mutation and Battle Bridge mailbox recovery remain outside this source slice.

GitHub remains canonical for public `main`, final hosted evidence and protected merge authority. The Windows runtime lane remains parked until a genuine attached Windows execution surface returns through the existing no-faff rescue path.
