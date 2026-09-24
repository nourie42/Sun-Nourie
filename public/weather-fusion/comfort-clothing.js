/** Garments for the existing 300px illustrated panels. Preserve faces, poses,
 * weather, footwear and the pet. Outfit labels alone never change the picture. */
const BOY_PANTS='M108 171 Q134 177 161 173 L165 203 L169 240 Q160 246 147 241 L135 211 L120 242 Q110 245 99 239 L104 207 L100 205 Z';
const SEATED_PANTS=[
 'M145 224 Q129 214 113 219 Q101 223 106 236 Q113 247 141 255 L151 244 Q133 235 133 232 L153 238 Z',
 'M163 232 Q171 207 183 197 Q198 187 208 204 L218 234 L201 241 L190 219 L187 240 Q179 248 163 247 Z'
];
const WALKER_PANTS=[
 'M75 145 Q93 148 110 145 L114 170 Q105 188 89 205 L61 240 L48 235 L69 200 L82 174 L73 169 Z',
 'M82 158 L112 158 Q120 175 118 191 L114 204 L128 245 L109 251 L91 214 Q87 203 88 194 L76 174 Z'
];
const BOY_JACKET='M99 116 Q114 109 126 112 Q136 123 147 111 Q161 115 166 121 L164 150 L168 176 Q134 183 103 176 L106 142 Z';
const SEATED_JACKET='M122 180 Q137 174 147 174 Q157 184 175 173 L194 169 L199 188 L181 196 L178 226 Q155 234 133 231 L121 221 L113 204 Z';
const WALKER_JACKET='M74 95 Q81 89 86 87 Q95 103 104 89 L115 96 L114 121 L118 147 Q96 155 70 147 L75 122 Z';
const SLEEVES={
 normal:[
  ['M117 198 L129 207 L121 216 L112 223 L102 217 Q101 207 117 198 Z','M189 174 Q202 172 207 162 L218 143 L228 148 Q224 171 210 185 L198 188 Z'],
  ['M101 114 L97 137 Q84 134 77 126 Q66 115 62 95 L75 89 Q79 108 88 110 Z','M163 121 L178 145 L184 176 L172 180 L160 149 Z'],
  ['M65 94 Q71 88 79 93 L83 109 L65 137 L55 165 L40 161 L49 132 L60 104 Z','M106 92 Q115 96 119 111 L128 138 L145 154 L137 163 L116 145 L105 122 Z']
 ],
 watch:[
  ['M117 198 L129 207 L121 216 L112 223 L102 217 Q101 207 117 198 Z','M175 180 L185 171 Q192 181 197 199 L182 205 L177 193 Z'],
  ['M101 114 L94 132 Q79 124 74 113 Q75 96 86 77 L98 83 L91 108 Z','M166 121 L182 136 Q189 143 180 158 L169 173 L159 166 L169 150 L160 145 Z'],
  ['M65 94 Q72 88 80 93 L85 109 L68 137 L59 166 L44 163 L53 130 L61 104 Z','M110 95 Q119 103 121 120 L133 142 L148 155 L140 165 L123 150 L109 128 Z']
 ],
 carry:[
  ['M119 194 L135 203 L136 211 L126 216 L113 205 Z','M175 180 L185 171 Q192 181 197 199 L182 205 L177 193 Z'],
  ['M102 115 L106 131 L116 136 L111 151 L94 148 L90 137 Z','M166 121 L182 136 Q189 143 180 158 L169 173 L159 166 L169 150 L160 145 Z'],
  ['M65 94 Q72 88 80 93 L85 109 L68 137 L59 166 L44 163 L53 130 L61 104 Z','M110 95 Q119 103 121 120 L133 142 L148 155 L140 165 L123 150 L109 128 Z']
 ],
 fog:[
  ['M117 198 L129 207 L121 216 L112 223 L102 217 Q101 207 117 198 Z','M188 174 Q202 171 208 160 L218 143 L228 148 Q224 171 210 185 L198 188 Z'],
  ['M101 115 L109 134 Q95 159 82 153 L73 144 L83 133 L92 136 Z','M163 121 L178 145 L184 176 L172 180 L160 149 Z'],
  ['M65 94 Q71 88 79 93 L83 109 L65 137 L55 165 L40 161 L49 132 L60 104 Z','M106 92 Q115 96 119 111 L128 138 L145 154 L137 163 L116 145 L105 122 Z']
 ]
};
const RAIN_PANTS=[SEATED_PANTS,
 ['M113 203 L134 208 L126 233 L109 231 Z','M148 207 L170 205 L178 234 L158 236 Z'],
 ['M87 159 L111 166 Q99 190 83 216 L69 227 L55 214 L74 187 Z','M80 201 L101 181 L102 200 L83 221 L71 216 Z','M94 159 L119 162 Q119 180 119 197 L127 223 L109 229 L100 209 L90 185 Z']
];
const safe=s=>String(s).replace(/[^a-z0-9_-]/gi,'');
export function clothingArtwork(panel,scene,outfit,sourceHref){
 if(!Number.isInteger(panel)||panel<0||panel>2||!['cold','cool','mild'].includes(outfit)||scene==='cold')return '';
 const id=`wardrobe-${panel}-${safe(scene)}-${outfit}`;
 const rainy=scene==='rain',variant=scene==='carry-umbrella'?'carry':scene==='watch'?'watch':scene==='fog'?'fog':'normal';
 const pants=rainy?RAIN_PANTS[panel]:panel===0?SEATED_PANTS:panel===1?[BOY_PANTS]:WALKER_PANTS;
 const layered=outfit!=='mild'&&(!rainy||panel===0);
 const torso=[SEATED_JACKET,BOY_JACKET,WALKER_JACKET][panel];
 const jacket=layered?[...SLEEVES[variant][panel],torso]:[];
 const seam=panel===0?'M187 205 Q192 216 206 235 M117 233 L140 249':panel===1?'M132 180 L132 200 M112 211 L107 235 M151 211 L158 238':'M82 177 L62 232 M101 186 L100 202 L117 244';
 const zipper=panel===0?'M157 190 L151 226':panel===1?'M135 123 L135 174':'M96 101 L95 146';
 const dark=panel===2?'#245a77':'#223e5c',light=panel===2?'#638eaa':'#527a9d';
 const hands=variant==='carry'?(panel===0?[[143,213,9,11],[177,169,8,12]]:panel===1?[[110,141,11,8]]:[]):panel===0?[[129,223,12,8]]:[];
 const clip=(name,paths)=>`<clipPath id="${id}-${name}">${paths.map(d=>`<path d="${d}"/>`).join('')}</clipPath>`;
 const filter=(name,r,g,b)=>`<filter id="${id}-${name}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${.2126*r[0]} ${.7152*r[0]} ${.0722*r[0]} 0 ${r[1]} ${.2126*g[0]} ${.7152*g[0]} ${.0722*g[0]} 0 ${g[1]} ${.2126*b[0]} ${.7152*b[0]} ${.0722*b[0]} 0 ${b[1]} 0 0 0 1 0"/></filter>`;
 const image=(clipId,filterId)=>sourceHref?`<g clip-path="url(#${id}-${clipId})"><image href="${sourceHref}" x="${-300*panel}" y="0" width="900" height="300" preserveAspectRatio="none"${filterId?` filter="url(#${id}-${filterId})"`:''}/></g>`:'';
 return `<g class="comfort-clothing" data-visible-outfit="${outfit}" data-garment="${layered?'jacket-and-trousers':rainy?'rainwear-and-trousers':'long-trousers'}" aria-hidden="true"><defs>${clip('legs',pants)}${clip('sleeves',jacket)}<clipPath id="${id}-hands">${hands.map(([x,y,rx,ry])=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`).join('')}</clipPath>${filter('denim',[.10,.13],[.12,.23],[.15,.34])}${panel===2?filter('fabric',[.34,.07],[.5,.25],[.47,.27]):filter('fabric',[.42,.10],[.51,.28],[.49,.41])}<linearGradient id="${id}-pants" x1="0" y1="0" x2="1" y2=".25"><stop stop-color="${dark}"/><stop offset=".48" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient><linearGradient id="${id}-jacket" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="${panel===2?'#77c4c1':'#81b5dd'}"/><stop offset=".4" stop-color="${panel===2?'#429896':'#4286bd'}"/><stop offset="1" stop-color="${panel===2?'#236a73':'#25547f'}"/></linearGradient></defs><g class="wardrobe-trousers" fill="url(#${id}-pants)" stroke="${dark}" stroke-width=".65" stroke-linejoin="round">${pants.map(d=>`<path d="${d}"/>`).join('')}</g><g opacity=".28">${image('legs','denim')}</g>${!rainy?`<path d="${seam}" fill="none" stroke="#96b5cf" stroke-width=".65" opacity=".35"/>`:''}${layered?`<g class="wardrobe-jacket" fill="url(#${id}-jacket)" stroke="${panel===2?'#286574':'#30577e'}" stroke-width=".6" stroke-linejoin="round">${jacket.map(d=>`<path d="${d}"/>`).join('')}</g>${image('sleeves','fabric')}<path d="${zipper}" fill="none" stroke="#d7eafa" stroke-width="1" opacity=".7"/>`:''}${hands.length?image('hands'):''}</g>`;
}
