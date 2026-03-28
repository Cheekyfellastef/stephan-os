export function createIgnitionPlan(decision) {
  const needsRebuild = true;
  return {
    runPreflight: true,
    needsRebuild,
    runVerify: true,
    runServe: true,
  };
}

export async function runIgnitionPlan({
  preflightState,
  runPreflight = async () => {},
  runBuild,
  runVerify,
  runServe,
}) {
  const plan = createIgnitionPlan(preflightState.decision);

  if (plan.runPreflight) {
    await runPreflight();
  }

  if (plan.needsRebuild) {
    await runBuild();
  }

  await runVerify();
  await runServe();
}
