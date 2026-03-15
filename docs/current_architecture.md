# Stephanos OS — Current Technical Architecture

## 1) Runtime Flow (Updated)

Stephanos OS now follows this runtime sequence:

1. **Boot Layer**
   - `index.html` renders the shell and boot UI.
   - `main.js` starts initialization and transitions to online state.

2. **System Core**
   - `system/core/event_bus.js` provides publish/subscribe communication.
   - `system/core/system_state.js` provides in-memory runtime state.
   - `system/core/service_registry.js` provides service registration and lookup.

3. **Workspace Runtime**
   - `system/workspace.js` is part of runtime orchestration (not a standalone feature layer).
   - Opening a project updates workspace UI and emits runtime events.

4. **Module Loader**
   - `system/module_loader.js` reads `modules/module_registry.json`.
   - Each module is validated against the contract before initialization.

5. **Modules**
   - Runtime modules initialize through `init(context)`.
   - Modules can participate in event-driven communication via `context.eventBus`.

Architecture flow:

**Boot → System Core → Workspace Runtime → Module Loader → Modules**

---

## 2) Formal Module Contract

Modules are now expected to export:

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

## 3) Event-Driven Module System

Stephanos OS modules now communicate through the system event bus:

- Subscribe:

```js
context.eventBus.on("eventName", handler);
```

- Emit:

```js
eventBus.emit("eventName", payload);
```

Current runtime events include:
- `module:loaded` — emitted by `module_loader.js` after a module initializes.
- `workspace:opened` — emitted by `workspace.js` when a project launches.

This decouples modules from direct dependencies and enables feature growth via events.

---

## 4) Module Lifecycle Support

The loader supports optional lifecycle hooks:

```js
export function dispose(context) {}
```

Lifecycle behavior:
- Loaded modules are tracked internally in `loadedModules`.
- During system reload, `dispose(context)` is called for each module if defined.
- Disposal errors are isolated and logged per module.

This allows modules to remove listeners, release resources, and reset transient state safely.

---

## 5) Implementation Notes

- Stylesheet mismatch was corrected so the root app references `style.css`.
- The command deck module remains functional and now implements the module contract.
- Workspace launch behavior remains intact while emitting `workspace:opened` events.
- Reload behavior now attempts module disposal before page refresh.

Stephanos OS remains a browser-based modular shell while gaining stronger runtime boundaries, contract enforcement, and event-driven extensibility.
