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
npm run stephanos:chat:update -- --operator-approved
```

For read-only status only:

```text
npm run stephanos:chat:diagnostics
```

For source sync and focused bridge tests without runtime refresh:

```text
npm run stephanos:chat:sync -- --operator-approved
```

## Approval rule

Treat a direct imperative from Stephan such as `Update Stephanos now` as approval for this exact bounded update. For a question such as `Can Stephanos be updated?`, explain the plan and request explicit approval before using the approval flag.

Never invent approval. Never reuse approval for a later update.

## Safety

The update entrypoint must remain the only command surface used for this workflow. Do not replace it with handwritten PowerShell or a free-form shell sequence.

It is constrained to:

- the canonical `main` checkout;
- `git fetch` and `git merge --ff-only`;
- existing source-controlled dispatch tests;
- the existing guarded Battle Bridge ignition entry;
- exact-head Git and localhost health proof.

It must fail closed on local commits, divergence, unsafe source dirt changes, failed tests, failed ignition, or stale served runtime.

It must never run `git reset`, `git clean`, `git stash`, force checkout, rebase, push, branch deletion, public tunnel changes, or secret dumping.

## Result

Return the structured result with:

- before, remote, and after source heads;
- whether a fast-forward occurred;
- test outcome;
- ignition outcome;
- 4173 exact-head proof;
- 8787 and 18789 health;
- source-dirt delta;
- whether a desktop restart is required;
- PASS, FAIL, or exact blocker.

Do not ask Stephan to open PowerShell. The entrypoint may call existing hidden Windows machinery internally, but the operator interface is the chat.
