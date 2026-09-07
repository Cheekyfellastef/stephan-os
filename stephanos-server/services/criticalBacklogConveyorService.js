import { SELF_HOSTING_CRITICAL_BACKLOG } from '../../shared/agents/criticalBacklogGoalBuildingBootstrapV1.mjs';
import {
  CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
  ELASTIC_GOAL_BUILD_IGNITION_SCHEMA,
  dispatchElasticGoalBuilds,
  ensureCriticalBacklogMission as ensureCriticalBacklogMissionCore,
  publishCriticalBacklogProjection,
  resolveCriticalBacklogRuntimePaths,
} from './criticalBacklogConveyorServiceCore.js';

export {
  CRITICAL_BACKLOG_CONVEYOR_SERVICE_SCHEMA,
  ELASTIC_GOAL_BUILD_IGNITION_SCHEMA,
  dispatchElasticGoalBuilds,
  publishCriticalBacklogProjection,
  resolveCriticalBacklogRuntimePaths,
};

export async function ensureCriticalBacklogMission(options = {}) {
  const normalized = options && typeof options === 'object' ? options : {};
  return ensureCriticalBacklogMissionCore({
    ...normalized,
    backlog: normalized.backlog ?? SELF_HOSTING_CRITICAL_BACKLOG,
  });
}
