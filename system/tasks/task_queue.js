export function createTaskQueue() {
  const queue = [];

  return {
    addTask(task) {
      queue.push(task);
    },

    getNextTask() {
      return queue.shift();
    },

    listTasks() {
      return queue;
    }
  };
}
