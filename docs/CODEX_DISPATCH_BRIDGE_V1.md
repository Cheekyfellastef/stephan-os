# Stephanos Codex Dispatch Bridge V1

## Purpose

Remove the normal copy-and-paste handoff between a compatible ChatGPT/Codex chat and Codex running on the Windows Battle Bridge.

The bridge reuses the existing Codex Dispatch Queue, Automated Codex Dispatcher, Shared Agent Workspace, Verification Harness, and Battle Bridge guardrails. It does not create a second mission system.

## What V1 supports

A compatible client with the local MCP plugin can call:

- `dispatch_codex_task`
- `get_codex_task_status`
- `read_codex_task_result`

V1 is intentionally limited to operator-approved Battle Bridge proof and diagnostics. Source design, code changes, GitHub review, pull requests, and merges remain in the ChatGPT plus GitHub lane whenever possible.

## Execution path

```text
compatible chat
-> explicit operator confirmation
-> dispatch_codex_task
-> canonical #1292 queue record
-> #1293 automated dispatcher
-> local Codex exec worker on the Battle Bridge
-> bounded shared-workspace task/log/result files
-> get_codex_task_status / read_codex_task_result
```

The worker runs Codex non-interactively with JSON output, ephemeral session state, and workspace-write sandboxing. It records the source HEAD and Git status before and after execution.

## Safety contract

The local worker has no authority to:

- merge or push;
- delete branches;
- run `git reset --hard`;
- expose a public tunnel;
- use broad process-kill commands;
- silently discard source changes;
- run more than one active job.

V1 accepts only the `battle-bridge-proof` task type. Generated `apps/stephanos/dist/**` changes are classified separately. Any other source-tree change blocks the task result and is preserved for operator inspection.

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

Restart ChatGPT desktop after installation. Install or enable the local `stephanos-codex-dispatch` plugin in the plugin/developer interface, then open a new compatible chat. Installation is not considered complete until that chat lists all three tools.

## Cross-device boundary

The source-controlled V1 server is local stdio MCP. It proves direct dispatch from compatible chats running with access to the Battle Bridge plugin. Phone and remote web chats require a separately authenticated ChatGPT app or secure MCP transport to the Battle Bridge. Do not expose the MCP server or backend directly to the public internet.

## Proof commands

```powershell
node --test shared/agents/localCodexExecIntegration.test.mjs shared/agents/codexDispatchMcp.test.mjs
npm run stephanos:codex-dispatch:install
npm run stephanos:codex-dispatch:status
codex mcp list
```

## Done boundary

Source merge proves the bridge implementation. Battle Bridge installation plus a real `tools/list`, dispatch receipt, running status, and completed proof result are required before issue #1293 may claim automatic dispatch is fully complete.
