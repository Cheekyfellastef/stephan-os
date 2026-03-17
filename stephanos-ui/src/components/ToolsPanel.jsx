export default function ToolsPanel({ commandHistory }) {
  const latestTools = [...commandHistory]
    .reverse()
    .find((entry) => Array.isArray(entry.response?.data?.tools));

  const tools = latestTools?.response?.data?.tools ?? [];

  return (
    <section className="panel">
      <h2>Tools</h2>
      {tools.length === 0 ? (
        <p className="muted">Run /tools to inspect registry.</p>
      ) : (
        <ul className="compact-list">
          {tools.map((tool) => (
            <li key={tool.name}>{tool.name} ({tool.state})</li>
          ))}
        </ul>
      )}
    </section>
  );
}
