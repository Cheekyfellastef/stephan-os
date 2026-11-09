# Goal Cockpit Chat v1

## Outcome

Goal Cockpit Chat is a read-only MCP App projection of current Stephanos goal truth. It is intended to open as an immediate cockpit inside a compatible ChatGPT or Codex conversation, with the same compact status hierarchy on desktop, iPhone, and iPad.

It does not create a second goal authority. The plugin reads the canonical runtime-backed projections, composes a bounded display model, and renders that model. Missing or conflicting authority-bearing evidence must remain visibly `UNKNOWN` or `CONFLICT`; it must not be inferred as healthy or complete.

## Truth contract

| Surface | Contract |
| --- | --- |
| Canonical authority | Existing Stephanos runtime adjudication and goal projections |
| Chat service | Read-only composition of the canonical projections |
| MCP tools | Read-only retrieval and rendering; no mutation tool is exposed |
| Cockpit UI | Projection consumer; never a source of runtime truth |
| Widget cache | Display-only last snapshot, labelled cached until refreshed |
| Missing source | `UNKNOWN`, with source failure retained |
| Exact-head mismatch | `CONFLICT`, never merge-ready or complete |
| Completion | Shown only when canonical completion evidence is present |

Truth state and work state are separate dimensions. A goal can be running while its source truth is stale, or blocked while its source truth is current. The UI must not collapse those meanings into one colour or one status word.

## MCP surface

The server entry is:

```text
plugins/stephanos-goal-cockpit/scripts/goal-cockpit-mcp.mjs
```

The v1 server exposes these bounded tools:

| Tool | Purpose | UI resource |
| --- | --- | --- |
| `get_goal_cockpit_current` | Read the current cockpit projection | None |
| `get_goal_detail` | Read one goal from the current projection by goal ID | None |
| `render_goal_cockpit` | Return the current projection with the cockpit component | `ui://stephanos/goal-cockpit-v1.html` |

All tools declare read-only, non-destructive, idempotent, closed-world annotations. Only the render tool is coupled to the UI resource. This keeps data retrieval usable without forcing a rendered component into every answer.

The UI may retain a last snapshot in ChatGPT widget state so it can paint immediately. It then requests a fresh projection when mounted and every 30 seconds while visible. Polling stops while the component is hidden. Cached content is presentation convenience only and remains labelled until a successful current read replaces it.

## Local Windows install

Prerequisites:

- Node.js available on `PATH`
- a local Codex command when automatic MCP registration is wanted
- this repository checkout
- the Stephanos shared workspace path used by the runtime

From the repository root:

```powershell
npm run stephanos:goal-cockpit:test
npm run stephanos:goal-cockpit:install -- -RepositoryRoot "C:\path\to\stephan-os" -SharedWorkspace "C:\path\to\Stephanos-openclaw-workspace"
npm run stephanos:goal-cockpit:status -- -RepositoryRoot "C:\path\to\stephan-os" -SharedWorkspace "C:\path\to\Stephanos-openclaw-workspace"
```

The installer:

1. verifies the plugin manifest, MCP server, UI resource, and configuration template;
2. copies the plugin to `%USERPROFILE%\.codex\plugins\stephanos-goal-cockpit`;
3. materializes an absolute `.mcp.json` bound to the selected repository and workspace;
4. registers the MCP server with local Codex unless `-SkipCodexMcpRegistration` is supplied; and
5. writes a bounded install receipt to `<shared-workspace>\goal-cockpit\install-proof.json`.

The receipt deliberately records cross-device ChatGPT connection and tool proof as unverified. A successful local install is not evidence that a phone or tablet can reach the private runtime.

For a direct stdio check:

```powershell
npm run stephanos:goal-cockpit:mcp -- --repo-root "C:\path\to\stephan-os" --workspace-root "C:\path\to\Stephanos-openclaw-workspace"
```

After installation, start a new Codex conversation so the installed MCP tools are rediscovered.

## ChatGPT, iPhone, and iPad gate

The local stdio process is private to its host. Cross-device availability requires an approved secure connection from that process to ChatGPT; copying the plugin locally is not sufficient.

1. Keep the trusted runtime host online with the repository and shared workspace available.
2. Expose the stdio MCP server through an approved secure MCP tunnel. Do not open an unauthenticated public port.
3. Add the resulting MCP endpoint in ChatGPT developer mode for the same workspace or account used by the target devices.
4. Open a new compatible chat and verify that the three Goal Cockpit tools are present.
5. Invoke `render_goal_cockpit` and verify a current snapshot, its source freshness, and the expected `ui://stephanos/goal-cockpit-v1.html` resource.
6. Repeat first-open and refresh proof on desktop, iPhone, and iPad. Until those receipts exist, report cross-device status as unverified.

Use the official OpenAI guidance for [connecting an MCP server to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [building an MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui). The connection mechanism is operational infrastructure, not a new truth authority.

## Verification

Run the bounded automated checks:

```powershell
npm run stephanos:goal-cockpit:test
python C:\path\to\plugin-creator\scripts\validate_plugin.py plugins\stephanos-goal-cockpit
```

The automated proof should cover:

- absent or failed sources do not produce false green health;
- exact-head disagreement projects `CONFLICT`;
- all tool annotations remain read-only and only the render tool names a UI resource;
- the MCP resource uses `text/html;profile=mcp-app`;
- the UI has no mutation controls or direct network authority;
- visibility-aware refresh and cached-snapshot labelling remain present; and
- goal-detail lookup is bounded to the current projection.

Browser-visible acceptance still requires real component proof. Capture at minimum:

- desktop compact and expanded layouts;
- iPhone portrait first-open and one successful refresh;
- iPad portrait or split-view first-open and one successful refresh;
- dark and light theme legibility;
- stale, unknown, conflict, and operator-attention states; and
- a source failure without fabricated completion.

## Safety and rollback

The v1 plugin must not expose dispatch, approval, merge, deployment, provider switching, filesystem mutation, arbitrary command execution, or arbitrary path reads. Operator actions remain on their existing authority-bearing lanes.

To disable the local integration, remove the `stephanos-goal-cockpit` MCP registration and the installed plugin directory. The canonical goal state is unaffected because the plugin holds no authoritative state.

## Programme contribution

- **Result:** an at-a-glance goal cockpit available through a conversation surface.
- **Reusable capability:** one read-only projection contract can support chat, desktop, and mobile component layouts.
- **Invariant:** convenience caches and UI rendering may accelerate display, but only canonical runtime evidence may claim current health, approval, exact-head readiness, or completion.
