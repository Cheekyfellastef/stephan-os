import { useAIStore } from '../state/aiStore';
import CommandResultCard from './CommandResultCard';
import ProviderToggle from './ProviderToggle';
import CustomProviderPanel from './CustomProviderPanel';

export default function AIConsole({ input, setInput, submitPrompt, commandHistory }) {
  const { isBusy, apiStatus } = useAIStore();

  const onSubmit = (event) => {
    event.preventDefault();
    submitPrompt(input);
    setInput('');
  };

  return (
    <section className="panel">
      <h1>Stephanos Mission Console</h1>
      <div className="provider-switch-block">
        <ProviderToggle />
        <CustomProviderPanel />
      </div>
      <div className={`api-connection-banner ${apiStatus.state}`}>
        <strong>{apiStatus.label}</strong>
        <span>{apiStatus.detail}</span>
      </div>
      <div className="output-panel">
        {commandHistory.length === 0 ? (
          <p className="muted">Ready. Try /status, /tools, /simulate list, /simulate run trajectory-demo --start 1000 --monthly 100 --rate 0.05 --years 10</p>
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
