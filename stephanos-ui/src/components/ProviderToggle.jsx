import { useEffect } from 'react';
import { useAIStore } from '../state/aiStore';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'ollama', label: 'Ollama' },
  { id: 'custom', label: 'Custom' },
];

const PROVIDER_COMPONENT_MARKER = 'stephanos-ui/components/ProviderToggle.jsx::v3';

export default function ProviderToggle() {
  const { provider, setProvider, setUiDiagnostics } = useAIStore();

  useEffect(() => {
    console.log('[ProviderToggle] mounted from', PROVIDER_COMPONENT_MARKER);
    setUiDiagnostics((prev) => ({
      ...prev,
      providerToggleMounted: true,
      providerToggleMarker: PROVIDER_COMPONENT_MARKER,
    }));

    return () => {
      setUiDiagnostics((prev) => ({
        ...prev,
        providerToggleMounted: false,
      }));
    };
  }, [setUiDiagnostics]);

  return (
    <div className="provider-toggle-block" data-component-marker={PROVIDER_COMPONENT_MARKER}>
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
