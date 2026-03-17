import { useState } from 'react';
import { parseCommand, getLocalCommandResponse } from '../ai/commandParser';
import { sendPrompt } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';

export function useAIConsole() {
  const [input, setInput] = useState('');
  const {
    setIsBusy,
    setStatus,
    setLastRoute,
    chatHistory,
    setChatHistory,
    setDebugData,
  } = useAIStore();

  async function submitPrompt(rawPrompt) {
    const prompt = rawPrompt.trim();
    if (!prompt) return;

    const parsed = parseCommand(prompt);
    const startedAt = performance.now();

    setIsBusy(true);
    setStatus('processing');

    setChatHistory((prev) => [...prev, { role: 'user', text: prompt }]);

    const localResponse = getLocalCommandResponse(parsed);
    if (localResponse) {
      setChatHistory((prev) => [...prev, { role: 'assistant', text: localResponse }]);
      setStatus('ok');
      setIsBusy(false);
      setDebugData({
        parsed_command: parsed,
        selected_route: 'command',
        timing_ms: Math.round(performance.now() - startedAt),
      });
      return;
    }

    try {
      const { data, requestPayload } = await sendPrompt({ prompt, parsedCommand: parsed });

      setChatHistory((prev) => [...prev, { role: 'assistant', text: data.output_text }]);
      setLastRoute(data.route || 'assistant');
      setStatus('ok');
      setDebugData({
        request_payload: requestPayload,
        response_payload: data,
        parsed_command: parsed,
        selected_route: data.route,
        tool_calls: data.tools_used,
        timing_ms: data?.debug?.timing_ms ?? Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      setChatHistory((prev) => [
        ...prev,
        { role: 'assistant', text: `Error: ${error.message}` },
      ]);
      setStatus('error');
      setDebugData({
        parsed_command: parsed,
        error: error.message,
        timing_ms: Math.round(performance.now() - startedAt),
      });
    } finally {
      setIsBusy(false);
    }
  }

  function clearConsole() {
    setChatHistory([]);
    setStatus('idle');
    setLastRoute('assistant');
    setDebugData({});
    setInput('');
  }

  return {
    input,
    setInput,
    chatHistory,
    submitPrompt,
    clearConsole,
  };
}
