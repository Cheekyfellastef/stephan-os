import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AIStoreProvider } from './state/aiStore';
import { buildApiUrl } from './ai/apiConfig';
import './styles.css';

async function logDevStartupHealthCheck() {
  console.info('Stephanos UI running on http://localhost:5173');
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
