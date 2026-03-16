export function createTaskScheduler(context) {
  const queue = context.services.getService("taskQueue");

  function runNextTask() {
    const task = queue.getNextTask();

    if (!task) return;

    try {
      task.execute(context);
      context.eventBus.emit("task:completed", task.id);
    } catch (err) {
      context.eventBus.emit("task:failed", task.id);
    }
  }

  setInterval(runNextTask, 1000);

  return {
    runNextTask
  };
}
