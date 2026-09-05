from pathlib import Path
p=Path('public/weather-fusion/experience.js')
s=p.read_text()
old="import {dailyDisplay,temperatureBar,thermalComfort,finite} from './weather-math.js';"
new=old+"\nimport {renderDewpointMeter,resetDewpointMeter} from './dewpoint-meter.js';"
assert old in s and new not in s
s=s.replace(old,new,1)
old="  renderComfortArt(forecast,now);\n"
new="  renderComfortArt(forecast,now);\n  renderDewpointMeter(forecast,now);\n"
assert old in s
s=s.replace(old,new,1)
old="  const tile=$('skin-exposure');if(tile){delete tile.dataset.weather;tile.querySelector('.comfort-weather-art')?.remove();}\n"
new=old+"  resetDewpointMeter();\n"
assert old in s
s=s.replace(old,new,1)
# Correct a tiny HTML escaping typo introduced in the previous evening patch while we're touching this file.
s=s.replace("'\\\"':'&quot'","'\\\"':'&quot;'")
p.write_text(s)
