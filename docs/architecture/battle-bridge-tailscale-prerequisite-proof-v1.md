# Battle Bridge Tailscale Bootstrap Prerequisite Proof V1

## Purpose

Prove whether the existing Battle Bridge Tailscale bootstrap pipe is actually ready before asking it to mutate the Windows GitHub Sync task.

This is a read-only proof path inside the existing `Battle Bridge Tailscale Bootstrap Pipe` workflow. It is not a new mailbox, worker, recovery mesh, scheduler, wake, truth store, deployment authority, or merge authority.

## Why this exists

The GitHub integration used by ChatGPT cannot list repository Actions secrets or variables. Treating that permission failure as evidence that settings are absent would be incorrect.

The prerequisite proof resolves that blind spot from inside GitHub Actions while preserving secret confidentiality. It emits only presence/validation booleans and missing or invalid setting names. Secret values are never included in the proof artifact.

It also closes a routing hardening gap: the configured Battle Bridge SSH target must be a Tailscale CGNAT address in `100.64.0.0/10` or a `*.ts.net` hostname. A public, LAN, loopback, or arbitrary DNS host fails closed before either the read-only probe or the live bootstrap joins the tailnet.

## Request contract

The read-only marker is:

`stephanos-battle-bridge-tailscale-bootstrap-prerequisites`

The JSON body is exact-field and contains:

- `schemaVersion`: `stephanos.battle-bridge-tailscale-bootstrap-prerequisites.v1`
- `requestId`
- `operation`: `CHECK_BOOTSTRAP_PREREQUISITES`
- `repository`: `Cheekyfellastef/stephan-os`
- `issueNumber`: `1507`
- `expectedHead`: exact current GitHub `main` SHA
- `expiresAt`: at most 30 minutes in the future

The comment must be authored by `Cheekyfellastef` on issue #1507. Extra fields fail closed. No `operatorApproval` is accepted because this operation is read-only.

The existing mutation marker is explicitly excluded from this prerequisite marker, so a prerequisite check cannot accidentally start the GitHub Sync task.

## Stage 1: redacted GitHub settings proof

The workflow checks only whether these fixed settings are present:

### Secrets

- `TS_OAUTH_CLIENT_ID`
- `TS_AUDIENCE`
- `STEPHANOS_BATTLE_BRIDGE_SSH_PRIVATE_KEY`
- `STEPHANOS_BATTLE_BRIDGE_SSH_KNOWN_HOSTS`

### Variables

- `STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST`
- `STEPHANOS_BATTLE_BRIDGE_SSH_USER`

The host must be Tailscale-only and the Windows SSH user must satisfy the fixed bounded username contract.

The settings artifact contains only booleans and missing/invalid setting names. It records `secretValuesExposed: false`, `mutationPerformed: false`, and `codexRequired: false`.

If any setting is missing or unsafe, this artifact is uploaded first and the workflow then fails before joining Tailscale.

## Stage 2: private-network and Windows proof

Only when settings are ready does the workflow join Tailscale using the existing fixed ephemeral identity:

`tag:stephanos-github-recovery`

It then performs strict SSH with:

- `BatchMode=yes`
- `IdentitiesOnly=yes`
- `StrictHostKeyChecking=yes`
- the fixed known-host file
- the dedicated recovery private key

The remote PowerShell is generated from source and is read-only. It may only:

1. confirm `%USERPROFILE%\Documents\GitHub\stephan-os` exists;
2. confirm the existing GitHub Sync installer exists without invoking it;
3. confirm the existing GitHub Sync status script exists without invoking it;
4. use exact `C:\Program Files\Git\cmd\git.exe` to read the current checkout `HEAD`;
5. use exact `C:\Program Files\Tailscale\tailscale.exe status --json` to prove the Windows Tailscale client is running and online;
6. emit a bounded receipt.

It cannot start or register Scheduled Tasks, use `-StartNow`, mutate source, run destructive Git, restart the PC, mutate OpenClaw or Forge, or execute caller-selected commands.

The observed Windows `HEAD` is permitted to be older than `expectedHead`. That is the point of this prerequisite proof: it proves the independent pipe can reach a stale Battle Bridge before the later bootstrap updates it.

## Ready verdict

The combined proof emits:

`BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITES_READY`

only when all of these are proven:

- fixed GitHub settings are ready;
- the target is Tailscale-only;
- the ephemeral recovery identity can join the tailnet;
- the tag can reach the Battle Bridge over the private path;
- strict SSH host-key validation succeeds;
- the dedicated SSH key is authorized by Windows OpenSSH;
- the Windows Tailscale client is running and online;
- the canonical repo and fixed Git binary exist;
- the already-reviewed GitHub Sync installer and status scripts exist;
- no mutation occurred;
- Codex is not required.

Only after this proof is ready should the existing `BOOTSTRAP_CANONICAL_GITHUB_SYNC` operation be issued.
