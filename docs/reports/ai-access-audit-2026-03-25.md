# AI Access Path Audit (2026-03-25)

## Scope
Inspected `apps/**`, `system/**`, `shared/**`, and `modules/**` for AI entry points, provider leakage, and backend URL resolver drift.

## Findings summary
- **Standardized (shared helper): 1**
- **Backend-targeted but not standardized: 2**
- **Ad hoc local AI plumbing: 1**
- **Direct provider call from tile/frontend source: 0**
- **Mock-only entry paths: 0**
- **Unclear / needs investigation (compiled UI): 1**

## Inventory
| File | Module / function | Classification | Behavior | Risk | Recommended action | Priority |
|---|---|---|---|---|---|---|
| `apps/experimental/src/simulationRunner.js` | `requestSimulationAdvisor` | Standardized | Uses `queryStephanosAI(...)` and sends simulation advisor request to Stephanos backend route. | Low. This already follows the target architecture. | Keep as reference implementation for migration of other tiles/simulations. | Low |
| `shared/ai/stephanosClient.mjs` | `queryStephanosAI` | Standardized | Shared helper builds payload + resolves backend base URL + POSTs to `/api/ai/chat`. | Low. Single standard path is present. | Continue using this as the canonical tile/simulation client. | Low |
| `system/apps/app_validator.js` | `validateStephanosRuntime` (`providerHealthUrl` + `postJsonSafely`) | Backend-targeted but not standardized | Builds `.../api/ai/providers/health` from resolved backend URL and POSTs provider preference data. | Medium. Duplicated HTTP plumbing outside shared helper (diagnostic path) can drift from shared client conventions. | Add a small shared diagnostic helper for provider-health probing (or extend shared helper namespace). | Medium |
| `shared/runtime/stephanosHomeNode.mjs` | `fetchJsonWithTimeout`, `probeStephanosHomeNode` | Backend-targeted but not standardized | Directly probes backend `/api/health` for node discovery and route diagnostics. | Low/Medium. Not an AI chat call, but another backend probe implementation path. | Keep for runtime discovery; optionally centralize low-level fetch wrapper to reduce divergence. | Low |
| `shared/runtime/stephanosSessionMemory.mjs` | `sanitizeStephanosSessionMemoryForDevice` | Ad hoc local AI plumbing | Stores/sanitizes per-provider configs and loopback endpoint memory (including Ollama connection memory). | Medium. Not an execution path itself, but local provider config plumbing can encourage non-standard direct endpoint thinking. | Keep state model, but document that execution must remain via shared helper + backend router only. | Medium |
| `apps/stephanos/dist/assets/index-*.js` | compiled runtime (`by(...)`, `qc(...)` path names in bundle) | Unclear / needs investigation | Minified bundle contains backend AI request flow and provider config/fallback orchestration; source is not present in repo under `stephanos-ui/src`. | High for auditability. Compliance is hard to verify at source level, and bundle appears to contain ad hoc AI transport logic. | Restore/check in corresponding source (or submodule) and migrate its AI calls to `shared/ai/stephanosClient.mjs`. | High |

## Direct provider leakage check
- No **source-level** frontend/tile direct calls to `http://localhost:11434`, `/api/generate`, Ollama chat endpoints, Groq/Gemini/OpenAI/OpenRouter HTTP endpoints, or provider SDKs were found in inspected non-test source files.
- Provider URLs exist in defaults/config state definitions (`shared/ai/providerDefaults.mjs`) and tests, which is expected for backend routing config and test fixtures.

## Competing backend URL resolver findings
- Canonical resolver exists in `shared/runtime/stephanosHomeNode.mjs` (`resolveStephanosBackendBaseUrl`).
- Shared AI helper consumes this resolver in `shared/ai/stephanosClient.mjs`.
- `system/apps/app_validator.js` also resolves backend base URL and performs its own POST/GET probes (diagnostic path), creating a secondary fetch path outside shared AI helper.
- Compiled `apps/stephanos/dist` bundle appears to contain additional backend URL normalization logic (minified), which is another competing source-of-truth risk until source is restored.

## Migration readiness assessment
- `apps/experimental/src/simulationRunner.js`: already migrated, no action required.
- `system/apps/app_validator.js`: easy migration for AI provider-health probe helper extraction; low blast radius.
- `apps/stephanos/dist` runtime AI flow: moderate/high effort due missing readable source in this repo; likely requires source restore first.
- Runtime/session modules (`shared/runtime/*`): mostly diagnostics and persisted preferences; low urgency, but should be explicitly constrained to non-execution responsibilities.

## Next 3 migration candidates
1. **`system/apps/app_validator.js` provider health probing path**
   - Highest payoff with low risk: removes duplicated AI-adjacent POST plumbing.
2. **Stephanos UI runtime AI transport (currently visible only in `apps/stephanos/dist` bundle)**
   - High standardization payoff; needs source recovery first.
3. **Shared diagnostic HTTP wrapper for runtime probes (`shared/runtime/stephanosHomeNode.mjs` + validator callers)**
   - Medium payoff: unify backend URL + fetch behavior, reducing drift.

## Optional tiny follow-ups (safe)
- Add a comment in `system/apps/app_validator.js` marking provider-health POST as **diagnostic path** and noting future alignment with shared helper conventions.
- Add a short README note in `shared/ai/` documenting that tile/simulation AI execution must go through `queryStephanosAI`.
