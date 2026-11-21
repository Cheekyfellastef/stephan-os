# Stephanos Forge Shadow M3 Official Release Metadata Observer Adapter Plan V1

## Purpose

This source-only slice continues Forge goal #1671 after the merged official-release observation boundary and execution-request contract. It validates one exact execution request and produces the deterministic plan for a future separately authorised, fixed-route, read-only official Forgejo runner metadata observer.

This slice does not perform the observation. It performs no network request, redirect, artifact fetch or download, binary intake, filesystem access, runner installation, registration, connection, execution, workflow execution, source mutation, Git-ref write, credential access, exposure, merge, deployment, or Windows mutation.

## Fixed route and source

The adapter plan is fixed to:

- route identity forgejo-official-runner-stable-release-metadata-v1;
- observer class source-controlled-readonly-official-release-observer;
- source identity forgejo-official-runner-release;
- release channel stable;
- selection policy highest-stable-semver-only;
- metadata scope official-runner-release-and-verification-manifests-only.

The caller cannot supply an endpoint, URL, location, version, mutable reference, redirect, command, credential, binary, payload, or artifact body. Current release information is deliberately not embedded in source; the future observer must discover it through the fixed reviewed route.

## Exact request binding

The plan re-derives the canonical execution request from its primitive repository, head, tree, timestamp, request ID, and observation ID. It rejects any changed request binding or nested discovery, artifact, or receipt contract.

Adapter preparation must use a strict calendar-valid explicit-timezone timestamp from the request time through fifteen minutes later. Impossible dates, missing timezones, early preparation, and stale preparation fail closed.

## Deterministic steps

The output contains four bounded future steps:

1. validate the exact execution request;
2. observe fixed-route official stable release metadata;
3. verify release, checksum, and provenance manifest metadata;
4. project the request-bound observation receipt.

Every step remains marked as non-executing in this source slice. The plan grants no network, artifact, filesystem, runner, source, credential, merge, deployment, or arbitrary-command authority.

## Runtime boundary

The actual metadata observation remains separately reviewed and separately authorised. It must use a source-controlled transport implementation, reject redirects and caller locations, retain no artifact payload, and return the canonical receipt for validation by the merged observation boundary.

GitHub remains canonical for public main, final hosted evidence, and protected merge authority. The detached Windows/Battle Bridge control plane is not modified by this PR.
