# Spatial ChatGPT console

The far wall is a holographic display with an attached keyboard console. It is an interactive surface for the operator's existing ChatGPT/Codex desktop window: conversations, account access, tools and approvals remain in that app. This adapter does not create an OpenAI API session or a second agent command channel.

## Using it

1. Open ChatGPT/Codex on the Windows PC, then use the normal **Stephanos Spatial Workspace** desktop shortcut.
2. Choose the intended window, connect it, and confirm that exact window in the Windows prompt. Keep it restored rather than minimized. The list refreshes automatically while you choose, so opening ChatGPT after opening the chooser works. A valid selection stays selected; if that window disappears, choose again. Connect is disabled when no window is selected. The native prompt also supports Alt+Y/Alt+N.
3. Enter VR through the PC browser and Quest Link/Air Link. This local Windows window adapter does not connect a standalone Quest browser to the PC.
4. Point at a field or control on the hologram and press Quest trigger, or look at it and press Xbox A. Use the console keyboard for text. Send/Enter sends the original app's Enter key; the original app decides its meaning.
5. Zoom enlarges the app; the four **View** arrows move the enlarged view to reach the composer, Voice or attachment controls at its edges. **Fit** restores the full image and centres the view. **Scroll** arrows scroll the original app at the last point indicated on it, or the view centre after a view adjustment. Sticks still walk and turn smoothly. Grip/RT still manipulates cubes.
6. Shift changes the displayed letters and punctuation to match what the keyboard sends. The input status appears below the hologram as well as on the launcher. “Input sent” means the adapter posted it to the selected app; it does not prove the app accepted a message or produced a reply. A rejection, paused picture or lost connection has its own visible status.

The original app's image attachment and microphone controls remain on the hologram. Audio help explains headset microphone/speaker selection; it does not start a recording or claim an independent voice connection. Windows and the original app route sound through the selected headset. Audio and physical headset acceptance require an operator test.

### ChatGPT Voice and Quest audio

**Audio help** is a setup guide. It does not configure Windows, obtain microphone permission, enable Voice or verify your headset. Use the PC browser with Quest Link / Air Link, then:

1. In Windows **Settings → System → Sound → Input**, select the headset microphone, open its properties and run the microphone test. Play the recording back to check what Windows actually captured. See [Microsoft’s microphone setup and test guide](https://support.microsoft.com/en-us/windows/hardware/drivers/how-to-set-up-and-test-microphones-in-windows).
2. In **Sound → Volume mixer → Apps**, make sure ChatGPT (or its browser) is unmuted and its output uses the headset speakers. See [Microsoft’s app audio routing guide](https://support.microsoft.com/en-us/windows/hardware/audio/fix-app-audio-not-working-while-system-sounds-work-in-windows). Device names depend on the actual Windows installation.
3. Press **Audio help** again to return to the connected app. Use **Fit**, **Zoom** and the **View** arrows to reach ChatGPT’s own **Voice** button, start Voice and allow microphone access when prompted. Voice starts a spoken conversation; microphone dictation enters text. Availability depends on the app, account and workspace. See [OpenAI’s Voice guide](https://learn.chatgpt.com/docs/features/voice).
4. For headset acceptance, say a short phrase, confirm ChatGPT hears it, and check that its spoken response plays through the Quest speakers. End Voice using the original app’s control. This live test is separate from browser/source checks and has not been established by a synthetic frame or an Audio help screen.

The existing capture helper supplies window images and bounded input. It does not capture or stream audio. ChatGPT and Windows retain microphone permission, recording and playback control; this room does not add another audio connection.

Disconnect revokes the local connection. Refreshing requires choosing and confirming a window again. Closing an abandoned tab expires its session within 90 seconds. Reload asks for a second press, saves the cubes, ends the current VR session, and reloads installed source. Reconnect the app and enter VR again. It does not apply or approve source changes: request changes through the existing chat and its normal review/installation gates.

## Seated and standing comfort

The existing launcher, keyboard and upright display share two explicit comfort
profiles: **Seated** and **Standing**. Each remembers its own height offset
(-100 to +100 cm) and continuous keyboard tilt (0° flat to 90° vertical).
The launcher sliders also offer 0.1° angle adjustment; in VR, the height and
tilt buttons step by 1 cm and 1°, with hold-to-repeat.

Use either large side dial with a Quest controller: point and hold trigger,
or grab with grip, then turn the controller about the keyboard's hinge axis.
The current angle is the starting point; release holds and saves it. Both
knobs drive the same hinge. Only one hand owns adjustment at a time, and
tracking loss, disconnection, hidden sessions or a mode change end a grab.
While a dial is held, its grip cannot also pick up a cube and stick movement
is paused. A fresh press is required after tracking recovers.

Quest trigger and Xbox gaze plus A can select the comfort controls on the
upright display even when the keyboard starts below or above the seated
viewpoint. These controls work without connecting a desktop window. Existing
walking, smooth turning and cube controls retain their normal mappings.

The selected height translates both eyes and controller interactions together,
without changing physical headset tracking. Recentring preserves that profile's
height. Switching modes uses the saved absolute offset once; it does not add
one profile's offset to another. Reset affects only the selected profile.

The keyboard surface and its hit targets share one front-edge hinge transform.
Its supporting desk and cube collision surface stay fixed. Both profiles and
the selected mode are saved as local room preferences; privacy-restricted or
full browser storage falls back to session-only adjustment with a visible
message. Settings save on release, profile switching, reset and session/page
exit, rather than writing storage every XR frame. No native input permissions,
adapter binaries or desktop-window connection are changed by these controls.

Source and browser checks do not establish Quest fit or comfort. Final headset
acceptance checks both postures, 0°/37°/90° key selection, either knob, Xbox
adjustment, tracking loss and reopening the room with saved profiles.

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
