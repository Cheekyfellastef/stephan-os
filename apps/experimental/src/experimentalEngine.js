import { parseIntent } from './intentParser.js';
import { decomposeIntent } from './decompositionEngine.js';
import { generateSystemStructure } from './systemGenerator.js';
import { runSandboxSimulation } from './simulationRunner.js';

function buildEvaluation({ intent, blueprint, simulation }) {
  const metrics = simulation?.metrics || {};
  const riskCount = (metrics.riskAreas || []).length;
  const missingCount = (metrics.missingComponents || []).length;

  return {
    summary: riskCount === 0 && missingCount === 0
      ? 'Simulation suggests the generated system is operationally complete.'
      : 'Simulation surfaced follow-up work before production readiness.',
    readinessScore: Math.max(0, (metrics.completeness || 0) - riskCount * 10 - missingCount * 5),
    highlights: {
      completeness: metrics.completeness || 0,
      riskCount,
      missingCount,
      simulationCoreStatus: simulation?.simulationCoreStatus || 'unknown',
      providerMode: simulation?.providerMode || 'unknown'
    },
    generatedAt: new Date().toISOString()
  };
}

export async function runExperimentalCycle({ inputText, previousState, refinement }) {
  console.info('[Experimental] cycle starting');

  const intent = parseIntent(inputText, previousState?.intentModel);
  console.info('[Experimental] intent parsed', { intentId: intent.id, iteration: intent.iteration });

  const blueprint = decomposeIntent(intent, refinement);
  console.info('[Experimental] blueprint built', { layers: blueprint.layers.length });

  const generation = generateSystemStructure(blueprint);
  console.info('[Experimental] generation built', { files: generation.files.length });

  const simulation = await runSandboxSimulation({ intent, decomposition: blueprint, generatedSystem: generation });
  console.info('[Experimental] simulation run', {
    durationMs: simulation.durationMs,
    simulationCoreStatus: simulation.simulationCoreStatus
  });

  const evaluation = buildEvaluation({ intent, blueprint, simulation });
  console.info('[Experimental] evaluation built', { readinessScore: evaluation.readinessScore });

  return {
    intentModel: intent,
    blueprint,
    generation,
    simulation,
    evaluation,
    iterationCount: (previousState?.iterationCount || 0) + 1
  };
}
