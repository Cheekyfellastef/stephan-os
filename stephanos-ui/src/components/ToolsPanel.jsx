import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function ToolsPanel({ commandHistory }) {
  const { uiLayout, togglePanel } = useAIStore();
  const latestTools = [...commandHistory]
    .reverse()
    .find((entry) => Array.isArray(entry.response?.data?.grouped_tools));

  const groups = latestTools?.response?.data?.grouped_tools ?? [];

  return (
    <CollapsiblePanel
      as="aside"
      panelId="toolsPanel"
      title="Tools"
      description="Tool registry groups and live subsystem readiness."
      className="tools-panel"
      isOpen={uiLayout.toolsPanel}
      onToggle={() => togglePanel('toolsPanel')}
    >
      {groups.length === 0 ? (
        <p className="muted">Run /tools to inspect registry.</p>
      ) : (
        <div>
          {groups.map((group) => (
            <div key={`${group.subsystem}-${group.category}`}>
              <strong>{group.subsystem} / {group.category}</strong>
              <ul className="compact-list">
                {group.tools.map((tool) => (
                  <li key={tool.name}>{tool.name} ({tool.state})</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </CollapsiblePanel>
  );
}
