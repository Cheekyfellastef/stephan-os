import { useState } from 'react';
import { parseCommand } from '../ai/commandParser';
import { sendPrompt } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';

export function useAIConsole() {
  const [input, setInput] = useState('');
  const {
    commandHistory,
    setCommandHistory,
    setIsBusy,
    setStatus,
    setLastRoute,
    setDebugData,
  } = useAIStore();

  async function submitPrompt(rawPrompt) {
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    if (prompt === '/clear') {
      clearConsole();
      return;
    }

    const parsed = parseCommand(prompt);
    const startedAt = performance.now();

    setIsBusy(true);
    setStatus('processing');

    try {
      const { data, requestPayload } = await sendPrompt({ prompt });
      const entry = {
        id: `cmd_${Date.now()}`,
        raw_input: prompt,
        parsed_command: parsed,
        route: data.route,
        tool_used: data.tools_used?.[0] ?? null,
        success: data.success,
        output_text: data.output_text,
        data_payload: data.data,
        timing_ms: data.timing_ms ?? Math.round(performance.now() - startedAt),
        timestamp: new Date().toISOString(),
        error: data.error,
        response: data,
      };

      setCommandHistory((prev) => [...prev, entry]);
      setLastRoute(data.route || 'assistant');
      setStatus(data.success ? 'ok' : 'error');
      setDebugData({
        request_payload: requestPayload,
        response_payload: data,
        parsed_command: parsed,
        selected_route: data.route,
        selected_tool: data.tools_used?.[0] ?? null,
        tool_state: data.debug?.tool_state,
        graph_action: data.debug?.graph_action,
        simulation_action: data.debug?.simulation_action,
        simulation_id: data.data?.simulationId ?? null,
        validated_input: data.data?.input ?? null,
        tool_args: data.debug?.tool_args,
        result_summary: data.debug?.result_summary,
        storage_outcome: data.debug?.storage_outcome,
        memory_hits: data.memory_hits,
        timing_ms: entry.timing_ms,
        tool_timing_ms: data.debug?.tool_timing_ms,
        error: data.error,
      });
    } catch (error) {
      setStatus('error');
      setDebugData({ parsed_command: parsed, error: error.message });
    } finally {
      setIsBusy(false);
    }
  }

  function clearConsole() {
    setCommandHistory([]);
    setStatus('idle');
    setLastRoute('assistant');
    setDebugData({});
    setInput('');
  }

  return {
    input,
    setInput,
    commandHistory,
    submitPrompt,
    clearConsole,
  };
}
