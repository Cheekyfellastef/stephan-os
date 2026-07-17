---
name: update-stephanos-from-chat
description: Update the canonical Stephanos Battle Bridge checkout and exact-head runtime from a Battle Bridge, phone, or iPad Codex Remote chat without asking Stephan to run PowerShell.
---

# Update Stephanos from chat

Use this skill when Stephan says things such as:

- Update Stephanos.
- Sync the Battle Bridge to main.
- Pull the latest Stephanos build and make it live.
- Update Stephanos from my phone or iPad.

## Routing

Prefer ChatGPT plus GitHub for creating, reviewing, testing, and merging source changes.

After approved changes are on `origin/main`, use the source-controlled Battle Bridge update entrypoint from the canonical repository:

```text
node scripts/stephanos-chat-update.mjs update --operator-approved
```

For read-only status only:

```text
node scripts/stephanos-chat-update.mjs diagnostics
```

For source sync and focused bridge tests without runtime refresh:

```text
node scripts/stephanos-chat-update.mjs sync --operator-approved
```

Use `node` directly. Do not route this workflow through `npm`, `npm.cmd`, PowerShell, or a handwritten shell sequence.

## Execution-surface preflight

This skill is valid only on a real attached Battle Bridge Windows execution surface. Before running any command, verify a fresh execution-surface handshake proving:

- attached/connected state;
- Windows platform;
- `can_local_windows_proof: true`;
- a real surface receipt;
- a fresh heartbeat.

A plain GitHub `@codex` mention launches cloud Codex and is not a Battle Bridge route, regardless of prompt wording. Never use it for this skill.

If the handshake is missing, stale, Linux, or otherwise mismatched, run nothing and return exactly `BATTLE_BRIDGE_EXECUTION_SURFACE_NOT_ATTACHED` or `BLOCKED_ROUTE_CAPABILITY_MISMATCH`. Do not create a cloud substitute, do not claim a task receipt, and do not create a duplicate task.

## Approval rule

Treat a direct imperative from Stephan such as `Update Stephanos now` as approval for one exact bounded update to the latest canonical `origin/main` observed immediately after this run fetches it.

Record that observed 40-character remote head as `approvedTargetHead`. Require the post-fast-forward local HEAD to equal it exactly before tests or runtime refresh may count as accepted.

Do not pin the request to an older merge head when Stephan asked for the latest canonical main. A newer canonical `origin/main` is not an unapproved surprise under this approval scope. It becomes the exact approved target only when observed by the current run after fetch.

For a question such as `Can Stephanos be updated?`, explain the plan and request explicit approval before using the approval flag.

Never invent approval. Never reuse approval for a later update.

## Safety

The update entrypoint must remain the only command surface used for this workflow. Do not replace it with handwritten PowerShell or a free-form shell sequence.

It is constrained to:

- the canonical `main` checkout;
- `git fetch` and `git merge --ff-only`;
- existing source-controlled dispatch tests run through the current Node executable;
- the existing guarded Battle Bridge ignition entry;
- exact-head Git and localhost health proof.

It must fail closed on local commits, divergence, post-fetch target mismatch, unsafe source dirt changes, failed tests, failed ignition, or stale served runtime.

It must never run `git reset`, `git clean`, `git stash`, force checkout, rebase, push, branch deletion, public tunnel changes, or secret dumping.

## Result

Return the structured result with:

- approval scope and approved target head;
- before, remote, and after source heads;
- whether a fast-forward occurred;
- direct Node test outcome;
- ignition outcome;
- 4173 exact-head proof;
- 8787 and 18789 health;
- source-dirt delta;
- whether a desktop restart is required;
- PASS, FAIL, or exact blocker.

Do not ask Stephan to open PowerShell. The entrypoint may call existing hidden Windows machinery internally, but the operator interface is the chat.
