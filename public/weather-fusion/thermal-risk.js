/** UTCI stress categories, not NWS Heat Index or an official warning.
 * Conservative inclusive thresholds; classify unrounded Fahrenheit values.
 * https://confluence.ecmwf.int/spaces/FUG/pages/673551030/Section+8.1.18+Thermal+parameters
 */
export function thermalRisk(value){
 if(typeof value!=='number'||!Number.isFinite(value))return null;
 if(value>=114.8)return {key:'extreme-heat',level:'extreme',label:'Extreme heat stress',short:'Extreme heat'};
 if(value>=100.4)return {key:'very-strong-heat',level:'danger',label:'Very strong heat stress',short:'High heat risk'};
 if(value>=89.6)return {key:'strong-heat',level:'caution',label:'Strong heat stress',short:'Heat stress'};
 if(value<=-40)return {key:'extreme-cold',level:'extreme',label:'Extreme cold stress',short:'Extreme cold'};
 if(value<=-16.6)return {key:'very-strong-cold',level:'danger',label:'Very strong cold stress',short:'High cold risk'};
 if(value<=8.6)return {key:'strong-cold',level:'caution',label:'Strong cold stress',short:'Cold stress'};
 return null;
}
export function thermalRiskHTML(value,compact=false){
 const risk=thermalRisk(value);if(!risk)return '';
 return `<span class="thermal-risk${compact?' thermal-risk-compact':''}" data-thermal-risk="${risk.key}" data-risk="${risk.level}" title="${risk.label} · estimated UTCI, not an official alert">${compact?risk.short:risk.label}</span>`;
}
