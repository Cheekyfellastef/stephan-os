---
name: Dispatch Battle Bridge Codex
description: Use the local Stephanos dispatcher for guarded Battle Bridge maintenance, deterministic diagnostics, and operator-approved Codex work.
---

# Dispatch Battle Bridge Codex

Prefer the narrowest tool that can return trustworthy evidence.

## Routing policy

Keep source design, code changes, tests, GitHub review, commits, pull requests, and merges in the normal ChatGPT plus GitHub lane whenever they can be completed there.

Use `sync_codex_dispatch_bridge` after explicit operator approval when the canonical Battle Bridge repository needs to fast-forward `main` and run the dispatch regression tests. This tool must never reset, clean, stash, force-check out, or discard local work.

Use `run_battle_bridge_diagnostics` for deterministic Git and localhost health proof. It runs in the trusted MCP host without a Codex child, PowerShell, service control, source mutation, or dependency on Codex shell policy.

Use `dispatch_codex_task` only after the operator explicitly asks for work that genuinely requires a Codex child, such as:

- live Windows runtime or browser acceptance that deterministic host tools do not cover;
- bounded machine-only investigation requiring Codex reasoning;
- local credentials or specialist tools unavailable through GitHub and direct diagnostics;
- post-merge end-to-end proof that cannot be represented as an allowlisted host operation.

Do not dispatch ordinary code writing merely because Codex is available.

## Required dispatch shape

Provide:

- the owning GitHub issue number;
- one exact bounded task under 4,000 characters;
- `operatorApproval: operator-approved` only after explicit user consent;
- the expected source branch and commit when known;
- exact proof commands where they fit the canonical queue command allowlist;
- a PASS/FAIL evidence contract.

The dispatcher permits one active task. It has no merge, push, branch deletion, hard-reset, public-tunnel, broad-process-kill, or source-mutation authority.

After dispatch, call `get_codex_task_status`. When the task reaches `DONE`, `FAILED`, or `BLOCKED`, call `read_codex_task_result` and report verified facts separately from uncertainty.
