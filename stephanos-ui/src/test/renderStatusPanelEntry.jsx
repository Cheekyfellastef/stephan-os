import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatusPanel from '../components/StatusPanel.jsx';

export function renderStatusPanel() {
  return renderToStaticMarkup(<StatusPanel />);
}
