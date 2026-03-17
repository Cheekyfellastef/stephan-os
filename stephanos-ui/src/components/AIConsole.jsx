import { useAIStore } from '../state/aiStore';
import CommandResultCard from './CommandResultCard';

export default function AIConsole({ input, setInput, submitPrompt, commandHistory }) {
  const { isBusy } = useAIStore();

  const onSubmit = (event) => {
    event.preventDefault();
    submitPrompt(input);
    setInput('');
  };

  return (
    <section className="panel">
      <h1>Stephanos Mission Console</h1>
      <div className="output-panel">
        {commandHistory.length === 0 ? (
          <p className="muted">Ready. Try /status, /tools, /agents, or /memory.</p>
        ) : (
          commandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />)
        )}
      </div>

      <form className="command-form" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Enter command or prompt..."
          disabled={isBusy}
        />
        <button type="submit" disabled={isBusy}>
          {isBusy ? 'Routing...' : 'Execute'}
        </button>
      </form>
    </section>
  );
}
