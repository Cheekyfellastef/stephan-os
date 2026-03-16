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

export default function Chart({ data, retirementAge, depletionAge, statePensionAge, startAge, endAge }) {

if (!Array.isArray(data)) {
  return <div>Chart waiting for data...</div>;
}

return (

<div style={{width:"100%", height:600}}>

<ResponsiveContainer>

<LineChart
  
  data={data}
  margin={{ top: 20, right: 40, left: 60, bottom: 40 }}
>
  <ReferenceArea
  x1={retirementAge}
  x2={endAge}
  fill="#1f2937"
  fillOpacity={0.25}
/>
<ReferenceLine
  x={retirementAge}
  stroke="red"
  strokeWidth={3}
  strokeDasharray="3 3"
/>
{depletionAge && (
<ReferenceLine
  x={depletionAge}
  stroke="#ef4444"
  strokeWidth={4}
/>
)}

<ReferenceLine x={statePensionAge} stroke="purple" strokeDasharray="3 3"/>

<CartesianGrid strokeDasharray="3 3"/>

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

<YAxis tickFormatter={(v)=>`£${(v/1000).toFixed(0)}k`} />

<Tooltip/>

<Legend/>

<Line dataKey="ISA" stroke="#14b8a6"/>
<Line dataKey="WifeISA" stroke="#ec4899"/>
<Line dataKey="Dormant" stroke="#f59e0b"/>
<Line dataKey="Active" stroke="#3b82f6"/>
<Line dataKey="Total" stroke="#22c55e" strokeWidth={4}/>
<Line dataKey="HousePot" stroke="#9ca3af"/>

</LineChart>

</ResponsiveContainer>

</div>

);

}