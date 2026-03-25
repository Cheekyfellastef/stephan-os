import { parseIntent } from './intentParser.js';
import { decomposeIntent } from './decompositionEngine.js';
import { generateSystemStructure } from './systemGenerator.js';
import { runSandboxSimulation } from './simulationRunner.js';

export async function runExperimentalCycle({ inputText, previousState, refinement }) {
  const intent = parseIntent(inputText, previousState?.intent);
  const decomposition = decomposeIntent(intent, refinement);
  const generation = generateSystemStructure(decomposition);
  const simulation = await runSandboxSimulation({ intent, decomposition, generatedSystem: generation });

  return {
    intent,
    decomposition,
    generation,
    simulation,
    iterationCount: (previousState?.iterationCount || 0) + 1
  };
}
