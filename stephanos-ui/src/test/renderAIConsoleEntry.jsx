import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIConsole from '../components/AIConsole.jsx';
import { AIStoreProvider } from '../state/aiStore';

export function renderAIConsole({ commandHistory = [] } = {}) {
  return renderToStaticMarkup(
    <AIStoreProvider>
      <AIConsole
        input=""
        setInput={() => {}}
        submitPrompt={() => {}}
        commandHistory={commandHistory}
      />
    </AIStoreProvider>,
  );
}
