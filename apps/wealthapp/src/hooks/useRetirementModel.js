import { useMemo } from "react";
import { projectGrowth } from "../engine/retirementEngine";

export function useRetirementModel(inputs){

const result = useMemo(() => {
  return projectGrowth(inputs);
}, [inputs]);

return result;

}