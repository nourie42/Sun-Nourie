from pathlib import Path
p=Path('public/weather-fusion/experience.js')
s=p.read_text()
old="import {dailyDisplay,temperatureBar,thermalComfort,finite} from './weather-math.js';"
new=old+"\nimport {renderDewpointMeter,resetDewpointMeter} from './dewpoint-meter.js';"
assert old in s and new not in s
s=s.replace(old,new,1)
needle="renderComfortArt(forecast,now);"
assert needle in s and "renderDewpointMeter(forecast,now);" not in s
s=s.replace(needle,needle+"\n renderDewpointMeter(forecast,now);",1)
needle="const tile=$('skin-exposure');if(tile){delete tile.dataset.weather;tile.querySelector('.comfort-weather-art')?.remove();}"
assert needle in s and "resetDewpointMeter();" not in s
s=s.replace(needle,needle+"\n resetDewpointMeter();",1)
# Correct a tiny HTML escaping typo introduced in the previous evening patch while we're touching this file.
s=s.replace("'\\\"':'&quot'","'\\\"':'&quot;'")
p.write_text(s)
