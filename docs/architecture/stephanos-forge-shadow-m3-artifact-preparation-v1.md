# Stephanos Forge Shadow M3 Artifact Preparation V1

Status: source-built, runtime-unproven

## Purpose

This connected-Windows adapter closes the binary boundary between the source-only M3 artifact resolver and the fixed proof executors. It performs one separately approved, exact-head-bound preparation action, then emits immutable artifact resolutions and a truthful cache receipt. It does not install, register, connect, or execute a runner.

The request contains only repository, source head and tree, request identities, request time, M3-only scope, and explicit operator approval. A caller cannot supply a URL, path, version, artifact, command, build flag, toolchain, credential, or cache location.

## Corrected two-artifact estate

Forgejo's official Runner v13 release publishes signed Linux amd64 and arm64 binaries. It does not publish a Windows executable, even though the Runner source and Makefile support `windows/amd64`.

The exact M3 estate is therefore prepared as follows:

| Runner class | Artifact derivation | Verification |
| --- | --- | --- |
| `linux-isolated` | official stable `linux-amd64` release binary | release asset size, ELF format, official `.sha256`, and detached GPG signature pinned to fingerprint `EB114F5E6C0DC2BCDD183550A4B61A2DC5923710` |
| `windows-proof-isolated` | fixed cross-build from the exact official stable release source commit | tag-ref commit binding, source archive digest, `VERSION`, module-major binding, `go.sum` digest, exact source-declared Go toolchain, fixed `windows/amd64` build recipe, PE format, and `go version -m` inspection |

The Windows artifact is deliberately reported as `signatureVerified=false` and `sourceBuildVerified=true`. The receipt never claims that Forgejo published or signed a Windows executable.

## Fixed source and build boundary

The adapter derives all network locations internally from these fixed authorities:

- the official Forgejo Runner stable-release API;
- the official Forgejo Runner release-download and Git archive hosts;
- the pinned Forgejo release signing-key endpoint; and
- the Go module proxy and checksum database fixed in the build environment.

The stable release tag is resolved to one exact 40-hex commit before the source archive is fetched by commit identity. The archive must remain under the single `runner/` root. `VERSION`, `go.mod`, and `go.sum` must be real files. The module major must equal the release major and the source-declared patch-level Go toolchain must exactly equal the installed Windows toolchain.

The build process receives a minimal environment with no inherited GitHub, Forgejo, mailbox, or user credential variables. `GOOS=windows`, `GOARCH=amd64`, `CGO_ENABLED=0`, `GOTOOLCHAIN=local`, `GOENV=off`, read-only module mode, the fixed proxy, and the public checksum database are mandatory. Build tags, linker flags, output identity, and source directory are fixed in source.

## Cache and receipt truth

Artifacts are written only under the fixed per-version cache identity:

`forge-shadow/artifacts/<version>/<fixed artifact name>`

An existing cache entry is reused only when its byte digest equals the newly verified digest. A different existing digest blocks the operation; it is never overwritten. New entries are written to exclusive temporary files, reread, digest-checked, and atomically renamed.

The cache receipt records:

- exact Stephanos source head and tree plus request-binding digest;
- release version and source commit;
- Linux signature status and Windows source-build status separately;
- immutable artifact digests and sizes;
- source archive, `go.mod`, `go.sum`, build-recipe, and provenance digests;
- exact toolchain identity;
- network fetch, artifact download, source build, and immutable cache write as actions that did occur; and
- no caller location, credential, future execution, merge, deployment, or arbitrary-command authority.

The existing canonical artifact resolver is replayed against the prepared evidence. No result becomes ready unless that resolver independently accepts exactly one Linux artifact and one Windows proof artifact for the same repository, head, tree, version, and proof reference.

## Runtime boundary

This slice creates source and cache evidence only. It does not authorize the fixed proof executor. Runner installation, repository-scoped ephemeral registration, disposable-canary execution, Windows Sandbox execution, teardown, and final M3 readiness still require their own short-lived exact-head runtime authorization and actual acceptance receipt.

References:

- <https://data.forgejo.org/api/v1/repos/forgejo/runner/releases/latest>
- <https://code.forgejo.org/forgejo/runner/src/tag/v13.0.0/Makefile>
- <https://forgejo.org/docs/v15.0/admin/actions/installation/binary/>
- <https://forgejo.org/docs/v15.0/admin/actions/security/>
