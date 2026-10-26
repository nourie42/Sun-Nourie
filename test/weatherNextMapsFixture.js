// Shared fixture: a WeatherNext 3 map catalog shaped exactly like scripts/weather_weathernext_maps.py writes it.
export const HOUR=3600000;
export const runAt=Date.parse('2026-10-25T12:00:00Z');
export const now=runAt+10*HOUR;
const BOUNDS=[[20,-130],[55,-60]];
const stamp='2026102512';
const framesFor=(field,units,hours)=>hours.map(hour=>({file:`weathernext-maps/wn3-${stamp}-${field}-${String(hour).padStart(3,'0')}.png`,time:new Date(runAt+hour*HOUR).toISOString(),hour,bounds:BOUNDS,field,units}));
const hours=[];for(let h=3;h<=48;h+=3)hours.push(h);
export function catalogFixture(){
 return {
  schema:'weather-nourie-weathernext-maps-v1',model:'Google WeatherNext 3',generatedAt:new Date(runAt+8*HOUR).toISOString(),runAt:new Date(runAt).toISOString(),
  sourceTable:'example.weathernext_3',statistic:'ensemble mean',ensembleMembers:64,resolutionDegrees:0.1,sampleDegrees:0.2,bounds:BOUNDS,imageSize:[840,420],missingLayers:[],
  note:'Ensemble-mean WeatherNext forecast maps for the contiguous United States. These are model forecasts, not observations.',
  layers:{
   temperature:{label:'Temperature',units:'°F',description:'Ensemble-mean air temperature 2 m above ground.',
    legend:{thresholds:[20,32,45,60,75,90,105],colors:['rgba(94,62,168,.72)','rgba(58,92,196,.72)','rgba(60,150,220,.72)','rgba(90,190,170,.72)','rgba(240,220,90,.72)','rgba(242,150,60,.72)','rgba(220,70,50,.72)','rgba(150,20,60,.72)']},
    frames:framesFor('temperature','°F',hours)},
   precipitation:{label:'Precipitation (6-hour)',units:'in',description:'Ensemble-mean rain-equivalent precipitation over the preceding six hours.',
    legend:{thresholds:[0.01,0.05,0.1,0.25,0.5,1],colors:['rgba(0,0,0,0)','rgba(120,200,230,.7)','rgba(70,150,230,.74)','rgba(50,100,220,.78)','rgba(90,70,200,.8)','rgba(160,50,180,.82)','rgba(220,40,120,.85)']},
    frames:framesFor('precipitation','in',hours)}
  }
 };
}
export const installWeatherNextMapsSelfTest={catalogFixture,runAt,now};
