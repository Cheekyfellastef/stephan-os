const startingAssets = document.getElementById("starting-assets");
const monthlyContribution = document.getElementById("monthly-contribution");
const output = document.getElementById("projection-output");

function renderProjection() {

  const principal = Number(startingAssets.value);
  const contribution = Number(monthlyContribution.value);

  const years = 20;
  const rate = 0.05;

  let balance = principal;

  for (let i = 0; i < years * 12; i++) {
    balance += contribution;
    balance *= 1 + rate / 12;
  }

  output.textContent =
    "Estimated 20-year balance: £" +
    Math.round(balance).toLocaleString("en-GB");
}

startingAssets.addEventListener("input", renderProjection);
monthlyContribution.addEventListener("input", renderProjection);

renderProjection();
