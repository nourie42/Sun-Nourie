import test from 'node:test';
import assert from 'node:assert/strict';
import {buildForecastWindows} from '../public/weather-fusion/forecast-windows.js';
import {forecastWindowBannerHTML,forecastWindowDetailHTML} from '../public/weather-fusion/forecast-window-banners.js';
import {thermalComfort} from '../public/weather-fusion/weather-math.js';

const HOUR = 3600000;
const base = Date.parse('2026-09-26T12:00:00Z');
const at = (hour, start=base) => new Date(start+hour*HOUR).toISOString();
const location={timeZone:'America/New_York',latitude:35.79,longitude:-78.48};

test('main-page forecast and storm controls remain visible without a qualifying window',()=>{
  const view=buildForecastWindows({},base);
  const perfect=forecastWindowBannerHTML(view,'perfect',base),rain=forecastWindowBannerHTML(view,'rain',base);
  assert.match(perfect,/data-forecast-window="perfect"/);assert.match(perfect,/Perfect weather ahead/);
  assert.match(rain,/data-forecast-window="rain"/);assert.match(rain,/Rain &amp; storm outlook/);
  assert.match(forecastWindowDetailHTML(view,'perfect','Knightdale',base),/No matching hours in the next 5 days/);
  assert.match(forecastWindowDetailHTML(view,'rain','Knightdale',base),/No matching hours in the next 5 days/);
});

function refreshHour(data,index){
  const hour=data.hours.find(row=>Date.parse(row.time)===Date.parse(data.metricForecasts.series.feels[index].time));
  const point=data.metricForecasts.series.feels[index],inputs=point.inputs,time=Date.parse(point.time);
  hour.temperature=inputs.temperature;hour.dewpoint=inputs.dewpoint;hour.skyCover=inputs.skyCover;hour.condition=inputs.condition;
  const temperature=data.metricForecasts.series.temperature?.find(row=>Date.parse(row.time)===time);if(temperature)temperature.value=inputs.temperature;
  const comfort=thermalComfort(inputs,data.location,time);
  point.value=Number(comfort.rawOutdoors.toFixed(1));point.daylight=comfort.daylight;point.condition=inputs.condition;
}
function setSunTemperature(data,index,target){
  const point=data.metricForecasts.series.feels[index],inputs=point.inputs,time=Date.parse(point.time);
  let air=target;
  for(let n=0;n<8;n++){
    inputs.temperature=air;refreshHour(data,index);
    const comfort=thermalComfort(inputs,data.location,time),sun=air+comfort.rawOutdoors-comfort.rawShade;
    air+=target-sun;
  }
  inputs.temperature=air;refreshHour(data,index);
}

function fixture(count=4, start=base) {
  const hours = Array.from({length:count},(_,index) => ({t