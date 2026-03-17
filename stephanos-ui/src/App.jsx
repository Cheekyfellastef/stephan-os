import AIConsole from './components/AIConsole';
import StatusPanel from './components/StatusPanel';
import DebugConsole from './components/DebugConsole';
import { useAIConsole } from './hooks/useAIConsole';
import { useDebugConsole } from './hooks/useDebugConsole';

export default function App() {
  const { input, setInput, submitPrompt, clearConsole, chatHistory } = useAIConsole();
  useDebugConsole();

  return (
    <main className="app-shell">
      <AIConsole
        input={input}
        setInput={setInput}
        submitPrompt={submitPrompt}
        clearConsole={clearConsole}
        chatHistory={chatHistory}
      />
      <StatusPanel />
      <DebugConsole />
    </main>
  );
}
