# Route A: llama.cpp governor custody contract (source-only)

Owner: #3096, supporting existing PR #3097. This is a design/acceptance contract, not a commissioned adapter or authority to enable inference.

## Safety invariant
Gaming and Quest have absolute priority. The production hard-disable in `seedCanopyParallelResourceV1.mjs` remains unchanged until independently signed qualification. A cancelled HTTP request, model-router status, CI fixture, or stale idle snapshot is never evidence of zero residency.

## Required adapter boundary
- Register the canonical governor's separately owned llama.cpp router with an immutable launch identity: executable digest, authorized parent PID, creation time, process group/job, model ID, listening endpoint and child descendants. Reject unregistered routers and PID reuse.
- Bind the governor to a least-privilege launch/termination principal and an explicit allowlist. Never terminate unrelated processes, accept arbitrary shell commands, or alter existing Goal Dashboard or Rescue Island leases.
- On game/Quest detection, governor uncertainty, restart or stale proof: deny new model requests before admission; cancel active requests; stop the registered router and descendants; prevent service/task relaunch; independently verify process-tree absence and released model residency before issuing a fresh signed zero-residency receipt.
- Do not treat `/v1/completions?autoload=false` as a complete safeguard: prove the server honors no-autoload, and prevent another caller or restart from loading a model during gaming.
- A stable idle governor must issue fresh liveness/custody evidence even without state changes. A consumer must reject expired evidence and reconcile immediately before admission and throughout inference.
- Zero-residency attestation must bind governor instance, exact router launch identity, model ID, verified PID tree, measurement timestamp, nonce, evidence source and gaming state. Sign with an independently protected key and reject replay. Any missing measurement fails closed.

## Independent acceptance tests
1. Start a controlled test router; verify registered PID tree, model ID, endpoint and no-autoload behavior. Reject a lookalike unregistered router.
2. Enter gaming while generation is active. Demonstrate bounded termination, descendant exclusion, model absence and independent VRAM/process evidence before declaring zero residency.
3. Simulate governor crash, stale idle proof, router restart, PID reuse, orphan child, alternate caller autoload, failed termination and a racing Quest launch. Every case must refuse inference until independently verified safe.
4. Demonstrate no unrelated process is terminated, no gaming CPU/GPU/VRAM is reserved, and the source-only #3097 HOLD remains effective throughout qualification.
5. Independent Windows/process-security and gaming-governor reviewers sign the exact adapter head and measured Battle Bridge evidence. Only a separate protected, operator-approved change may lift the hard-disable.

## Rollback
Stop the qualified adapter and return to inference-disabled state. Never bypass the hold to obtain a passing test. Do not run local models or touch Windows processes as part of this source-only proposal.
