import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CollapsiblePanel from '../components/CollapsiblePanel.jsx';

export function renderCollapsiblePanel({ isOpen = false, keepMountedWhenClosed = false } = {}) {
  return renderToStaticMarkup(
    <CollapsiblePanel
      panelId="testPanel"
      title="Test Panel"
      isOpen={isOpen}
      onToggle={() => {}}
      keepMountedWhenClosed={keepMountedWhenClosed}
    >
      <div data-testid="expensive-child">expensive child content</div>
    </CollapsiblePanel>,
  );
}
