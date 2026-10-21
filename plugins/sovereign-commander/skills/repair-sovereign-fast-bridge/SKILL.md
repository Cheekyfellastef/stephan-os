---
name: repair-sovereign-fast-bridge
description: Operate and recover the existing iPad/cloud-to-Battle-Bridge Sovereign Commander fast carrier with exact immutable owner commands and authenticated terminal receipts.
---

# Fast Sovereign Commander bridge

Sovereign Commander runs locally on Battle Bridge. The cloud ChatGPT chat cannot assume it can call `http://127.0.0.1:18791/mcp`, and a local desktop/stdin plugin does not automatically become a cloud connector. Use the existing **Sovereign Relay fast carrier**, with the source-defined canonical mailbox as guarded durable fallback. Do not create a second mailbox consumer, unrestricted network endpoint, tunnelling secret or arbitrary-shell proxy.

## Fast connection test
1. Read trusted `main` from `Cheekyfellastef/stephan-os`, compare to Battle Bridge using most recent `visibility-snapshot`; never send guessed `expectedHead`.
2. For a read-only link check, use `RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION` with `remoteAction: "status"`, the current `CANONICAL_MAILBOX_ISSUE` from trusted main, exact branch `main`, `operatorApproval: "operator-approved"`, unique requestId, near-term ISO expiry. Use the fixed `stephanos-battle-bridge-command` fence. Never include passwords, tokens, command lines, local paths or raw logs.
3. Correlate the same requestId across `ACCEPTED` and terminal `DONE` / `BLOCKED`. Record exact process head, receipt hash, timing and reason. `ACCEPTED` is **not** completion. If fast carrier is delayed, inspect the independently scheduled fallback, heartbeat and existing outbox watchdog. A stalled accepted request is in-flight; NEVER send it again on a new request ID.
4. If source head moved during the command, obey `COMMAND_EXPECTED_HEAD_SUPERSEDED` and start a *new read-only inspection*, not a stale source mutation. Do not keep polling GitHub aggressively: obey shared observation broker cooldown/403/429 semantics.
5. For several independent already-qualified local actions, use one at-most-six-step `remotePlan` in declared order, and stop at first failed receipt. Do not include arbitrary shell, task/file arguments or a "success" gate if the previous action returned a protected HOLD.

## Recovery and capability upgrade
Persistent FAST_ACTIVE / FAST_BUSY / FAST_RECOVERED posture proves transport, not that source building is healthy. RECOVERING / FALLBACK_COVERED means degrade to already installed guarded GitHub carrier, preserving request identity. Collect typed `status-stephanos-core-daemon`, `controller-lane-status`, `visibility-snapshot`, `status-worker-watchdog` and, when needed, `cpu-pressure-snapshot` first.

If a necessary action does not exist, create a narrow versioned source-controlled maintenance capability and tests, qualify Windows/GitHub security, then add only that fixed action to the *existing* commander/mailbox schema. A skill document by itself cannot install a privileged Windows service, authenticate signatures or make local stdio available in an iPad chat. Record proof before declaring "direct connected".
