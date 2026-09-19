import puppeteer from 'puppeteer';

const base=String(process.env.AI_CHAT_BASE_URL||'http://127.0.0.1:3211').replace(/\/$/,'');
const providers=[
  {id:'openai',label:'OpenAI',model:'gpt-5.6',configured:false,healthStatus:'not_connected',healthLabel:'Not connected'},
  {id:'anthropic',label:'Claude',model:'claude-opus-5',configured:true,healthStatus:'ready',healthLabel:'Ready'},
  {id:'gemini',label:'Gemini',model:'gemini-3.1-pro-preview',configured:true,healthStatus:'model_error',healthLabel:'Unavailable'},
  {id:'xai',label:'Grok',model:'grok-4.6',configured:true,healthStatus:'ready',healthLabel:'Ready'},
];
const bots=[
  {id:'shop',name:'Shopping Helper',role:'Find and compare products',provider:'anthropic',instructions:'Compare products.',color:'#1687ff',tools:{webSearch:true}},
  {id:'everyday',name:'Everyday Helper',role:'Help with everyday questions and tasks',provider:'anthropic',instructions:'Be practical.',color:'#00c877',tools:{webSearch:true}},
  {id:'grok-boy',name:'Grok Boy',role:'Personal helper',provider:'xai',instructions:'Challenge weak recommendations.',color:'#8b46ff',tools:{webSearch:true}},
];

const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-setuid-sandbox']});
const page=await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Linux; Android 17; SM-S948U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36');
await page.setViewport({width:412,height:915,deviceScaleFactor:1,isMobile:true,hasTouch:true});
page.setDefaultTimeout(30000);

let startCalls=0,pollCalls=0;
const browserErrors=[];
page.on('pageerror',e=>browserErrors.push(e.stack||e.message||String(e)));
page.on('requestfailed',req=>browserErrors.push(req.url()+' '+(req.failure()?.errorText||'failed')));

await page.setRequestInterception(true);
page.on('request',req=>{
  const url=new URL(req.url());
  if(url.origin!==new URL(base).origin)return req.continue();
  const path=url.pathname;
  if(path==='/api/ai-agent/status'){
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true,providers,configuredCount:3,readyCount:2,checkedCount:3,autoChecked:true})});
  }
  if(path==='/api/ai-agent/provider-health'){
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true,providers,checked:providers.filter(p=>p.configured),readyCount:2})});
  }
  if(path==='/api/ai-agent/location'){
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify({ok:true,location:{city:'Knightdale',area:'North Carolina',country:'US',timezone:'America/New_York'}})});
  }
  if(path==='/api/ai-agent/bots/run'&&req.method()==='POST'){
    startCalls+=1;
    return req.respond({status:202,contentType:'application/json',body:JSON.stringify({
      ok:true,accepted:true,jobId:'room-ui-test',status:'running',
      progress:{phase:'queued',round:0,rounds:1,completedTurns:0,totalTurns:3,message:'Hot Room queued…'},
      pollUrl:'/api/ai-agent/bots/run/room-ui-test'
    })});
  }
  if(path==='/api/ai-agent/bots/run/room-ui-test'&&req.method()==='GET'){
    pollCalls+=1;
    if(pollCalls<3){
      return req.respond({status:200,contentType:'application/json',body:JSON.stringify({
        ok:true,jobId:'room-ui-test',status:'running',
        progress:{phase:'round',round:1,rounds:1,completedTurns:pollCalls,totalTurns:3,message:`Round 1 of 1 · ${pollCalls} of 3 bot turns complete…`}
      })});
    }
    return req.respond({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,jobId:'room-ui-test',status:'complete',
      progress:{phase:'complete',round:1,rounds:1,completedTurns:3,totalTurns:3,message:'Hot Room finished.'},
      result:{
        ok:true,topic:'washer dryer',mode:'debate',rounds:1,summary:'Team answer: compare cleaning, speed, pet hair, energy use, and reliability.',
        turns:[
          {round:1,botId:'shop',name:'Shopping Helper',provider:'anthropic',ok:true,text:'Claude shopping answer',webSearchUsed:true},
          {round:1,botId:'everyday',name:'Everyday Helper',provider:'anthropic',ok:true,text:'Claude everyday answer',webSearchUsed:true},
          {round:1,botId:'grok-boy',name:'Grok Boy',provider:'xai',ok:true,text:'Grok answer',webSearchUsed:true},
        ],citations:[],attachments:[],location:{city:'Knightdale'},webSearchUsed:true
      }
    })});
  }
  req.continue();
});

await page.evaluateOnNewDocument(({bots})=>{
  localStorage.setItem('ai-council-bots-v1',JSON.stringify(bots));
  localStorage.setItem('ai-council-selected-bots-v1',JSON.stringify(bots.map(b=>b.id)));
  sessionStorage.setItem('ai-council-access','browser-smoke');
},{bots});

try{
  const response=await page.goto(base+'/ai-council/bots/?view=hot&hot-room-smoke='+Date.now(),{waitUntil:'networkidle2',timeout:60000});
  if(response?.status()!==200)throw new Error('Bots page returned '+response?.status());
  await page.waitForSelector('#hotPanel.active');
  await page.waitForFunction(()=>document.querySelectorAll('#hotPicker input[type="checkbox"]:checked').length===3);
  await page.type('#roomTopic','Tell me the best washer and dryer for pets, fastest cycles, energy use, and stain cleaning.');
  await page.select('#roomMode','debate');
  await page.select('#roomRounds','1');
  await page.click('#runRoomBtn');
  await page.waitForFunction(()=>document.querySelector('#roomNotice')?.textContent?.includes('Round 1 of 1'),{timeout:15000});
  await page.waitForFunction(()=>document.querySelector('#roomNotice')?.textContent?.includes('Hot Room finished.'),{timeout:20000});

  const state=await page.evaluate(()=>({
    notice:document.querySelector('#roomNotice')?.textContent?.trim(),
    results:document.querySelector('#roomResults')?.textContent?.trim(),
    buttonDisabled:document.querySelector('#runRoomBtn')?.disabled,
    script:[...document.scripts].map(s=>s.src).find(src=>src.includes('bots-v2.js'))||''
  }));
  if(startCalls!==1)throw new Error('Expected one Hot Room start request, got '+startCalls);
  if(pollCalls<3)throw new Error('Hot Room UI did not poll background job enough times: '+pollCalls);
  if(!state.results.includes('Team Answer'))throw new Error('Team Answer was not rendered.');
  for(const name of ['Shopping Helper','Everyday Helper','Grok Boy'])if(!state.results.includes(name))throw new Error(name+' result missing.');
  if(state.buttonDisabled)throw new Error('Start Hot Room button stayed disabled after completion.');
  if(!state.script.includes('bots-v2.js?v=5'))throw new Error('New Hot Room client was not loaded: '+state.script);
  if(/connection to the AI service closed/i.test(state.notice))throw new Error('Old disconnect error was displayed.');
  if(browserErrors.length)throw new Error('Browser errors: '+browserErrors.join(' | '));
  console.log('HOT_ROOM_UI',JSON.stringify({startCalls,pollCalls,...state}));
  console.log('Hot Room browser smoke passed');
}finally{
  await browser.close();
}
