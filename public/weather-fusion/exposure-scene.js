import {weatherShapes} from './weather-display.js?v=weather-art-labels-v10';
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

function palette(feels){
 const outfit=clothingForFeels(feels);
 return {
  outfit,
  shirt:outfit==='cold'?'#4f7298':outfit==='cool'?'#6594bd':'#48c4f3',
  shorts:outfit==='hot'||outfit==='warm',
  pants:outfit==='cold'?'#314963':'#365d82',
  shoe:'#f4fbff',
  skin:'#ffc49f',
  hair:'#613a2c'
 };
}

function face(p){
 return `<ellipse cx="0" cy="0" rx="19" ry="22" fill="${p.skin}"/>
 <path d="M-19-1Q-20-24 0-25Q22-23 19 2Q14-8 7-12Q-3-7-12-12Q-16-7-19-1Z" fill="${p.hair}"/>
 <g class="person-eyes" fill="#17324b"><ellipse cx="-7" cy="3" rx="2.5" ry="3.3"/><ellipse cx="7" cy="3" rx="2.5" ry="3.3"/></g>
 <path class="person-smile" d="M-8 12Q0 19 8 12" fill="none" stroke="#a54d45" stroke-width="2.3" stroke-linecap="round"/>
 <circle cx="-13" cy="9" r="2.8" fill="#f49b88" opacity=".45"/><circle cx="13" cy="9" r="2.8" fill="#f49b88" opacity=".45"/>`;
}

function standingPerson(feels){
 const p=palette(feels),legs=p.shorts
  ? `<path d="M-14 46H14L11 61H2L0 54L-2 61H-11Z" fill="${p.pants}"/>
     <path d="M-8 60L-10 88M8 60L11 88" stroke="${p.skin}" stroke-width="10" stroke-linecap="round"/>`
  : `<path d="M-9 48L-12 88M9 48L12 88" stroke="${p.pants}" stroke-width="12" stroke-linecap="round"/>`;
 return `<g class="exposure-person-art standing-person" data-outfit="${p.outfit}" transform="translate(136 176) scale(1.28)">
  <ellipse cx="1" cy="98" rx="37" ry="7" fill="#0a3858" opacity=".24"/>
  ${legs}
  <path d="M-18 91H-3M7 91H23" stroke="${p.shoe}" stroke-width="9" stroke-linecap="round"/>
  <path d="M-16 18Q0 11 16 18L21 50Q0 58-21 50Z" fill="${p.shirt}"/>
  <path d="M-14 22L-27 51" stroke="${p.skin}" stroke-width="9" stroke-linecap="round"/>
  <path class="friendly-raised-arm" d="M14 22L31 4L35-20" fill="none" stroke="${p.skin}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <g class="friendly-wave"><g stroke="${p.skin}" stroke-width="4" stroke-linecap="round">
   <path d="M34-18L28-31M36-20L35-35M38-20L42-34M40-17L48-28"/>
  </g></g>
  <ellipse cx="37" cy="-18" rx="7" ry="8" fill="${p.skin}"/>
  <path d="M-4 16V22Q0 26 4 22V16" fill="#e6a57e"/>
  <g transform="translate(0,-4)">${face(p)}</g>
 </g>`;
}

function seatedPerson(feels){
 const p=palette(feels);
 return `<g class="exposure-person-art seated-person" data-outfit="${p.outfit}" transform="translate(183 213) scale(1.15)">
  <ellipse cx="-1" cy="76" rx="55" ry="8" fill="#0a3858" opacity=".24"/>
  <path d="M-16 39Q-24 52-35 62L-49 67" fill="none" stroke="${p.skin}" stroke-width="12" stroke-linecap="round"/>
  <path d="M12 42Q23 54 37 63L52 67" fill="none" stroke="${p.skin}" stroke-width="12" stroke-linecap="round"/>
  <path d="M-55 69H-38M45 69H60" stroke="${p.shoe}" stroke-width="10" stroke-linecap="round"/>
  <path d="M-20 31H18L15 49Q0 56-17 48Z" fill="${p.pants}"/>
  <path d="M-17 4Q0-4 18 4L22 34Q0 43-22 34Z" fill="${p.shirt}"/>
  <path d="M-14 8L-28 32" stroke="${p.skin}" stroke-width="9" stroke-linecap="round"/>
  <path class="friendly-raised-arm" d="M15 7L31-7L35-28" fill="none" stroke="${p.skin}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <g class="friendly-wave"><g stroke="${p.skin}" stroke-width="4" stroke-linecap="round">
   <path d="M34-27L29-39M36-29L36-43M38-29L43-42M40-26L49-36"/>
  </g></g>
  <ellipse cx="37" cy="-27" rx="7" ry="8" fill="${p.skin}"/>
  <path d="M-4 1V6Q0 10 4 6V1" fill="#e6a57e"/>
  <g transform="translate(0,-19)">${face(p)}</g>
 </g>`;
}

function skyPalette(weather,daylight){
 if(!daylight)return {top:'#082c58',bottom:'#24618e',ground:'#174a58',horizon:'#1f6670'};
 if(['rain','storm'].includes(weather.kind))return {top:'#48667c',bottom:'#7796a8',ground:'#31595d',horizon:'#446d70'};
 if(weather.kind==='cloudy'||weather.kind==='fog')return {top:'#6489a3',bottom:'#a2bdc9',ground:'#477067',horizon:'#5e8776'};
 if(weather.kind==='snow')return {top:'#94bad3',bottom:'#d8e7ef',ground:'#e9f2f4',horizon:'#b8ced5'};
 return {top:'#078ee1',bottom:'#62d2ff',ground:'#5fc850',horizon:'#35a85d'};
}

function sharedDefs(id,p){
 return `<defs>
  <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${p.top}"/><stop offset="1" stop-color="${p.bottom}"/></linearGradient>
  <linearGradient id="${id}-grass" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${p.horizon}"/><stop offset="1" stop-color="${p.ground}"/></linearGradient>
  <radialGradient id="${id}-sun"><stop stop-color="#fffbd1"/><stop offset=".52" stop-color="#ffe66f"/><stop offset="1" stop-color="#ffc942"/></radialGradient>
  <filter id="${id}-soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="8"/></filter>
 </defs>`;
}

function sunGlyph(id,x,y,scale=1){
 return `<g class="sky-sun" transform="translate(${x} ${y}) scale(${scale})">
  <circle r="39" fill="#ffd95f" opacity=".28" filter="url(#${id}-soft)"/>
  <g stroke="#ffdc65" stroke-width="9" stroke-linecap="round" opacity=".9">
   <path d="M0-63V-48M0 63V48M-63 0H-48M63 0H48M-45-45L-34-34M45 45L34 34M-45 45L-34 34M45-45L34-34"/>
  </g><circle r="31" fill="url(#${id}-sun)"/>
 </g>`;
}

function distantPark(id,p){
 return `<path d="M0 242Q37 213 78 230Q119 196 164 227Q210 199 300 226V302H0Z" fill="${p.horizon}" opacity=".72"/>
 <g fill="${p.ground}" opacity=".9"><circle cx="31" cy="233" r="28"/><circle cx="77" cy="227" r="24"/><circle cx="245" cy="226" r="31"/><circle cx="283" cy="231" r="27"/></g>
 <path d="M0 272Q74 258 145 270Q220 252 300 269V360H0Z" fill="url(#${id}-grass)"/>`;
}

function shadeTree(){
 return `<g class="exposure-tree">
  <ellipse cx="92" cy="319" rx="92" ry="13" fill="#093d44" opacity=".28"/>
  <path d="M54 111Q74 171 69 318" stroke="#765034" stroke-width="34" stroke-linecap="round"/>
  <path d="M67 195L26 138M72 169L114 111M70 224L130 173" stroke="#765034" stroke-width="19" stroke-linecap="round"/>
  <path d="M63 112Q78 171 73 316" stroke="#a7774b" stroke-width="9" stroke-linecap="round" opacity=".62"/>
  <g fill="#159f49"><circle cx="30" cy="101" r="51"/><circle cx="75" cy="79" r="65"/><circle cx="134" cy="94" r="58"/><circle cx="174" cy="119" r="46"/><circle cx="110" cy="125" r="62"/></g>
  <g fill="#49c85b" opacity=".82"><circle cx="46" cy="74" r="28"/><circle cx="94" cy="54" r="32"/><circle cx="145" cy="75" r="27"/><circle cx="153" cy="117" r="22"/></g>
  <g fill="#85e270" opacity=".65"><circle cx="74" cy="48" r="11"/><circle cx="125" cy="62" r="10"/><circle cx="39" cy="103" r="9"/><circle cx="166" cy="95" r="9"/></g>
 </g>`;
}

export function exposureScene(sun,daylight=true,condition='Clear',feels=null){
 const weather=weatherState(condition),id=sun?'direct-scene':'shade-scene',p=skyPalette(weather,daylight);
 const defs=sharedDefs(id,p),weatherClass=sun?'person-weather':'shade-weather';
 const icon=!daylight?`<g class="${weatherClass}">${weatherShapes(condition,false)}</g>`:(['clear','partly-cloudy'].includes(weather.kind)?`<g class="${weatherClass}">${sunGlyph(id,sun?235:247,sun?76:62,sun?1:.78)}</g>`:`<g class="${weatherClass}" transform="translate(215 30) scale(1.1)">${weatherShapes(condition,daylight)}</g>`);
 const cloud=`<g fill="#fff" opacity=".8"><ellipse cx="222" cy="171" rx="48" ry="17"/><ellipse cx="255" cy="165" rx="31" ry="22"/><ellipse cx="191" cy="169" rx="26" ry="14"/></g>`;
 const background=`<rect width="300" height="360" rx="22" fill="url(#${id}-sky)"/>${daylight&&['clear','partly-cloudy'].includes(weather.kind)?cloud:''}${distantPark(id,p)}`;
 const art=sun?standingPerson(feels):shadeTree()+seatedPerson(feels);
 const clothing={hot:'light hot-weather clothing',warm:'light warm-weather clothing',mild:'everyday mild-weather clothing',cool:'a jacket and long pants',cold:'a coat, scarf and warm hat'}[clothingForFeels(feels)];
 const label=sun?`A smiling person in ${clothing}, outdoors in ${weather.label.toLowerCase()} conditions`:`A smiling person in ${clothing}, sitting beneath a tall shade tree`;
 return `<svg viewBox="0 0 300 360" role="img" aria-label="${label}" data-outfit="${clothingForFeels(feels)}">${defs}${background}${icon}${art}</svg>`;
}
