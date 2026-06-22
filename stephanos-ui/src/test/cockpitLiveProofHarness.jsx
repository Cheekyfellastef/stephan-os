import React, { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import CockpitPanel from '../components/CockpitPanel.jsx';
import { AIStoreProvider, useAIStore } from '../state/aiStore.js';

function ProofHarness() {
  const { setLastExecutionMetadata } = useAIStore();
  useEffect(() => {
    setLastExecutionMetadata({
      command_deck_universal_intake_routed_to: 'evidence-return-intake',
      command_deck_cumulative_accepted_proof_items: 'mission-console-bridge',
      command_deck_cumulative_rejected_proof_items: '',
    });
    window.__acceptBuildProof = () => setLastExecutionMetadata({
      command_deck_universal_intake_routed_to: 'evidence-return-intake',
      command_deck_universal_intake_accepted_proof_items: 'build-proof',
      command_deck_cumulative_accepted_proof_items: 'mission-console-bridge|build-proof',
      command_deck_cumulative_rejected_proof_items: '',
    });
  }, [setLastExecutionMetadata]);
  return <CockpitPanel forceOpen standalone />;
}

createRoot(document.getElementById('root')).render(
  <AIStoreProvider>
    <ProofHarness />
  </AIStoreProvider>,
);
