import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIConsole from '../components/AIConsole.jsx';
import { AIStoreProvider } from '../state/aiStore';

export function renderAIConsole() {
  return renderToStaticMarkup(
    <AIStoreProvider>
      <AIConsole
        input=""
        setInput={() => {}}
        submitPrompt={() => {}}
        commandHistory={[]}
      />
    </AIStoreProvider>,
  );
}
