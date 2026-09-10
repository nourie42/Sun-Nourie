import {weatherShapes} from './weather-display.js?v=comfort-paws-uv-v1';
import {weatherState} from './weather-state.js';
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function clothingForFeels(value){
 if(!finite(value))return 'mild';
 if(value>=88)return 'hot';
 if(value>=74)return 'warm';
 if(value>=58)return 'mild';
 if(value>=42)return 'cool';
 return 'cold';
}
function person(feels){
 const outfit=clothingForFeels(feels),shorts=outfit==='hot'||outfit==='warm',covered=outfit==='cool'||outfit==='cold';
 const legs=shorts
  ? `<path d="M-11 36H11L9 45H2L1 40L-1 40L-2 45H-9Z" fill="#527da4"/><path d="M-6 45L-8 58M6 45L9 58" stroke="#efbd96" stroke-width="7" stroke-linecap="round"/>`
  : `<path d="M-8 37L-10 58M8 37L11 58" stroke="${outfit==='cold'?'#334d68':'#527da4'}" stroke-width="9" stroke-linecap="round"/>`;
 const torso=outfit==='hot'
  ? `<path d="M-7 18Q0 15 7 18L11 37Q0 41-11 37Z" fill="#b2e1eb"/><path d="M-5 18L-8 25M5 18L8 25" stroke="#f5c8a4" stroke-width="4"/>`
  : outfit==='warm'||outfit==='mild'
  ? `<path d="M-9 19Q0 15 9 19L14 38Q0 43-14 38Z" fill="#b2e1eb"/><path d="M-10 21L-15 29M10 21L15 29" stroke="#b2e1eb" stroke-width="6" stroke-linecap="round"/>`
  : `<path d="M-12 17Q0 13 12 17L16 40Q0 45-16 40Z" fill="${outfit==='cold'?'#456079':'#6f96b6'}"/><path d="M0 18V39" stroke="#d9e8f3" stroke-opacity=".6" stroke-width="1.5"/>`;
 const arms=covered
  ? `<path d="M-11 21L-18 40" stroke="${outfit==='cold'?'#456079':'#6f96b6'}" stroke-width="7" stroke-linecap="round"/><g class="friendly-wave-pose"><path class="friendly-raised-arm" d="M11 22L21 13L24 2" fill="none" stroke="${outfit==='cold'?'#456079':'#6f96b6'}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="25" cy="0" r="5" fill="#efbd96"/><g class="friendly-wave"><path d="M24 1L20-6M25-1L24-10M27-1L28-10M29 0L32-7" fill="none" stroke="#efbd96" stroke-width="2.8" stroke-linecap="round"/></g></g>`
  : `<path d="M-10 22L-17 41" stroke="#efbd96" stroke-width="6" stroke-linecap="round"/><g class="friendly-wave-pose"><path class="friendly-raised-arm" d="M10 24L22 14L25-2" fill="none" stroke="#efbd96" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><g class="friendly-wave"><path d="M24 1L20-6M25-1L24-10M27-1L28-10M29 0L32-7" fill="none" stroke="#efbd96" stroke-width="2.8" stroke-linecap="round"/><ellipse cx="26" cy="-1" rx="5" ry="6" fill="#efbd96"/></g></g>`;
 const winter=outfit==='cold'?`<path d="M-10 17Q0 22 10 17" fill="none" stroke="#e8c98f" stroke-width="5"/><path d="M-12-4Q0-15 12-4L11 0H-11Z" fill="#6b8098"/><circle cx="0" cy="-12" r="3" fill="#e8c98f"/>`:'';
 return `<g class="exposure-person-art" data-outfit="${outfit}" transform="translate(118 101)">
 <ellipse cx="0" cy="63" rx="24" ry="4" fill="#102c43" opacity=".32"/>
 ${legs}<path d="M-14 61h10M7 61h11" stroke="#e0f0f9" stroke-width="5" stroke-linecap="round"/>
 ${arms}${torso}<ellipse class="person-resting-hand" cx="-17" cy="41" rx="3.8" ry="4.5" fill="#efbd96"/>
 <path d="M-3 14v6q3 3 6 0v-6" fill="#e8b088"/>
 <ellipse cx="0" cy="4" rx="12" ry="14" fill="#f5c8a4"/>
 <path d="M-12 4Q-15-10 0-11Q15-10 12 4L7-3Q-1 2-6-3L-9 6Z" fill="#4b3540"/>
 ${winter}
 <path d="M-8 3l4-1M4 2l4 1" stroke="#71504b" stroke-width="1.3" stroke-linecap="round"/>
 <g class="person-eyes" fill="#26384a"><ellipse cx="-5" cy="6" rx="1.5" ry="2"/><ellipse cx="5" cy="6" rx="1.5" ry="2"/></g>
 <path d="M0 7l-1 4h2" fill="none" stroke="#cc956f" stroke-width="1" stroke-linecap="round"/>
 <path class="person-smile" d="M-4 13Q0 17 4 13" fill="none" stroke="#975b56" stroke-width="1.6" stroke-linecap="round"/>
 </g>`;
}
export function exposureScene(sun,daylight=true,condition='Clear',feels=null){
 const tree=`<g class="exposure-tree"><ellipse cx="93" cy="164" rx="68" ry="6" fill="#0e2942" opacity=".26"/><path d="M48 61L49 162" stroke="#a2b7aa" stroke-width="13" stroke-linecap="round"/><path d="M49 115L82 71M49 92L29 70" stroke="#a2b7aa" stroke-width="7" stroke-linecap="round"/><path d="M28 88C0 74 7 43 32 38C26 11 69 1 86 22C122 8 147 34 139 53C174 62 159 96 131 96L39 96Z" fill="#408f83"/><path d="M23 63C7 48 24 26 45 32C44 9 79 7 91 30C117 17 140 37 132 55C154 64 139 83 118 82H43Z" fill="#65b2a0"/></g>`;
 const weather=weatherState(condition),sky=`<g class="person-weather" data-weather-kind="${weather.kind}" transform="translate(16 6) scale(1.65)">${weatherShapes(condition,daylight)}</g>`;
 const treeSky=['cloudy','partly-cloudy','rain','storm','snow','fog'].includes(weather.kind)?`<g transform="translate(148 4) scale(.8)">${weatherShapes(condition,daylight)}</g>`:'';
 const outfit=clothingForFeels(feels),clothing={hot:'light hot-weather clothing',warm:'light warm-weather clothing',mild:'everyday mild-weather clothing',cool:'a jacket and long pants',cold:'a coat, scarf and warm hat'}[outfit];
 const label=sun?`A smiling person in ${clothing}, waving outdoors in ${!daylight?'nighttime':weather.label.toLowerCase()} conditions`:`A smiling person in ${clothing}, waving under a tall shade tree`;
 return `<svg viewBox="0 0 220 180" role="img" aria-label="${label}" data-outfit="${outfit}">${sun?sky:tree+treeSky}<path d="M13 167H204" stroke="#b6d5d2" stroke-opacity=".4" stroke-width="2"/>${person(feels)}</svg>`;
}
