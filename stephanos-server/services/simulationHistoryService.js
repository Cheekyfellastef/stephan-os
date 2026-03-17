import { createError, ERROR_CODES } from './errors.js';
import { makeId, nowIso } from './storageUtils.js';
import { simulationHistoryStore } from './simulationHistoryStore.js';
import { activityLogService } from './activityLogService.js';

class SimulationHistoryService {
  list() {
    return simulationHistoryStore.readRuns().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  recordRun({ simulationId, input, result, timingMs, presetName = null }) {
    const runs = simulationHistoryStore.readRuns();
    const run = {
      run_id: makeId('simrun'),
      simulation_id: simulationId,
      input,
      output_summary: { final_value: result?.summary?.finalValue ?? null, headline: result?.summary?.headline ?? null },
      timing_ms: timingMs,
      timestamp: nowIso(),
      preset_name: presetName,
      raw_result: result,
    };
    runs.push(run);
    simulationHistoryStore.writeRuns(runs);
    activityLogService.record({ type: 'simulation_run_executed', subsystem: 'simulation_history', summary: `Simulation ${simulationId} executed (${run.run_id}).`, payload: { run_id: run.run_id, simulation_id: simulationId } });
    return run;
  }

  getByRunId(runId) {
    const run = this.list().find((entry) => entry.run_id === runId);
    if (!run) throw createError(ERROR_CODES.SIM_HISTORY_NOT_FOUND, `Simulation run '${runId}' was not found.`, { status: 404 });
    return run;
  }

  clear() {
    simulationHistoryStore.writeRuns([]);
    return { cleared: true };
  }

  compare(runIdA, runIdB) {
    const a = this.getByRunId(runIdA);
    const b = this.getByRunId(runIdB);
    if (!a || !b) throw createError(ERROR_CODES.SIM_COMPARE_INVALID, 'Both run IDs are required for comparison.');
    const finalA = Number(a.output_summary.final_value ?? 0);
    const finalB = Number(b.output_summary.final_value ?? 0);
    return {
      run_a: { run_id: a.run_id, simulation_id: a.simulation_id, timing_ms: a.timing_ms },
      run_b: { run_id: b.run_id, simulation_id: b.simulation_id, timing_ms: b.timing_ms },
      input_differences: Object.keys({ ...a.input, ...b.input }).reduce((acc, key) => {
        if (a.input?.[key] !== b.input?.[key]) acc[key] = { a: a.input?.[key] ?? null, b: b.input?.[key] ?? null };
        return acc;
      }, {}),
      output_differences: { final_value_delta: finalB - finalA, headline_a: a.output_summary.headline, headline_b: b.output_summary.headline },
      timing_delta_ms: b.timing_ms - a.timing_ms,
      summary: `Compared ${runIdA} vs ${runIdB}; final value delta=${finalB - finalA}, timing delta=${b.timing_ms - a.timing_ms}ms.`,
    };
  }

  getStatus() {
    return { state: 'live', ...simulationHistoryStore.getStatus() };
  }
}

export const simulationHistoryService = new SimulationHistoryService();
