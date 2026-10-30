---
name: meter-free-battle-bridge-files
description: Use private Sovereign Commander MCP to read, inspect and safely edit authorized Battle Bridge files without using Codex or Remote Desktop Commander meter; discover desktop activation blockers and coordinate scoped OpenClaw fallback.
---

# Battle Bridge private files without a remote-control meter

This skill is a tool-routing recipe, not a grant of new filesystem capability or proof that ChatGPT Desktop has loaded a local MCP connection. The existing `sovereign-commander` stdio MCP implements `read_file`, `read_multiple_files`, `get_file_info`, `list_directory`, `write_file`, `edit_file`, `search_project`, `list_processes`, `get_config` and `maintenance_action`. Source presence and account plugin installation **do not** prove host tool discovery or a successful local file operation.

## First discover which route is actually live

1. Use the **connected private local MCP** on Battle Bridge if its named tools are available in the current conversation. Check actual `tools/list` exposure, then prove with `get_file_info` or `read_file` on a harmless, exact file. A known physical MCP verification from 13 October 2026 confirmed fixed private batch read and metadata tools through a local authenticated route, but not direct tool exposure in any particular ChatGPT session.
2. If no Sovereign tools appear, do not pretend to have local access. Check the installed Desktop-host plugin inventory, actual local stdio MCP process activation and loaded plugin skills. Repository release or restarting `sovereign-commander-http.mjs` is not a Desktop-host activation proof. Report the specific missing hop.
3. For whole-PC inspection that cannot be fulfilled through this chat, have **OpenClaw Standalone on the Battle Bridge** call the same local/private Sovereign primitives or use its own authorized local filesystem tools. Do not present an instruction to OpenClaw as if it already executed; require an actual result. For Stephanos repository files only, OpenClaw Local can be used with its narrow project scope. Neither OpenClaw agent's local existence creates a direct tool transport from ChatGPT cloud chat.
4. Mobile / normal cloud ChatGPT can use the established guarded GitHub the current source-defined canonical mailbox action mailbox for fixed metadata-only remote actions. **Never** transmit local file contents, sensitive filenames, absolute PC paths, tokens, source excerpts or private stdout/stderr through the public repo or its comments. File contents need a genuinely private/authenticated transport, not the public relay.
5. Preserve the original tool/agent authority controls; do not open loopback port `18791` to the public Internet, publish token files, invent an MCP tunnel, or route unconstrained file reads through GitHub. Do not substitute Remote Commander just because the SaaS transport meter is available.

## File workflow

- For file or directory discovery: `list_directory` (bounded depth / entry count), `get_file_info` (size, modification timestamp), then `read_file` (offset and line cap) or `read_multiple_files` (maximum eight private paths per call, limited lines). Existing `search_project` is a bounded literal search **inside the Stephanos repository only**, not general whole-disk search. Say so when the user asks to search elsewhere.
- For file edits: use `edit_file` exact unique replacement or `write_file` to one operator-authorized absolute path; check scope, intent, before-content and explicit authorization, then re-read and verify. Never mutate with a read-only probe. Do not use this skill to bypass normal source-lease, independent PR review, protected merge or operator approval.
- For PDFs, image handling, filesystem move/rename/mkdir, arbitrary whole-PC content search, live terminal interaction or process termination: check the live registry. These are **parity gaps unless individually implemented and physically proven**. Route bounded requirements under canonical GitHub issue #2573 instead of asserting parity or inventing tool names.
- For user privacy, never quote a home file's content into a public GitHub artifact. ChatGPT conversation itself remains a separate service; explain that sensitive content read through connected private tools may be processed by the active model service according to its settings. For fully local-only data, use Stephanos AI / OpenClaw local models instead.

## Verification contract

Use exactly one innocuous checked-in test file (e.g. `package.json`) for a live proof: local tool discovery, actual file metadata, bounded content read, directory listing and optionally repository search. A proof script can call the existing `scripts/sovereign-commander-mcp.mjs` locally and emit **only booleans and error codes**. That proves MCP *server* function, **not** that ChatGPT Desktop exposed the same tools; test both separately. Never return raw paths, source text, secrets or test content in a public receipt.

Status must distinguish: `SOURCE_EXISTS`, `PLUGIN_RELEASE_PRESENT`, `DESKTOP_HOST_CONNECTED`, `MCP_TOOL_LISTED`, `LOCAL_FILE_READ_PROVEN`, `OPENCLAW_ROUTE_PROVEN` and `REMOTE_CHAT_ACCESS_PROVEN`. Only mark a state green with its own observed evidence. A healthy daemon or a GitHub receipt is not evidence of direct local ChatGPT file access.

## Pricing

Local Sovereign operations use no Codex or Remote Desktop Commander tool-call meter. A cloud ChatGPT session still has normal plan/message/tool usage, and a GitHub mailbox is subject to GitHub's quotas. Do not promise zero usage limits or automatic desktop tool support. The long-term fully sovereign route is Stephanos AI + OpenClaw/Ollama executing privately on Battle Bridge.
