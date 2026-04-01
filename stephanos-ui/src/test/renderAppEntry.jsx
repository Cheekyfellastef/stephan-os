import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App.jsx';
import { AIStoreProvider } from '../state/aiStore';

function TestAppShell() {
  return (
    <AIStoreProvider>
      <App />
    </AIStoreProvider>
  );
}

export function renderApp() {
  return renderToStaticMarkup(<TestAppShell />);
}
