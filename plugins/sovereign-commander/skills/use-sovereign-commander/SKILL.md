---
name: Use Sovereign Commander
description: Use the local guarded Stephanos Sovereign Commander on the Battle Bridge for bounded PC inspection, explicit file operations, and source-controlled maintenance actions.
---

# Use Sovereign Commander

Use this local MCP surface when the operator wants ChatGPT Desktop to inspect or operate the Battle Bridge without relying on a metered remote-control service.

## Safety and routing

Prefer read-only tools first. Use `get_config`, `search_project`, `list_processes`, `list_directory`, and `read_file` to establish current state before proposing mutation. For project discovery, prefer `search_project` over Remote Desktop Commander search because it is canonical-repository scoped and meter-free.

For persistent Stephanos health, use the fixed `status-stephanos-core-daemon` maintenance action. It reports only bounded Core Daemon readiness, heartbeat age, exact source head and the health of the already-canonical Sovereign Commander/backend/Mission Worker observations. Use this remote-capable status before falling back to Remote Desktop Commander for Battle Bridge inspection.

Use `write_file` or `edit_file` only when the operator has actually requested a file change and the requested path is within Sovereign Commander's admitted policy.

Use `maintenance_action` only for the source-controlled action IDs exposed by the tool schema. Do not invent action IDs or translate user prose into arbitrary shell commands.

Sovereign Commander intentionally exposes no arbitrary shell, force-push, merge authority, credential export, unrestricted process control, or PC restart authority. Do not route around those limits.

Treat tool receipts and proof hashes as the execution truth. Separate observed facts from plans or inferred state.

For fleet/goal continuity, use `fleet-goal-supervisor`. It consumes the canonical programme and provider-capacity receipts through the existing backlog conveyor/elastic dispatcher and asks that fabric to fill safe free lanes. It performs no synchronous provider probes. Long-running source mutation remains owned by the Mission Worker. The supervisor must not create another scheduler, seize leases, or invent work when no runnable goal is proven.

## Multi-surface boundary

This plugin is the direct local desktop route. iPad and iPhone chats do not receive local MCP tools from this package. Mobile or cloud ChatGPT requests must use the separately guarded Sovereign Commander mailbox ingress. That ingress may request the admitted source-controlled repair/orchestration actions, including Battle Bridge repair, control-plane repair, ignition, worker/backend recovery, and OpenClaw ignition repair. It still carries no arbitrary shell, arbitrary path, merge, credential, or PC-restart authority.

Never put Sovereign Commander bearer tokens, file contents, credentials, private paths containing secrets, or raw command output into the public GitHub mailbox.


## Semantic recovery verbs

Prefer the highest-level admitted repair verb that matches the operator intent:

- `repair-openclaw-standalone` repairs and proves the canonical whole-PC OpenClaw Standalone agent using the source-controlled OpenClaw Doctor, agent-registration, Gateway and model-route checks.
- `repair-openclaw-local` applies the same bounded recovery contract to the Stephanos-scoped `stephanos-scout-coder` agent.
- `repair-goal-builder-flow` checks the canonical fleet/goal supervisor first and, only when blocked, repairs the control plane, ensures the Mission Worker is running, refreshes goal discovery, and re-runs dispatch proof.

These verbs are semantic shortcuts, not extra authority. They accept no arbitrary command text or caller-selected filesystem path and do not add merge or PC-restart authority.

## Remote repair delegation

When a ChatGPT session cannot see the local Sovereign Commander MCP tools, do not conclude that Sovereign Commander cannot perform a repair merely because the local tool surface is absent. If the user has requested a repair that maps to an admitted remote action, use the canonical GitHub mailbox operation RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION with exact current main head, expiry and operator approval.

Prefer the narrowest admitted repair action. repair-battle-bridge is the general bounded Battle Bridge repair orchestrator; use a more specific repair action when one exists. Do not translate arbitrary user text into shell commands, and do not put raw command output, file content or secrets into the public mailbox.

If a native ChatGPT Remote Desktop Commander connector must be used as break-glass, treat the tool use as a capability-discovery event. Mirror its semantic operation into the #2573 parity observation schema using the `desktop-commander-direct` ingress when a ChatGPT-facing adapter is available. Never treat native connector availability or meter as the durable implementation.


## Bounded remote plans

When one remote repair needs several already-admitted Sovereign Commander maintenance actions, prefer one bounded `remotePlan` over multiple independent mailbox requests. A remote plan may contain at most six unique source-controlled maintenance action IDs and executes strictly in the supplied order.

Use plans for compact recovery sequences such as `battle-bridge-status` → `repair-control-plane` → `ignite-stephanos`. Every step must return an exact successful Sovereign Commander receipt before the next step is admitted. The plan stops at the first failed or malformed receipt and returns only sanitised proof metadata for the completed steps.

Do not include `status` in a plan; the existing single-action `status` route remains the read-only Commander posture check. Do not duplicate action IDs. A plan does not add arbitrary shell, arbitrary arguments, file-content transport, path access, credentials, merge authority, or PC restart authority.

For source-code repairs from cloud ChatGPT, keep source mutation on the governed GitHub branch/PR lane, then use a bounded Sovereign Commander plan for local sync, repair, ignition and proof. This keeps the public mailbox as a control envelope rather than a code or secret transport.
