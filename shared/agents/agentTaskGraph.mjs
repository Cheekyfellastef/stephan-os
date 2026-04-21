function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value = '') {
  return String(value ?? '').trim();
}

export function buildAgentTaskGraph({ missionModel = {} } = {}) {
  const tasks = asArray(missionModel.tasks);
  const goals = asArray(missionModel.goals);
  const handoffs = asArray(missionModel.handoffs);

  const taskById = new Map(tasks.map((task) => [task.taskId, task]));
  const tasksByGoal = new Map();
  const childrenByTask = new Map();

  for (const task of tasks) {
    if (task.parentGoalId) {
      const existing = tasksByGoal.get(task.parentGoalId) || [];
      existing.push(task.taskId);
      tasksByGoal.set(task.parentGoalId, existing);
    }
    if (task.parentTaskId) {
      const existing = childrenByTask.get(task.parentTaskId) || [];
      existing.push(task.taskId);
      childrenByTask.set(task.parentTaskId, existing);
    }
  }

  const ownership = tasks.reduce((acc, task) => {
    const owner = asText(task.assignedAgentId, 'unassigned');
    acc[owner] = (acc[owner] || 0) + 1;
    return acc;
  }, {});

  return {
    goals: goals.map((goal) => ({
      goalId: goal.goalId,
      linkedTaskIds: tasksByGoal.get(goal.goalId) || [],
    })),
    tasksByGoal: Object.fromEntries(tasksByGoal.entries()),
    childrenByTask: Object.fromEntries(childrenByTask.entries()),
    taskById,
    handoffChains: handoffs.map((handoff) => ({
      handoffId: handoff.handoffId,
      taskId: handoff.taskId,
      fromAgentId: handoff.fromAgentId,
      toAgentId: handoff.toAgentId,
      state: handoff.state,
    })),
    ownership,
  };
}
