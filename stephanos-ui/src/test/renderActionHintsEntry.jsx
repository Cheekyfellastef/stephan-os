import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActionHints from '../components/system/ActionHints.jsx';

export function renderActionHints(finalRouteTruth) {
  return renderToStaticMarkup(<ActionHints finalRouteTruth={finalRouteTruth} />);
}
