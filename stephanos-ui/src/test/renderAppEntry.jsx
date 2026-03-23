import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App.jsx';

export function renderApp() {
  return renderToStaticMarkup(<App />);
}
