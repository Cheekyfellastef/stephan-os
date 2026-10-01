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

This plugin is the direct local desktop route. iPad and iPhone chats do not receive local MCP tools from this package. Mobile ChatGPT requests must use the separately guarded Sovereign Commander mailbox ingress, which is intentionally limited to sanitised status and source-controlled maintenance actions.

Never put Sovereign Commander bearer tokens, file contents, credentials, private paths containing secrets, or raw command output into the public GitHub mailbox.
