(function () {
  const mountNode = document.getElementById('scenario-lab-root');
  if (!mountNode) {
    return;
  }

  const scenarios = [
    {
      id: 'base-case',
      title: 'Base Case',
      tag: 'Default',
      summary: 'Placeholder baseline using the cloned Wealth App assumptions with no extra shocks applied.',
      config: {
        'Portfolio return bias': '+0.0% adjustment',
        'Living cost pressure': 'Baseline placeholder',
        'Retirement timing': 'Current simulator values',
      },
    },
    {
      id: 'energy-shock',
      title: 'Energy Shock',
      tag: 'Placeholder',
      summary: 'Local-only scenario preset for future cost-of-living stress tests. No external macro feed is connected.',
      config: {
        'Portfolio return bias': '-1.0% placeholder',
        'Living cost pressure': '+12% placeholder',
        'Retirement timing': 'No automatic change yet',
      },
    },
    {
      id: 'early-retirement-push',
      title: 'Early Retirement Push',
      tag: 'Placeholder',
      summary: 'Sandbox preset to explore retiring sooner. Values are illustrative placeholders only for UI scaffolding.',
      config: {
        'Portfolio return bias': '-0.5% placeholder',
        'Living cost pressure': '+4% placeholder',
        'Retirement timing': 'Bring forward by 2 years',
      },
    },
    {
      id: 'cash-buffer-defense',
      title: 'Cash Buffer Defense',
      tag: 'Placeholder',
      summary: 'Extra local preset to reserve more cash before drawdown modelling is wired up in future iterations.',
      config: {
        'Portfolio return bias': '-0.2% placeholder',
        'Living cost pressure': '+2% placeholder',
        'Retirement timing': 'Hold current timing',
      },
    },
  ];

  let activeScenarioId = 'base-case';

  const render = () => {
    const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) || scenarios[0];
    mountNode.innerHTML = `
      <div class="scenario-lab-shell">
        <section class="scenario-lab-badge" aria-label="Experimental wealth simulation sandbox banner">
          <div class="scenario-lab-badge__eyebrow">Experimental sandbox</div>
          <h1 class="scenario-lab-badge__title">Wealth Simulation Scenarios</h1>
          <p class="scenario-lab-badge__text">
            This app is a separate scenario lab cloned from the stable Wealth App. Presets and config below are local/static placeholders for future modelling only.
          </p>
        </section>
        <aside class="scenario-lab-panel" aria-label="Scenario presets and local configuration scaffold">
        <div class="scenario-lab-panel__eyebrow">Scenario lab</div>
        <h2 class="scenario-lab-panel__title">Scenario Presets</h2>
        <p class="scenario-lab-panel__description">
          Select a preset to annotate the simulation with sandbox assumptions. The underlying calculator remains the cloned Wealth App for now.
        </p>
        <div class="scenario-lab-panel__grid">
          ${scenarios
            .map(
              (scenario) => `
                <button
                  type="button"
                  class="scenario-card${scenario.id === activeScenario.id ? ' is-active' : ''}"
                  data-scenario-id="${scenario.id}"
                >
                  <div class="scenario-card__eyebrow">Scenario preset</div>
                  <div class="scenario-card__title-row">
                    <h3 class="scenario-card__title">${scenario.title}</h3>
                    <span class="scenario-card__pill">${scenario.tag}</span>
                  </div>
                  <p class="scenario-card__summary">${scenario.summary}</p>
                </button>
              `
            )
            .join('')}
        </div>
        <section class="scenario-config" aria-label="Selected scenario configuration scaffold">
          <div class="scenario-lab-panel__eyebrow">Scenario config</div>
          <h3 class="scenario-config__title">${activeScenario.title}</h3>
          <div class="scenario-config__list">
            ${Object.entries(activeScenario.config)
              .map(
                ([label, value]) => `
                  <div class="scenario-config__row">
                    <div class="scenario-config__label">${label}</div>
                    <div class="scenario-config__value">${value}</div>
                  </div>
                `
              )
              .join('')}
          </div>
          <p class="scenario-config__hint" style="margin-top: 12px;">
            Placeholder only: these values currently label sandbox assumptions and do not claim backend, macro, or cloud integration.
          </p>
        </section>
        <div class="scenario-lab-toast">
          Active preset: <strong>${activeScenario.title}</strong>. Future shared helper extraction can happen later once the sandbox proves stable.
        </div>
      </aside>
      </div>
    `;

    mountNode.querySelectorAll('[data-scenario-id]').forEach((button) => {
      button.addEventListener('click', () => {
        activeScenarioId = button.getAttribute('data-scenario-id') || 'base-case';
        render();
      });
    });
  };

  render();
})();
