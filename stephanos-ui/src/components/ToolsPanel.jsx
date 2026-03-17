export default function ToolsPanel({ commandHistory }) {
  const latestTools = [...commandHistory]
    .reverse()
    .find((entry) => Array.isArray(entry.response?.data?.grouped_tools));

  const groups = latestTools?.response?.data?.grouped_tools ?? [];

  return (
    <section className="panel">
      <h2>Tools</h2>
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
    </section>
  );
}
