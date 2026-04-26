# Battle Bridge backend autostart + stack repair (Windows)

## Canonical Battle Bridge route

Stephanos Battle Bridge is exposed over a **tailnet-only** HTTPS route at:

- `https://desktop-9flonkj.taild6f215.ts.net`

Expected Serve mapping:

- `https://desktop-9flonkj.taild6f215.ts.net/` → `http://127.0.0.1:8787`

Funnel must remain disabled.

## Operational model: backend lifecycle vs Tailscale lifecycle

These are intentionally separate concerns:

- **Backend lifecycle (local process)**
  - Managed by `start-stephanos-backend.ps1` and the scheduled task.
  - Ensures local API health (`http://127.0.0.1:8787/api/health`).
- **Tailscale transport lifecycle**
  - Managed by Tailscale session + Serve configuration.
  - Provides tailnet HTTPS transport to the local backend.

The autostart installer only configures backend startup at logon. It does not make browser/runtime/provider assumptions and does not merge backend health with transport truth.

## One-time autostart install (backend only)

Run this on the Battle Bridge machine from repo root:

```powershell
npm run stephanos:battle-bridge:autostart:install
```

Installer behavior:

- Creates/updates scheduled task: `Stephanos Battle Bridge Backend`
- Trigger: current user logon
- Action: `powershell.exe ... scripts/windows/start-stephanos-backend.ps1`
- Does not modify Tailscale Serve mapping
- Does not enable Funnel

## Full stack status (backend + transport + hosted health)

```powershell
npm run stephanos:battle-bridge:status
```

This reports explicit field-style status for:

- Scheduled task presence/state/last result
- Local backend health: `http://127.0.0.1:8787/api/health`
- Tailscale CLI presence
- `tailscale status` summary and DNS/health warning lines
- `tailscale serve status`
- Expected Serve mapping presence for canonical host + `/` proxy target
- Hosted bridge health: `https://desktop-9flonkj.taild6f215.ts.net/api/health`

### DNS warnings policy

Tailscale DNS/health warnings are surfaced as warnings. They are not treated as fatal by themselves when hosted bridge health is HTTP 200.

## Full stack repair (safe, operator-invoked)

```powershell
npm run stephanos:battle-bridge:repair
```

Repair script (`scripts/windows/repair-stephanos-battle-bridge.ps1`) behavior:

1. Resolves repo root from script location and runs in repo root.
2. Ensures `logs/battle-bridge/` exists.
3. Checks local backend health.
4. If backend unhealthy, invokes `start-stephanos-backend.ps1` and re-checks health.
5. Verifies `tailscale.exe` is available.
6. Reads `tailscale status` and `tailscale serve status`.
7. If expected Serve mapping is missing, restores only:
   - `/` proxy to `http://127.0.0.1:8787` via `tailscale serve --bg http://127.0.0.1:8787`
8. Never enables Funnel and never exposes publicly.
9. Polls hosted bridge health.
10. Exits `0` only when both local and hosted health checks are healthy.

This script is a visible repair/check layer, not hidden autonomous mutation.

## Autostart status + uninstall

```powershell
npm run stephanos:battle-bridge:autostart:status
npm run stephanos:battle-bridge:autostart:uninstall
```

Autostart uninstall is safe if already absent.

## Troubleshooting

1. **Backend healthy locally, hosted route unhealthy**
   - Run:
     - `npm run stephanos:battle-bridge:status`
     - `npm run stephanos:battle-bridge:repair`
   - Inspect `tailscale status`/`tailscale serve status` sections for auth/session/mapping drift.
2. **`tailscale.exe` missing**
   - Repair exits clearly non-zero after backend recovery checks, without masking backend result.
3. **Task present but backend did not start after logon**
   - Check scheduled task `LastTaskResult` and logs under `logs/battle-bridge/`.
4. **DNS warnings shown**
   - Treat as warning if hosted health returns HTTP 200.
   - Treat as actionable if hosted health fails.
