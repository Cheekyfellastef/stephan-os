# Battle Bridge Tailscale Bootstrap Pipe V1

## Purpose

Provide one independent cloud-to-Windows bootstrap path for the canonical Battle Bridge when all of these can be unavailable at once:

- the local `Stephanos Battle Bridge GitHub Sync` Scheduled Task;
- the #1507 GitHub command mailbox consumer;
- Codex capacity.

This pipe is not a replacement mailbox, worker, recovery mesh, scheduler, truth store or merge authority. It has one operation only: restore/start the existing canonical GitHub Sync task and prove the canonical Windows checkout reaches the exact current GitHub `main` head requested by the operator.

## Route

`#1507 owner comment -> GitHub-hosted Actions runner -> ephemeral Tailscale node -> Windows OpenSSH over the private tailnet -> existing install-battle-bridge-github-sync.ps1 -StartNow -> exact-head proof`

Tailscale supplies network reachability only. The Windows destination continues to use its existing OpenSSH service. No public listener is added.

## Request contract

The only accepted command marker is `stephanos-battle-bridge-tailscale-bootstrap` on issue #1507 and the comment author must be `Cheekyfellastef`.

The JSON object has exactly these fields:

- `schemaVersion`: `stephanos.battle-bridge-tailscale-bootstrap.v1`
- `requestId`
- `operation`: `BOOTSTRAP_CANONICAL_GITHUB_SYNC`
- `repository`: `Cheekyfellastef/stephan-os`
- `issueNumber`: `1507`
- `operatorApproval`: `operator-approved`
- `expectedHead`: exact 40-character Git SHA
- `expiresAt`: no more than 30 minutes in the future

The workflow checks out canonical `main` and refuses the request unless the requested head exactly equals the checked-out `main` head. Extra fields are rejected, including any command, executable, path, task name, host or shell field.

## Fixed remote authority

The remote PowerShell is generated from source. The only dynamic value is the already-validated 40-character expected head.

It may only:

1. resolve the canonical `%USERPROFILE%\Documents\GitHub\stephan-os` checkout;
2. invoke existing `scripts\windows\install-battle-bridge-github-sync.ps1 -StartNow`;
3. validate that install receipt against the existing task contract;
4. use exact `C:\Program Files\Git\cmd\git.exe` to read `HEAD` while the existing bounded sync task converges;
5. invoke existing `scripts\windows\status-battle-bridge-github-sync.ps1` read-only;
6. emit `BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_READY` only after observed Windows `HEAD` exactly equals the requested GitHub `main` head.

It cannot run reset, clean, stash, rebase, push, arbitrary PowerShell, arbitrary shell, PC restart, Forge mutation, OpenClaw update or merge operations.

## GitHub Actions permissions

The workflow's PR contract job has `contents: read` only.

The live bootstrap job has:

- `contents: read`
- `id-token: write`

`id-token: write` is used only for Tailscale workload identity federation. The workflow does not request `issues: write`, `pull-requests: write`, `contents: write` or `actions: write`.

## One-time operator setup

The pipe fails closed until all of the following are configured:

### Tailscale

1. Create a tag named `tag:stephanos-github-recovery`.
2. Create a Tailscale workload/federated identity for this GitHub repository with authority to create ephemeral nodes carrying that tag.
3. Allow that tag to reach only the Battle Bridge's Tailscale identity on TCP port 22.
4. Keep the Battle Bridge's normal Windows OpenSSH service available on the tailnet. Do not expose SSH publicly for this pipe.

### GitHub Actions secrets

- `TS_OAUTH_CLIENT_ID`: Tailscale federated identity client ID.
- `TS_AUDIENCE`: Tailscale federated identity audience.
- `STEPHANOS_BATTLE_BRIDGE_SSH_PRIVATE_KEY`: dedicated private key for this recovery lane only.
- `STEPHANOS_BATTLE_BRIDGE_SSH_KNOWN_HOSTS`: exact OpenSSH known-host entry for the Battle Bridge target.

### GitHub Actions variables

- `STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST`: fixed MagicDNS hostname or Tailscale IP of the Battle Bridge.
- `STEPHANOS_BATTLE_BRIDGE_SSH_USER`: fixed Windows OpenSSH account used by the existing Battle Bridge tasks.

The matching public SSH key must be authorized for that Windows account. Prefer a dedicated recovery key rather than reusing a general interactive-admin key.

## Runtime acceptance

A merged workflow is not proof that this pipe is live.

The first real acceptance requires a #1507 request bound to the exact current `main`, a successful GitHub Actions run, and its uploaded receipt showing:

- `repository: Cheekyfellastef/stephan-os`
- `taskName: Stephanos Battle Bridge GitHub Sync`
- `expectedHead` equals current GitHub `main`
- `observedHead` equals `expectedHead`
- `taskInstalled: true`
- `codexRequired: false`
- all unsafe-authority booleans false
- `finalVerdict: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_READY`

Only after that proof may the normal #1507 mailbox/diagnostic path be expected to resume. Forge remains separately gated by its own real Windows M2 receipt.
