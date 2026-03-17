# LLM Provider Switch Report

## 1. Executive summary
Stephanos now supports backend-centralized LLM provider switching across OpenAI Cloud, Local Ollama, and Custom LLM. The Mission Console exposes a visible provider toggle, custom provider configuration UI, and status visibility while keeping all provider traffic routed through `/api/ai/chat`.

## 2. Files changed
- `stephanos-ui/src/state/aiStore.js`
- `stephanos-ui/src/components/AIConsole.jsx`
- `stephanos-ui/src/components/StatusPanel.jsx`
- `stephanos-ui/src/components/ProviderToggle.jsx`
- `stephanos-ui/src/components/CustomProviderPanel.jsx`
- `stephanos-ui/src/hooks/useAIConsole.js`
- `stephanos-ui/src/ai/aiClient.js`
- `stephanos-ui/src/styles.css`
- `stephanos-server/routes/ai.js`
- `stephanos-server/services/errors.js`
- `stephanos-server/services/llm/providerRouter.js`
- `stephanos-server/services/llm/providers/openaiProvider.js`
- `stephanos-server/services/llm/providers/ollamaProvider.js`
- `stephanos-server/services/llm/providers/customProvider.js`

## 3. Architecture decisions
- Provider routing is centralized in backend `providerRouter` and provider modules.
- Frontend always POSTs to `/api/ai/chat`, never directly to OpenAI/Ollama/custom endpoints.
- Conversational route now uses provider router while command/tool routing remains unchanged.
- Providers return normalized shape: `output_text`, `provider`, `model`, and optional `raw`.
- Custom provider config persists non-secret fields only; `apiKey` is session-only for safer defaults.

## 4. Supported providers
- `openai`: existing OpenAI integration preserved.
- `ollama`: backend calls `http://localhost:11434/api/chat` with model default (`llama3`).
- `custom`: backend calls user-configured `baseUrl + chatEndpoint`, optional bearer auth and JSON headers.

## 5. Known limitations
- Custom provider expects JSON responses and best-effort OpenAI-compatible/ollama-like shapes.
- Health checks are backend reachability-centric; deep provider heartbeat endpoints are not yet implemented.
- Provider-specific status derives from request outcomes rather than a dedicated polling endpoint.

## 6. Testing performed
- Backend test suite: `npm --prefix stephanos-server test`
- UI production build: `npm --prefix stephanos-ui run build`
- Root script presence check and changed file review via git status.

## 7. Recommended next milestone
Add a dedicated backend endpoint for provider health diagnostics (`/api/ai/providers/health`) with per-provider reachability checks and richer UI badges (latency, model availability, and last successful call timestamp).
