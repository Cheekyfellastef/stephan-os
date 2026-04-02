import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatusPanel from '../components/StatusPanel.jsx';
import { AIStoreProvider } from '../state/aiStore';

export function renderStatusPanel() {
  return renderToStaticMarkup(
    <AIStoreProvider>
      <StatusPanel />
    </AIStoreProvider>,
  );
}
