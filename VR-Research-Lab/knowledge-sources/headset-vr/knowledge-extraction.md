# Headset-VR Configuration and Profile Field Evidence

Status date: 2026-08-10
Priority: P1
Evidence class: creator configuration, profile distribution and operational field evidence

## Why this source matters

Headset-VR fills a different evidence role from a pure showcase channel. Publicly indexed material repeatedly pairs gameplay demonstrations with concrete UEVR profiles, CVars, controller mappings, scripts, executable variants and installation/runtime instructions. That makes the channel valuable for discovering the **last-mile configuration grammar** that turns a theoretically compatible flat game into a usable VR session.

The canonical implementation authority remains the underlying framework or mod. Headset-VR is strongest at answering questions such as:

- which executable/profile variant is required;
- which runtime must be active;
- which UEVR profile or CVars file is loaded;
- how 6DoF controllers, arms, cursors or camera modes are attached;
- which install order or supporting files are required;
- which features are tested versus merely expected;
- what breaks in menus, multiplayer, cutscenes, first-person or third-person modes.

## Reusable configuration recipe

A useful Headset-VR extraction should normalise each demonstrated route into a common packet:

```text
game + exact build/executable
→ engine and protection classification
→ injector/mod + exact version
→ runtime and transport
→ profile author + profile revision
→ render/camera method
→ CVars / plugins / scripts
→ controller and embodiment mappings
→ menu and cursor handling
→ graphics/performance settings
→ known caveats and untested claims
→ rollback / clean-state route
→ local headset acceptance
```

This packet is more valuable to Stephanos than a loose list of settings because it can become input to the Capability Route Planner, launcher generation and Battle Bridge proof.

## Seed evidence patterns

### Alien Isolation Grandmother VR Mod

The 2026 installation post exposes an ordered multi-component install sequence and an explicit SteamVR-only runtime constraint at the time of publication. This is useful for modelling dependency order, runtime gates and compatibility fixes separately from the base VR mod.

### Aliens Fireteam Elite

The public post metadata describes a 6DoF UEVR profile, a separate Game Pass executable profile and an accompanying CVars package. This is a strong example of why profiles must be bound to executable identity rather than only to a game title.

### KARMA: The Dark World

The public metadata credits a Flat2VR community profile author, describes right-motion-controller cursor control and mentions scripting. This provides both a UI-interaction method and an attribution rule: the distributor, video creator and profile author can be different people.

### Nobody Wants to Die

The public metadata describes arms attached to the right controller. This is useful as a small embodiment-profile example that can be compared with full IK systems such as VRIK/HIGGS/PLANCK or CyberpunkVR Port.

### Current catalogue breadth

The 2026 public index includes first-person UEVR tuning, 6DoF controller profiles, gestures, third-person configuration, multiplayer testing, playability checks and game-specific profile updates across many titles. Treat this catalogue as a discovery feed for configuration primitives, not as automatic acceptance of every profile.

## Capability Graph candidates

- executable-specific VR profile binding;
- profile-plus-CVars configuration bundles;
- community profile provenance and author attribution;
- first-person versus third-person camera recipes;
- 6DoF controller attachment recipes;
- controller-driven cursor and menu interaction;
- gesture and scripted interaction profiles;
- runtime-specific launch constraints;
- game-build compatibility matrices;
- tested / untested / inferred capability labels;
- clean install order and dependency sequencing;
- profile rollback and known-good configuration;
- configuration diffing between profile revisions;
- automatic launcher packet generation from a proven recipe.

## Evidence discipline

For every extracted recipe, record:

- video/post URL and publication date;
- exact game build and executable when available;
- framework/mod and version;
- profile filename, revision and original author;
- runtime, headset and PC transport;
- render method and important graphical settings;
- CVars, plugins or scripts referenced;
- controller/camera/UI mappings;
- what was visibly demonstrated;
- what the creator says but does not demonstrate;
- what remains untested;
- local Battle Bridge reproduction status.

Never copy a community profile into Stephanos merely because it is downloadable. First resolve authorship, licence, required attribution and whether redistribution is allowed. Derived configuration facts can be stored separately from restricted files.

## Relationship to UEVR and Flat2VR

UEVR documentation and source remain the authority for injector behaviour and supported configuration semantics. Headset-VR adds the empirical layer showing which combinations people actually use per game. Flat2VR community provenance should be retained whenever a profile originates there or from another named contributor.

This creates a useful three-plane evidence chain:

```text
framework truth
+ community profile provenance
+ creator headset/configuration evidence
→ local Quest 3 acceptance
```

## Starfield relevance

Starfield is not a UEVR title, so Headset-VR profiles are not a direct Starfield conversion path. The reusable value is the configuration architecture: exact executable identity, versioned profile packets, runtime choice, camera/controller mappings, UI fallbacks, dependency order, known-good rollback and headset proof.

Those same primitives can make the Starfield Mutar/OpenXR route dramatically easier to operate. Stephanos should be able to take a proven configuration packet and generate a guarded no-faff launcher plus a verification checklist instead of making the operator rediscover settings manually.

## Continuous discovery role

Headset-VR should be monitored as a P1 discovery source for new UEVR configuration methods and game-specific fixes. Promote a new method only when it is materially different from existing recipes or resolves a known gap. Do not turn every new video into a separate durable source entry.
