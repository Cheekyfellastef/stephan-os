import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

export default function RuntimeFingerprintPanel({ runtimeFingerprint }) {
  const { uiLayout, togglePanel } = useAIStore();

  return (
    <CollapsiblePanel
      panelId="missionFingerprintPanel"
      title="Mission Control Fingerprint"
      description="Runtime identity, route source, and launch target truth for this Mission Control pane."
      className="runtime-fingerprint-panel"
      isOpen={uiLayout.missionFingerprintPanel}
      onToggle={() => togglePanel('missionFingerprintPanel')}
    >
      <ul>
        <li><b>role:</b> {runtimeFingerprint.runtimeRole}</li>
        <li><b>route/source:</b> {runtimeFingerprint.routeSourceLabel}</li>
        <li><b>build:</b> <code>{runtimeFingerprint.buildFingerprint}</code></li>
        <li><b>commit:</b> <code>{runtimeFingerprint.commitHash}</code></li>
        <li><b>built:</b> {runtimeFingerprint.buildTimestamp}</li>
        <li><b>origin:</b> <code>{runtimeFingerprint.currentOrigin}</code></li>
        <li><b>pathname:</b> <code>{runtimeFingerprint.currentPathname}</code></li>
        <li><b>expected root:</b> <code>{runtimeFingerprint.expectedRootLauncherUrl}</code></li>
        <li><b>expected dist:</b> <code>{runtimeFingerprint.expectedMissionControlDistUrl}</code></li>
      </ul>
    </CollapsiblePanel>
  );
}
