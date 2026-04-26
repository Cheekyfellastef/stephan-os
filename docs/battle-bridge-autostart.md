# Battle Bridge backend autostart (Windows)

## Why this exists

Stephanos Battle Bridge is exposed over a **tailnet-only** HTTPS bridge at:

- `https://desktop-9flonkj.taild6f215.ts.net`

Tailscale Serve can persist the HTTPS proxy mapping across restarts, but it still proxies to the local backend target (`http://127.0.0.1:8787`). If the Stephanos backend is not running after Windows logon/reboot, the bridge has no active upstream process to reach.

## Backend vs Tailscale Serve

- **Tailscale Serve**: persistent HTTPS-to-local proxy configuration.
- **Stephanos backend**: local process that must be running to satisfy `/api/health` and other runtime requests.

This kit adds a Windows Scheduled Task that starts the backend at user logon. It does **not** change or reconfigure Tailscale Serve, and it does **not** enable public Funnel.

## One-time install

Run this from the repository root on the Battle Bridge machine:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/install-stephanos-backend-autostart.ps1
```

What the installer does:

- Creates/updates scheduled task: `Stephanos Battle Bridge Backend`
- Trigger: at current user logon
- Action: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/start-stephanos-backend.ps1`
- Uses current user + interactive token (no stored password requirement in normal cases)

## Status check

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/status-stephanos-backend-autostart.ps1
```

This reports:

- Scheduled task presence/state/last result
- Local backend health (`http://127.0.0.1:8787/api/health`)
- `tailscale serve status` (if `tailscale` CLI is available)
- Hosted bridge health (`https://desktop-9flonkj.taild6f215.ts.net/api/health`)

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/uninstall-stephanos-backend-autostart.ps1
```

Safe behavior: if task is already absent, uninstall exits cleanly.

## Logs and runtime behavior

`start-stephanos-backend.ps1`:

- Resolves repository root from script path
- Uses repository root as working directory
- Writes logs under `logs/battle-bridge/`
- Checks local `/api/health` first
  - If already healthy: logs and exits (no duplicate backend start)
  - If unhealthy: runs canonical project start command (`npm run stephanos:serve`), then polls `/api/health` for bounded startup confirmation

## Troubleshooting

1. **Task exists but backend is down**
   - Run status script and inspect `LastTaskResult`.
   - Run starter manually to observe logging:
     ```powershell
     powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/start-stephanos-backend.ps1
     ```
2. **`npm` not found**
   - Ensure Node.js/npm is installed for the account running the task and available on PATH.
3. **Tailscale bridge unhealthy while local is healthy**
   - Verify `tailscale serve status` and that session is tailnet-authenticated.
4. **Bridge config exists but route still fails**
   - Confirm local backend responds on `http://127.0.0.1:8787/api/health`; bridge persistence alone is insufficient.
