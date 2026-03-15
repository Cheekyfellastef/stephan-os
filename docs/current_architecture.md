# Stephanos OS — Current Technical Architecture

## 1) Runtime Flow

Stephanos OS now runs through a single module-driven runtime rooted at the repository root:

1. **Boot Layer**
   - `index.html` renders the shell and boot UI.
   - `main.js` initializes runtime services and transitions system status to online.

2. **System Core**
   - `system/core/event_bus.js` provides publish/subscribe communication.
   - `system/core/system_state.js` provides in-memory runtime state.
   - `system/core/service_registry.js` provides service registration and lookup.

3. **Workspace Runtime**
   - `system/workspace.js` controls workspace open/close transitions.
   - Workspace lifecycle emits events for other modules to react.

4. **Module Loader**
   - `system/module_loader.js` reads `modules/module_registry.json`.
   - Each module is validated against the runtime contract before initialization.

5. **Modules**
   - Runtime modules initialize through `init(context)`.
   - Modules communicate via `context.eventBus`.

Architecture flow:

**Boot → System Core → Workspace Runtime → Module Loader → Modules**

---

## 2) Runtime Consolidation

Legacy parallel UI runtime paths have been removed. Stephanos OS now has one execution path:

- Root `main.js` creates runtime context and loads modules.
- `modules/command-deck/command-deck.js` owns project tile rendering.
- `system/workspace.js` owns workspace navigation and emits workspace events.

This consolidation eliminates duplicated startup logic and keeps all runtime behavior inside the module-driven architecture.

---

## 3) Formal Module Contract

Modules are expected to export:

```js
export const moduleDefinition = {
  id: "module-id",
  version: "1.0",
  description: "module description"
};

export function init(context) {}
```

Validation rules in the loader:
- `init` must exist and be a function.
- `moduleDefinition` must include `id`, `version`, and `description` as strings.

If validation fails, the loader skips the module and logs an error instead of crashing runtime initialization.

On success, the loader logs:

```text
Loaded module: <moduleDefinition.id>
```

---

## 4) Event Bus Conventions

Stephanos OS uses namespaced events to keep runtime boundaries clear:

- `system:*` — runtime lifecycle and shell-level events.
- `module:*` — module lifecycle and inter-module status events.
- `workspace:*` — workspace navigation/state transitions.
- `project:*` — project-specific actions and state changes.

Current emitted runtime events include:
- `module:loaded` — emitted by `system/module_loader.js` after module initialization.
- `workspace:opened` — emitted by `system/workspace.js` when a project launches.
- `workspace:closed` — emitted by `system/workspace.js` when returning to the command deck.

---

## 5) Module Lifecycle Support

The loader supports an optional lifecycle hook:

```js
export function dispose(context) {}
```

Lifecycle behavior:
- Loaded modules are tracked internally in `loadedModules`.
- During system reload, `dispose(context)` is called for each module if defined.
- Disposal errors are isolated and logged per module.

This allows modules to remove listeners, release resources, and reset transient state safely.
