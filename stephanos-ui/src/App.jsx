import AIConsole from './components/AIConsole';
import StatusPanel from './components/StatusPanel';
import DebugConsole from './components/DebugConsole';
import ToolsPanel from './components/ToolsPanel';
import MemoryPanel from './components/MemoryPanel';
import KnowledgeGraphPanel from './components/KnowledgeGraphPanel';
import { useAIConsole } from './hooks/useAIConsole';
import { useDebugConsole } from './hooks/useDebugConsole';

export default function App() {
  const { input, setInput, submitPrompt, commandHistory } = useAIConsole();
  useDebugConsole();

  return (
    <main className="app-shell">
      <AIConsole
        input={input}
        setInput={setInput}
        submitPrompt={submitPrompt}
        commandHistory={commandHistory}
      />
      <div className="side-stack">
        <StatusPanel />
        <ToolsPanel commandHistory={commandHistory} />
        <MemoryPanel commandHistory={commandHistory} />
        <KnowledgeGraphPanel commandHistory={commandHistory} />
      </div>
      <DebugConsole />
    </main>
  );
}
