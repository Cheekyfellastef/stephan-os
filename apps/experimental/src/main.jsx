import { runExperimentalCycle } from './experimentalEngine.js';
import { renderEvaluationPanel } from './evaluationPanel.jsx';

const state = {
  run: null,
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

function renderRun(run) {
  if (!run) {
    return '<section class="panel"><h3>No simulation run yet</h3><p>Enter intent and press <strong>Run Experimental Cycle</strong>.</p></section>';
  }

  return `
    <section class="panel">
      <h3>Intent</h3>
      ${jsonBlock(run.intent)}
    </section>
    <section class="panel">
      <h3>Decomposition</h3>
      ${jsonBlock(run.decomposition)}
    </section>
    <section class="panel">
      <h3>Generated System</h3>
      ${jsonBlock(run.generation)}
    </section>
    ${renderEvaluationPanel(run.simulation)}
  `;
}

function bind() {
  const app = document.getElementById('app');
  const input = document.getElementById('intent-input');
  const status = document.getElementById('run-status');

  const refresh = () => {
    const runHtml = renderRun(state.run);
    const target = document.getElementById('results');
    if (target) target.innerHTML = runHtml;

    if (status) {
      status.textContent = state.run
        ? `Iteration ${state.run.iterationCount} complete · ${state.run.simulation.durationMs}ms`
        : 'Idle';
    }
  };

  document.getElementById('run-btn')?.addEventListener('click', async () => {
    const inputText = input?.value || '';
    status.textContent = 'Running simulation...';
    state.run = await runExperimentalCycle({
      inputText,
      previousState: state.run,
      refinement: state.refinement
    });
    refresh();
  });

  document.getElementById('rerun-btn')?.addEventListener('click', async () => {
    if (!state.run) return;
    status.textContent = 'Re-running with refinements...';

    const keys = Object.keys(state.refinement);
    keys.forEach((key) => {
      const field = document.getElementById(`refine-${key}`);
      state.refinement[key] = field?.value || '';
    });

    state.run = await runExperimentalCycle({
      inputText: input?.value || state.run.intent.raw,
      previousState: state.run,
      refinement: state.refinement
    });
    refresh();
  });

  app?.classList.add('ready');
  refresh();
}

bind();
