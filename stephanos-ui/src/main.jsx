import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AIStoreProvider } from './state/aiStore';
import { buildApiUrl } from './ai/apiConfig';
import './styles.css';
import { STEPHANOS_UI_BOOT_LOG, STEPHANOS_UI_BUILD_METADATA } from './runtimeInfo';
import { createStephanosLocalUrls } from '../../shared/runtime/stephanosLocalUrls.mjs';

// LIVE SOURCE OF TRUTH: this Vite entry boots the Stephanos Mission Console UI from stephanos-ui/src.
// Production output is generated into apps/stephanos/dist and embedded by the root launcher.
async function logDevStartupHealthCheck() {
  const canonicalUrls = createStephanosLocalUrls();
  const startupFingerprint = {
    commitHash: STEPHANOS_UI_BUILD_METADATA.gitCommit,
    buildFingerprint: STEPHANOS_UI_BUILD_METADATA.runtimeMarker,
    buildTimestamp: STEPHANOS_UI_BUILD_METADATA.buildTimestamp,
    currentOrigin: window.location.origin,
    currentPathname: window.location.pathname,
    runtimeRole: window.location.pathname.startsWith('/apps/stephanos/dist/')
      ? 'mission-control-dist-runtime'
      : 'mission-control-dev-runtime',
    expectedRootLauncherUrl: canonicalUrls.launcherShellUrl,
    expectedMissionControlDistUrl: canonicalUrls.runtimeIndexUrl,
    routeSourceLabel: 'vite-main-entry',
  };
  console.info(STEPHANOS_UI_BOOT_LOG);
  const intendedMode = startupFingerprint.runtimeRole === 'mission-control-dist-runtime'
    ? '4173 dist runtime'
    : '5173 Vite dev runtime';
  const intendedFinalUrl = startupFingerprint.runtimeRole === 'mission-control-dist-runtime'
    ? canonicalUrls.runtimeIndexUrl
    : 'http://127.0.0.1:5173/';
  const [port4173Running, port5173Running] = await Promise.all([
    fetch('http://127.0.0.1:4173/__stephanos/health', { method: 'GET' }).then((response) => response.ok).catch(() => false),
    fetch('http://127.0.0.1:5173/', { method: 'GET' }).then((response) => response.ok).catch(() => false),
  ]);

  console.info('[Stephanos Runtime] Build metadata', STEPHANOS_UI_BUILD_METADATA);
  console.info('[Stephanos Runtime Fingerprint] startup', startupFingerprint);
  console.info('[Stephanos Runtime] Intended mode', intendedMode);
  console.info('[Stephanos Runtime] Intended final URL', intendedFinalUrl);
  console.info('[Stephanos Runtime] 4173 currently running', port4173Running);
  console.info('[Stephanos Runtime] 5173 currently running', port5173Running);
  console.info('Waiting for backend health check...');

  const healthUrl = buildApiUrl('/api/health');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    if (response.ok) {
      console.info('Stephanos backend detected.');
      return;
    }
  } catch {
    // no-op, warning is logged below
  } finally {
    clearTimeout(timeout);
  }

  console.warn('Backend not detected. Start with:\nnpm run stephanos');
}

void logDevStartupHealthCheck();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AIStoreProvider>
      <App />
    </AIStoreProvider>
  </React.StrictMode>,
);
