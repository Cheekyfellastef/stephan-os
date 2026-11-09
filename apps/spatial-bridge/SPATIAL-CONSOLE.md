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

## Movable furniture, mass and permanent placement

The existing #1717 room now treats its **table and keyboard console as separate
movable assemblies**. Hold Quest grip over the table edge or keyboard body and
translate the controller. The plastic material mass response is deliberately
damped: the table has an approximate 10 kg feel and the keyboard about 3.8 kg.
No virtual object is a weight-bearing real-world support. Xbox can aim, hold
the left bumper and use the left stick for slower positioning; the launcher
also exposes bounded 10 cm translation and 5 cm height nudges.

**Release freezes the new location and saves both independent offsets** in
`stephanos.spatial.furniture.v1`. Reopening the same local browser workspace
restores exactly those saved positions; the assemblies do not spring back or
reset merely because the controller releases, VR exits, the page reloads, or
Seated/Standing changes. An explicit per-assembly Reset is the only way to
return a saved assembly to its starting place. An unavailable or full storage
store makes the movement session-only and reports that limitation visibly.

The scene renderer, holographic keycaps, keyboard ray targets, grip/side-dial
targets, walking obstacles, and movable cube collision contacts track the
same furniture offsets. The original keyboard tilt and independent
Seated/Standing height settings remain separate and unaffected. World bounds
limit dragging; navigation remains active while carrying a cube, dragging furniture or turning a dial. A single controller cannot simultaneously grip both a cube and furniture. This is a physics-inspired heavy-mass visual
feel with fixed stops, **not** haptic hardware resistance.

## Consent-gated PC browser window sharing when the native helper is not installed

The launcher offers **Show ChatGPT window (view only)** on the Battle Bridge's local `127.0.0.1`/localhost address. This invokes the browser's standard `getDisplayMedia` window chooser **only on the operator's button click**. Select the actual open ChatGPT/Codex window. The displayed live video frames are composited into the same stereo hologram and flat preview but are not recorded, relayed, cached, uploaded, or granted to an agent. The browser sharing indicator and Stop/Disconnect revoke the live track; leaving the page or a track ending also releases it. This is a genuine live window picture, not a simulated harness, but it is deliberately **view-only**: clicking the hologram or typing on the virtual keyboard cannot control the captured window, and requests are visibly refused. ChatGPT audio continues in the original Windows app; this browser capture requests no audio. Phone/iPad remote sessions have the flat 3D preview, not remote access to PC screen capture or the private Windows helper.

For fully **interactive** ChatGPT, the existing trusted Windows Spatial helper on `127.0.0.1:4180` must be installed, verified and started, then the operator must select and explicitly consent to their original ChatGPT window. The existing launcher **Connect interactive ChatGPT window** uses that native path, preserving keyboard, clicking and original Voice controls. Opening the web landing tile by itself cannot install or launch a Windows program. Original #1717/#2961 native commissioning must close that attended installation gap through its existing authority, not mint a new public capture server or pretend that a source merge proves a live adapter.

## ChatGPT harness and real headset audio controls

The **Check ChatGPT screen connection** button performs a read-only health
check of the already installed private `127.0.0.1:4180` desktop capture
helper. It cannot install, start or bypass that helper. When absent, launch
the normal reviewed Spatial Workspace Windows shortcut, then use **Choose
window**, select the real ChatGPT/Codex desktop window and accept the
original Windows consent prompt. The **Show connected ChatGPT screen** button
expands the actual native window preview; it does not invent a harness frame.
Only after the helper supplies a current frame can keyboard actions and the
original app's Voice button work.

The launcher now also has a real **Find microphone & speakers**, **Test
microphone**, **Stop mic test** and **Play speaker test** control. Device
enumeration is browser-local; an explicit microphone test asks for microphone
permission, analyzes audio level without recording/transmitting it, and
stops and releases tracks when the user stops, hides the page or exits.
Speaker test plays a short, low-volume local tone, selecting an output
only if the browser provides a supported audio sink API. These tests **do
not** route audio in the original ChatGPT app, do not start a ChatGPT Voice
session, and do not claim real Quest headphones or microphone were verified.
Open the connected app's **own Voice** button on the hologram and check the
Windows sound output and input when necessary. PC browser via Quest Link /
Air Link is required for the current private Windows helper; standalone Quest
Browser cannot reach the PC's loopback service.

These changes are accepted as delivered only after the original #1717
independent source review, protected merge, exact-head local UI refresh and
real physical headset trials. Source tests/host health alone are not full
Quest/ChatGPT audio acceptance.

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


## Solid-by-default room contract

Spatial Workspace physical geometry is **solid by default**. Controller locomotion must not pass through room walls, the workstation, console/keyboard, display, dials, movable cubes, or future physical room objects. The adjustable keyboard uses the same hinge transform for rendering, input and cube collision. Movable cubes become live walking obstacles, and the wall display and dial bodies participate in cube physics.

Grid lines, light strips, pointer rays and other explicitly decorative effects may remain non-solid. Any future visible object intended to represent physical matter must register collision geometry with the canonical room/cube collision model rather than relying on rendering alone. Physical headset room-scale movement remains real-world tracking and is never silently rewritten by Stephanos.
