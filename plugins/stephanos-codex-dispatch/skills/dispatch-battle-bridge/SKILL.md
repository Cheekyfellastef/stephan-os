---
name: Dispatch Battle Bridge Codex
description: Use the local Stephanos dispatcher for guarded Battle Bridge updates, deterministic diagnostics, and operator-approved Codex work.
---

# Dispatch Battle Bridge Codex

Prefer the narrowest tool that can return trustworthy evidence.

## Routing policy

Keep source design, code changes, tests, GitHub review, commits, pull requests, and merges in the normal ChatGPT plus GitHub lane whenever they can be completed there.

Use `update_stephanos_from_chat` after explicit operator approval when Stephan asks to update Stephanos completely. It fast-forwards canonical `main`, runs the bridge regression tests, invokes the existing guarded ignition entry, and proves the served UI plus backend and OpenClaw health. It removes manual PowerShell from the operator workflow while preserving the existing internal Windows machinery and safety gates.

Use `sync_codex_dispatch_bridge` after explicit operator approval when only the canonical Battle Bridge repository and dispatch tests need to move forward. This tool must never reset, clean, stash, force-check out, or discard local work.

Use `run_battle_bridge_diagnostics` for deterministic Git and localhost health proof. It runs in the trusted MCP host without a Codex child, PowerShell, service control, source mutation, or dependency on Codex shell policy.

Use `dispatch_codex_task` only after the operator explicitly asks for work that genuinely requires a Codex child, such as:

- live Windows runtime or browser acceptance that deterministic host tools do not cover;
- bounded machine-only investigation requiring Codex reasoning;
- local credentials or specialist tools unavailable through GitHub and direct diagnostics;
- post-merge end-to-end proof that cannot be represented as an allowlisted host operation.

Do not dispatch ordinary code writing merely because Codex is available.

## Phone and iPad Codex Remote route

When this local MCP tool surface is not present but the chat is attached to the Battle Bridge through Codex Remote, use the repository skill `update-stephanos-from-chat` and its exact source-controlled entrypoint. Do not ask Stephan to open PowerShell or paste a shell wall.

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
