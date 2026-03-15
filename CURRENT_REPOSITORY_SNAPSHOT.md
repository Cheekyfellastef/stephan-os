# Stephanos OS — Repository Snapshot

## 1. Current Directory Tree

```text
stephan-os/
├── index.html
├── main.js
├── style.css
├── projects_registry.json
├── modules/
│   ├── module_registry.json
│   └── command-deck/
│       ├── command-deck.js
│       └── module.json
├── system/
│   ├── module_loader.js
│   ├── workspace.js
│   └── core/
│       ├── event_bus.js
│       ├── system_state.js
│       └── service_registry.js
├── docs/
│   ├── README.md
│   ├── current_architecture.md
│   └── repository_architecture_review.md
├── architecture/
│   └── README.md
├── dashboard/
│   └── README.md
├── knowledge-graph/
│   └── README.md
├── agents/
│   └── README.md
├── VR-Research-Lab/
│   ├── README.md
│   ├── docs/
│   │   ├── engine-architecture/
│   │   │   ├── creation-engine-vr-pipeline.md
│   │   │   └── rage-engine-rendering-pipeline.md
│   │   ├── research-notes/
│   │   │   └── tooling-integration-workflow.md
│   │   └── vr-techniques/
│   │       ├── camera-injection-techniques.md
│   │       └── stereo-rendering-methods.md
│   └── tools/
│       └── engine-scanner/
│           ├── README.md
│           ├── patterns/
│           │   ├── camera_patterns.json
│           │   ├── input_patterns.json
│           │   └── rendering_patterns.json
│           └── scanner/
│               ├── code_parser.py
│               ├── engine_mapper.py
│               ├── pattern_library.py
│               └── report_generator.py
├── stephanos-ui/                  # secondary/legacy UI runtime subtree
│   ├── index.html
│   ├── main.js
│   ├── styles.css
│   ├── system/
│   │   └── module_loader.js
│   └── modules/
│       ├── module_registry.json
│       └── command-deck/
│           └── commandDeck.js
├── README.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── STEWARD.md
├── system_map.md
├── project_state.md
├── VISION.md
└── stephanos-icon.png
```

---

## 2. Core Runtime Components

### System Core
**Purpose:** runtime primitives used by modules and UI runtime services.

**Implementations:**
- `system/core/event_bus.js` — lightweight publish/subscribe bus.
- `system/core/system_state.js` — in-memory key/value runtime state object.
- `system/core/service_registry.js` — runtime service registration and lookup.

These components are instantiated in `main.js` and bundled into a shared `context` passed to modules.

### Event Bus
**Purpose:** decouple module-to-module and system-to-module communication.

**Implementation:** `createEventBus()` in `system/core/event_bus.js`.

**Interface:**
- `on(eventName, handler)`
- `off(eventName, handler)`
- `emit(eventName, data)`

**Observed runtime usage:**
- `module_loader.js` emits `module:loaded` after successful module initialization.
- `workspace.js` emits `workspace:opened` when a project is opened.

### System State
**Purpose:** mutable runtime state storage for system/session values.

**Implementation:** `createSystemState(initialState = {})` in `system/core/system_state.js`.

**Interface:**
- `get(key)`
- `set(key, value)`
- `has(key)`
- `snapshot()`

### Service Registry
**Purpose:** shared service container for registering discoverable runtime services.

**Implementation:** `createServiceRegistry()` in `system/core/service_registry.js`.

**Interface:**
- `registerService(name, instance)`
- `getService(name)`
- `hasService(name)`
- `unregisterService(name)`
- `listServices()`

### Module Loader
**Purpose:** dynamically load and validate runtime modules from registry.

**Implementation:** `system/module_loader.js`.

**Behavior:**
1. Loads `modules/module_registry.json`.
2. Resolves each module path.
3. Dynamically imports module file.
4. Validates module contract:
   - exported `init` function
   - exported `moduleDefinition` with `id`, `version`, `description`
5. Executes `init(context)`.
6. Tracks loaded modules for optional disposal.
7. Emits `module:loaded` event.

Also exposes `disposeModules(context)` to call each module’s optional `dispose` lifecycle hook.

### Workspace System
**Purpose:** runtime view transition from Command Deck to project workspace.

**Implementation:** `system/workspace.js`.

**Behavior:**
- `workspace.open(project, context)` toggles UI sections, sets workspace title, and renders either:
  - an `<iframe>` when `project.entry` exists, or
  - fallback text content.
- Emits `workspace:opened` event through the event bus.

---

## 3. Module System

### Registered modules (`modules/module_registry.json`)

Current registry contains one module:

1. **Module ID:** `command-deck`
   - **Entry file:** `./modules/command-deck/command-deck.js`
   - **Purpose:** render project tiles in the Command Deck and route launches to workspace runtime.
   - **Exports:**
     - `moduleDefinition` object:
       - `id: "command-deck"`
       - `version: "1.0"`
       - `description: "Renders project tiles and routes launches into the workspace runtime."`
     - `init(context)` function:
       - Reads `context.projects`
       - Normalizes project objects (`name`, `icon`, `entry`)
       - Renders `.app-tile` nodes in `#project-registry`
       - Launches via `context.workspace.open(safeProject, context)` on click

### Module contract expected by runtime loader

Each runtime module is expected to provide:

```js
export const moduleDefinition = {
  id: "module-id",
  version: "1.0",
  description: "..."
};

export function init(context) {}
```

Optional:

```js
export function dispose(context) {}
```

---

## 4. VR Lab Module

### What exists in the repo now

There is **no runtime-registered VR module** in `modules/module_registry.json` at the root runtime.

Instead, the repository includes a **research subtree** at:
- `VR-Research-Lab/`

This appears to be a documentation + tooling lab, not an active browser runtime module.

### Structure and purpose

**Location:** `VR-Research-Lab/`

**Primary files:**
- `VR-Research-Lab/README.md` — scope, goals, workflow, target interaction model.
- `VR-Research-Lab/docs/...` — engine architecture notes, VR techniques, and tooling workflows.
- `VR-Research-Lab/tools/engine-scanner/...` — Python scanner framework and pattern libraries.

**Declared purpose:** analyze flat-to-VR conversion techniques, map engine hook points, and extract reusable VR bridging patterns for future Stephanos integration.

### Dependencies

- Documentation indicates workflows around external reverse-engineering/graphics tools (RenderDoc, PIX, Ghidra, Frida).
- Included code under `tools/engine-scanner/scanner/*.py` implies Python runtime dependencies for scanning workflow.
- No JS import path currently connects this lab into root `main.js` runtime boot.

### Integration with module system

Current status: **not integrated into active module runtime**.

- Not listed in `modules/module_registry.json`.
- No `moduleDefinition` + `init(context)` module file in root `modules/` for VR lab.
- Integration path is conceptual/documented, not yet wired to the browser OS runtime.

---

## 5. Runtime Startup Flow

Current observed startup flow in root app:

```text
Page Load (index.html + main.js script)
↓
window.onload triggers startStephanos()
↓
Boot title/version text resolved from <meta name="stephanos-version">
↓
Projects loaded from projects_registry.json
↓
Core runtime modules imported:
  - workspace
  - module loader
  - event bus
  - system state
  - service registry
↓
Core instances created and packed into context
↓
Module loader reads modules/module_registry.json
↓
Each module imported, validated, and init(context) executed
↓
module:loaded emitted per successful module
↓
System status set to "Stephanos OS Online"
↓
Boot screen hidden after timeout
↓
User can interact with Command Deck tiles
↓
Tile click → workspace.open(project, context)
↓
workspace:opened emitted
```

Additional runtime lifecycle:
- `reloadStephanos()` calls `disposeModules(context)` if available, then hard reloads page.

---

## 6. Integration Points

### module loader → modules
- Loader consumes `modules/module_registry.json` and dynamic imports each entry.
- Validates module contract (`init` + `moduleDefinition`).
- Calls `init(context)` for module activation.
- Optionally calls module `dispose(context)` during reload lifecycle.

### workspace → modules
- Workspace is injected via `context.workspace`.
- Command Deck module launches projects through `context.workspace.open(...)`.
- Workspace emits `workspace:opened`, allowing any listener modules to react.

### system core → modules
Modules receive shared `context` with:
- `eventBus`
- `systemState`
- `services`
- `workspace`
- `projects`

This is the principal dependency injection mechanism for runtime modules.

### event bus usage
Current explicit emit points:
- `module_loader.js`: `eventBus.emit("module:loaded", moduleDefinition)`
- `workspace.js`: `eventBus.emit("workspace:opened", project)`

No persistent subscribers are defined in root runtime code yet, but bus APIs support module-level listeners.

---

## 7. Known Architectural Risks

1. **Dual runtime trees (root app vs `stephanos-ui`) may diverge.**
   - The repository contains a second module system under `stephanos-ui/` with different registry schema and loader behavior.
   - Increases maintenance risk and ambiguity over canonical runtime.

2. **Module registry supports minimal metadata only at root runtime.**
   - Root registry currently stores a simple path array; richer metadata is embedded in each module, not centralized.
   - Discovery/diagnostics tooling may be harder without normalized registry metadata.

3. **Limited disposal/error isolation strategy.**
   - Loader catches init/dispose errors per module, which is good, but there is no health state map, retry strategy, or degraded mode status surfaced in UI.

4. **Workspace rendering uses raw `iframe` injection from project entry values.**
   - If future project definitions are externalized/untrusted, this becomes a security and policy concern (origin restrictions/sandboxing not yet enforced).

5. **Event bus has no namespacing/governance conventions yet.**
   - As module count grows, event naming collisions and payload shape drift are likely without conventions.

6. **VR research subtree is not runtime-integrated yet.**
   - Valuable content exists, but no direct bridge module in active runtime means integration remains conceptual.

7. **UI/control logic split between legacy direct functions and modular runtime.**
   - `main.js` still contains older helpers (`renderProjectRegistry`, `launchProject`) while module-driven Command Deck now handles launch behavior.
   - Dead/duplicate code paths can become confusing during future refactors.
