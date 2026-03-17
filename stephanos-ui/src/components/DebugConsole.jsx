import { useAIStore } from '../state/aiStore';

export default function DebugConsole() {
  const { debugVisible, debugData } = useAIStore();
  if (!debugVisible) return null;

  return (
    <section className="debug-console panel">
      <h2>Developer Debug Console</h2>
      <div className="debug-grid">
        <div><strong>Request</strong><pre>{JSON.stringify({ request_id: debugData.response_payload?.debug?.request_id, parsed_command: debugData.parsed_command }, null, 2)}</pre></div>
        <div><strong>Routing</strong><pre>{JSON.stringify({ subsystem: debugData.selected_subsystem, route: debugData.selected_route, tool: debugData.selected_tool, subsystem_state: debugData.subsystem_state }, null, 2)}</pre></div>
        <div><strong>Execution</strong><pre>{JSON.stringify({ execution_payload: debugData.execution_payload, simulation_id: debugData.simulation_id, validated_input: debugData.validated_input, storage_outcome: debugData.storage_outcome }, null, 2)}</pre></div>
        <div><strong>Result</strong><pre>{JSON.stringify({ result_summary: debugData.result_summary, timing_ms: debugData.timing_ms, tool_timing_ms: debugData.tool_timing_ms }, null, 2)}</pre></div>
        <div><strong>Memory</strong><pre>{JSON.stringify({ memory_hits: debugData.memory_hits }, null, 2)}</pre></div>
        <div><strong>Errors</strong><pre>{JSON.stringify({ error_code: debugData.error_code, error: debugData.error }, null, 2)}</pre></div>
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
