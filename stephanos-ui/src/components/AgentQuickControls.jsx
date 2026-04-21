export default function AgentQuickControls({ controls, onToggle, onSetAutonomy, onToggleAgent, registry = [] } = {}) {
  if (!controls) return null;
  return (
    <div className="agent-quick-controls">
      <button
        type="button"
        className="agent-cog-button"
        onClick={() => onToggle('visible')}
        aria-label="Agent quick controls"
      >
        ⚙︎
      </button>
      {controls.visible ? (
        <div className="agent-cog-popup" data-no-drag>
          <label><input type="checkbox" checked={controls.globalVisibilityToggle} onChange={() => onToggle('globalVisibilityToggle')} /> Agent visuals</label>
          <label><input type="checkbox" checked={controls.autonomyMasterToggle} onChange={() => onToggle('autonomyMasterToggle')} /> Autonomy master</label>
          <label><input type="checkbox" checked={controls.safeMode} onChange={() => onToggle('safeMode')} /> Safe mode</label>
          <label><input type="checkbox" checked={controls.debugVisibility} onChange={() => onToggle('debugVisibility')} /> Debug visibility</label>
          <label>
            Autonomy ladder
            <select value={controls.globalAutonomy} onChange={(event) => onSetAutonomy(event.target.value)}>
              <option value="manual">manual</option>
              <option value="assisted">assisted</option>
              <option value="guarded-auto">guarded-auto</option>
              <option value="full-auto">full-auto</option>
            </select>
          </label>
          <div className="agent-quick-list">
            {registry.map((agent) => (
              <label key={agent.agentId}>
                <input
                  type="checkbox"
                  checked={controls.agentEnabledMap?.[agent.agentId] ?? agent.enabledByDefault === true}
                  onChange={() => onToggleAgent(agent.agentId)}
                />
                {agent.displayName}
              </label>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
