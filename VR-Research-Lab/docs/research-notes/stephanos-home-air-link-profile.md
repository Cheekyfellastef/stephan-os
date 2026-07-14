# Stephanos Home Air Link Profile

**Status:** Durable observed setup and transport correction  
**Recorded:** 2026-07-14  
**Parent doctrine:** [Stephanos Spatial Dual-Access Transport Doctrine](stephanos-spatial-dual-access-transport.md)  
**Retrieval tags:** `vr`, `quest-3`, `air-link`, `home`, `local-wireless-pcvr`, `battle-bridge`, `spatial-surface`

## Observed home setup

At home, Stephan normally connects the Quest 3 to the Battle Bridge using **Meta Quest Air Link**.

This is the canonical home transport assumption for future Stephanos spatial planning. It supersedes any earlier wording that treated USB Quest Link as the preferred normal home route.

## Home transport posture

- **Primary transport:** Meta Quest Air Link.
- **Rendering host:** Battle Bridge for the PC-rendered spatial or PCVR experience.
- **Headset role:** Quest 3 receives the local wireless PCVR stream and supplies head tracking, audio, and controller input.
- **Network scope:** local home network, not Starlink or the public internet, for the normal home session.
- **USB Link role:** optional diagnostic, recovery, benchmarking, or fallback route rather than the default experience.
- **Canonical state:** the same Stephanos state and authority machinery used by every other surface.

## Design consequences

The home spatial profile should be designed and tested around wireless freedom rather than a tethered seated assumption. Stephanos should therefore observe and surface:

- Air Link session availability and connection state
- Battle Bridge reachability
- local Wi-Fi quality
- round-trip latency, jitter, and packet loss on the local wireless path
- Battle Bridge Ethernet status where available
- encoder and GPU headroom
- frame pacing and comfort health
- headset battery and power posture where available
- reconnects or transport changes during a session

The spatial bridge should distinguish clearly between:

- `HOME · AIR LINK`
- `HOME DEGRADED · CONTROL ACTIVE`
- `HOME MEDIA UNAVAILABLE · LOCAL CONTROL ACTIVE`
- `CARAVAN · REMOTE STARLINK`

## Network design preference

For the future implementation, the Battle Bridge should preferably use wired Ethernet to the home network while the Quest 3 uses the strongest suitable local Wi-Fi path. Exact router, band, channel, and codec recommendations must be reverified against the equipment and Meta software version present when implementation begins.

## Safety and continuity

Air Link is a media and interaction transport. It must not own mission truth, approvals, execution state, evidence, or authority. If Air Link drops:

- Stephanos retains canonical mission and execution state.
- No approval is repeated or inferred from reconnect behaviour.
- The session may resume from the current verified state.
- A phone, tablet, or desktop can recover the same mission.
- Any in-progress Battle Bridge action continues only according to its existing bounded execution contract, never because Air Link reconnects.

## Retrieval instruction

Retrieve this profile whenever planning the home Quest 3 spatial surface, Air Link telemetry, local wireless PCVR, bridge performance, or transport failover. Treat Air Link as Stephan's normal home connection unless he explicitly changes that preference.