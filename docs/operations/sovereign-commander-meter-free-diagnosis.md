# Meter-free Battle Bridge diagnosis

Canonical owner: #2573 — Goal: Make Sovereign Commander absorb every Remote Commander capability.

Use the existing Sovereign Commander execution plane first. Local/private MCP is the direct desktop route. Cloud ChatGPT uses the GitHub Sovereign Relay fast carrier and the scheduled mailbox fallback on #2808 — Canonical Sovereign Mailbox Authority — successor to exhausted #2590. Neither route requires a Remote Desktop Commander allowance. ChatGPT/provider usage and GitHub API capacity remain separate constraints.

## Read-only discovery

`inspect_battle_bridge` is a private MCP adapter to existing fixed maintenance actions. Its closed action enum is enforced before execution, including rejection of extra arguments. It has no independent executor, shell, controller, service or state store. The underlying fixed registry and proof receipts remain canonical.

| Need | Fixed action |
| --- | --- |
| CPU pressure and process/script attribution | `cpu-pressure-snapshot` (five-second sample, creation-time checks) |
| RAM, GPU/VRAM, loaded models and service reachability | `battle-bridge-observe` |
| Source/runtime heads, health, transport and lane attention | `visibility-snapshot` |
| Battle Bridge status | `battle-bridge-status` |
| Physical/logical controller activity | `controller-lane-status` |
| Provider meter observations | `meter-status` |
| Recovery task health | `status-recovery-mesh` |
| Worker watchdog health | `status-worker-watchdog` |
| Core daemon readiness and heartbeat | `status-stephanos-core-daemon` |
| Gaming/VR governor's recorded state | `gaming-resource-status` |
| Starfield VR performance evidence | `starfield-vr-performance-diagnosis` |

`gaming-resource-status` reads recorded governor telemetry. Check its observation time; a newly returned receipt does not make old telemetry current. Likewise, process-list CPU is cumulative process time; use the sampler for utilization. A successful transport receipt proves execution, not healthy services, fresh evidence, low CPU or a successful repair.

Before the new tool is admitted and the connected MCP process refreshed, use the existing `maintenance_action` for its exposed diagnostics. The core-daemon action also remains available through the guarded cloud mailbox. Source publication does not refresh an already-running MCP process or the client tool catalog.

## Cloud ChatGPT

Post one owner-authenticated `stephanos-battle-bridge-command` envelope using `RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION`, the current exact main head, one fixed `remoteAction`, unique request ID and short expiry. Preserve the same request identity while inspecting receipt state. Publication and `ACCEPTED` are intermediate states; require a correlated `DONE` receipt with its action projection and proof hash before claiming execution. An expired or blocked request is not success and must not be blindly replayed.

The CPU mailbox action executes only the immutable sampler blob from the approved Git head, so it remains usable when a long-lived MCP process has an older tool catalog. Other remote actions retain their existing authenticated MCP route. Public GitHub receipts are sanitized: no raw file contents, command lines, local paths or secrets. Do not widen this mailbox to reproduce private file/process inspection.

## Guarded repair

Use existing `maintenance_action` / admitted remote repair verbs after diagnosis: for example `repair-ui-4173`, `repair-control-plane`, `repair-battle-bridge` or `repair-openclaw-stack`. The read-only inspection tool rejects all repair verbs, gaming preparation/overrides and runtime restart. Repair approval, source/head checks, leases and post-action proof remain independently required. A parity classification is a route mapping, never an approval grant.

General PowerShell, arbitrary process/service control, unrestricted termination, credential export and PC restart are not supplied by this adapter. Missing bounded capabilities belong to #2573; preserve operator gates while building the smallest reusable fixed recipe. Existing private file batching remains in PR #3024 — Goal #2573: Expand Sovereign Commander private diagnostics without vendor meter.

## Delivery and reusable invariant

Run the complete Sovereign parity suite and independent review on the exact source head/base. Use the existing protected merge boundary with its exact operator packet; synchronize main without discarding local data, refresh the existing MCP lifecycle where admitted, then prove `tools/list` and real Windows calls. Do not claim the new tool is deployed from candidate tests alone.

Invariant: an existing guarded diagnostic must be discoverable from its admitted transport and map to its canonical semantic capability, while read-only tool admission must fail closed before any repair executor is reached. Cross-layer regression tests enforce the registry/MCP/cloud correspondence and rejection of repair, shell, path and process-ID smuggling.
