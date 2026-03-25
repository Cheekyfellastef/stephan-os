# Stephanos Routing Truths and Guardrails

## 1) Purpose (why this exists)

This document is a **truth bank + field manual** for Stephanos routing behavior after a long multi-symptom debugging chain.

Its job is to prevent future developers, operators, and Codex runs from re-fighting the same failures by keeping one canonical description of:

- local PC (`localhost`) vs hosted/remote/home-node routing realities,
- what stale/manual state can break,
- what must be enforced in route selection (not only UI display),
- what startup behavior is expected for Ollama discovery,
- when dist fallback is the correct truthful behavior,
- why source code changes do not become runtime truth until build + cache refresh are done.

---

## 2) Local vs remote session model

Stephanos has **different routing realities** depending on where the UI session is running.

### Local PC session reality

- UI origin is loopback (`localhost`/`127.0.0.1`).
- Local machine routing and local Ollama assumptions are valid.
- `localhost` is the clean/default operating mode for local Ollama usage.

### Hosted/remote/home-node session reality

- UI origin is non-loopback (hosted URL, LAN host, or another device).
- Previously saved local loopback assumptions must not override current remote truth.
- Home-node/manual routing must be treated as **remote path validation**, not local-desktop equivalence.

### Non-poisoning rule

Local-desktop truth and remote/home-node truth are separate contexts. Persisted state from one context must never silently poison the other.

---

## 3) Known operating modes

### A. PC local localhost mode

Use when Stephanos and Ollama run on the same PC.

- Preferred host shape: `http://localhost:<port>`.
- Expected behavior: startup can auto-discover Ollama without manual press once backend context is healthy.
- This is the cleanest mode for local model development and deterministic behavior.

### B. Hosted remote mode

Use when Stephanos UI is opened from a hosted/non-local address.

- Loopback targets from old local sessions are not valid remote truth.
- Backend route selection must prefer current reachable context and reject poisoned loopback/manual leftovers.

### C. Home-node / LAN mode

Use when routing through a configured home-node.

- Reachability is two-part truth:
  1. home-node backend route/API reachable,
  2. home-node UI target (for launch/open flow) reachable.
- If backend is reachable but UI target is not, home-node mode is **not fully launchable**.

### D. Dist fallback mode

When preferred home-node path is unavailable/unlaunchable, falling back to served dist runtime is valid and truthful.

- This is not a bug by itself.
- It is an integrity-preserving fallback when candidates fail reachability/launchability checks.

---

## 4) Truths discovered from the debugging saga

1. Local PC sessions and remote/home-node sessions are different realities and must not poison each other.
2. Bad stored state can masquerade as network/routing failure.
3. Startup/manual recovery differences reveal missing boot-time logic.
4. Final truth must be enforced in route-selection logic, not only surfaced in UI text.
5. Home-node launchability requires both backend reachability and UI target reachability.
6. Source truth is not runtime truth until dist is rebuilt and browser runtime is refreshed.
7. Stable local PC Ollama usage is achieved by staying in localhost mode.
8. Dist fallback is a valid truthful fallback when home-node UI is unreachable.

---

## 5) Guardrails added (and why they matter)

These guardrails represent expected project behavior:

- **Stale local-desktop truth no longer wins in hosted sessions**
  - Prevents persisted local assumptions from hijacking remote route selection.
- **Home-node UI reachability probe + dist fallback**
  - Prevents “backend reachable” from being misread as “home-node fully usable.”
- **Malformed host rejection (`http://1:8787`, numeric host values, etc.)**
  - Stops invalid manual/stored hosts from entering candidate routing as if legitimate.
- **Operator local-session override (Force Local On This PC)**
  - Allows explicit local truth when operator intent is to isolate this device from home-node/manual routing.
- **Startup localhost Ollama auto-discovery regression fix**
  - Aligns startup behavior with manual “Auto-Find Ollama” behavior when local conditions allow discovery.
- **Build/verify pipeline as source→runtime truth gate**
  - Makes runtime drift (source fixed but dist stale) detectable and blockable.
- **Forensic diagnostics for route boundaries/candidates/operator actions**
  - Makes runtime decisions observable instead of guesswork.
- **Operator-facing home-node diagnostics**
  - Gives practical failure reason and next action instead of opaque “offline” symptoms.

---

## 6) Common failure signatures and what they really mean

### Signature: `http://1:8787`

Usually indicates malformed/manual persisted host contamination (numeric host shorthand) rather than a real network destination.

**Interpretation:** bad configuration truth, not a healthy route candidate.

### Signature: backend reachable but home-node UI unreachable

Backend health alone does not prove home-node launchability.

**Interpretation:** route may be API-reachable but launch flow cannot complete; dist fallback can be the truthful outcome.

### Signature: Auto-Find Ollama works, but startup does not

Manual recovery succeeding while startup fails is usually a boot-time discovery gate/regression issue.

**Interpretation:** missing/incorrect startup auto-discovery logic, not necessarily user misconfiguration.

### Signature: source fixed, runtime still wrong

If behavior does not match source changes, verify dist and browser runtime freshness.

**Interpretation:** stale generated assets and/or stale browser cache can preserve old behavior.

### Signature: hosted session showing local truth

Remote session displaying/using local-desktop assumptions means session-boundary guardrails are missing or bypassed.

**Interpretation:** context poisoning between local and remote realities.

---

## 7) Recommended operating guidance

1. **For local Ollama work on the PC, use localhost mode first.**
2. **Treat home-node routing as a separate remote mode** that needs its own reachability and launchability validation.
3. **After routing/UI runtime changes, always run build + verify** before trusting behavior.
4. **Validate fresh dist in a private window or hard refresh** to rule out cache artifacts.
5. **Use operator override intentionally** when this PC must force local routing truth.

---

## 8) Diagnostic checklist (fast triage)

1. **Identify session reality first**
   - Is UI local loopback or remote/hosted origin?
2. **Inspect selected route kind and candidate evaluations**
   - Confirm local-desktop vs home-node vs dist decision path.
3. **Check for poisoned stored/manual targets**
   - Reject malformed hosts (e.g., numeric host artifacts).
4. **For home-node mode, test both truths**
   - backend reachability,
   - UI target reachability.
5. **Compare startup vs manual recovery behavior**
   - If manual succeeds but startup fails, inspect boot-time discovery path.
6. **Validate source→dist→browser chain**
   - rebuild dist,
   - run verify,
   - hard refresh/private window.
7. **Check operator actions**
   - Is Force Local On This PC active?

---

## 9) Operator quick reference

- Local PC + local Ollama: open Stephanos on `localhost`.
- Remote/hosted session: do not trust saved localhost/manual leftovers from another device/session.
- If home-node backend is up but UI won’t open, expect fallback behavior and inspect home-node UI reachability.
- If Auto-Find works but startup misses Ollama, treat as startup discovery logic issue.
- If source says fixed but runtime disagrees: rebuild, verify, then hard refresh/private window.

---

## 10) What future changes must preserve

Any routing/runtime change must preserve these invariants:

1. **Session-boundary isolation:** local and remote truths do not poison each other.
2. **Route-selection enforcement:** invalid/poisoned candidates are excluded in decision logic.
3. **Home-node completeness check:** backend + UI reachability are both considered for launchability.
4. **Truth-chain discipline:** source truth must pass through dist build + verify before considered runtime truth.
5. **Operator control:** local override remains explicit and observable.
6. **Diagnostic visibility:** route decisions, candidate attempts, and operator actions remain inspectable.

---

## 11) Suggested future improvements

- Add a first-class “session reality” badge in diagnostics (`local-loopback`, `remote-hosted`, `home-node-lan`).
- Persist route decision snapshots with bounded history for postmortem replay.
- Add an explicit UI warning for malformed manual hosts before save.
- Add a one-click “rebuild/verify reminder” surface for development mode when runtime metadata and source hash diverge.
- Add an operator self-test action that checks backend reachability + UI launchability together for home-node mode.

---

## 12) Truth layers (do not conflate)

When debugging, explicitly separate these layers:

1. **Source truth** — current code in `stephanos-ui/src/**` and shared runtime modules.
2. **Built dist truth** — generated `apps/stephanos/dist/**` output from latest source.
3. **Browser runtime truth** — what the current browser tab actually loaded (can be stale).
4. **Network truth** — real endpoint reachability from current device/session context.

Most long debugging chains happen when these layers are mixed together.
