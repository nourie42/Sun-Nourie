import express from 'express';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const weatherRoot=fileURLToPath(new URL('../public/weather-fusion/',import.meta.url));
const nextRoot=fileURLToPath(new URL('../public/experimental/next-gen/',import.meta.url));
export const NEXT_GEN_ROUTE='/experimental/next-gen';
export const NEXT_GEN_LINK='<a class="experimental-wn-link" id="next-gen-link" href="/experimental/next-gen/" aria-label="Open Weather Nourie Next Gen">Weather Nourie Next Gen <span aria-hidden="true">↗</span></a>';

export function experimentalWithNextGen(html){
  return html.includes('id="next-gen-link"')?html:html.replace('<div class="shell">','<div class="shell">'+NEXT_GEN_LINK);
}

/** The existing controller still owns all requests, calculations and detail
 * components. Only this separate document's presentation and PWA are replaced. */
export function nextGenDocument(original,shell){
  const controller=original.match(/<script type="module" src="([^"]*\/app\.js[^"]*)"/);
  if(!controller)throw new Error('The existing weather controller could not be found.');
  let html=original.replace(/<title>[\s\S]*?<\/title>/,'<title>Weather Nourie — Next Gen</title>');
  html=html.replace(/<script\b[^>]*\ssrc="([^"]+)"[^>]*>[\s\S]*?<\/script>/g,(tag,src)=>/\/(best-times|gross-toggle|week-toggle|collapse)\.js\b/.test(src)?tag:'');
  html=html.replace(/<link\b[^>]*(?:manifest|pwa-bridge\.css|apple-touch-icon)[^>]*>/g,'');
  html=html.replace(/<meta\b[^>]*name="theme-color"[^>]*>/g,'');
  html=html.replace('</head>',`<meta name="theme-color" content="#123c50"><meta name="apple-mobile-web-app-capable" content="yes"><link rel="manifest" href="${NEXT_GEN_ROUTE}/manifest.webmanifest"><link rel="stylesheet" href="${NEXT_GEN_ROUTE}/next-gen.css?v=2"></head>`);
  html=html.replace(/<body\b[^>]*>/,`<body class="next-gen" data-controller="${controller[1]}">${shell}<div id="ng-legacy" hidden aria-hidden="true">`);
  // Make the existing experimental model-map controls available to this shell.
  html=html.replace(/(<button class="selected" data-layer="radar"[^>]*>[\s\S]*?<\/button>)/,'$1'+[['hrrr','HRRR'],['ecmwf','ECMWF rain'],['nbm','NBM rain'],['temperature','Temperature'],['wind','Wind'],['clouds','Clouds']].map(([id,label])=>`<button type="button" data-layer="${id}" aria-pressed="false">${label}</button>`).join(''));
  const dialogs=[];
  html=html.replace(/<dialog\b[\s\S]*?<\/dialog>/g,tag=>{dialogs.push(tag);return '';});
  return html.replace('</body>',`</div><div class="ng-legacy-dialogs">${dialogs.join('')}</div><script type="module" src="${NEXT_GEN_ROUTE}/app.js?v=2"></script></body>`);
}

export function registerWeatherNextGenRoutes(app){
  app.get(['/weather-fusion/experimental-weather.html'],async(_req,res,next)=>{
    try{res.set('Cache-Control','no-cache').type('html').send(experimentalWithNextGen(await readFile(weatherRoot+'index.html','utf8')));}catch(error){next(error);}
  });
  app.get([NEXT_GEN_ROUTE,NEXT_GEN_ROUTE+'/'],async(_req,res,next)=>{
    try{
      const [original,shell]=await Promise.all([readFile(weatherRoot+'index.html','utf8'),readFile(nextRoot+'shell.html','utf8')]);
      res.set('Cache-Control','no-cache').set('X-Content-Type-Options','nosniff').type('html').send(nextGenDocument(original,shell));
    }catch(error){next(error);}
  });
  app.use(NEXT_GEN_ROUTE+'/',express.static(nextRoot,{index:false,etag:true,setHeaders(res,path){
    if(path.endsWith('sw.js'))res.setHeader('Cache-Control','no-cache');
    if(path.endsWith('.webmanifest'))res.setHeader('Content-Type','application/manifest+json');
  }}));
}
