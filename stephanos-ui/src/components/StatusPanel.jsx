import { useAIStore } from '../state/aiStore';

export default function StatusPanel() {
  const { status, isBusy, lastRoute, commandHistory, apiStatus } = useAIStore();
  const latest = commandHistory[commandHistory.length - 1];
  const proposalStats = commandHistory.findLast((entry) => entry.data_payload?.stats)?.data_payload?.stats;
  const roadmapSummary = commandHistory.findLast((entry) => entry.data_payload?.summary)?.data_payload?.summary;

  return (
    <aside className="status-panel panel">
      <h2>Status</h2>
      <ul>
        <li>Backend: {apiStatus.label}</li>
        <li>API URL: {apiStatus.baseUrl || 'n/a'}</li>
        <li>API Health: {apiStatus.state}</li>
        <li>Execution: {isBusy ? 'busy' : status}</li>
        <li>Route: {lastRoute}</li>
        <li>Commands: {commandHistory.length}</li>
        <li>Latest Tool: {latest?.tool_used ?? 'none'}</li>
        <li>Pending Proposals: {proposalStats?.pending ?? 'n/a'}</li>
        <li>Roadmap Open: {roadmapSummary?.open ?? 'n/a'}</li>
        <li>Debug Console: F1</li>
      </ul>
      <p className={`api-banner ${apiStatus.state}`}>{apiStatus.detail}</p>
    </aside>
  );
}
