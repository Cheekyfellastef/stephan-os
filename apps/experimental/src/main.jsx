import { runExperimentalCycle } from './experimentalEngine.js';
import { renderEvaluationPanel } from './evaluationPanel.jsx';
import { EXPERIMENTAL_EXPERIENCES, resolveExperienceLaunchUrl } from './experienceRegistry.js';

const state = {
  cycle: {
    phase: 'idle',
    input: '',
    intentModel: null,
    blueprint: null,
    generation: null,
    simulation: null,
    evaluation: null,
    error: null,
    validationMessage: null,
    lastRunAt: null,
    iterationCount: 0
  },
  refinement: {
    frontend: '',
    backend: '',
    routing: '',
    providers: '',
    persistence: '',
    ui_ux: ''
  }
};

function jsonBlock(data) {
  return `<pre>${JSON.stringify(data, null, 2)}</pre>`;
}

function renderCycleResult(cycle) {
  if (cycle.phase === 'idle') {
    return '<section class="panel"><h3>No simulation run yet</h3><p>Enter intent and press <strong>Run Experimental Cycle</strong>.</p></section>';
  }

  if (cycle.phase === 'running') {
    return '<section class="panel"><h3>Running experimental cycle…</h3><p class="muted">Intent parsing, blueprint generation, simulation, and evaluation are in progress.</p></section>';
  }

  if (cycle.validationMessage) {
    return `
      <section class="panel">
        <h3>Input Validation</h3>
        <p>${cycle.validationMessage}</p>
      </section>
    `;
  }

  if (cycle.phase === 'error') {
    return `
      <section class="panel">
        <h3>Cycle Error</h3>
        <p>${cycle.error || 'Unknown execution error.'}</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <h3>Intent</h3>
      ${jsonBlock(cycle.intentModel)}
    </section>
    <section class="panel">
      <h3>Blueprint</h3>
      ${jsonBlock(cycle.blueprint)}
    </section>
    <section class="panel">
      <h3>Generated System</h3>
      ${jsonBlock(cycle.generation)}
    </section>
    <section class="panel">
      <h3>Evaluation Summary</h3>
      ${jsonBlock(cycle.evaluation)}
    </section>
    ${renderEvaluationPanel(cycle.simulation)}
  `;
}

function formatStatus(cycle) {
  if (cycle.phase === 'running') return 'Running experimental cycle…';
  if (cycle.phase === 'complete') {
    return `Complete · Iteration ${cycle.iterationCount} · ${cycle.simulation?.durationMs || 0}ms`;
  }
  if (cycle.phase === 'error') return 'Error';
  return 'Idle';
}


function renderExperienceList() {
  return EXPERIMENTAL_EXPERIENCES.map((experience) => `
    <article class="experience-card">
      <h3>${experience.name}</h3>
      <p class="muted">${experience.description}</p>
      <a class="experience-launch" href="${resolveExperienceLaunchUrl(experience)}" data-experience-id="${experience.id}">Launch Lab</a>
    </article>
  `).join('');
}

function bind() {
  const app = document.getElementById('app');
  const input = document.getElementById('intent-input');
  const status = document.getElementById('run-status');
  const experienceList = document.getElementById('experience-list');

  const refresh = () => {
    const cycle = state.cycle;
    const runHtml = renderCycleResult(cycle);
    const target = document.getElementById('results');
    if (target) target.innerHTML = runHtml;

    if (status) status.textContent = formatStatus(cycle);
  };

  const startCycle = async ({ inputText, preservePrevious = true }) => {
    console.info('[Experimental] button clicked', { action: preservePrevious ? 'run' : 'rerun' });
    const normalizedInput = String(inputText || '').trim();

    if (!normalizedInput) {
      state.cycle = {
        ...state.cycle,
        phase: 'error',
        input: normalizedInput,
        validationMessage: 'Intent input is required before running the experimental cycle.',
        error: null
      };
      console.warn('[Experimental] cycle failed: validation', { reason: state.cycle.validationMessage });
      refresh();
      return;
    }

    state.cycle = {
      ...state.cycle,
      phase: 'running',
      input: normalizedInput,
      validationMessage: null,
      error: null
    };
    refresh();

    try {
      const output = await runExperimentalCycle({
        inputText: normalizedInput,
        previousState: preservePrevious ? state.cycle : null,
        refinement: state.refinement
      });

      state.cycle = {
        ...state.cycle,
        phase: 'complete',
        intentModel: output.intentModel,
        blueprint: output.blueprint,
        generation: output.generation,
        simulation: output.simulation,
        evaluation: output.evaluation,
        iterationCount: output.iterationCount,
        lastRunAt: new Date().toISOString(),
        error: null,
        validationMessage: null
      };
      console.info('[Experimental] cycle completed', {
        iterationCount: state.cycle.iterationCount,
        durationMs: state.cycle.simulation?.durationMs
      });
    } catch (error) {
      state.cycle = {
        ...state.cycle,
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
        validationMessage: null,
        lastRunAt: new Date().toISOString()
      };
      console.error('[Experimental] cycle failed', error);
    }

    refresh();
  };

  document.getElementById('run-btn')?.addEventListener('click', async () => {
    await startCycle({ inputText: input?.value || '', preservePrevious: true });
  });

  document.getElementById('rerun-btn')?.addEventListener('click', async () => {
    const keys = Object.keys(state.refinement);
    keys.forEach((key) => {
      const field = document.getElementById(`refine-${key}`);
      state.refinement[key] = field?.value || '';
    });

    const fallbackInput = state.cycle.intentModel?.raw || '';
    await startCycle({ inputText: input?.value || fallbackInput, preservePrevious: true });
  });

  if (experienceList) {
    experienceList.innerHTML = renderExperienceList();
  }

  app?.classList.add('ready');
  refresh();
}

bind();
