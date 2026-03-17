import { useAIStore } from '../state/aiStore';

export default function DebugConsole() {
  const { debugVisible, debugData } = useAIStore();
  if (!debugVisible) return null;

  return (
    <section className="debug-console panel">
      <h2>Developer Debug Console</h2>
      <div className="debug-grid">
        <div><strong>Parsed Command</strong><pre>{JSON.stringify(debugData.parsed_command, null, 2)}</pre></div>
        <div><strong>Route / Tool</strong><pre>{JSON.stringify({ route: debugData.selected_route, tool: debugData.selected_tool, tool_state: debugData.tool_state }, null, 2)}</pre></div>
        <div><strong>Graph Action</strong><pre>{JSON.stringify({ graph_action: debugData.graph_action, tool_args: debugData.tool_args, storage_outcome: debugData.storage_outcome }, null, 2)}</pre></div>
        <div><strong>Result Summary</strong><pre>{JSON.stringify({ result_summary: debugData.result_summary, timing_ms: debugData.timing_ms, tool_timing_ms: debugData.tool_timing_ms }, null, 2)}</pre></div>
        <div><strong>Memory</strong><pre>{JSON.stringify({ memory_hits: debugData.memory_hits }, null, 2)}</pre></div>
        <div><strong>Errors</strong><pre>{JSON.stringify({ error: debugData.error }, null, 2)}</pre></div>
      </div>
      <details>
        <summary>Latest Request Payload</summary>
        <pre>{JSON.stringify(debugData.request_payload, null, 2)}</pre>
      </details>
      <details>
        <summary>Latest Response Payload</summary>
        <pre>{JSON.stringify(debugData.response_payload, null, 2)}</pre>
      </details>
    </section>
  );
}
