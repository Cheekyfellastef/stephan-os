# Sovereign Commander V1

Owner goal: #2519 — Build Sovereign Commander as the unmetered Battle Bridge control surface.

## Purpose

Sovereign Commander is the Stephanos-owned whole-PC execution/control surface for the Battle Bridge. It replaces normal dependence on metered third-party Remote/Desktop Commander transport while reusing the existing Stephanos command-envelope, proof, authority and recovery contracts.

It is an execution surface, not a second conversational agent, scheduler, mission store, lease plane, merge path or AI provider. OpenClaw Standalone remains the broad whole-PC agent. Sovereign Commander gives trusted agents governed local hands.

## Trust layers

```text
agent / controller intent
  -> stephanos.execution-command-fabric.v1
  -> SOVEREIGN_COMMANDER
  -> bounded local executor
  -> deterministic proof hash / receipt
```

The executor exposes no general shell tool. File mutation is explicit-path write/append or exact unique-string replacement. Focused tests are limited to explicit `.test.js` / `.test.mjs` files within the proved Stephanos repository. Process starts are selected from a source-controlled registry.

## Transport layers

### Local stdio MCP

`scripts/sovereign-commander-mcp.mjs` is the lowest-dependency transport. It uses newline-delimited JSON-RPC over stdin/stdout and has no external package dependency.

### Authenticated loopback HTTP

`scripts/sovereign-commander-http.mjs` listens on loopback by default (`127.0.0.1:18791`). MCP requests require a bearer token stored outside the repository. The health route contains no token or command capability.

The server refuses a non-loopback bind unless the caller explicitly enables it. Normal operation must keep the backend loopback-only.

### Tailnet route

`scripts/windows/configure-sovereign-commander-tailscale.ps1` is an explicit operator-approved action. It uses Tailscale Serve to proxy the loopback backend over HTTPS inside the operator tailnet. It does not configure Tailscale Funnel. Tailnet ACLs and the Sovereign Commander bearer token are independent gates.

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

Because the repository mailbox is public, the mobile route intentionally does not expose Sovereign Commander's `read_file`, `write_file`, `edit_file`, or arbitrary path surfaces. Richer private mobile access requires a separately reviewed private transport and must not weaken this public-mailbox contract.

### Shared execution truth

Desktop and mobile are two ingress surfaces over the same local Sovereign Commander. Both ultimately use the source-controlled command fabric and receipts. Surface differences must not create a second mission store, a second authority plane, or duplicate execution ownership.

## Windows lifecycle

`scripts/windows/install-sovereign-commander.ps1` creates the local token when needed, restricts the token file ACL to the current user, and installs the hidden `Stephanos Sovereign Commander` scheduled task. The task runs at logon and once per minute through the existing windowless VBS launcher.

`scripts/windows/run-sovereign-commander-hidden.ps1` starts only the source-controlled Node HTTP daemon when absent/unhealthy and proves the `/health` route after launch. No network package install, vendor relay, arbitrary shell or PC restart authority is granted.

## Capability pack 2

The second bounded capability pack widens the fixed maintenance registry without adding a general shell. It adds source-controlled actions for:

- full Stephanos/Battle Bridge ignition;
- bounded Battle Bridge repair;
- goal-discovery heartbeat publication;
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
