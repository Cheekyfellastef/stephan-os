import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TelemetryFeed from '../components/system/TelemetryFeed.jsx';

export function renderTelemetryFeed(runtimeStatusModel, telemetryEntries = []) {
  return renderToStaticMarkup(<TelemetryFeed runtimeStatusModel={runtimeStatusModel} telemetryEntries={telemetryEntries} />);
}
