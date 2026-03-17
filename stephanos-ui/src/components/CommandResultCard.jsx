import { formatResultTitle, getResultTone } from '../ai/commandFormatter';

export default function CommandResultCard({ entry }) {
  const tone = getResultTone(entry.response?.type);

  return (
    <article className={`result-card ${tone}`}>
      <header>
        <strong>{formatResultTitle(entry)}</strong>
        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
      </header>
      <p className="result-input">{entry.raw_input}</p>
      <p>{entry.output_text}</p>
      {entry.error && <p className="error-text">Error: {entry.error}</p>}
      {entry.data_payload && Object.keys(entry.data_payload).length > 0 && (
        <details>
          <summary>Structured data</summary>
          <pre>{JSON.stringify(entry.data_payload, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}
