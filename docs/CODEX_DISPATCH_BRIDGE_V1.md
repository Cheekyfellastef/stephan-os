# Stephanos Codex Dispatch Bridge V1

## Purpose

Remove the normal copy-and-paste handoff for a compatible local Codex client running on the Windows Battle Bridge, while keeping remote ChatGPT attachment as a separate authenticated-transport problem.

The bridge reuses the existing Codex Dispatch Queue, Automated Codex Dispatcher, Shared Agent Workspace, Verification Harness, and Battle Bridge guardrails. It does not create a second mission system.

## What V1 supports

A compatible client with the local MCP plugin can call:

- `dispatch_codex_task`
- `get_codex_task_status`
- `read_codex_task_result`

V1 is intentionally limited to operator-approved Battle Bridge proof and diagnostics. Source design, code changes, GitHub review, pull requests, and merges remain in the ChatGPT plus GitHub lane whenever possible.

## Execution path

```text
compatible local Codex client
-> explicit operator confirmation
-> dispatch_codex_task
-> canonical #1292 queue record
-> #1293 automated dispatcher
-> local Codex exec worker on the Battle Bridge
-> bounded shared-workspace task/log/result files
-> get_codex_task_status / read_codex_task_result
```

The worker runs Codex non-interactively with JSON output, ephemeral session state, an explicit `never` approval policy, and a read-only sandbox. It ignores user config for the child run and explicitly disables the dispatch MCP server so the worker cannot recursively dispatch itself. It records the source HEAD and Git status before and after execution.

A successful process exit is not sufficient. The worker requires a `turn.completed` JSON event and rejects `turn.failed`, `error`, failed-item, cancellation, or missing-completion evidence.

## Safety contract

The local worker has no authority to:

- merge or push;
- delete branches;
- run `git reset --hard`;
- expose a public tunnel;
- use broad process-kill commands;
- call MCP or app tools from the child Codex run;
- silently discard source changes;
- run more than one active job.

V1 accepts only the `battle-bridge-proof` task type. Generated `apps/stephanos/dist/**` activity is classified separately. Source mutation is determined by comparing pre-task and post-task source-dirt snapshots, so unchanged pre-existing dirt is reported but is not falsely attributed to the dispatched task. Any new or removed source dirt, or a changed source HEAD, blocks the task result and is preserved for operator inspection.

## Windows installation

From the repository root:

```powershell
npm run stephanos:codex-dispatch:install
npm run stephanos:codex-dispatch:status
```

The installer:

1. copies the plugin package to `%USERPROFILE%\.codex\plugins\stephanos-codex-dispatch`;
2. writes an absolute local `.mcp.json` configuration;
3. registers the MCP server with the local Codex client through `codex mcp add` when available;
4. writes an install proof to `%USERPROFILE%\Documents\Stephanos-openclaw-workspace\codex-dispatch\install-proof.json`.

Restart the local Codex client after installation and open a new compatible Codex session. Local installation is not considered attached until the documented `codex-mcp-client` completes the MCP initialize/initialized session handshake and that session lists all three tools.

The one-click Battle Bridge control-plane rescue reuses this installer and status check. A bare or out-of-order stdio request, unsupported client, invalid version, local files, or MCP registration cannot publish even local attachment readiness. A valid local Codex handshake proves only `readyForCodexCliDispatch`; it does not prove an authenticated remote ChatGPT route and therefore cannot set `readyForRemoteChatDispatch`.

## Cross-device boundary

The source-controlled V1 server is local stdio MCP. Its self-declared client metadata is not an authenticated remote identity. Phone, iPad, and remote web chats require a separately reviewed and authenticated ChatGPT app or secure MCP transport to the Battle Bridge. Until that route exists, status remains `BLOCKED_AUTHENTICATED_REMOTE_MCP_TRANSPORT_REQUIRED`. Do not expose the MCP server or backend directly to the public internet.

## Proof commands

```powershell
node --test shared/agents/localCodexExecIntegration.test.mjs shared/agents/codexDispatchMcp.test.mjs
npm run stephanos:codex-dispatch:install
npm run stephanos:codex-dispatch:status
codex mcp list
```

## Done boundary

Source merge proves only the bridge implementation. A local initialized Codex session, real `tools/list`, dispatch receipt, running status, and completed proof result prove local dispatch. Remote ChatGPT completion additionally requires an authenticated remote transport receipt; local stdio evidence alone can never satisfy that gate.
