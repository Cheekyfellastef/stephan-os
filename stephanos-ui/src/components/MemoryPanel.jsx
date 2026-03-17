export default function MemoryPanel({ commandHistory }) {
  const latestMemory = [...commandHistory]
    .reverse()
    .find((entry) => entry.route === 'memory' || entry.response?.type === 'memory_result');

  const items = latestMemory?.response?.data?.items
    || latestMemory?.response?.data?.matches
    || (latestMemory?.response?.data?.item ? [latestMemory.response.data.item] : []);

  return (
    <section className="panel">
      <h2>Memory</h2>
      {items.length === 0 ? (
        <p className="muted">Run /memory list or /memory find &lt;query&gt;.</p>
      ) : (
        <ul className="compact-list">
          {items.slice(0, 5).map((item) => (
            <li key={item.id ?? item.text}>{item.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
