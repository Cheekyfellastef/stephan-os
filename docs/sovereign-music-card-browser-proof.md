# Sovereign Music card browser proof

Bounded browser-capability slice of #2573 — Goal: Make Sovereign Commander absorb every Remote Commander capability.

## Registered route

Use the existing owner-approved `RUN_EXACT_HEAD_WINDOWS_BROWSER_PROOF` mailbox operation, with `proofScenario: MUSIC_CARDS_ARTWORK_EXACT_LINKS`. The existing exact PR identity, clean checkout, expected head, merged-main ancestry, served source/dist fingerprint, expiry and protected authority checks remain mandatory. No new executor, controller, mailbox, arbitrary URL, browser profile, JavaScript or shell command field is added.

The scenario uses the existing native Playwright runner with installed Windows Edge. The new scenario never falls through to legacy Codex dispatch, even if an integration object is supplied. A current-head source change is not installed capability or physical proof.

## What the evidence establishes

- Between one and twenty existing Listening Deck cards, including at least one verified Spotify track. Empty, oversized, duplicate or incomplete samples block.
- Exact Spotify/YouTube action destinations match the stored, permitted track identities. Generic service landing pages, mismatched IDs and spoofed hosts fail.
- Spotify cover images are actually loaded and agree with a same-track oEmbed overlay or metadata-verified catalogue record. Negative verification statuses cannot gain a Spotify cover or direct Spotify action.
- Resolved cards suppress redundant generic searches; unresolved cards retain truthful search actions.
- Iframe node identity survives the enrichment observation interval. This does not assert audible playback or decoder progression.
- Reload retains the same card identities, destinations, artwork and iframe counts, with exact served source attested before and after. Iframe object identity is intentionally checked within a document, not across reload.
- Browser console/page errors fail the scenario. Public evidence contains counts, booleans and hashes, not song identities, raw storage, credentials or console contents.

Exact destination proof means agreement with canonical stored IDs. It does not independently prove Spotify catalogue title/artist correctness, provider availability, subscription entitlement, playback, or sound.

## Real browser-state boundary — still requires commissioning

The current generic native runner creates an isolated browser context. The Music tile stores its cards in browser-local storage. The collector therefore requires an internal `realCardContextAdmitted` contract, defaulting to false, and the evaluator independently checks it. This is not an accepted public mailbox field. Until the existing-session witness is commissioned, the generic native invocation stops with `MUSIC_REAL_CARD_CONTEXT_NOT_ADMITTED` even if a fresh context happens to contain default/sample cards. An admitted but empty context stops with `MUSIC_REAL_CARDS_UNAVAILABLE_OR_OUT_OF_BOUNDS`.

The collector is reusable on an existing admitted local page/context. It does not seed songs, overwrite storage, intercept provider responses, discover arbitrary browser profiles, copy cookies or open a debugging listener. Existing user-authorized browser-session access or a separately reviewed, origin-scoped state witness must supply the real-card context before claiming operator-profile proof. Do not silently substitute fixtures or claim this source PR closes that transport gap.

## Qualification

1. Source regressions: `node --test scripts/music-card-browser-proof.test.mjs scripts/browser-proof-runner.test.mjs shared/agents/exactHeadWindowsBrowserProofDispatch.test.mjs`.
2. Independent exact-head review and required protected operator-approved merge. This addition does not bypass Music repair PR #3163's failing Windows browser test or unresolved review.
3. Battle Bridge sync/build and exact served-head attestation.
4. Demonstrate the admitted real-card context with a terminal bounded receipt; empty isolated contexts remain blocked.
5. Run the scenario against real cards before and after reload; retain proof hashes and negative cases (missing image, wrong song destination, stale head, unavailable session). Protect gaming resources.

Lesson: a browser driver is only a mechanism. Exact served bytes, a real observed sample, operation-specific assertions and a terminal receipt establish capability. A heartbeat, dispatch ACK or fixture success does not.
