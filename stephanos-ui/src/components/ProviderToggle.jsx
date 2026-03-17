import { useAIStore } from '../state/aiStore';

const PROVIDERS = [
  { id: 'openai', label: '☁ OpenAI Cloud' },
  { id: 'ollama', label: '🖥 Local Ollama' },
  { id: 'custom', label: '🛠 Custom LLM' },
];

export default function ProviderToggle() {
  const { provider, setProvider } = useAIStore();

  return (
    <div className="provider-toggle-block">
      <span className="provider-switch-label">AI Provider</span>
      <div className="provider-toggle" role="tablist" aria-label="AI Provider">
        {PROVIDERS.map((item) => {
          const isActive = provider === item.id;

          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`provider-toggle-button${isActive ? ' active' : ''}`}
              onClick={() => setProvider(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
