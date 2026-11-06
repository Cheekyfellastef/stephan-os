# Spatial ChatGPT console

The far wall is a holographic display with an attached keyboard console. It is an interactive surface for the operator's existing ChatGPT/Codex desktop window: conversations, account access, tools and approvals remain in that app. This adapter does not create an OpenAI API session or a second agent command channel.

## Using it

1. Open ChatGPT/Codex on the Windows PC, then use the normal **Stephanos Spatial Workspace** desktop shortcut.
2. Choose the intended window, connect it, and confirm that exact window in the Windows prompt. Keep it restored rather than minimized. The native prompt also supports Alt+Y/Alt+N.
3. Enter VR through the PC browser and Quest Link/Air Link. This local Windows window adapter does not connect a standalone Quest browser to the PC.
4. Point at a field or control on the hologram and press Quest trigger, or look at it and press Xbox A. Use the console keyboard for text. Send/Enter sends the original app's Enter key; the original app decides its meaning.
5. Fit and Zoom change the display view; Scroll up/down scroll at the last point indicated on the app. Sticks still walk and turn smoothly. Grip/RT still manipulates cubes.

The original app's image attachment and microphone controls remain on the hologram. Audio help explains headset microphone/speaker selection; it does not start a recording or claim an independent voice connection. Windows and the original app route sound through the selected headset. Audio and physical headset acceptance require an operator test.

Disconnect revokes the local connection. Refreshing requires choosing and confirming a window again. Closing an abandoned tab expires its session within 90 seconds. Reload room asks for a second press, saves the cubes, ends the current VR session, and reloads installed source. Reconnect the app and enter VR again. It does not apply or approve source changes: request changes through the existing chat and its normal review/installation gates.

## Windows installation

After protected review and installation approval, run `scripts/windows/install-stephanos-spatial-workspace-shortcut.ps1` from the reviewed canonical checkout. It builds the helper with Visual Studio Build Tools (Desktop development with C++) and a Windows SDK containing C++/WinRT, verifies its source/binary hashes, and installs the normal shortcut. Generated binaries and receipts live under ignored `.stephanos/local-state-checkpoints/spatial-window`, never in source control.

The installer compiles before stopping an older helper. It stops only the process owning port 4180 whose executable, exact command line and process creation time match this checkout's helper. A foreign owner fails closed. Starting the shortcut launches or reuses that verified helper, then opens the room. An already served room does not trigger full runtime ignition; starting a missing room retains the existing canonical ignition checks. Room availability does not imply that the separate command runtime is healthy.

## Scope and safeguards

- The Node adapter binds only `127.0.0.1:4180` and accepts the exact local workspace Origin and Host. Preview uses only ports 4174/4184.
- One random capability, one selected HWND/PID/process-creation identity, and an explicit native confirmation are required. Capture follows only that window and its owned dialog; changing or closing it invalidates input generations.
- The input contract permits bounded click, wheel, text and a small key allowlist. It has no command, file access, process-launch or agent-execution operation. Windows input is posted to the selected window's children without global pointer input or changing foreground focus.
- Capture and keystrokes stay in local memory. They are not logged, recorded, uploaded, or included in Stephanos telemetry. The existing application retains its normal network behavior.
- Requests are serialized, input sequence numbers cannot replay, stale capture generations are rejected, and revocation fences late native replies. Old native-child events cannot affect a replacement connection.
- A build receipt binds the exact C++ source, host, contract and resulting binary. A changed installation is rejected rather than silently reused. That receipt proves file identity, not independent review or operator approval.
- Saved cubes keep their existing storage key, poses and stacking physics. The new console also participates in walking and cube collisions.

## Evidence and remaining acceptance

Candidate checks on 6 November 2026: native C++ build; 75 deterministic room/input/connection tests; real Edge-window click, typing, Shift/Backspace, exactly-once Enter and scrolling; unsent `test` in the actual ChatGPT desktop composer, then removal and disconnect; isolated helper build, replacement, hash verification and repeated-start reuse. No actual chat message or attachment was sent. These candidate checks do not prove protected publication, merge, installation, physical controller accuracy, headset readability, image-dialog behavior, or live audio.

Reusable invariant: a spatial surface forwards explicit human input to the original application and preserves that application's authority boundaries. It must never translate an on-screen status, a queued input, or a source build into a claim of successful application action or physical headset acceptance.
