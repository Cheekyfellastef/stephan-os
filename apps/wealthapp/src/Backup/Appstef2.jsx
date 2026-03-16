import { useState, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ReferenceArea
} from "recharts";

/* ---------------- TAX MODEL ---------------- */

function calculateTax(income) {
  const personalAllowance = 12570;
  const basicLimit = 50270;
  const basicRate = 0.2;

  const taxable = Math.max(0, income - personalAllowance);
  const basicBand = Math.min(
    taxable,
    basicLimit - personalAllowance
  );

  return basicBand * basicRate;
}

/* --------------- CORE ENGINE --------------- */

function projectGrowth({
  isaStart,
  dormantStart,
  activeStart,
  returnRate,
  annualActiveContribution,
  isaFromWages,
  isaFromPension,
  startAge,
  endAge,
  retirementAge,
  desiredIncome,
  statePensionAnnual,
  statePensionAge
}) {
  const data = [];

  let isa = isaStart;
  let uncrystallised = dormantStart;
  let crystallised = 0;
  let active = activeStart;
  let cumulativeStatePension = 0;

  for (let age = startAge; age <= endAge; age++) {

    /* ----- Growth ----- */
    isa *= 1 + returnRate;
    uncrystallised *= 1 + returnRate;
    crystallised *= 1 + returnRate;
    active *= 1 + returnRate;

    /* ----- BEFORE RETIREMENT ----- */
    if (age < retirementAge) {

      active += annualActiveContribution;

      /* ISA from wages */
      isa += isaFromWages;

      /* ISA from pension */
      if (isaFromPension > 0 && uncrystallised > 0) {
        const requiredCrystallisation =
          isaFromPension / 0.25;

        const actualCrystallisation = Math.min(
          requiredCrystallisation,
          uncrystallised
        );

        const taxFree = actualCrystallisation * 0.25;
        const taxable = actualCrystallisation * 0.75;

        uncrystallised -= actualCrystallisation;
        crystallised += taxable;
        isa += taxFree;
      }
    }

    /* ----- AFTER RETIREMENT ----- */
    if (age >= retirementAge) {

      const statePension =
        age >= statePensionAge ? statePensionAnnual : 0;

      if (statePension > 0) {
        cumulativeStatePension += statePension;
      }

      let incomeNeeded =
        Math.max(0, desiredIncome - statePension);

      /* 1️⃣ ISA first */
      const isaWithdrawal = Math.min(isa, incomeNeeded);
      isa -= isaWithdrawal;
      incomeNeeded -= isaWithdrawal;

      /* 2️⃣ Tax-free lump sum */
      if (incomeNeeded > 0 && uncrystallised > 0) {
        const requiredCrystallisation =
          incomeNeeded / 0.25;

        const actualCrystallisation = Math.min(
          requiredCrystallisation,
          uncrystallised
        );

        const taxFree = actualCrystallisation * 0.25;
        const taxable = actualCrystallisation * 0.75;

        uncrystallised -= actualCrystallisation;
        crystallised += taxable;

        incomeNeeded -= Math.min(taxFree, incomeNeeded);
      }

      /* 3️⃣ Taxable pension */
      if (incomeNeeded > 0 && crystallised + active > 0) {

        const taxableIncome =
          incomeNeeded + statePension;

        const tax = calculateTax(taxableIncome);

        const grossNeeded = incomeNeeded + tax;

        const available =
          crystallised + active;

        const withdrawal =
          Math.min(grossNeeded, available);

        const cShare =
          crystallised / available;

        const aShare =
          active / available;

        crystallised -= withdrawal * cShare;
        active -= withdrawal * aShare;
      }
    }

    const total =
      isa + uncrystallised + crystallised + active;

    data.push({
      age,
      ISA: Math.round(isa),
      DormantUncrystallised: Math.round(uncrystallised),
      DormantCrystallised: Math.round(crystallised),
      ActivePension: Math.round(active),
      Total: Math.round(Math.max(0, total)),
      CumulativeStatePension:
        Math.round(cumulativeStatePension)
    });
  }

  return data;
}

/* --------------- UI ---------------- */

export default function App() {

  const [isaStart, setIsaStart] = useState(0);
  const [dormantStart, setDormantStart] = useState(100000);
  const [activeStart, setActiveStart] = useState(0);

  const [returnRate, setReturnRate] = useState(0.045);
  const [annualActiveContribution, setAnnualActiveContribution] =
    useState(14426);

  const [isaFromWages, setIsaFromWages] = useState(5000);
  const [isaFromPension, setIsaFromPension] = useState(5000);

  const [desiredIncome, setDesiredIncome] =
    useState(40000);

  const [statePensionAnnual, setStatePensionAnnual] =
    useState(11500);

  const [statePensionAge, setStatePensionAge] =
    useState(67);

  const [retirementAge, setRetirementAge] =
    useState(60);

  const [startAge, setStartAge] = useState(55);
  const [endAge, setEndAge] = useState(100);

  const [widthMultiplier, setWidthMultiplier] =
    useState(1);

  const data = useMemo(
    () =>
      projectGrowth({
        isaStart,
        dormantStart,
        activeStart,
        returnRate,
        annualActiveContribution,
        isaFromWages,
        isaFromPension,
        startAge,
        endAge,
        retirementAge,
        desiredIncome,
        statePensionAnnual,
        statePensionAge
      }),
    [
      isaStart,
      dormantStart,
      activeStart,
      returnRate,
      annualActiveContribution,
      isaFromWages,
      isaFromPension,
      startAge,
      endAge,
      retirementAge,
      desiredIncome,
      statePensionAnnual,
      statePensionAge
    ]
  );

  return (
    <div style={{ padding: 30, fontFamily: "Arial" }}>
      <h2>Full Retirement Simulator</h2>

      <h3>Starting Balances</h3>
      ISA: <input type="number" value={isaStart} onChange={e => setIsaStart(Number(e.target.value))} /><br /><br />
      Dormant Pension: <input type="number" value={dormantStart} onChange={e => setDormantStart(Number(e.target.value))} /><br /><br />
      Active Pension: <input type="number" value={activeStart} onChange={e => setActiveStart(Number(e.target.value))} /><br /><br />

      <h3>Growth & Contributions</h3>
      Return Rate: <input type="number" step="0.001" value={returnRate} onChange={e => setReturnRate(Number(e.target.value))} /><br /><br />
      Annual Active Contribution: <input type="number" value={annualActiveContribution} onChange={e => setAnnualActiveContribution(Number(e.target.value))} /><br /><br />

      <h3>ISA Funding Strategy</h3>
      ISA from Wages (£{isaFromWages})
      <input type="range" min="0" max="20000" step="1000"
        value={isaFromWages}
        onChange={e => setIsaFromWages(Number(e.target.value))}
      /><br /><br />

      ISA from Pension (£{isaFromPension})
      <input type="range" min="0" max="20000" step="1000"
        value={isaFromPension}
        onChange={e => setIsaFromPension(Number(e.target.value))}
      /><br /><br />

      <h3>Retirement Settings</h3>
      Desired Income: <input type="number" value={desiredIncome} onChange={e => setDesiredIncome(Number(e.target.value))} /><br /><br />
      Retirement Age: <input type="number" value={retirementAge} onChange={e => setRetirementAge(Number(e.target.value))} /><br /><br />
      State Pension: <input type="number" value={statePensionAnnual} onChange={e => setStatePensionAnnual(Number(e.target.value))} /><br /><br />
      State Pension Age: <input type="number" value={statePensionAge} onChange={e => setStatePensionAge(Number(e.target.value))} /><br /><br />

      <h3>Projection Range</h3>
      Start Age: <input type="number" value={startAge} onChange={e => setStartAge(Number(e.target.value))} /><br /><br />
      End Age: <input type="number" value={endAge} onChange={e => setEndAge(Number(e.target.value))} /><br /><br />

      Chart Width Multiplier:
      <input type="number" step="0.1" min="0.5"
        value={widthMultiplier}
        onChange={e => setWidthMultiplier(Number(e.target.value))}
      /><br /><br />

      <div style={{
        width: `${95 * widthMultiplier}%`,
        margin: "0 auto"
      }}>
        <ResponsiveContainer width="100%" height={600}>
          <LineChart data={data}>

            <ReferenceArea
              x1={retirementAge}
              x2={endAge}
              fill="#e5e7eb"
              fillOpacity={0.3}
            />

            <ReferenceLine x={retirementAge}
              stroke="red"
              strokeDasharray="3 3"
              label="Retirement"
            />

            <ReferenceLine x={statePensionAge}
              stroke="purple"
              strokeDasharray="3 3"
              label="State Pension"
            />

            <CartesianGrid strokeDasharray="3 3" />

            <XAxis
              dataKey="age"
              type="number"
              domain={[startAge, endAge]}
              ticks={Array.from(
                { length: endAge - startAge + 1 },
                (_, i) => startAge + i
              )}
              interval={0}
            />

            <YAxis tickFormatter={v =>
              `£${(v / 1000).toFixed(0)}k`
            } />

            <Tooltip />
            <Legend />

            <Line dataKey="ISA" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line dataKey="DormantUncrystallised" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line dataKey="DormantCrystallised" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            <Line dataKey="ActivePension" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line dataKey="Total" stroke="#166534" strokeWidth={4} dot={false} />

          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}