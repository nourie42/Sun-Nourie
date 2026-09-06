/** Purpose-built vector artwork. Shared ground line; canopy taller than the adult. */
function person(){return `<g class="exposure-person-art" transform="translate(118 101)">
 <ellipse cx="0" cy="63" rx="24" ry="4" fill="#102c43" opacity=".32"/>
 <path d="M-8 39L-10 58M8 39L11 58" stroke="#527da4" stroke-width="9" stroke-linecap="round"/>
 <path d="M-14 61h10M7 61h11" stroke="#e0f0f9" stroke-width="5" stroke-linecap="round"/>
 <path d="M-10 22L-17 41" stroke="#efbd96" stroke-width="6" stroke-linecap="round"/>
 <g class="friendly-wave"><path d="M10 24L22 14L25-2" fill="none" stroke="#efbd96" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 1L20-6M25-1L24-10M27-1L28-10M29 0L32-7" fill="none" stroke="#efbd96" stroke-width="2.8" stroke-linecap="round"/>
  <ellipse cx="26" cy="-1" rx="5" ry="6" fill="#efbd96"/>
 </g>
 <path d="M-9 19Q0 15 9 19L14 38Q0 43-14 38Z" fill="#b2e1eb"/>
 <path d="M-3 14v6q3 3 6 0v-6" fill="#e8b088"/>
 <ellipse cx="0" cy="4" rx="12" ry="14" fill="#f5c8a4"/>
 <path d="M-12 4Q-15-10 0-11Q15-10 12 4L7-3Q-1 2-6-3L-9 6Z" fill="#4b3540"/>
 <path d="M-8 3l4-1M4 2l4 1" stroke="#71504b" stroke-width="1.3" stroke-linecap="round"/>
 <g class="person-eyes" fill="#26384a"><ellipse cx="-5" cy="6" rx="1.5" ry="2"/><ellipse cx="5" cy="6" rx="1.5" ry="2"/></g>
 <path d="M0 7l-1 4h2" fill="none" stroke="#cc956f" stroke-width="1" stroke-linecap="round"/>
 <path class="person-smile" d="M-4 13Q0 17 4 13" fill="none" stroke="#975b56" stroke-width="1.6" stroke-linecap="round"/>
 <circle cx="-8" cy="11" r="2" fill="#e9a99a" opacity=".65"/><circle cx="8" cy="11" r="2" fill="#e9a99a" opacity=".65"/>
 </g>`;}
export function exposureScene(sun,daylight=true){
 const tree=`<g class="exposure-tree"><ellipse cx="93" cy="164" rx="68" ry="6" fill="#0e2942" opacity=".26"/><path d="M48 61L49 162" stroke="#a2b7aa" stroke-width="13" stroke-linecap="round"/><path d="M49 115L82 71M49 92L29 70" stroke="#a2b7aa" stroke-width="7" stroke-linecap="round"/><path d="M28 88C0 74 7 43 32 38C26 11 69 1 86 22C122 8 147 34 139 53C174 62 159 96 131 96L39 96Z" fill="#408f83"/><path d="M23 63C7 48 24 26 45 32C44 9 79 7 91 30C117 17 140 37 132 55C154 64 139 83 118 82H43Z" fill="#65b2a0"/><path d="M39 50Q60 35 79 42M88 62Q110 51 124 61" fill="none" stroke="#8bcbbb" stroke-width="5" stroke-linecap="round" opacity=".6"/></g>`;
 const sunshine=`<g class="exposure-sun"><circle cx="58" cy="40" r="22" fill="#ffdc84"/><g stroke="#ffdc84" stroke-width="3.5" stroke-linecap="round"><path d="M58 8V2M58 73v6M25 40h-6M91 40h6M35 17l-4-4M81 63l4 4M35 63l-4 4M81 17l4-4"/></g><path d="M94 59L156 158M111 58L176 158" stroke="#ffe5a1" stroke-width="10" opacity=".06"/></g>`;
 return `<svg viewBox="0 0 220 180" role="img" aria-label="${sun?'A person in direct sunlight, smiling with eyes and hair and waving':'A person standing in the shade of a tall tree, smiling with eyes and hair and waving'}"${sun&&!daylight?' class="sun-unavailable"':''}>${sun?sunshine:tree}<path d="M13 167H204" stroke="#b6d5d2" stroke-opacity=".4" stroke-width="2"/>${person()}</svg>`;
}
