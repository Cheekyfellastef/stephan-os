# Sovereign Commander: operator browser observation (source candidate)

## Purpose
A meter-free, passive proof intake for **already-open, operator-authorised Stephanos workspace tabs** on Battle Bridge. It complements (does not replace) the exact-head, semantic scenario proof machinery in `scripts/browser-proof-runner.mjs`. No lease release, build, review, merge, deployment, browser click, or external-site authority follows from a screenshot.

## Capability
The fixed action `observe-open-stephanos-tabs` is registered in Sovereign Commander's local MCP maintenance registry and guarded remote-action allowlist. It runs `scripts/sovereign-commander-browser-observe.mjs` without operator-supplied arguments. It:
- Attaches **only** to an explicitly debug-enabled local Chromium-family browser at `127.0.0.1:9222`. It never starts a debugging listener, rewrites a profile, navigates, clicks, reloads, executes supplied JavaScript, or reads cookies/storage/request bodies.
- Discovers up to eight authorised open pages. Default allowed origins: `localhost` and `127.0.0.1` ports `4173` and `5173`. A local machine administrator may configure a bounded extra **exact-origin** allowlist in `STEPHANOS_BROWSER_OBSERVE_ALLOWED_ORIGINS` (comma-separated). Caller-controlled URLs and origins are not admitted through MCP or remote mailbox.
- Measures rendered image failures, pending images, anchor counts, generic Spotify homepage links, buttons and headings, plus new console/page/request failures **during capture only**. Existing historic browser errors and real interaction functionality remain **unknown**, not passed.
- Saves private PNG screenshots and a hashed JSON receipt to `.stephanos/local-state-checkpoints/sovereign-browser-observation/`. Browser URLs (including query/fragment), page text, credentials, raw requests, and screenshots are **not sent to the public remote mailbox**. Remote feedback is typed counts, hash, timestamp, and a truthful observation-only verdict.
- Returns `BROWSER_OBSERVATION_BLOCKED` if CDP is not enabled, the dependency is unavailable, or no admissible workspace tab exists. Partial captures are not acceptance proof.

## Operator setup / security
This is **not yet a way to observe every tab in the user's normal Chrome, Edge, Brave, Firefox or iPad browser**. Those normal browsing profiles do not expose CDP by default. Modern Chromium browsers generally require a **separate non-default debugging profile**, which will not automatically share the operator's existing tabs or sessions. Enabling remote debugging on a regular signed-in profile increases credential exposure risk and is **not recommended**.

The first safe physical test should be with a distinct, disposable, operator-approved browser profile, a localhost-only debugger port, and a Stephanos workspace opened in that same profile. Do not expose port 9222 to LAN/Tailscale/public networks. Do not copy personal cookies or passwords into the proof profile. Use the installed Playwright dependency with its system-browser channel where supported.

For true inspection of **existing browser tabs across different browsers and devices**, a separate approved extension/native-messaging bridge (plus user-granted site permissions) is still required. Firefox and mobile Safari/Brave do not become available merely because this Chromium CDP action exists.

## Qualification gates
1. Source tests: `node --test tests/sovereign-commander-browser-observe.test.mjs` plus existing Commander/MCP/mailbox suites.
2. Protected PR review: security and Windows browser specialists, exact head and required checks.
3. Operator-approved merge, Battle Bridge sync and local MCP capability reload.
4. Live Battle Bridge proof from a disposable browser session: authorised tab visible, screenshot + hash + private receipt, bounded remote result, refusal on unrelated tabs, browser unaffected.
5. Only then call **browser observation** installed/working. Full proof requires matching served HEAD and a task-specific interaction or semantic acceptance test. Do not equate `BROWSER_OBSERVATION_CAPTURED` with a repaired Music tile.

## Next uplift (separate guarded scope)
Build a signed Chrome/Edge/Brave extension with tab-by-tab permission and a local-only native messaging bridge, so an operator can grant Sovereign Commander view access to their **actual** workspace browser profile without turning on a general debugging port. Add Firefox and mobile through browser-specific approved channels; preserve per-origin permission revocation, screenshot redaction, device identity, proof provenance and no autonomous action by default.
