export function calculateTax(income) {

  const personalAllowance = 12570;
  const basicLimit = 50270;

  const taxable = Math.max(0, income - personalAllowance);

  const basicBand = Math.min(
    taxable,
    basicLimit - personalAllowance
  );

  return basicBand * 0.2;
}