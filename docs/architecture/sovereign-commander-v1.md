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

### Direct ChatGPT route: OpenAI Secure MCP Tunnel

The preferred ChatGPT pipe is OpenAI Secure MCP Tunnel with the local stdio MCP server as its only MCP target. The Battle Bridge opens an outbound HTTPS connection to OpenAI; no inbound firewall port or public Sovereign Commander endpoint is required.

The transport client is installed only by the explicit `-ApproveNetworkInstall` script, from the official `openai/tunnel-client` GitHub release, and is checked against the upstream SHA-256 manifest before installation.

`configure-sovereign-commander-chatgpt-tunnel.ps1` creates the named `stephanos-sovereign-commander` tunnel profile. The OpenAI runtime API key is accepted as a PowerShell `SecureString`, persisted only as a Windows DPAPI current-user blob, and never written to the repository or a plaintext config file.

`run-sovereign-commander-chatgpt-tunnel-hidden.ps1` keeps only that named tunnel profile alive and self-heals only its own stale `tunnel-client.exe` process. It does not expose a general shell or public listener.

The tunnel is transport, not authority. The source-controlled Sovereign Commander MCP tool list remains the command boundary, including no arbitrary shell, no protected-branch merge authority and no PC restart authority. ChatGPT-side app/connector confirmation policy is an additional gate, not a replacement for the local authority checks.

The GitHub command mailbox remains a break-glass fallback and bootstrap path. Once the tunnel is physically proven from ChatGPT, normal interactive control should prefer the direct MCP route and avoid mailbox latency.

## Windows lifecycle

`scripts/windows/install-sovereign-commander.ps1` creates the local token when needed, restricts the token file DACL to the current Windows user by SID using `icacls`, and installs the hidden `Stephanos Sovereign Commander` scheduled task. The task runs at logon and once per minute through the existing windowless VBS launcher.

`scripts/windows/run-sovereign-commander-hidden.ps1` starts only the source-controlled Node HTTP daemon when absent/unhealthy and proves the `/health` route after launch. No network package install, vendor relay, arbitrary shell or PC restart authority is granted.

The separate `Stephanos Sovereign Commander ChatGPT Tunnel` scheduled task is installed only after an operator supplies a valid tunnel ID and runtime key and the official tunnel client passes its own doctor check.

## Authority boundary

V1 does not grant:

- merge or protected-branch authority;
- force-push or destructive Git authority;
- arbitrary shell execution;
- file deletion;
- PC restart authority;
- credential export;
- public internet exposure of the Sovereign Commander backend;
- lease seizure or duplicate mission ownership.

## Migration rule

Host-control selection may prefer Sovereign Commander once its source and runtime proofs are admitted. The GitHub command mailbox and Desktop Commander remain compatibility/break-glass surfaces until physical acceptance demonstrates the sovereign route after logon/restart/power recovery. Removing either legacy surface is a later bounded change.

## Acceptance still required

Source tests are not physical Battle Bridge proof. Before normal routing depends on Sovereign Commander, prove on the canonical Battle Bridge:

1. installation and token ACL without administrator-only privileges;
2. hidden daemon start with no flashing console;
3. authenticated MCP call completing through the local executor;
4. self-heal after daemon termination;
5. logon/restart recovery;
6. operator-approved Tailscale Serve access from another tailnet device when wanted;
7. official OpenAI Secure MCP Tunnel install with checksum proof;
8. tunnel doctor and hidden tunnel watchdog green;
9. one direct ChatGPT MCP read operation;
10. one operator-confirmed governed write or maintenance operation when the ChatGPT plan/app surface permits it;
11. one real governed operation with a correlated local proof receipt.
