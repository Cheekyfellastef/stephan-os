import { useState } from "react";
import Chart from "./components/Chart";
import { projectGrowth } from "./engine/retirementEngine";
import Slider from "./components/Slider"

export default function App(){

const [retirementAge, setRetirementAge] = useState(60);

const [desiredIncome, setDesiredIncome] = useState(30000);



const [returnRate, setReturnRate] = useState(0.045);

const [startAge, setStartAge] = useState(55);

const [endAge, setEndAge] = useState(100);

const [houseSaleAmount, setHouseSaleAmount] = useState(0);
const [houseSaleAge, setHouseSaleAge] = useState(75);

const [isaFromHouse, setIsaFromHouse] = useState(10000);
const [wifeIsaFromHouse, setWifeIsaFromHouse] = useState(10000);

const [isaStart, setIsaStart] = useState(2200);

const [wifeIsaStart, setWifeIsaStart] = useState(0);

const [activeContribution, setActiveContribution] = useState(14000);

const [isaContribution, setIsaContribution] = useState(20000);

const [dormantStart, setDormantStart] = useState(124500);

const [activeStart, setActiveStart] = useState(93000);

const [statePensionAge, setStatePensionAge] = useState(67);

const [statePensionAnnual, setStatePensionAnnual] = useState(23000);

const [annualActiveContribution, setAnnualActiveContribution] = useState(14426);

const [widthMultiplier, setWidthMultiplier] = useState(1);



const { data, depletionAge } = projectGrowth({

isaStart,
wifeIsaStart,
dormantStart,
activeStart,

isaContribution,
activeContribution,

houseSaleAmount,
houseSaleAge,
isaFromHouse,
wifeIsaFromHouse,

returnRate,

startAge,
endAge,

retirementAge,
desiredIncome,
statePensionAge,
statePensionAnnual

});

return(

<div style={{
padding:40,
background:"#000",
minHeight:"100vh"
}}>

<h1>Retirement Simulator</h1>

<h2>Starting Assets</h2>

<div style={{
display:"grid",
gridTemplateColumns:"200px 200px",
gap:"10px",
marginBottom:"20px"
}}>

<label>ISA</label>
<input
 type="number"
 value={isaStart}
 onChange={(e)=>setIsaStart(Number(e.target.value))}
/>

<label>Wife ISA</label>
<input
 type="number"
 value={wifeIsaStart}
 onChange={(e)=>setWifeIsaStart(Number(e.target.value))}
/>

<label>Dormant Pension</label>
<input
 type="number"
 value={dormantStart}
 onChange={(e)=>setDormantStart(Number(e.target.value))}
/>

<label>Active Pension</label>
<input
 type="number"
 value={activeStart}
 onChange={(e)=>setActiveStart(Number(e.target.value))}
/>

<label>House Sale Value</label>
<input
 type="number"
 value={houseSaleAmount}
 onChange={(e)=>setHouseSaleAmount(Number(e.target.value))}
/>

</div>

<Slider
 label="Retirement Age"
 value={retirementAge}
 min={55}
 max={70}
 onChange={setRetirementAge}
/>

<Slider
 label="Desired Income"
 value={desiredIncome}
 min={20000}
 max={50000}
 step={1000}
 onChange={setDesiredIncome}
/>

<Slider
 label="Combined State Pension (Annual)"
 value={statePensionAnnual}
 min={0}
 max={30000}
 step={500}
 onChange={setStatePensionAnnual}
/>

<Slider
 label="Return Rate"
 value={returnRate}
 min={0.02}
 max={0.10}
 step={0.001}
 onChange={setReturnRate}
/>

<Slider
 label="ISA Annual Contribution"
 value={isaContribution}
 min={0}
 max={20000}
 step={1000}
 onChange={setIsaContribution}
/>

<Slider
 label="Active Pension Contribution"
 value={activeContribution}
 min={0}
 max={30000}
 step={1000}
 onChange={setActiveContribution}
/>

<Slider
 label="House Sale Age"
 value={houseSaleAge}
 min={55}
 max={95}
 onChange={setHouseSaleAge}
/>

<Slider
 label="Your ISA From House"
 value={isaFromHouse}
 min={0}
 max={20000}
 step={1000}
 onChange={setIsaFromHouse}
/>

<Slider
 label="Wife ISA From House"
 value={wifeIsaFromHouse}
 min={0}
 max={20000}
 step={1000}
 onChange={setWifeIsaFromHouse}
/>

<Slider
 label="Start Age"
 value={startAge}
 min={50}
 max={70}
 onChange={setStartAge}
/>

<Slider
 label="End Age"
 value={endAge}
 min={80}
 max={110}
 onChange={setEndAge}
/>

<Slider
 label="Chart Width"
 value={widthMultiplier}
 min={1}
 max={3}
 step={0.1}
 onChange={setWidthMultiplier}
/>

{depletionAge ? (
  <h3 style={{color:"#ef4444"}}>
    Portfolio runs out at age {depletionAge}
  </h3>
) : (
  <h3 style={{color:"#22c55e"}}>
    Portfolio survives to age {endAge}
  </h3>
)}

<div style={{
 width: `${95 * widthMultiplier}%`,
 margin: "0 auto"
}}>

<Chart
 data={data}
 retirementAge={retirementAge}
 depletionAge={depletionAge}
 statePensionAge={statePensionAge}
 startAge={startAge}
 endAge={endAge}
/>

</div>

</div>

);

}