# OpenClaw recovery host-process binding V1

Status: source-only repair

## Incident

The authenticated WhatsApp command `/stephanos-ignite wake` reached the installed OpenClaw plugin on 2026-08-16 but failed before queuing the canonical Recovery Mesh request because the legacy adapter treated `http://127.0.0.1:18789/identity` as a JSON identity endpoint. The live gateway returned its HTML control surface instead, producing an `Unexpected token '<'` JSON parse failure.

This is an ingress verification defect, not evidence that arbitrary OpenClaw recovery authority should be widened.

## Repair

The authenticated plugin already executes inside the OpenClaw gateway host process. The recovery adapter therefore binds its one-minute host proof directly to that host process identity:

```text
runtimeId = openclaw-host-pid:<hostPid>
```

The fixed PowerShell verifier then requires all of the existing local process proofs before accepting the wake:

- the PowerShell recovery process is a direct child of the claimed host PID;
- the parent process is `node`/`openclaw` and its command line identifies OpenClaw;
- TCP port `18789` is listening and owned by that same host PID;
- the proof `runtimeId` is exactly derived from that same PID;
- the proof was created by the authenticated `stephanos-ignite wake` command surface;
- the proof is fresh, short-lived and create-new claimed before use.

The repair removes the HTTP `/identity` round trip entirely. HTML returned by the OpenClaw control UI can therefore no longer break or influence this recovery authorization.

## Authority boundary

The command remains wake-only. It still invokes only the existing fixed `OPENCLAW_WHATSAPP` recovery route and canonical Recovery Mesh task. It adds no caller-selected task, executable, path, URL, command, PowerShell, shell, source mutation, Git mutation, merge, deployment, Forge/Podman or PC restart authority.

The independently installed #1814 lifeboat remains the long-term recovery root of trust because this legacy OpenClaw path still depends on the current `stephan-os` checkout for `request-battle-bridge-recovery.ps1`. This repair is therefore a useful in-band recovery entrance, not a replacement for the checkout-independent lifeboat.

## Acceptance

Source acceptance requires focused regressions proving:

1. no `/identity` HTTP request remains in either the plugin wake adapter or the fixed recovery verifier;
2. authenticated host process PID is embedded in the proof;
3. the verifier requires exact parent-process and port-ownership identity;
4. invalid PID, unauthenticated command and failed fixed adapter remain blocked;
5. arbitrary command and mutation authority remain absent.

A later live claim requires an exact merged-main Battle Bridge adoption and a fresh authenticated WhatsApp wake receipt. Source proof alone does not claim the Battle Bridge is healed.
