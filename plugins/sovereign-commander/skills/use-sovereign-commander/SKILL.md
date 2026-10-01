---
name: Use Sovereign Commander
description: Use the local guarded Stephanos Sovereign Commander on the Battle Bridge for bounded PC inspection, explicit file operations, and source-controlled maintenance actions.
---

# Use Sovereign Commander

Use this local MCP surface when the operator wants ChatGPT Desktop to inspect or operate the Battle Bridge without relying on a metered remote-control service.

## Safety and routing

Prefer read-only tools first. Use `get_config`, `list_processes`, `list_directory`, and `read_file` to establish current state before proposing mutation.

Use `write_file` or `edit_file` only when the operator has actually requested a file change and the requested path is within Sovereign Commander's admitted policy.

Use `maintenance_action` only for the source-controlled action IDs exposed by the tool schema. Do not invent action IDs or translate user prose into arbitrary shell commands.

Sovereign Commander intentionally exposes no arbitrary shell, force-push, merge authority, credential export, unrestricted process control, or PC restart authority. Do not route around those limits.

Treat tool receipts and proof hashes as the execution truth. Separate observed facts from plans or inferred state.

## Multi-surface boundary

This plugin is the direct local desktop route. iPad and iPhone chats do not receive local MCP tools from this package. Mobile or cloud ChatGPT requests must use the separately guarded Sovereign Commander mailbox ingress. That ingress may request the admitted source-controlled repair/orchestration actions, including Battle Bridge repair, control-plane repair, ignition, worker/backend recovery, and OpenClaw ignition repair. It still carries no arbitrary shell, arbitrary path, merge, credential, or PC-restart authority.

Never put Sovereign Commander bearer tokens, file contents, credentials, private paths containing secrets, or raw command output into the public GitHub mailbox.


## Remote repair delegation

When a ChatGPT session cannot see the local Sovereign Commander MCP tools, do not conclude that Sovereign Commander cannot perform a repair merely because the local tool surface is absent. If the user has requested a repair that maps to an admitted remote action, use the canonical GitHub mailbox operation RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION with exact current main head, expiry and operator approval.

Prefer the narrowest admitted repair action. repair-battle-bridge is the general bounded Battle Bridge repair orchestrator; use a more specific repair action when one exists. Do not translate arbitrary user text into shell commands, and do not put raw command output, file content or secrets into the public mailbox.
