# Codex Patch Escrow and Durable Workspace V1

## Purpose

This is the reusable recovery path for Codex work that is complete and tested inside a disposable workspace but cannot reach a GitHub branch. It prevents the loop where a local commit is reported, the workspace disappears, and another Codex task rebuilds the same patch.

The owning programme is issue #1293, Automated Codex Dispatcher V1.

## Durable identities

Every Codex job uses three distinct identities:

- `jobId`: stable identity for the authorised goal.
- `attemptId`: numbered implementation attempt such as `codex-job-1503-a003`.
- `workspaceId`: disposable workspace identity such as `ws-codex-job-1503-a003`.

A local commit SHA is local build evidence only. It is never remote publication proof.

## Required terminal handoff

Before a disposable workspace may be treated as safely finished, it must produce one of:

- `REMOTE_BRANCH_VERIFIED`: GitHub confirms the exact remote branch head.
- `PATCH_ESCROWED`: a complete checksummed patch bundle is stored durably in bounded GitHub issue comments.

If a valid escrow exists, recovery chooses `PUBLISH_ESCROW`; it must not rebuild the patch.

## Patch escrow protocol

Generate a binary-safe patch from the exact tested base and head:

```sh
git diff --binary BASE_SHA REPAIR_SHA > repair.patch
```

Create `escrow-config.json` with bounded metadata:

```json
{
  "issueNumber": 1503,
  "baseBranch": "main",
  "baseSha": "40-character-main-sha",
  "changedFiles": ["shared/agents/example.mjs"],
  "testProfile": "shared-agents",
  "commitMessage": "Repair issue #1503",
  "prTitle": "Repair issue #1503",
  "prBody": "Source-only bounded repair. Do not merge without exact-head approval."
}
```

Export the durable comments:

```sh
node scripts/codex-patch-escrow-export.mjs escrow-config.json repair.patch escrow-output
```

Post `manifest.comment.md` and every numbered chunk comment to the issue. Chunks may be posted by the repository owner or `chatgpt-codex-connector[bot]`.

The final `publish.comment.md` must be posted by the repository owner on an issue carrying the existing `codex` label. That owner-authored comment is the bounded publication authorization.

The bundle ID is not merely shape-checked. It must equal `patch-issue-{issueNumber}-{patchSha256.slice(0, 12)}` for the same manifest, or the request fails before selection and publication.

## Three-phase automatic publisher

After this workflow is present on `main`, the final `PATCH_ESCROW_PUBLISH_V1` comment starts three separate jobs.

### 1. Tokened preparation job

The preparation job has read-only GitHub permission and checks out canonical `main` with `persist-credentials: false`. It:

1. Validates the owner-authored publication event and issue label.
2. Fetches issue comments using a short-lived read token.
3. Selects and reassembles the exact escrow.
4. Binds the bundle ID to the same issue number and patch SHA-256.
5. Verifies current `main` still equals the signed base SHA.
6. Writes a one-day prepared artifact containing only the manifest, checksummed patch bytes, and public repository metadata.

It does not apply the patch or execute patched code.

### 2. Token-free validation job

The validation job starts separately and never receives `GITHUB_TOKEN`, `GH_TOKEN`, or a GitHub PAT. It checks out canonical `main` with `persist-credentials: false`, downloads the prepared artifact as untrusted input, and:

1. Revalidates the complete manifest and bundle/hash/issue binding.
2. Revalidates patch base64, byte length, SHA-256, signed base, changed-file list, safe paths, and fixed test profile.
3. Walks Linux `/proc` process ancestry and fails if the current process or a parent exposes a GitHub repository credential variable.
4. Computes the exact expected Git tree from the signed patch.
5. Applies the patch with `git apply --check --binary`.
6. Verifies no Git credentials were persisted.
7. Runs `git diff --check` and the fixed test profile with an isolated HOME and disabled ambient Git configuration.
8. Fails if tests introduce any unapproved workspace change.

Patched test code therefore runs in a process tree that never received GitHub repository credentials.

### 3. Write-enabled publication job

The publication job starts only after token-free validation succeeds. It receives write permission but does not run code from the patch. It:

1. Re-fetches and re-verifies the complete escrow against current `main`.
2. Recomputes the expected Git tree.
3. For an existing deterministic branch, verifies the remote commit tree, its single signed-base parent, branch ref, PR head, PR base, and patch receipt before idempotent reuse.
4. Otherwise applies and stages the patch, verifies the staged tree exactly matches the signed expected tree, commits, and pushes the deterministic branch.
5. Re-reads GitHub's remote ref and commit tree to prove exact publication.
6. Opens one linked pull request.
7. Posts a publication receipt and never merges.

A matching PR body alone is never accepted as remote proof.

## Fixed test profiles

- `shared-workspace`: focused Shared Workspace/Battle Bridge tests, then the complete `shared/agents/*.test.mjs` suite.
- `shared-agents`: complete `shared/agents/*.test.mjs` suite.
- `node-changed`: syntax-check every changed `.mjs` file and run changed `.test.mjs` files.

No arbitrary command from an issue comment is executed.

## Safety boundaries

- No direct `main` write.
- No force push.
- No branch deletion.
- No merge.
- No generated dist, runtime data, dependency, secret, token, credential, `.env`, or key paths.
- No approval inferred from a Codex local SHA or `make_pr` report.
- Current `main` must exactly match the signed `baseSha`; stale patches fail closed.
- Existing mismatched deterministic branches fail closed rather than being overwritten.
- Bundle identity must match the manifest issue number and exact patch hash.
- Patched code never executes in a process tree that received GitHub repository credentials.
- Existing publication is reusable only when its exact tree and signed-base parent are proven.

## Operational result

A disposable builder must finish with either a verified remote head or a durable escrow. A later clean process can safely publish the exact patch without Stephan acting as courier or Codex rebuilding it.
