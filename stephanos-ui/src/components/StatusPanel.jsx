import { useAIStore } from '../state/aiStore';

export default function StatusPanel() {
  const { status, isBusy, lastRoute, commandHistory } = useAIStore();
  const latest = commandHistory[commandHistory.length - 1];

  return (
    <aside className="status-panel panel">
      <h2>Status</h2>
      <ul>
        <li>Backend: {status === 'error' ? 'degraded' : 'online'}</li>
        <li>Execution: {isBusy ? 'busy' : status}</li>
        <li>Route: {lastRoute}</li>
        <li>Commands: {commandHistory.length}</li>
        <li>Latest Tool: {latest?.tool_used ?? 'none'}</li>
        <li>Debug Console: F1</li>
      </ul>
    </aside>
  );
}
