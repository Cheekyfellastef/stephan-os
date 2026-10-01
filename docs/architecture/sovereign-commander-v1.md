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

A private tailnet route is directly useful to the operator's authorised devices and local agents, but it does not by itself make the Battle Bridge reachable from a cloud-hosted ChatGPT session. Until a separately reviewed authenticated connector/remote MCP path exists, ChatGPT can continue to use the existing GitHub mailbox/control-plane bridge for remote requests while Sovereign Commander performs local execution.

Do not make the Sovereign Commander backend public merely to remove that limitation.

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
