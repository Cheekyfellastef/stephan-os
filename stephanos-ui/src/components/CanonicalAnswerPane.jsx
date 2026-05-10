import CommandResultCard from './CommandResultCard';

export default function CanonicalAnswerPane({ commandHistory = [] }) {
  if (!Array.isArray(commandHistory) || commandHistory.length === 0) {
    return <p className="muted">Ready. Ask Stephanos anything.</p>;
  }
  return commandHistory.map((entry) => <CommandResultCard key={entry.id} entry={entry} />);
}
