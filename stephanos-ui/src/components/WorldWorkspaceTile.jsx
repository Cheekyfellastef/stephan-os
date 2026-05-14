import CollapsiblePanel from './CollapsiblePanel';

export default function WorldWorkspaceTile({ uiLayout, togglePanel } = {}) {
  const openWorldWorkspace = () => {
    if (typeof window === 'undefined') return;
    window.location.assign('./../../world-workspace/index.html');
  };

  return (
    <CollapsiblePanel
      panelId="worldWorkspacePanel"
      title="World Workspace"
      description="Prototype-ready semi-realistic 3D globe with illustrative/sample strategic assets."
      isOpen={uiLayout?.worldWorkspacePanel !== false}
      onToggle={() => togglePanel?.('worldWorkspacePanel')}
      className="pane-span-2"
    >
      <section className="tile-card" aria-label="World Workspace">
      <h3>🌍 World Workspace</h3>
      <p>Prototype-ready semi-realistic 3D globe with illustrative/sample strategic assets.</p>
      <ul>
        <li>Mode: illustrative / simulation-ready</li>
        <li>Layers: Cities, Naval, Air, Infrastructure, Routes, Labels</li>
        <li>Truth: demo/simulated positions, not live military tracking</li>
      </ul>
      <button type="button" onClick={openWorldWorkspace}>Open World Workspace</button>
      </section>
    </CollapsiblePanel>
  );
}
