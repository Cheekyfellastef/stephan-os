import { requireFiniteNumber } from '../simulationTypes.js';

function validateInput(input = {}) {
  return {
    startValue: requireFiniteNumber(input.startValue, 'startValue', { min: 0 }),
    monthlyContribution: requireFiniteNumber(input.monthlyContribution, 'monthlyContribution', { min: 0 }),
    annualRate: requireFiniteNumber(input.annualRate, 'annualRate', { min: -1, max: 1 }),
    years: requireFiniteNumber(input.years, 'years', { min: 1, max: 100 }),
  };
}

export const trajectoryDemoSimulation = {
  id: 'trajectory-demo',
  name: 'Trajectory Demo',
  description: 'Deterministic monthly compound-growth sandbox with yearly snapshots.',
  category: 'numerical',
  state: 'live',
  input_schema: {
    startValue: 'number >= 0',
    monthlyContribution: 'number >= 0',
    annualRate: 'number between -1 and 1',
    years: 'integer-like number between 1 and 100',
  },
  output_schema: {
    finalValue: 'number',
    yearlySnapshots: 'array<{ year, value, totalContributions, interestEarned }>',
    formula: 'string',
  },
  validateInput,
  execute(input) {
    const validated = validateInput(input);
    const monthlyRate = validated.annualRate / 12;
    const totalMonths = Math.trunc(validated.years * 12);

    let value = validated.startValue;
    const yearlySnapshots = [];

    for (let month = 1; month <= totalMonths; month += 1) {
      value = (value * (1 + monthlyRate)) + validated.monthlyContribution;

      if (month % 12 === 0) {
        const year = month / 12;
        const totalContributions = validated.startValue + (validated.monthlyContribution * month);
        yearlySnapshots.push({
          year,
          value: Number(value.toFixed(2)),
          totalContributions: Number(totalContributions.toFixed(2)),
          interestEarned: Number((value - totalContributions).toFixed(2)),
        });
      }
    }

    return {
      model: 'monthly_compound_growth',
      formula: 'value_next = value_current * (1 + annualRate / 12) + monthlyContribution',
      monthsSimulated: totalMonths,
      finalValue: Number(value.toFixed(2)),
      yearlySnapshots,
    };
  },
};
