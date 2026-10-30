---
name: remote-commander-parity
description: Audit and upgrade Sovereign Commander toward guarded parity or better with all 31 Remote Desktop Commander tools; file, search, process, session, config, telemetry and recovery gaps remain under canonical issue #2573.
---

# Sovereign Commander parity ratchet: better than the metered operator

The durable owner is Cheekyfellastef/stephan-os#2573. Use existing capability-parity reconciler, Skill Forge drafts and canonical mission/build, review, merge, install and proof contracts. Do **not** open a duplicate goal, scheduler, shell gateway, lease owner or second agent runtime merely to count tools. Differentiate whole-PC *functional parity* from Remote Desktop Commander's vendor-specific account, device registry and feedback functions.

## Currently evidenced source-side MCP operations

`get_config`, `read_file`, `read_multiple_files`, `get_file_info`, `write_file`, `edit_file`, `list_directory`, `search_project` (canonical repo only), `list_processes`, and fixed-registry `maintenance_action`.

Some tool names are equal but capabilities may still be narrower. The 13 October 2026 physical `private-mcp-parity-proof` validated only the fixed private metadata and batch-read path. Each expansion requires distinct live proof. A plugin manifest cannot enable host tools that the server does not implement; a source merge cannot prove Desktop-host activation.

## The 31-tool comparison, by outcome

| Remote Desktop Commander action | Sovereign standing as inspected 14 Oct 2026 | Needed proof / work |
|---|---|---|
| read_file, read_multiple_files, get_file_info | Implemented source, narrow physical proof | Authenticated Desktop private file reads, boundaries, content privacy |
| write_file, edit_block | Implemented source as write_file, edit_file | Exact authorized path mutation, before/after + rollback evidence |
| list_directory | Implemented source | Whole-PC path and bound proof |
| list_processes | Implemented source | Fresh local process snapshot |
| get_config | Implemented source | Privacy-safe local config status |
| start_search, get_more_search_results, stop_search, list_searches | PARTIAL only for repo `search_project` | Scoped whole-PC file/content search with bounded paginated sessions and cancellation |
| create_directory, move_file | GAP | Source-controlled private mkdir/rename/move with path consent, symlink checks, rollback |
| write_pdf | GAP | Bounded local PDF workflow, explicitly permitted inputs/outputs |
| start_process, read_process_output, interact_with_process, list_sessions | PARTIAL fixed maintenance only | Approved process registry, bounded output, tracked sessions and operator permission; no generic arbitrary shell |
| kill_process, force_terminate | GAP by default | Narrow PID/identity guarded lifecycle, protected services and proof, separate approval |
| set_config_value | GAP | Allowlisted keys, typed validation, rollback and audit |
| get_usage_stats, get_recent_tool_calls | GAP | Own local usage and correlated receipt history without revealing secrets |
| ping | PARTIAL via health/probe | Genuine observed local/remote transport end-to-end ping |
| list_devices, who_am_i, get_tool_result, list_remote_tool_calls | Service-specific | Equivalent Sovereign device/agent registry and receipt/status, not fake vendor account clones |
| shutdown | Service-specific, potentially hazardous | Governed local agent/service stop only with explicit approval, never silent PC restart |
| give_feedback_to_desktop_commander | Vendor-specific | Sovereign user feedback and improvement intake, not third-party feedback impersonation |

Follow the real registry rather than the table when a new source head has landed. Do not describe the GAP row as installed. Do not count a skill draft or an accepted dispatch as a functioning executable.

## Proposed sequence and graduation gates

1. **Close transport:** prove ChatGPT Desktop host loaded the exact private local plugin manifest and advertised skills, plus genuine MCP `tools/list` and benign `read_file`. Treat a local raw MCP smoke test and the desktop host test as separate gates. Do not leak private contents into public GitHub.
2. **Build filesystem parity:** guarded full-PC path search, creation, move/rename, binary/PDF workflows, directory metadata. Keep OpenClaw Local strictly inside the Stephanos scope and whole-PC access with Standalone and Sovereign.
3. **Build session/process parity:** allowlisted process start, captured output, stop/cancel/timeouts; explicit operator approval for service termination, no arbitrary shell or unrestricted execution. The Sovereign executor stays owner of local command/receipt and preserves canonical approvals.
4. **Build superior features:** anti-hammer adaptive relay, reboot recovery, offline local-model support, skill gap classification into reviewable proposals, autonomy with genuine source/proof, gaming/VR resource governor, integrated telemetry in the existing Observatory/Flywheel. Full local sovereignty is achieved when provider/network outage no longer prevents private PC work, not when a dashboard says GREEN.
5. Require **per-capability physical Battle Bridge evidence** with current head, tool version, host/process identity, exact request ID, before/after or read-only assertion, safe proof hash, negative boundary tests and downgrade/rollback plan. Preserve independent approval and protected merge.

If a tool/action is missing, deduplicate it into the existing #2573 gap registry. When controllers stall, request a skill or capability build through the established Skill Forge/Forge and builder lanes, **not** via self-approval or an insecure, generic HTTP shell. Prefer existing native tools and a unified capability registry over adding a separate second system.
