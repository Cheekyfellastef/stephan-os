# Battle Bridge Recovery Lifeboat GitHub Claim V1

## Purpose

This is M5 of durable recovery goal #1814, stacked on the independent A/B lifeboat installer in PR #1821.

The missing boundary after M1-M4 is not another recovery command surface. It is a deterministic way for the installed lifeboat to discover a fresh owner request on canonical issue #1814, bind it to the GitHub-hosted M2 attestation, and admit only actions already implemented by the checkout-independent M3 fixed executor.

This slice is source-only. It does not poll GitHub from Windows, install a new bank, start a Scheduled Task, execute a recovery action, merge source, deploy, install Podman, execute Forge, or restart the PC.

## Fixed public GitHub endpoint

The repository is public, so the future installed lifeboat does not require a GitHub token merely to read the recovery issue. The claim contract fixes the read endpoint to canonical repository `Cheekyfellastef/stephan-os`, issue `#1814`, first page, maximum 100 comments.

No caller-selected repository, issue, URL, page, query, token, header, ref, or workflow is accepted.

The five-minute M1 authority window means a valid recovery request must be recent. If the bounded 100-comment window cannot contain a uniquely valid current request/attestation pair, the lifeboat fails closed instead of widening its query surface.

## Trust chain

A recovery action is claimable only through this chain:

```text
owner comment on #1814
  -> exact M1 request marker + JSON
  -> owner login == Cheekyfellastef
  -> author_association == OWNER
  -> fresh <=5 minute M1 request
  -> GitHub-hosted M2 attestation comment
  -> comment author == github-actions[bot]
  -> exact sourceCommentId/eventBinding back to owner request
  -> exact request SHA-256/action/expiry/workflow binding
  -> action belongs to the currently qualified M3 executable set
  -> requestId is not already consumed
  -> create-new local claim required before execution
```

Raw issue text never executes. An owner-authored imitation of the attestation marker is not accepted as GitHub-hosted attestation evidence.

## Initial executable action set

M5 deliberately admits only the fixed actions implemented by PR #1820:

- `PROBE_BATTLE_BRIDGE`
- `WAKE_CANONICAL_MAILBOX`
- `WAKE_CANONICAL_RECOVERY_MESH`

M1 already defines higher-impact actions such as backend/UI restart, checkout repair and full recovery, but this claim layer will not expose those until a later reviewed fixed executor qualifies them.

## Replay and concurrency rule

Selection is not execution authority by itself. The returned claim says `claimCreateNewRequired=true`.

The future installed PowerShell consumer must create one exclusive request claim in the lifeboat state root before running the M3 adapter. A consumed request ID may not be selected again. If another recovery entrance already owns that request, the later claimant loses cleanly.

This provides the deduplication primitive required for simultaneous GitHub, OpenClaw and future Tailnet requests without creating another scheduler or lease service.

## Live incident fixture

The 2026-08-16 iPad/WhatsApp attempt reached the installed OpenClaw plugin but failed because the legacy wake adapter treated an HTML SPA fallback from `127.0.0.1:18789/identity` as JSON.

M5 intentionally has no dependency on that endpoint or on OpenClaw gateway identity. The target path is:

```text
GitHub owner request
  -> GitHub-hosted attestation
  -> independent installed lifeboat
  -> fixed checkout-independent executor
```

That is the path that must eventually work while OpenClaw, the normal mailbox, the Recovery Mesh, or the repository checkout are individually broken.

## Fail-closed boundaries

The claim projection always keeps these false:

- arbitrary shell
- caller-selected URL/path/task
- source mutation
- Git mutation
- merge
- PC restart

A successful wake dispatch still requires fresh post-action proof. Starting a Scheduled Task must never be painted as recovered Battle Bridge health by itself.

## Next rung

M6 should implement the installed PowerShell claim consumer inside the inactive A/B bank, bind its bytes into the bank manifest, create exclusive claim/consumed receipts outside the repository, execute only the three M3 actions, and publish remote recovery status truth. Real installation and remote execution remain separately review- and approval-gated.
