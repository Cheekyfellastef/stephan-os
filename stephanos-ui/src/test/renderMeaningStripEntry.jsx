import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MeaningStrip from '../components/system/MeaningStrip.jsx';

export function renderMeaningStrip(finalRouteTruth, memoryMode, lastExecutionMetadata) {
  return renderToStaticMarkup(
    <MeaningStrip finalRouteTruth={finalRouteTruth} memoryMode={memoryMode} lastExecutionMetadata={lastExecutionMetadata} />,
  );
}
