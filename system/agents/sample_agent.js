export const sampleAgent = {
  id: "system-observer",

  subscribeEvents: [
    "module:loaded",
    "workspace:opened"
  ],

  handleEvent(payload, context) {
    console.log("Agent observed event:", payload);
  }
};
