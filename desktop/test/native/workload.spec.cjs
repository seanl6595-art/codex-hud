'use strict';
const {test,expect}=require('@playwright/test'),fs=require('node:fs'),path=require('node:path');
const {Recorder}=require('../../../lib/recorder');
const {fixture,launch,ready,close,api,status,memory,pause,until,snapshot,attachJSON,createProfile,cleanupProfiles}=require('./helpers.cjs');
let current;
test.afterAll(()=>cleanupProfiles());
test.afterEach(async()=>{if(current){try{await close(current)}catch{await current.app.close()}current=null;}});
function usage(input,output){return{input_tokens:input,cached_input_tokens:input*.4,output_tokens:output,reasoning_output_tokens:output/2,total_tokens:input+output};}
function event(timestamp,totalInput,totalOutput,lastInput=10,lastOutput=2){return{type:'event_msg',timestamp:new Date(timestamp).toISOString(),payload:{type:'token_count',info:{total_token_usage:usage(totalInput,totalOutput),last_token_usage:usage(lastInput,lastOutput),model_context_window:200000}}};}
test('large synthetic history preserves exact independent totals and warm Statistics speed',async({},info)=>{
  test.setTimeout(120000);
  const root=info.outputPath('large'),home=path.join(root,'codex-home'),dbPath=path.join(root,'history.sqlite3'),profile=createProfile();fs.mkdirSync(path.join(home,'sessions'),{recursive:true});
  const sessions=24,eventsPerSession=2000,start=Date.now()-12*3600000;
  for(let j=0;j<sessions;j++){
    const records=[{type:'session_meta',timestamp:new Date(start).toISOString(),payload:{id:'large-synthetic-'+j,cwd:'C:/Synthetic/Desktop-Large'}},{type:'turn_context',payload:{turn_id:'turn-'+j,model:'synthetic-model',effort:'high'}}];
    for(let i=1;i<=eventsPerSession;i++)records.push(event(start+i*1000,i*10,i*2));
    fs.writeFileSync(path.join(home,'sessions','large-'+j+'.jsonl'),records.map(JSON.stringify).join('\n')+'\n');
  }
  const f={home,dbPath,profile};const recorder=new Recorder(f);try{const scan=await recorder.scan();expect(scan.errors).toEqual([]);}finally{recorder.close();}
  const before=snapshot(f);current=await launch(f);const startup=await ready(current);
  const times=[];
  for(const hours of [24,48,168,24]){
    const began=performance.now(),response=await api(current,'/api/stats?range=lookback&hours='+hours+'&timezone=UTC'),stats=await response.json();times.push(performance.now()-began);
    expect(response.status).toBe(200);expect(stats.totals.input.value).toBe(sessions*eventsPerSession*10);expect(stats.totals.output.value).toBe(sessions*eventsPerSession*2);expect(stats.activity.usageEvents).toBe(sessions*eventsPerSession);
  }
  expect(Math.max(...times.slice(1))).toBeLessThan(4000);
  const mem=await memory(current),stopped=await close(current);current=null;expect(snapshot(f)).toEqual(before);
  await attachJSON(info,'large-history',{sessions,events:sessions*eventsPerSession,expectedInput:sessions*eventsPerSession*10,startup,queryMs:times,memory:mem,stopped});
});
test('sustained Recorder append/stop/restart, idle CPU and memory remain observable',async({},info)=>{
  const soakSeconds=Number(process.env.CODEX_HUD_DESKTOP_SOAK_SECONDS||90);
  if(!Number.isFinite(soakSeconds)||soakSeconds<10||soakSeconds>7200)throw Error('Soak duration must be 10–7200 seconds.');
  test.setTimeout(soakSeconds*1000+60000);
  const f=await fixture(info.outputPath('sustained'),'missing');current=await launch(f);await ready(current,'missing');
  // Initial fixture was never recorded. The GUI remains idle until this POST.
  expect(fs.existsSync(f.dbPath)).toBe(false);await api(current,'/api/recorder/start',{method:'POST'});
  const baseline=await memory(current),initial=(await(await api(current,'/api/recorder')).json()).events;
  const file=path.join(f.home,'sessions','synthetic-session-0.jsonl');
  const records=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse),last=records.filter(r=>r.payload?.info?.total_token_usage).at(-1).payload.info.total_token_usage;
  const runStarted=performance.now(),cycles=Math.ceil(soakSeconds/5);
  for(let i=1;i<=cycles;i++){
    // Advance every reported counter consistently; the last sample is independent
    // of the historical last-usage fields. Only this disposable source is appended.
    const total={...last,input_tokens:last.input_tokens+i*10,cached_input_tokens:last.cached_input_tokens+i*4,output_tokens:last.output_tokens+i*2,reasoning_output_tokens:last.reasoning_output_tokens+i,total_tokens:last.total_tokens+i*12};
    fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'token_count',info:{total_token_usage:total,last_token_usage:usage(10,2),model_context_window:200000}}})+'\n');
    await pause(5000);
  }
  await until(async()=>(await(await api(current,'/api/recorder')).json()).events===initial+cycles,15000);
  const sustained=await memory(current);await api(current,'/api/recorder/stop',{method:'POST'});
  expect((await(await api(current,'/api/recorder')).json()).running).toBe(false);
  await current.app.evaluate(({app})=>app.getAppMetrics());const cpuStart=await memory(current);await pause(10000);const idle=await memory(current);
  const idleCPUSeconds=idle.processes.reduce((sum,p)=>sum+p.CPU,0)-cpuStart.processes.reduce((sum,p)=>sum+p.CPU,0);
  const stopped=await close(current);current=null;
  current=await launch(f);await ready(current);const final=await(await api(current,'/api/recorder')).json();expect(final.running).toBe(false);expect(final.events).toBe(initial+cycles);
  await attachJSON(info,'sustained-recorder',{durationMs:performance.now()-runStarted,appendCycles:cycles,initialEvents:initial,finalEvents:final.events,baseline,sustained,idle,idleCPUSeconds,idleOneCorePercent:idleCPUSeconds/10*100,stopped,note:cycles*5+' seconds of active appends plus 10 seconds idle; not an overnight soak.'});
});
