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

/* ---------------- TAX ---------------- */

function calculateTax(income){

const personalAllowance = 12570;
const basicLimit = 50270;

const taxable = Math.max(0, income - personalAllowance);

const basicBand = Math.min(
taxable,
basicLimit - personalAllowance
);

return basicBand * 0.2;

}

/* ---------------- ENGINE ---------------- */

function projectGrowth({

isaStart,
wifeIsaStart,
dormantStart,
activeStart,
houseSaleStart,

returnRate,
annualActiveContribution,

isaFromWages,
isaFromPension,
isaFromHouse,
wifeIsaFromHouse,

startAge,
endAge,
retirementAge,

desiredIncome,
statePensionAnnual,
statePensionAge

}){

let isa = isaStart;
let wifeIsa = wifeIsaStart;

let houseSalePot = houseSaleStart;

let dormantUncrystallised = dormantStart;
let dormantCrystallised = 0;

let active = activeStart;

const data = [];

for(let age=startAge; age<=endAge; age++){

isa *= 1 + returnRate;
wifeIsa *= 1 + returnRate;

dormantUncrystallised *= 1 + returnRate;
dormantCrystallised *= 1 + returnRate;

active *= 1 + returnRate;

/* BEFORE RETIREMENT */

if(age <= retirementAge){

active += annualActiveContribution;

/* ISA allocation */

let isaRemaining = 20000;

const wagesContribution =
Math.min(isaFromWages, isaRemaining);

isaRemaining -= wagesContribution;

const pensionContribution =
Math.min(isaFromPension, isaRemaining);

isaRemaining -= pensionContribution;

const houseContribution =
Math.min(
isaFromHouse,
isaRemaining,
houseSalePot
);

isaRemaining -= houseContribution;

isa +=
wagesContribution +
pensionContribution +
houseContribution;

houseSalePot -= houseContribution;

/* wife ISA */

const wifeContribution =
Math.min(
wifeIsaFromHouse,
20000,
houseSalePot
);

wifeIsa += wifeContribution;

houseSalePot -= wifeContribution;

/* crystallise pension */

if(pensionContribution > 0 && dormantUncrystallised > 0){

const crystallise =
Math.min(
pensionContribution / 0.25,
dormantUncrystallised
);

const taxable = crystallise * 0.75;

dormantUncrystallised -= crystallise;
dormantCrystallised += taxable;

}

}

/* RETIREMENT */

if(age >= retirementAge){

const statePension =
age >= statePensionAge
? statePensionAnnual
: 0;

let incomeNeeded =
Math.max(0, desiredIncome - statePension);

/* ISA */

const isaWithdraw =
Math.min(isa, incomeNeeded);

isa -= isaWithdraw;
incomeNeeded -= isaWithdraw;

/* wife ISA */

const wifeWithdraw =
Math.min(wifeIsa, incomeNeeded);

wifeIsa -= wifeWithdraw;
incomeNeeded -= wifeWithdraw;

/* tax free pension */

if(incomeNeeded > 0 && dormantUncrystallised > 0){

const crystallise =
Math.min(
incomeNeeded / 0.25,
dormantUncrystallised
);

const taxFree = crystallise * 0.25;

const taxable = crystallise * 0.75;

dormantUncrystallised -= crystallise;
dormantCrystallised += taxable;

incomeNeeded -= Math.min(
taxFree,
incomeNeeded
);

}

/* taxable pension */

if(incomeNeeded > 0 && dormantCrystallised + active > 0){

const taxableIncome =
incomeNeeded + statePension;

const tax =
calculateTax(taxableIncome);

const grossNeeded =
incomeNeeded + tax;

const available =
dormantCrystallised + active;

const withdraw =
Math.min(grossNeeded, available);

const shareDormant =
dormantCrystallised / available;

const shareActive =
active / available;

dormantCrystallised -= withdraw * shareDormant;
active -= withdraw * shareActive;

}

}

const total =
isa +
wifeIsa +
dormantUncrystallised +
dormantCrystallised +
active;

data.push({

age,
ISA: Math.round(isa),
WifeISA: Math.round(wifeIsa),
DormantUncrystallised: Math.round(dormantUncrystallised),
DormantCrystallised: Math.round(dormantCrystallised),
ActivePension: Math.round(active),
HouseSaleRemaining: Math.round(houseSalePot),
Total: Math.round(total)

});

}

return data;

}

/* ---------------- APP ---------------- */

export default function App(){

/* starting balances */

const [isaStart,setIsaStart] = useState(2200);
const [wifeIsaStart,setWifeIsaStart] = useState(0);

const [dormantStart,setDormantStart] = useState(124500);
const [activeStart,setActiveStart] = useState(93000);

const [houseSaleStart,setHouseSaleStart] = useState(0);

/* assumptions */

const [returnRate,setReturnRate] = useState(0.045);

const [annualActiveContribution,setAnnualActiveContribution] =
useState(14426);

/* ISA sliders */

const [isaFromWages,setIsaFromWages] = useState(5000);
const [isaFromPension,setIsaFromPension] = useState(5000);

const [isaFromHouse,setIsaFromHouse] = useState(5000);
const [wifeIsaFromHouse,setWifeIsaFromHouse] = useState(5000);

/* retirement */

const [retirementAge,setRetirementAge] = useState(60);
const [desiredIncome,setDesiredIncome] = useState(40000);

const [statePensionAge,setStatePensionAge] = useState(67);
const [statePensionAnnual,setStatePensionAnnual] = useState(11500);

/* timeline */

const [startAge,setStartAge] = useState(55);
const [endAge,setEndAge] = useState(100);

/* chart */

const [widthMultiplier,setWidthMultiplier] = useState(1);

/* run simulation */

const data = useMemo(()=>projectGrowth({

isaStart,
wifeIsaStart,
dormantStart,
activeStart,
houseSaleStart,

returnRate,
annualActiveContribution,

isaFromWages,
isaFromPension,
isaFromHouse,
wifeIsaFromHouse,

startAge,
endAge,
retirementAge,

desiredIncome,
statePensionAnnual,
statePensionAge

}),[
isaStart,
wifeIsaStart,
dormantStart,
activeStart,
houseSaleStart,

returnRate,
annualActiveContribution,

isaFromWages,
isaFromPension,
isaFromHouse,
wifeIsaFromHouse,

startAge,
endAge,
retirementAge,

desiredIncome,
statePensionAnnual,
statePensionAge
]);

return(

<div style={{padding:30,fontFamily:"Arial"}}>

<h2>Retirement Simulator</h2>

<h3>Starting Assets</h3>

ISA  
<input type="number"
value={isaStart}
onChange={e=>setIsaStart(Number(e.target.value))}/>

<br/><br/>

Wife ISA  
<input type="number"
value={wifeIsaStart}
onChange={e=>setWifeIsaStart(Number(e.target.value))}/>

<br/><br/>

Dormant Pension  
<input type="number"
value={dormantStart}
onChange={e=>setDormantStart(Number(e.target.value))}/>

<br/><br/>

Active Pension  
<input type="number"
value={activeStart}
onChange={e=>setActiveStart(Number(e.target.value))}/>

<br/><br/>

House Sale Pot  
<input type="number"
value={houseSaleStart}
onChange={e=>setHouseSaleStart(Number(e.target.value))}/>

<br/><br/>

<h3>ISA Funding Sliders</h3>

ISA from Wages £{isaFromWages}
<input type="range" min="0" max="20000" step="1000"
value={isaFromWages}
onChange={e=>setIsaFromWages(Number(e.target.value))}/>

<br/><br/>

ISA from Pension £{isaFromPension}
<input type="range" min="0" max="20000" step="1000"
value={isaFromPension}
onChange={e=>setIsaFromPension(Number(e.target.value))}/>

<br/><br/>

ISA from House £{isaFromHouse}
<input type="range" min="0" max="20000" step="1000"
value={isaFromHouse}
onChange={e=>setIsaFromHouse(Number(e.target.value))}/>

<br/><br/>

Wife ISA from House £{wifeIsaFromHouse}
<input type="range" min="0" max="20000" step="1000"
value={wifeIsaFromHouse}
onChange={e=>setWifeIsaFromHouse(Number(e.target.value))}/>

<br/><br/>

<h3>Assumptions</h3>

Return Rate  
<input type="number" step="0.001"
value={returnRate}
onChange={e=>setReturnRate(Number(e.target.value))}/>

<br/><br/>

Annual Pension Contribution  
<input type="number"
value={annualActiveContribution}
onChange={e=>setAnnualActiveContribution(Number(e.target.value))}/>

<br/><br/>

<h3>Retirement</h3>

Retirement Age  
<input type="number"
value={retirementAge}
onChange={e=>setRetirementAge(Number(e.target.value))}/>

<br/><br/>

Desired Income  
<input type="number"
value={desiredIncome}
onChange={e=>setDesiredIncome(Number(e.target.value))}/>

<br/><br/>

State Pension Age  
<input type="number"
value={statePensionAge}
onChange={e=>setStatePensionAge(Number(e.target.value))}/>

<br/><br/>

State Pension Annual  
<input type="number"
value={statePensionAnnual}
onChange={e=>setStatePensionAnnual(Number(e.target.value))}/>

<br/><br/>

<h3>Timeline</h3>

Start Age  
<input type="number"
value={startAge}
onChange={e=>setStartAge(Number(e.target.value))}/>

<br/><br/>

End Age  
<input type="number"
value={endAge}
onChange={e=>setEndAge(Number(e.target.value))}/>

<br/><br/>

<h3>Chart Width</h3>

<input
type="number"
step="0.1"
value={widthMultiplier}
onChange={e=>setWidthMultiplier(Number(e.target.value))}
/>

<br/><br/>

<div style={{
width:`${95*widthMultiplier}%`,
margin:"0 auto"
}}>

<ResponsiveContainer width="100%" height={600}>

<LineChart data={data}>

<ReferenceArea
x1={retirementAge}
x2={endAge}
fill="#e5e7eb"
fillOpacity={0.3}
/>

<ReferenceLine
x={retirementAge}
stroke="red"
strokeDasharray="3 3"
/>

<ReferenceLine
x={statePensionAge}
stroke="purple"
strokeDasharray="3 3"
/>

<CartesianGrid strokeDasharray="3 3"/>

<XAxis
dataKey="age"
type="number"
domain={[startAge,endAge]}
ticks={Array.from(
{length:endAge-startAge+1},
(_,i)=>startAge+i
)}
interval={0}
/>

<YAxis tickFormatter={v=>`£${(v/1000).toFixed(0)}k`} />

<Tooltip/>
<Legend/>

<Line dataKey="ISA" stroke="#14b8a6"/>
<Line dataKey="WifeISA" stroke="#ec4899"/>
<Line dataKey="DormantUncrystallised" stroke="#f59e0b"/>
<Line dataKey="DormantCrystallised" stroke="#8b5cf6"/>
<Line dataKey="ActivePension" stroke="#3b82f6"/>
<Line dataKey="HouseSaleRemaining" stroke="#9ca3af"/>
<Line dataKey="Total" stroke="#166534" strokeWidth={4}/>

</LineChart>

</ResponsiveContainer>

</div>

</div>

);
}