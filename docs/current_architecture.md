# Stephanos OS — Current Technical Architecture

## 1) High-Level System Architecture

Stephanos OS currently implements a browser-based shell with a lightweight modular runtime.

### Runtime layers (as implemented)

1. **Web entry shell (root app)**
   - `index.html` defines the UI skeleton (boot screen, system panel, project registry, workspace, dev console).
   - `main.js` orchestrates startup and binds user interactions.

2. **System core services**
   - `system/core/event_bus.js`: pub/sub event mechanism.
   - `system/core/system_state.js`: mutable key-value state container.
   - `system/core/service_registry.js`: service locator/DI-like registry.

3. **Module system**
   - `system/module_loader.js` fetches `modules/module_registry.json`, dynamically imports each module, and calls `init(context)` when present.
   - Modules are expected (by convention) to export an `init` function.

4. **Feature modules**
   - Current concrete module: `modules/command-deck/command-deck.js`.
   - This module renders project tiles from the project registry and delegates launch behavior to workspace APIs.

5. **Project workspace host**
   - `system/workspace.js` handles opening a project view in the workspace panel and embedding project entries via iframe when provided.

### Supporting architecture artifacts

- `ARCHITECTURE.md`, `system_map.md`, and `ROADMAP.md` define a longer-term multi-layer cognitive OS vision (knowledge graph, agents, simulation systems), while the currently running implementation is a minimal shell plus module foundation.

---

## 2) Directory Structure and Purpose

> Scope: repository root folders currently present.

- **`system/`** — Runtime system code used by root app.
  - `core/`: event bus, state store, service registry primitives.
  - `module_loader.js`: dynamic module bootstrap.
  - `workspace.js`: workspace UI control.

- **`modules/`** — Runtime modules for root app.
  - `module_registry.json`: list of module entry points to load.
  - `command-deck/`: current module implementation + metadata (`module.json`).

- **`docs/`** — Project documentation and analysis artifacts.
  - Includes repository architecture review and general docs index.

- **`architecture/`** — Architecture-doc namespace (currently minimal placeholder README).

- **`knowledge-graph/`** — Placeholder/data-doc space for graph model direction.

- **`agents/`** — Placeholder/data-doc space for AI agent capabilities.

- **`dashboard/`** — Placeholder/data-doc space for control interface concepts.

- **`stephanos-ui/`** — Secondary/legacy prototype UI with its own entrypoint, module loader, and module registry (parallel implementation).

- **Root files (selected):**
  - `index.html`, `main.js`, `style.css`: root web shell entrypoint assets.
  - `projects_registry.json`: project source of truth for tiles rendered by command deck.
  - `ARCHITECTURE.md`, `system_map.md`, `ROADMAP.md`, `project_state.md`, `VISION.md`: strategic architecture/roadmap docs.

---

## 3) Core Systems

### A. System Core (`system/core/*`)

The system core is currently a small set of in-memory primitives passed to modules via context:

- **Event Bus**
  - API: `on(eventName, handler)`, `off(eventName, handler)`, `emit(eventName, data)`.
  - Uses `Map<eventName, Set<handler>>` listener structure.
  - Supports unsubscribe via function returned by `on`.

- **System State**
  - API: `get`, `set`, `has`, `snapshot`.
  - Backed by a plain object cloned from `initialState`.
  - No immutability guard, schema validation, or persistence layer yet.

- **Service Registry**
  - API: `registerService`, `getService`, `hasService`, `unregisterService`, `listServices`.
  - Backed by `Map`, enabling module-to-module service sharing through named instances.

### B. Module Loader (`system/module_loader.js`)

Responsibilities:

- Fetch module registry (`modules/module_registry.json`).
- Resolve each module path.
- Dynamically import modules at runtime.
- Call `init(context)` when exported.
- Isolate failures with per-module `try/catch` and continue loading remaining modules.

Current contract characteristics:

- Contract is **convention-based**, not validated.
- Supports registry entries as either strings or objects containing `path`.

### C. Command Deck (`modules/command-deck/command-deck.js`)

Responsibilities:

- Normalize incoming project entries (string or object) into `{ name, icon, entry }`.
- Render project tiles in `#project-registry`.
- Wire tile click events to `context.workspace.open(project)`.

Behavioral role:

- Serves as the primary navigation module for available projects.
- Effectively bridges project metadata and workspace presentation.

### D. Workspace (`system/workspace.js`)

Responsibilities:

- Toggle between Projects panel and Workspace panel.
- Update workspace title.
- Render embedded project entry via iframe when `project.entry` is defined.
- Fall back to text placeholder when no `entry` exists.

Integration role:

- Receives normalized project objects from modules (currently command deck).
- Acts as the host surface for launched projects.

---

## 4) Runtime Startup Flow

Current root-app startup sequence:

1. **Page load event**
   - `window.onload` triggers `startStephanos()`.

2. **Boot metadata + visual initialization**
   - Reads `<meta name="stephanos-version">` and updates boot title text.
   - Logs startup message to developer console panel.

3. **Project data loading**
   - Fetches `projects_registry.json` and extracts `projects` array.

4. **Core system dynamic imports**
   - Imports workspace, module loader, and core services (`event_bus`, `system_state`, `service_registry`).

5. **Core context assembly**
   - Instantiates `eventBus`, `systemState`, `services`.
   - Builds `context = { eventBus, systemState, services, workspace, projects }`.

6. **Module bootstrap**
   - Calls `loadModules(context)`.
   - Module loader imports each registry module and invokes `init(context)`.

7. **System-ready state**
   - Sets system status to “Stephanos OS Online”.
   - Hides boot screen after timeout.

---

## 5) How Modules Integrate with the System

### Module integration model

- Modules are listed in `modules/module_registry.json`.
- Loader dynamically imports each module path.
- Module `init(context)` receives shared runtime context.

### Available context dependencies

- `eventBus`: cross-module events.
- `systemState`: shared state.
- `services`: service registration/discovery.
- `workspace`: host navigation and rendering API.
- `projects`: loaded registry data.

### Practical integration example

`command-deck` consumes:

- `context.projects` to render tiles.
- `context.workspace.open(...)` to launch selected project.

This demonstrates a plugin-like pattern where modules add UI/functionality without modifying boot logic directly, as long as they comply with the expected init signature.

---

## 6) Architectural Risks and Inconsistencies

1. **Dual application surfaces (root app vs `stephanos-ui/`)**
   - Two parallel entrypoints, module loaders, and registries increase drift risk and ownership ambiguity.

2. **Root stylesheet reference mismatch**
   - `index.html` references `styles.css`, but repository provides `style.css` at root.
   - Many key styles still work due to inline CSS, but file naming mismatch can hide style regressions.

3. **Module contract is implicit**
   - No schema/validation for registry entries, module metadata, or required exports.
   - Runtime failures are only caught during dynamic import/init.

4. **`module.json` currently unused by loader**
   - `modules/command-deck/module.json` exists, but loader consumes only `modules/module_registry.json` and module exports.
   - This creates metadata duplication without enforcement.

5. **Core primitives are in-memory only**
   - No persistence, auth boundaries, or isolation.
   - Suitable for prototype stage but insufficient for multi-session/multi-agent goals.

6. **Limited startup validation**
   - No preflight checks for missing files, invalid registry entries, or malformed project schema.

7. **Documentation vs implementation gap**
   - Strategic docs describe advanced layers (agents, knowledge graph, simulation, spatial UX), but runtime implementation is still a minimal shell + module seed.

---

## Current Architecture Summary

Stephanos OS currently functions as a **modular browser shell prototype** with:

- a clear startup orchestrator,
- lightweight core coordination services,
- dynamic module loading,
- and a working command-deck-to-workspace navigation path.

The primary architectural need is consolidation (single canonical app path), formalization (explicit module contract + validation), and alignment (bring implementation and architecture docs into tighter sync).
