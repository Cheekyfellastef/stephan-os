import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CollapsiblePanel from '../components/CollapsiblePanel.jsx';

export function renderCollapsiblePanel({
  isOpen = false,
  keepMountedWhenClosed = false,
  panelId = 'testPanel',
  onToggle = () => {},
} = {}) {
  return renderToStaticMarkup(
    <CollapsiblePanel
      panelId={panelId}
      title="Test Panel"
      isOpen={isOpen}
      onToggle={onToggle}
      keepMountedWhenClosed={keepMountedWhenClosed}
    >
      <div data-testid="expensive-child">expensive child content</div>
    </CollapsiblePanel>,
  );
}
