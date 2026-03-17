import { useAIStore } from '../state/aiStore';

export default function AIConsole({ input, setInput, submitPrompt, clearConsole, chatHistory }) {
  const { isBusy } = useAIStore();

  const onSubmit = (event) => {
    event.preventDefault();
    if (input.trim() === '/clear') {
      clearConsole();
      return;
    }
    submitPrompt(input);
    setInput('');
  };

  return (
    <section className="panel">
      <h1>Stephanos AI Core</h1>
      <div className="output-panel">
        {chatHistory.length === 0 ? (
          <p className="muted">Ready. Try /help or ask a question.</p>
        ) : (
          chatHistory.map((item, index) => (
            <div key={`${item.role}-${index}`} className={`message ${item.role}`}>
              <span>{item.role === 'user' ? 'You' : 'Core'}</span>
              <p>{item.text}</p>
            </div>
          ))
        )}
      </div>

      <form className="command-form" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Enter prompt or command..."
          disabled={isBusy}
        />
        <button type="submit" disabled={isBusy}>
          {isBusy ? 'Thinking...' : 'Send'}
        </button>
      </form>
    </section>
  );
}
