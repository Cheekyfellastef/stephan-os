import { useAIStore } from '../state/aiStore';

export default function StatusPanel() {
  const { status, isBusy, lastRoute, chatHistory } = useAIStore();

  return (
    <aside className="status-panel panel">
      <h2>Status</h2>
      <ul>
        <li>Backend: {status === 'error' ? 'degraded' : 'online'}</li>
        <li>State: {isBusy ? 'busy' : status}</li>
        <li>Route: {lastRoute}</li>
        <li>Messages: {chatHistory.length}</li>
        <li>Debug Console: press F1</li>
      </ul>
    </aside>
  );
}
