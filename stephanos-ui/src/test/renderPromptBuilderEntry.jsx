import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PromptBuilder from '../components/system/PromptBuilder.jsx';
import { AIStoreProvider } from '../state/aiStore';

export function renderPromptBuilder({ runtimeStatusModel = null, telemetryEntries = [], actionHints = [] } = {}) {
  return renderToStaticMarkup(
    <AIStoreProvider>
      <PromptBuilder runtimeStatusModel={runtimeStatusModel} telemetryEntries={telemetryEntries} actionHints={actionHints} />
    </AIStoreProvider>,
  );
}
