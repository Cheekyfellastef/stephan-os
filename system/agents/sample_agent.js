export const sampleAgent = {
  id: "system-observer",

  subscribeEvents: [
    "module:loaded",
    "workspace:opened"
  ],

  handleEvent(payload, context) {
    const task = {
      id: `system-observer-${Date.now()}`,
      agent: "system-observer",
      execute() {
        console.log("Agent observed event:", payload);
      }
    };

    context.services.getService("taskQueue").addTask(task);
  }
};
