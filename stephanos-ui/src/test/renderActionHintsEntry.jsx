import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionHints from '../components/system/ActionHints.jsx';

export function renderActionHints(runtimeStatusModel) {
  return renderToStaticMarkup(<ActionHints runtimeStatusModel={runtimeStatusModel} />);
}
