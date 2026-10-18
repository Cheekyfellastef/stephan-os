# Sovereign Commander browser witness: current Chromium tabs

## What exists in this source PR
**Primary path:** MV3 extension in `apps/sovereign-browser-bridge/` for a user's *existing* Chrome, Edge or Brave browser profile, using the browser's site permissions and a Windows per-user native messaging host. No debugging port and no dedicated browser profile are needed for the extension path. Chromium site permission patterns omit ports (for example, `http://localhost/*`), so the extension **and** native host re-check the configured exact origin, including port, before admitting a tab. This distinction is tested with a different localhost port. This is source code until reviewed, merged, installed and physically proven on Battle Bridge.

**Fallback path:** a disposable Chromium CDP session at `127.0.0.1:9222`, explicitly enabled in the local operator environment with `STEPHANOS_BROWSER_OBSERVE_ENABLE_CDP=1`, via `scripts/sovereign-commander-browser-observe.mjs`. Without this opt-in, an absent native witness returns `BROWSER_NATIVE_WITNESS_NOT_READY` and does not attach to or screenshot a CDP browser. Never enable CDP on your everyday signed-in profile or publish the debug port.

Sovereign Commander exposes the bounded fixed local MCP / approved remote action `observe-open-stephanos-tabs`. It first reads a **recent local native witness receipt** from `.stephanos/local-state-checkpoints/sovereign-browser-native-host/receipts`, verifies the screenshot file against SHA-256, refuses stale receipts, and only falls back to the separately opted-in CDP observer when no valid receipt exists. The public mailbox sees counts, a hash, timestamp and an observation-only verdict, never the screenshot, cookies, browser profile or raw page data.

## Install after protected merge on Battle Bridge
1. Sync the exact merged source and reload Sovereign Commander only after the protected merge. The installation is *not automatic* and must happen under the signed-in Windows operator.
2. In Edge: open `edge://extensions` (or `chrome://extensions`, `brave://extensions`). Enable Developer Mode and **Load unpacked**, selecting `apps/sovereign-browser-bridge` from the verified checkout. Copy the actual 32-character extension ID shown in that browser.
3. Run the reviewed per-user registration script from the checkout, for example:
   ```powershell
   powershell -NoProfile -File scripts/windows/install-sovereign-browser-witness.ps1 -Browser Edge -ExtensionId <extension-id-from-browser>
   ```
   For an operator-approved Stephanos Tailscale HTTPS origin, supply `-AllowedOrigins` with a complete exact-origin array, retaining the local origins. No origin can be added over the remote Commander mailbox.
4. Click the extension in the same real browser profile. Open the desired Stephanos workspace, press **Allow this workspace** (Chrome/Edge/Brave prompts for site access), and then **Capture current workspace proof**. Background tabs with previously granted matching permissions are scanned for bounded DOM diagnostics, but only the *visible selected tab* receives a screenshot. You can also explicitly **Enable 15-minute diagnostic checks** or **Pause automatic checks**; the default is OFF and these periodic checks never take screenshots.
5. In Sovereign Commander, run fixed `maintenance_action: observe-open-stephanos-tabs`; on mobile/cloud use the existing guarded `RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION` with `remoteAction=observe-open-stephanos-tabs` and exact expected head. The action reads only the recent receipt and returns an observation-only result.

The local host is `com.stephanos.sovereign_browser_witness`. Installation compiles a source-controlled C# console native-message host in local ignored state, registers the manifest only under the chosen browser's **HKCU** NativeMessagingHosts key, and restricts `allowed_origins` to that installed extension ID. There is no system service, blanket browser-profile debugger, GitHub relay of screenshots, automatic merge authority or unapproved browser interaction.

**Revoke:** Chromium's site permission is scoped to a scheme and hostname, not an individual port. Revoking it for localhost therefore revokes access for all localhost ports in that scheme. Use **Revoke this workspace** in the extension, then `powershell -NoProfile -File scripts/windows/uninstall-sovereign-browser-witness.ps1 -Browser Edge` to remove the native-host registration. Existing local evidence is deliberately preserved for audit; remove it separately via approved retention procedures.

## Observation truth
The extension inspects up to eight authorised workspace tabs and records link counts, Spotify exact-track links versus search/homepage links, missing artwork/image load state, button and heading counts. It also aggregates diagnostics from permitted embedded frames when Chromium admits them. Other cross-origin or restricted frames remain unknown, never counted as healthy. It reads the rendered DOM using a fixed local script and **does not read page text, session storage, passwords, cookies, request bodies or browser history**. An operator-triggered active-tab screenshot remains local on Battle Bridge, so the operator should avoid capturing sensitive overlays. Scans of background tabs do *not* count as screenshot proof.

The native host validates exact configured origins independently, refuses screenshots for unauthorised/background tabs, emits length-prefixed binary native messages and saves local receipts. An automatic or manual **scan-only** receipt reports `BROWSER_OBSERVATION_DIAGNOSTIC` with **zero** screenshots. A user-triggered screenshot receipt reports `BROWSER_OBSERVATION_CAPTURED` only after the image bytes are verified locally. Sovereign Commander's remote receipt remains `observationOnly: true`, `servedHeadVerified: false` and `functionalAcceptanceVerified: false`. A picture or a generic Spotify link count does not independently prove the correct track opened or that the Music tile was repaired. Use exact-head scenario proof and actual click/navigation tests under separately approved browser-control authority for functional acceptance.

## Known boundaries and qualification
- **Browsers:** Chrome, Edge and Brave on the Windows Battle Bridge via their separate extension ID and HKCU registration. Firefox needs a browser-specific add-on/native bridge; iPad Safari and iPad Brave cannot load this Windows MV3 extension. Other devices require their own explicitly approved witness and provenance.
- **Runtime:** This code is neither installed nor live-proven merely because GitHub CI passed. Required gates are Windows host compile/native protocol tests, independent Windows+security review, protected operator-approved merge, Battle Bridge sync, unpacked-extension install, permission prompt, live evidence capture and exact source-head attestation.
- **Coverage:** Passive diagnostics and visible screenshots, not automatic all-tab screenshots or hidden browsing; no unrestricted browsing, navigation, command execution, browser mutation or access outside approved Stephanos origins.
- **Security:** `optional_host_permissions` allows requests for HTTPS sites but grants none without the explicit browser permission prompt. Both extension and native host enforce the locally configured exact origins. Never send browser screenshots to the public remote mailbox or turn this source candidate into a privileged unreviewed merge.

## Verification commands
```text
node --test tests/sovereign-commander-browser-observe.test.mjs
node --test tests/sovereign-commander-browser-mailbox-projection.test.mjs
node --test tests/sovereign-browser-native-receipt.test.mjs
```
The Sovereign Commander Capability Parity workflow additionally compiles the native host on a Windows GitHub runner and runs `tests/sovereign-browser-host-windows.test.mjs`. Neither GitHub simulation nor source tests replace the physical Battle Bridge proof gate.
