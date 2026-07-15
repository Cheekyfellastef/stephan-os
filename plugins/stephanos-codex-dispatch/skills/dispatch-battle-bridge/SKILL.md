---
name: Dispatch Battle Bridge Codex
description: Use the local Stephanos dispatcher for operator-approved live Windows proof and diagnostics that genuinely require the Battle Bridge.
---

# Dispatch Battle Bridge Codex

Use `dispatch_codex_task` only after the operator explicitly asks for the work to be sent to Codex.

## Meter routing policy

Keep source design, code changes, tests, GitHub review, commits, pull requests, and merges in the normal ChatGPT plus GitHub lane whenever they can be completed there.

Reserve Codex dispatch for work that requires the real Battle Bridge, including:

- Windows processes, ports, PowerShell, local services, or machine state;
- live browser, Playwright, visual, or runtime acceptance proof;
- local credentials or tools that are not available through GitHub;
- post-merge cold-start, second-press, self-heal, and end-to-end tests.

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
