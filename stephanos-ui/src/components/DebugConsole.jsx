import { useAIStore } from '../state/aiStore';

export default function DebugConsole() {
  const { debugVisible, debugData } = useAIStore();
  if (!debugVisible) return null;

  return (
    <section className="debug-console panel">
      <h2>Developer Debug Console</h2>
      <pre>{JSON.stringify(debugData, null, 2)}</pre>
    </section>
  );
}
