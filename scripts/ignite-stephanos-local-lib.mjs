export function createIgnitionPlan(decision) {
  const needsRebuild = true;
  return {
    needsRebuild,
    runVerify: true,
    runServe: true,
  };
}

export async function runIgnitionPlan({
  preflightState,
  runBuild,
  runVerify,
  runServe,
}) {
  const plan = createIgnitionPlan(preflightState.decision);

  if (plan.needsRebuild) {
    await runBuild();
  }

  await runVerify();
  await runServe();
}
