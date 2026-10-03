# Sovereign Commander V1

Owner goal: #2519 — Build Sovereign Commander as the unmetered Battle Bridge control surface.

## Purpose

Sovereign Commander is the Stephanos-owned whole-PC execution/control surface for the Battle Bridge. It replaces normal dependence on metered third-party Remote/Desktop Commander transport while reusing the existing Stephanos command-envelope, proof, authority and recovery contracts.

It is an execution surface, not a second conversational agent, scheduler, mission store, lease plane, merge path or AI provider. OpenClaw Standalone remains the broad whole-PC agent. Sovereign Commander gives trusted agents governed local hands.

## Capability parity ratchet

Standing capability-parity goal: #2573 — **Goal: Make Sovereign Commander absorb every Remote Commander capability**.

Remote Desktop Commander is a bootstrap, proving and break-glass surface. It is not the durable owner of a useful Battle Bridge capability. Every canonical mission handoff to the `desktop-commander` adapter is a capability-discovery event. Direct ChatGPT connector observations may enter the same ratchet as `desktop-commander-direct` or `remote-desktop-commander`; they must update #2573 rather than create a second parity mechanism. Repository code cannot intercept a native ChatGPT plugin call before the platform executes it, so ChatGPT-facing adapters must mirror any such break-glass use into this canonical observation schema.

The one-minute Sovereign Commander fleet supervisor runs the parity reconciler before normal canonical goal dispatch. The reconciler:

1. reads the existing mission-worker queue without requiring Remote Desktop Commander health;
2. normalizes observed Remote Commander operations into semantic capability identities;
3. checks known Sovereign Commander equivalents;
4. retains missing safe capabilities as deduplicated `BUILDABLE_GAP` records owned by #2573;
5. retains forbidden authority requests as `BOUNDARY_HOLD` rather than cloning unsafe authority;
6. publishes `status/sovereign-commander-capability-parity-current.json` for proof, replay and controller visibility.

#2573 is a standing owner and should remain open. A new observation must update the existing parity record rather than create one GitHub goal per conversation or per tool call. The owner-authenticated `goal` label keeps the standing goal inside the existing canonical programme/scheduler fabric; the parity layer does not create a second scheduler, lease plane, mission store or merge path.

A Remote Desktop Commander outage, vendor meter condition or unavailable relay is not an operator fallback condition. Safe buildable parity work remains owned by #2573 and continues through the ordinary goal-building fleet. Existing approval, protected merge, arbitrary-shell, destructive Git, PC restart, credential and scope boundaries remain unchanged or stricter.

The governing UX rule is: **best click is no click**.

## Trust layers

```text
agent / controller intent
  -> stephanos.execution-command-fabric.v1
  -> SOVEREIGN_COMMANDER
  -> bounded local executor
  -> deterministic proof hash / receipt
```

The executor exposes no general shell tool. File mutation is explicit-path write/append or exact unique-string replacement. Focused tests are limited to explicit `.test.js` / `.test.mjs` files within the proved Stephanos repository. Process starts are selected from a source-controlled registry.

Project discovery is a first-class read-only capability. `search_project` performs a bounded literal search rooted only at the trusted canonical repository, skips known dependency/build directories and common secret-bearing file forms, caps file size and result count, and uses no shell. Remote Commander search operations such as `start-search` and `get-more-search-results` therefore resolve to proven Sovereign parity rather than a permanent meter dependency.

## Transport layers

### Local stdio MCP

`scripts/sovereign-commander-mcp.mjs` is the lowest-dependency transport. It uses newline-delimited JSON-RPC over stdin/stdout and has no external package dependency.

### Authenticated loopback HTTP

`scripts/sovereign-commander-http.mjs` listens on loopback by default (`127.0.0.1:18791`). MCP requests require a bearer token stored outside the repository. The health route contains no token or command capability.

The server refuses a non-loopback bind unless the caller explicitly enables it. Normal operation must keep the backend loopback-only.

### Tailnet route

`scripts/windows/configure-sovereign-commander-tailscale.ps1` is an explicit operator-approved action. It uses Tailscale Serve to proxy the loopback backend over HTTPS inside the operator tailnet. It does not configure Tailscale Funnel. Tailnet ACLs and the Sovereign Commander bearer token are independent gates.

## Sovereign transport mesh

Cloud-chat transport is a mesh, not a single dependency. Sovereign Commander remains the execution, state and authority owner regardless of which carrier delivered a request. No single transport is the critical path.

The preferred currently-available cloud-chat route is the **GitHub-backed fast carrier** driven by `scripts/battle-bridge-sovereign-relay-daemon.mjs`. It reuses the existing guarded command mailbox and is supervised by Sovereign Commander. Its polling cadence is adaptive and bounded: HOT is 2.5 seconds for five minutes after observed mailbox activity, WARM is 5 seconds until ten minutes after the last activity, and IDLE is 15 seconds. A degraded carrier also backs off to the 15-second ceiling instead of hammering GitHub. The daemon starts HOT after launch so restart or wake recovery remains responsive. The existing one-minute Scheduled Task mailbox remains independently armed as a fallback if the fast relay dies. Adaptive polling changes transport cadence only; it does not widen command authority, bypass the mailbox lease/deduplication guard, create another consumer owner, or remove any fallback. Setting `STEPHANOS_SOVEREIGN_RELAY_ADAPTIVE_POLLING=0`, `false`, or `off` forces the old fixed 2.5-second cadence as a runtime rollback without changing source.

Other routes are retained rather than removed:

- **Tailscale private route** remains a fallback for operator devices and local/private agents.
- **OpenAI Secure MCP Tunnel** remains an optional fallback if the account entitlement and economics become acceptable.
- **Remote Desktop Commander** remains a break-glass fallback while its useful capabilities continue to be absorbed into Sovereign Commander.
- **GitHub scheduled mailbox** remains the durable recovery fallback, including after relay failure or reboot.

All carriers are transport only. They do not own execution authority, mission state, proof truth or recovery policy. Requests retain their existing correlation/request identity so a retry through another carrier must not create duplicate execution.

### Failure rule

A carrier outage, quota, plan restriction or vendor meter may degrade latency or convenience, but must not make Sovereign Commander unhealthy. The relay is therefore supervised and reported, but it is deliberately excluded from the core Commander health predicate.

## Direct ChatGPT fast path

OpenAI Secure MCP Tunnel is retained as an optional low-latency fallback transport, not the preferred or required route. The customer-run `tunnel-client` stays on Battle Bridge, initiates outbound HTTPS only, and forwards tunnel requests to the existing local stdio `scripts/sovereign-commander-mcp.mjs` surface. Sovereign Commander therefore remains private and does not require a public inbound MCP endpoint.

The tunnel is transport only. It inherits the same fixed Sovereign Commander MCP tool registry, no-arbitrary-shell boundary, merge restrictions and PC-restart restrictions. GitHub issue #2590 remains the durable audited break-glass mailbox and power-recovery fallback, not the normal latency path.

Tunnel installation is explicit and checksum-verified from the official `openai/tunnel-client` release. Runtime configuration requires an operator-owned OpenAI `tunnel_id` and runtime API key; the runtime key is protected locally with Windows DPAPI and is never committed to the repository or emitted into mailbox receipts.

## Remote ChatGPT boundary

A private tailnet route is directly useful to the operator's authorised devices and local agents, but it does not by itself make the Battle Bridge reachable from a cloud-hosted ChatGPT session. ChatGPT can use the existing GitHub mailbox/control-plane bridge for remote requests while Sovereign Commander performs local execution.

Do not make the Sovereign Commander backend public merely to remove that limitation.

## Multi-surface ChatGPT ingress

Sovereign Commander deliberately has different transports for different ChatGPT surfaces while preserving one execution and authority plane.

### Battle Bridge desktop

The `sovereign-commander` local plugin uses `scripts/sovereign-commander-mcp.mjs` over stdio. No bearer token leaves the local machine and no vendor remote-control relay is required. The desktop plugin exposes the normal bounded Sovereign Commander tool schema and keeps the executor's no-arbitrary-shell, no-merge and no-PC-restart limits intact.

### iPad and iPhone

Mobile ChatGPT does not receive the desktop-local MCP process. Mobile requests therefore use the canonical GitHub command mailbox as an authenticated, operator-bound ingress to the local Sovereign Commander.

The mobile mailbox operation is `RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION`. It is exact-main-head bound, expiry bound, requires `operator-approved`, and accepts only a fixed `remoteAction` allowlist. The adapter may return sanitised status and proof metadata but must never place bearer tokens, credentials, file contents, private raw stdout/stderr, or arbitrary caller-selected command text into GitHub.

Because the repository mailbox is public, the mobile route intentionally does not expose Sovereign Commander's `read_file`, `write_file`, `edit_file`, or arbitrary path surfaces. It may expose `search-project` only as a canonical-repository search that returns relative path plus line/column proof, query hash and receipt metadata. It never returns file contents or local absolute paths through the public mailbox. Richer private mobile access requires a separately reviewed private transport and must not weaken this public-mailbox contract.

### Shared execution truth

Desktop and mobile are two ingress surfaces over the same local Sovereign Commander. Both ultimately use the source-controlled command fabric and receipts. Surface differences must not create a second mission store, a second authority plane, or duplicate execution ownership.

## Windows lifecycle

`scripts/windows/install-sovereign-commander.ps1` creates the local token when needed, restricts the token file ACL to the current user, and installs the hidden `Stephanos Sovereign Commander` daemon-equivalent scheduled task. It has an `AtStartup` trigger, uses the current user's S4U token so no interactive Windows logon is required, retains the logon/repeating recovery triggers, and asks Task Scheduler to retry transient failures. The shared windowless VBS launcher reconstructs the canonical user profile from its checked-in repo path before invoking the PowerShell runner. The Battle Bridge Recovery Mesh uses the same boot-safe lifecycle, so the authenticated mobile GitHub mailbox can wake the bounded `ignite-stephanos` action after a reboot once networking is available.

Windows requires administrator authority to create a Task Scheduler boot trigger. `scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1` is the one-time bootstrap for that OS boundary: it is exact-head bound, self-elevates only through UAC, invokes only the two fixed source-controlled installers, proves the real Scheduler definitions for Commander, Recovery Mesh and Guardian, and creates no standing elevated task. After that one approval, all three runtime tasks remain S4U, limited, hidden/windowless and pre-logon; normal recovery does not depend on an interactive Windows sign-in.

`scripts/windows/run-sovereign-commander-hidden.ps1` starts only the source-controlled Node HTTP daemon when absent/unhealthy and proves the `/health` route after launch. Its default capability requirement tracks the current source capability version so a healthy-but-stale daemon is recycled onto the new tool surface. No network package install, vendor relay, arbitrary shell or PC restart authority is granted.

## Capability pack 2

The second bounded capability pack widens the fixed maintenance registry without adding a general shell. It adds source-controlled actions for:

- full Stephanos/Battle Bridge ignition;
- bounded Battle Bridge repair;
- goal-discovery heartbeat publication;
- one-minute fleet/goal supervision through the existing canonical conveyor and elastic dispatcher, with source mutation left to the Mission Worker;
- mission-orchestrator worker scheduled-task start receipt and status;
- Stephanos backend start and autostart status;
- OpenClaw WhatsApp status;
- OpenClaw Stephanos ignition-command relink/repair.

Each action still resolves to a fixed repository script, runs with shell disabled and hidden windows, has an explicit timeout, and returns a correlated proof receipt through the existing Sovereign Commander execution contract.

## Ignition auto-heal boundary

The desktop Stephanos ignition path may invoke Sovereign Commander for one bounded control-plane repair attempt when the canonical main checkout reports a known control-plane installer or reconciliation blocker during ignition sync preflight. The repair is exposed only as the fixed repair-control-plane maintenance action.

The auto-heal client uses authenticated loopback MCP on 127.0.0.1:18791, permits no caller-selected command or path, and retries normal ignition at most once. Proof worktrees, non-main checkouts, source divergence, and unrelated ignition failures are not eligible. A successful retry returns to the existing cockpit contract, which opens the launcher landing page and Stephanos AI Core only after the supervisor publishes a fresh exact-head green receipt.

## Authority boundary

V1 does not grant:

- merge or protected-branch authority;
- force-push or destructive Git authority;
- arbitrary shell execution;
- file deletion;
- PC restart authority;
- credential export;
- public internet exposure;
- lease seizure or duplicate mission ownership.

## Migration rule

Host-control selection may prefer Sovereign Commander once its source and runtime proofs are admitted. Desktop Commander remains a compatibility/break-glass surface until physical acceptance demonstrates the sovereign route after logon/restart/power recovery. Removing the legacy surface is a later bounded change.

## Acceptance still required

Source tests are not physical Battle Bridge proof. Before normal routing depends on Sovereign Commander, prove on the canonical Battle Bridge:

1. installation and token ACL;
2. hidden daemon start with no flashing console;
3. authenticated MCP call completing through the local executor;
4. self-heal after daemon termination;
5. logon/restart recovery;
6. operator-approved Tailscale Serve access from another tailnet device;
7. one real governed maintenance/file operation with a correlated proof receipt.


## Cloud/mobile repair delegation

The guarded GitHub mailbox ingress is the cloud/mobile control route when direct local MCP is unavailable. It now admits the same source-controlled repair/orchestration actions used by the local Commander for Battle Bridge ignition, control-plane repair, general Battle Bridge repair, worker/backend recovery, and OpenClaw ignition repair. The public ingress returns sanitised proof metadata only.

This is functional repair delegation, not arbitrary-shell parity. Remote chats must prefer these fixed repair actions and must not claim Sovereign Commander is unreachable merely because the local desktop MCP tool is absent. Arbitrary shell text, arbitrary paths, raw stdout/stderr, secrets, merge authority and PC restart remain outside the remote mailbox boundary.
