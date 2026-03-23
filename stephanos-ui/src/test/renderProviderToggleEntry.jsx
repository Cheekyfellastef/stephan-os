import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ProviderToggle from '../components/ProviderToggle.jsx';

export function renderProviderToggle() {
  return renderToStaticMarkup(<ProviderToggle onTestConnection={() => {}} onSendTestPrompt={() => {}} />);
}
