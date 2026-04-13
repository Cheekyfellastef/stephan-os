# Stephanos Home Bridge: Tailscale Serve HTTPS execution bridge

## Objective

Enable hosted Stephanos surfaces (for example, an iPad loading the GitHub Pages launcher) to execute AI calls against the home PC backend without browser mixed-content blocking.

This approach keeps:

- home PC backend (`localhost:8787`) as the primary execution node,
- Tailscale as identity + transport,
- hosted execution over **tailnet-private HTTPS** on `*.ts.net`,
- operator transport truth separate from hosted execution truth.

## Runtime truth mapping used by this repo

- **Operator transport URL**: the operator-authored bridge transport target (can remain HTTP, e.g. `http://...:8787`).
- **Hosted execution bridge URL**: HTTPS execution target used by hosted browser surfaces (prefer `https://<machine>.ts.net`).
- **Direct reachability**: whether the bridge endpoint is reachable from the surface.
- **Hosted execution compatibility**: whether hosted HTTPS browser execution is compatible (`compatible`, `mixed-scheme-blocked`, `cors-blocked`).
- **Bridge mode**: `tailnet-private-https` when Tailscale HTTPS execution URL is active.

## Home PC commands (exact)

Run on the home PC (already logged into Tailscale):

```bash
tailscale status
tailscale serve --https=443 / http://127.0.0.1:8787
tailscale serve status
tailscale cert $(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
```

Optional persistence (Linux systemd):

```bash
sudo tailscale serve --bg --https=443 / http://127.0.0.1:8787
tailscale serve status
```

## Backend CORS requirement

Ensure the backend allows your hosted frontend origin (GitHub Pages). In this repo, default hosted origin includes:

- `https://cheekyfellastef.github.io`

If you use a different Pages origin, set:

```bash
export FRONTEND_ORIGINS="https://your-user.github.io"
```

before starting `stephanos-server`.

## Validation workflow

1. **Direct bridge access (from any tailnet device/browser):**
   - Open `https://<home-machine>.<tailnet>.ts.net/api/health`
   - Expect JSON with `service: "stephanos-server"`.

2. **Hosted frontend fetch validation (GitHub Pages surface):**
   - Open hosted Stephanos.
   - Configure Tailscale transport:
     - operator transport URL can stay as authored HTTP target,
     - set hosted execution URL to `https://<home-machine>.<tailnet>.ts.net`.
   - Confirm runtime/support snapshot shows:
     - `Bridge Mode: tailnet-private-https`
     - `Bridge Hosted Execution Compatibility: compatible`
     - `Bridge Hosted Execution URL: https://...ts.net`

3. **End-to-end AI request (iPad -> home backend):**
   - Submit an AI prompt from the iPad hosted surface.
   - Confirm response succeeds.
   - Confirm runtime target truth resolves to the HTTPS `ts.net` execution URL.

