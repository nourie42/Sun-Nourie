from pathlib import Path
import re

def edit(name,old,new):
 p=Path(name);s=p.read_text()
 if new in s:return
 if old not in s:raise RuntimeError('Expected source not found: '+name)
 p.write_text(s.replace(old,new))

p='public/weather-fusion/exposure-scene.js'
edit(p,"import {weatherState} from './weather-state.js';","import {weatherState} from './weather-state.js';\nimport {clothingArtwork} from './comfort-clothing.js?v=wardrobe-v1';")
edit(p,"if(value>=58)return 'mild';","if(value>=65)return 'mild';")
edit(p,"if(finite(feels)&&feels<40)return {key:'cold'","if(finite(feels)&&feels<42)return {key:'cold'")
edit(p,"mild:'everyday mild-weather clothing'","mild:'a top and long pants'")
edit(p,"${symbol}</svg>`;","${clothingArtwork(panel,scene.key,clothingForFeels(feels),comfortSceneUrl(scene.asset))}${symbol}</svg>`;")
edit(p,'aria-label="${label}" data-scene="${scene.key}"','aria-label="${label}; clothing: ${normalClothing}" data-scene="${scene.key}"')
edit('src/weatherFusion.js',"'experience.js','exposure-scene.js','forecast-cards.css'","'experience.js','exposure-scene.js','comfort-clothing.js','forecast-cards.css'")
modules=['exposure-scene','personal-details','pavement','experience','app']
for path in Path('public/weather-fusion').glob('*.js'):
 if path.name not in ['app.js','experience.js','personal-details.js','pavement.js']:continue
 s=path.read_text()
 for m in modules:s=re.sub(r'(?<=\./'+re.escape(m)+r'\.js\?v=)[A-Za-z0-9_-]+','wardrobe-v1',s)
 path.write_text(s)
p=Path('public/weather-fusion/index.html');s=p.read_text();s=re.sub(r'(?<=/weather-fusion/app\.js\?v=)[A-Za-z0-9_-]+','wardrobe-v1',s);p.write_text(s)
p=Path('test/weatherFusionForecastDetails.test.js');s=p.read_text()
for m in modules:
 s=re.sub(re.escape(m)+r'\\\.js\\\?v=[A-Za-z0-9_-]+',lambda _:m+r'\.js\?v=wardrobe-v1',s)
p.write_text(s)
edit('test/weatherFusionClearGraph.test.js',"[58,'mild']","[58,'cool']")
edit('test/weatherFusionForecastDetails.test.js',r'forecast-cards\.css\?v=weather-qa-v70',r'forecast-cards\.css\?v=real-clouds-v2')
print('Integrated visible weather-dependent clothing; weather data and layout unchanged.')
