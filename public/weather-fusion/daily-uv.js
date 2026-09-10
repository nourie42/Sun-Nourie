const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function uvCategory(value){
 if(!finite(value)||value<0)return {label:'Unavailable',key:'unknown',value:null};
 // Categories use the whole-number index (EPA/WHO); retain source precision.
 const index=Math.round(value);
 return {value,index,...(index<=2?{label:'Low',key:'low'}:index<=5?{label:'Moderate',key:'moderate'}:index<=7?{label:'High',key:'high'}:index<=10?{label:'Very high',key:'very-high'}:{label:'Extreme',key:'extreme'})};
}
export function dailyUvHTML(value,label='Peak UV'){
 const uv=uvCategory(value);
 return `<span class="daily-uv" data-uv="${uv.key}"><span>${label}</span> <b>${uv.value===null?'—':uv.index}</b> · ${uv.label}</span>`;
}
