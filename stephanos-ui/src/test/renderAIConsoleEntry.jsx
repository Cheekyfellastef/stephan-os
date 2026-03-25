import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AIConsole from '../components/AIConsole.jsx';

export function renderAIConsole() {
  return renderToStaticMarkup(
    <AIConsole
      input=""
      setInput={() => {}}
      submitPrompt={() => {}}
      commandHistory={[]}
    />,
  );
}
