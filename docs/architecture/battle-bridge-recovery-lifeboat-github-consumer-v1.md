# Battle Bridge Recovery Lifeboat GitHub Consumer V1

## Purpose

This is M6 of durable recovery goal #1814, stacked on M5 PR #1824.

M1-M5 define the owner request, GitHub-hosted attestation, fixed R1 executor, independent A/B installation boundary and deterministic claim selection. M6 puts the GitHub reader/claim/execution adapter inside each immutable lifeboat bank so the installed task can consume a valid mobile recovery request without depending on:

- the Stephanos UI or backend;
- OpenClaw Gateway;
- the ordinary GitHub command mailbox;
- the Recovery Mesh itself;
- Node/npm startup;
- the `stephan-os` checkout after installation.

This PR is source-only. It does not install or activate the lifeboat, execute a Windows recovery, merge source, deploy, install Podman, execute Forge, or restart the PC.

## Fixed recovery loop

Every ordinary scheduled lifeboat tick performs the existing immutable bank/probe checks and then, only when the bank remains healthy, runs one fixed no-argument GitHub claim consumer:

```text
fixed public GitHub issue #1814 endpoint
  -> require JSON response
  -> parse exact owner request marker
  -> prove OWNER identity + freshness + five-minute expiry
  -> parse exact github-actions[bot] M2 attestation
  -> prove source comment/event binding + request SHA-256
  -> admit only M3-qualified R1 action
  -> exclusive create-new local claim
  -> fixed checkout-independent action adapter
  -> immutable terminal execution receipt
  -> consumed-request receipt on successful fixed dispatch
  -> remote status truth
```

The currently executable action set remains exactly:

- `PROBE_BATTLE_BRIDGE`
- `WAKE_CANONICAL_MAILBOX`
- `WAKE_CANONICAL_RECOVERY_MESH`

No other M1 action is executable through M6.

## HTML/SPA incident handling

The live OpenClaw WhatsApp failure on 2026-08-16 returned `<!doctype ...>` where the legacy adapter expected JSON. M6 treats response media type and JSON decoding as explicit trust boundaries. HTML or malformed JSON becomes:

```text
RECOVERY_SOURCE_INVALID
GITHUB_RECOVERY_RESPONSE_NOT_JSON
```

or

```text
RECOVERY_SOURCE_INVALID
GITHUB_RECOVERY_JSON_INVALID
```

The response body is not evaluated as code, shell, PowerShell, URL, path, task or process identity.

GitHub unavailability is recorded as `RECOVERY_SOURCE_UNAVAILABLE` and does not make the independent local probe disappear. Silence is not painted green.

## A/B payload binding

Lifeboat bank version `1.1.0` extends the immutable manifest material from:

```text
runner
action
version
```

to:

```text
runner
action
claim
version
```

The installed claim-consumer bytes are therefore hash-bound to the promoted bank.

The candidate-bank installation self-test uses `-SelfTestOnly`. It proves the candidate payload and fixed local probe but deliberately does not poll GitHub, claim a request or execute a recovery action before promotion.

## Replay and concurrency

A valid recovery request must first create a claim file with `FileMode.CreateNew` under the installed lifeboat state root. Existing claims lose cleanly. A successful fixed dispatch then creates a terminal execution receipt and a consumed-request record.

M6 deliberately does not auto-reclaim an abandoned claim. Crash-recoverable claim leases belong to a later rung because reclaiming authority incorrectly is worse than holding a request for diagnosis.

## Truth semantics

A successful wake means only:

```text
RECOVERY_ACTION_DISPATCHED_PROOF_PENDING
```

It does **not** mean the Battle Bridge is recovered. The terminal receipt keeps `recoveredHealthClaimed=false` and `postActionProofRequired=true`.

Remote status records distinguish:

- no fresh attested request;
- GitHub unavailable;
- GitHub response invalid;
- request already claimed;
- fixed action blocked;
- fixed action dispatched with proof pending.

## Authority boundary

M6 exports no caller parameters and fixes all repository, issue, URL, action and local execution identities in reviewed source. It grants no arbitrary shell, caller-selected URL/path/task, source mutation, Git mutation, merge, deployment, Podman/Forge execution or PC restart authority.

## Next rung

M7 should add bounded post-action verification and crash-aware claim terminalization so a wake can graduate from `DISPATCHED_PROOF_PENDING` to a fresh exact recovery-health verdict without widening the action surface. Installation/activation and all real Windows mutation remain separately approval-gated.