export default function Slider({
 label,
 value,
 min,
 max,
 step = 1,
 onChange
}){

return(

<div style={{marginBottom:20}}>

<div>
{label}: {value}
</div>

<input
 type="range"
 min={min}
 max={max}
 step={step}
 value={value}
 onChange={(e)=>onChange(Number(e.target.value))}
/>

</div>

)

}