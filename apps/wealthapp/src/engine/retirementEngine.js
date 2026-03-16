export function projectGrowth({

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

}){

let isa = isaStart;
let wifeIsa = wifeIsaStart;
let dormant = dormantStart;
let active = activeStart;

const safeReturnRate = Math.min(returnRate,0.15);

let housePot = 0;
let houseSold = false;

let depletionAge = null;

const data = [];

for(let age=startAge; age<=endAge; age++){

/* annual ISA allowance tracking */

let myIsaAllowanceUsed = 0;
let wifeIsaAllowanceUsed = 0;

const ISA_LIMIT = 20000;

/* investment growth */

isa *= 1 + safeReturnRate;
wifeIsa *= 1 + safeReturnRate;
dormant *= 1 + safeReturnRate;
active *= 1 + safeReturnRate;

/* working contributions */

if(age < retirementAge){

const salaryISA = Math.min(
isaContribution,
ISA_LIMIT - myIsaAllowanceUsed
);

isa += salaryISA;
myIsaAllowanceUsed += salaryISA;

active += activeContribution;

}

/* trigger house sale */

if(age >= houseSaleAge && !houseSold){

housePot = houseSaleAmount;
houseSold = true;

}

/* move house funds into ISAs */

if(houseSold && housePot > 0){

const myISA = Math.min(
isaFromHouse,
ISA_LIMIT - myIsaAllowanceUsed,
housePot
);

isa += myISA;
housePot -= myISA;
myIsaAllowanceUsed += myISA;

const wifeISA = Math.min(
wifeIsaFromHouse,
ISA_LIMIT - wifeIsaAllowanceUsed,
housePot
);

wifeIsa += wifeISA;
housePot -= wifeISA;
wifeIsaAllowanceUsed += wifeISA;

}

/* retirement withdrawals */

if(age >= retirementAge){

let incomeNeeded = desiredIncome;

/* state pension */

if(age >= statePensionAge){

incomeNeeded -= statePensionAnnual;
incomeNeeded = Math.max(0,incomeNeeded);

}

/* withdraw from ISAs 50/50 */

if(incomeNeeded > 0){

let halfIncome = incomeNeeded / 2;

const myWithdraw = Math.min(isa,halfIncome);
const wifeWithdraw = Math.min(wifeIsa,halfIncome);

isa -= myWithdraw;
wifeIsa -= wifeWithdraw;

incomeNeeded -= (myWithdraw + wifeWithdraw);

/* if one ISA runs out the other covers */

if(incomeNeeded > 0){

const extraMy = Math.min(isa,incomeNeeded);
isa -= extraMy;
incomeNeeded -= extraMy;

}

if(incomeNeeded > 0){

const extraWife = Math.min(wifeIsa,incomeNeeded);
wifeIsa -= extraWife;
incomeNeeded -= extraWife;

}

}

/* withdraw from pension */

if(incomeNeeded > 0){

const totalPension = dormant + active;

if(totalPension > 0){

const pensionWithdraw = Math.min(totalPension,incomeNeeded);

const shareDormant = dormant / totalPension;
const shareActive = active / totalPension;

dormant -= pensionWithdraw * shareDormant;
active -= pensionWithdraw * shareActive;

incomeNeeded -= pensionWithdraw;

}

}

/* withdraw from house pot last */

if(incomeNeeded > 0 && housePot > 0){

const houseWithdraw = Math.min(housePot,incomeNeeded);

housePot -= houseWithdraw;
incomeNeeded -= houseWithdraw;

}

/* detect depletion */

if(incomeNeeded > 0 && depletionAge === null){

depletionAge = age;

}

}

/* total wealth */

const total =
isa +
wifeIsa +
dormant +
active +
housePot;

data.push({

age,
ISA: Math.round(isa),
WifeISA: Math.round(wifeIsa),
Dormant: Math.round(dormant),
Active: Math.round(active),
HousePot: Math.round(housePot),
Total: Math.round(total)

});

}

return{
data,
depletionAge
};

}