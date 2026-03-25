function tag(label, tone = 'neutral') {
  return `<span class="badge badge-${tone}">${label}</span>`;
}

export function renderEvaluationPanel(result) {
  const metrics = result?.metrics || {};
  const missing = (metrics.missingComponents || []).map((item) => `<li>${item}</li>`).join('') || '<li>none</li>';
  const risks = (metrics.riskAreas || []).map((item) => `<li>${item}</li>`).join('') || '<li>none</li>';
  const ideas = (metrics.suggestedImprovements || []).map((item) => `<li>${item}</li>`).join('') || '<li>none</li>';

  const completenessTone = (metrics.completeness || 0) >= 75 ? 'good' : 'warn';

  return `
    <section class="panel">
      <h3>Evaluation</h3>
      <div class="metrics-row">
        ${tag(`Completeness ${metrics.completeness || 0}%`, completenessTone)}
        ${tag(`Simulation core: ${result?.simulationCoreStatus || 'unknown'}`, result?.simulationCoreStatus === 'reachable' ? 'good' : 'warn')}
        ${tag(`Runtime route truth: ${result?.routeSimulation?.finalRouteTruth?.routeKind || 'unknown'}`)}
      </div>
      <div class="panel-grid">
        <article>
          <h4>Missing Components</h4>
          <ul>${missing}</ul>
        </article>
        <article>
          <h4>Risk Areas</h4>
          <ul>${risks}</ul>
        </article>
        <article>
          <h4>Suggested Improvements</h4>
          <ul>${ideas}</ul>
        </article>
      </div>
    </section>
  `;
}
