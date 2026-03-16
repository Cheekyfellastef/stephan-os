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

function projectGrowth({
  isaStart,
  dormantStart,
  activeStart,
  returnRate,
  annualActiveContribution,
  isaAllowance,
  startAge,
  endAge,
  retirementAge,
  withdrawalRate,
  statePensionAnnual,
  statePensionAge
}) {
  if (endAge <= startAge) return [];

  const data = [];

  let isa = isaStart;
  let uncrystallised = dormantStart;
  let crystallised = 0;
  let active = activeStart;

  let annualWithdrawal = 0;
  let cumulativeStatePension = 0;

  for (let age = startAge; age <= endAge; age++) {
    // Growth
    isa *= 1 + returnRate;
    uncrystallised *= 1 + returnRate;
    crystallised *= 1 + returnRate;
    active *= 1 + returnRate;

    // Before retirement
    if (age < retirementAge) {
      active += annualActiveContribution;

      const requiredCrystallisation = isaAllowance / 0.25;
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

    // Lock withdrawal at retirement
    if (age === retirementAge) {
      const total =
        isa + uncrystallised + crystallised + active;

      annualWithdrawal = total * withdrawalRate;
    }

    // After retirement
    if (age >= retirementAge && annualWithdrawal > 0) {
      const statePension =
        age >= statePensionAge ? statePensionAnnual : 0;

      if (statePension > 0) {
        cumulativeStatePension += statePension;
      }

      const netWithdrawal = Math.max(
        0,
        annualWithdrawal - statePension
      );

      const total =
        isa + uncrystallised + crystallised + active;

      if (total > 0) {
        const isaShare = isa / total;
        const uncrystallisedShare = uncrystallised / total;
        const crystallisedShare = crystallised / total;
        const activeShare = active / total;

        isa -= netWithdrawal * isaShare;
        uncrystallised -= netWithdrawal * uncrystallisedShare;
        crystallised -= netWithdrawal * crystallisedShare;
        active -= netWithdrawal * activeShare;
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
      CumulativeStatePension: Math.round(cumulativeStatePension)
    });
  }

  return data;
}

export default function App() {
  const [isaStart, setIsaStart] = useState(0);
  const [dormantStart, setDormantStart] = useState(100000);
  const [activeStart, setActiveStart] = useState(0);

  const [returnRate, setReturnRate] = useState(0.045);
  const [annualActiveContribution, setAnnualActiveContribution] = useState(14426);
  const [isaAllowance, setIsaAllowance] = useState(20000);

  const [withdrawalRate, setWithdrawalRate] = useState(0.04);

  const [statePensionAnnual, setStatePensionAnnual] = useState(11500);
  const [statePensionAge, setStatePensionAge] = useState(67);

  const [startAge, setStartAge] = useState(55);
  const [endAge, setEndAge] = useState(100);
  const [retirementAge, setRetirementAge] = useState(60);

  const [widthMultiplier, setWidthMultiplier] = useState(1);

  const data = useMemo(
    () =>
      projectGrowth({
        isaStart,
        dormantStart,
        activeStart,
        returnRate,
        annualActiveContribution,
        isaAllowance,
        startAge,
        endAge,
        retirementAge,
        withdrawalRate,
        statePensionAnnual,
        statePensionAge
      }),
    [
      isaStart,
      dormantStart,
      activeStart,
      returnRate,
      annualActiveContribution,
      isaAllowance,
      startAge,
      endAge,
      retirementAge,
      withdrawalRate,
      statePensionAnnual,
      statePensionAge
    ]
  );

  const retirementData = data.find(d => d.age === retirementAge);
  const retirementPot = retirementData ? retirementData.Total : 0;

  const finalData = data[data.length - 1];
  const cumulativeStatePension = finalData
    ? finalData.CumulativeStatePension
    : 0;

  const annualIncome = retirementPot * withdrawalRate;
  const monthlyIncome = annualIncome / 12;

  return (
    <div style={{ padding: 30, fontFamily: "Arial" }}>
      <h2>Lifetime Wealth Projection</h2>

      {/* Controls */}

      ISA:
      <input type="number" value={isaStart} onChange={e => setIsaStart(Number(e.target.value))} /><br /><br />

      Dormant Pension:
      <input type="number" value={dormantStart} onChange={e => setDormantStart(Number(e.target.value))} /><br /><br />

      Active Pension:
      <input type="number" value={activeStart} onChange={e => setActiveStart(Number(e.target.value))} /><br /><br />

      Return Rate:
      <input type="number" step="0.001" value={returnRate} onChange={e => setReturnRate(Number(e.target.value))} /><br /><br />

      Annual Contribution:
      <input type="number" value={annualActiveContribution} onChange={e => setAnnualActiveContribution(Number(e.target.value))} /><br /><br />

      ISA Allowance:
      <input type="number" value={isaAllowance} onChange={e => setIsaAllowance(Number(e.target.value))} /><br /><br />

      Withdrawal Rate:
      <input type="number" step="0.005" value={withdrawalRate} onChange={e => setWithdrawalRate(Number(e.target.value))} /><br /><br />

      State Pension (Annual):
      <input type="number" value={statePensionAnnual} onChange={e => setStatePensionAnnual(Number(e.target.value))} /><br /><br />

      State Pension Age:
      <input type="number" value={statePensionAge} onChange={e => setStatePensionAge(Number(e.target.value))} /><br /><br />

      Retirement Age:
      <input type="number" value={retirementAge} onChange={e => setRetirementAge(Number(e.target.value))} /><br /><br />

      Start Age:
      <input type="number" value={startAge} onChange={e => setStartAge(Number(e.target.value))} /><br /><br />

      End Age:
      <input type="number" value={endAge} onChange={e => setEndAge(Number(e.target.value))} /><br /><br />

      Chart Width Multiplier:
      <input type="number" step="0.1" min="0.5" value={widthMultiplier} onChange={e => setWidthMultiplier(Number(e.target.value))} /><br /><br />

      {/* Chart */}

      <div style={{ width: `${95 * widthMultiplier}%`, margin: "0 auto" }}>
        <ResponsiveContainer width="100%" height={600}>
          <LineChart data={data} margin={{ top: 20, right: 40, left: 40, bottom: 40 }}>

            {/* Retirement shading */}
            <ReferenceArea
              x1={retirementAge}
              x2={endAge}
              fill="#e5e7eb"
              fillOpacity={0.3}
            />

            {/* Retirement marker */}
            <ReferenceLine
              x={retirementAge}
              stroke="red"
              strokeDasharray="3 3"
              label="Retirement"
            />

            {/* State Pension marker */}
            <ReferenceLine
              x={statePensionAge}
              stroke="purple"
              strokeDasharray="3 3"
              label="State Pension"
            />

            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="age"
              type="number"
              domain={[startAge, endAge]}
              tickCount={Math.max(2, endAge - startAge + 1)}
              interval={0}
            />
            <YAxis tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`} />
            <Tooltip />
            <Legend />

            <Line type="monotone" dataKey="ISA" stroke="#14b8a6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="DormantUncrystallised" stroke="#f59e0b" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="DormantCrystallised" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="ActivePension" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="Total" stroke="#166534" strokeWidth={4} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <br /><br />
      <h3>Retirement Income</h3>
      <p>Pot at Retirement: £{retirementPot.toLocaleString()}</p>
      <p>Annual Target Income: £{annualIncome.toFixed(0)}</p>
      <p>Monthly Target Income: £{monthlyIncome.toFixed(0)}</p>

      <br />
      <h3>State Pension Received</h3>
      <p>Total State Pension Received by Age {endAge}: £{cumulativeStatePension.toLocaleString()}</p>
    </div>
  );
}