'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { fixture } = require('./helpers');
const { openDatabase, openReadOnlyDatabase } = require('../lib/recorder-db');
const { getHistoricalUsageStats } = require('../lib/stats');
const { heatmapPeriod } = require('../lib/stats-buckets');
const columns = ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'];
const before = '2026-01-01T11:00:00Z', at = '2026-01-01T12:30:00Z';
function setup(t) {
  const f = fixture(t), dbPath = path.join(f.home,'analytics.sqlite3'), db = openDatabase(dbPath); db.close();
  function insert({session = 's1', seq = 1, time = at, model = 'alpha', effort = 'high', turn = 't1', current = [100,60,20,10], last = current} = {}) {
    const writer = openDatabase(dbPath);
    try {
      writer.prepare("INSERT OR IGNORE INTO sources (session_id,current_path,checkpoint_byte_offset,last_event_seq,anchor_start_offset,anchor_end_offset,anchor_sha256,last_seen_file_size,updated_at) VALUES (?, 'synthetic', 0, 0, 0, 0, 'synthetic', 0, ?)").run(session,at);
      writer.prepare('INSERT INTO telemetry_events (session_id,event_seq,event_timestamp,model,reasoning_effort,turn_id,' + columns.flatMap(c => [c,'cumulative_'+c]).join(',') + ') VALUES (' + Array(14).fill('?').join(',') + ')')
        .run(session,seq,time,model,effort,turn,...columns.flatMap((_,i) => [last[i] ?? null,current[i] ?? null]));
    } finally {writer.close();}
  }
  const stats = (options = {}) => getHistoricalUsageStats({home:f.home,dbPath,from:'2026-01-01T12:00:00Z',to:'2026-01-01T16:00:00Z',timezone:'UTC',buckets:'hour',analytics:true,...options});
  return {...f,dbPath,insert,stats};
}
const sum = (groups,key) => groups.reduce((n,g) => n + (g.totals[key].value || 0),0);
test('analytics: models, efforts, cross groups and time buckets reconcile without changing canonical Stats', t => {
  const f = setup(t); f.insert({seq:1,time:before});
  f.insert({seq:2,model:'beta',effort:'medium',current:[160,90,35,15],last:[60,30,15,5]});
  f.insert({seq:3,model:'alpha',effort:'high',current:[200,110,40,18],last:[40,20,5,3]});
  f.insert({session:'s2',model:null,effort:null,current:[20,5,2,1]});
  const s = f.stats(), baseline = f.stats({analytics:false});
  const {analytics, ...rest} = s; assert.deepEqual(rest,baseline);
  for (const key of ['input','cached','fresh','output','reasoning']) {
    for (const groups of [analytics.models,analytics.efforts,analytics.cross]) assert.equal(sum(groups,key),s.totals[key].value);
    for (const group of analytics.models) assert.equal(group.buckets.reduce((n,b) => n + (b.totals[key].value || 0),0),group.totals[key].value || 0);
  }
  assert.equal(analytics.models.reduce((n,g) => n+g.usageEvents,0),s.activity.usageEvents);
});
test('analytics: time, model and effort filters run after full predecessor adjacency', t => {
  const f = setup(t); f.insert({time:before,current:[100,50,10,5]});
  f.insert({seq:2,model:'beta',effort:'medium',current:[160,80,20,10],last:[60,30,10,5]});
  f.insert({seq:3,current:[200,100,30,15],last:[40,20,10,5]});
  const a = f.stats({filters:{model:'alpha',effort:'high'}}).analytics;
  assert.equal(a.totals.input.value,40); assert.equal(a.models.find(g=>g.model==='alpha').totals.input.value,40);
  assert.equal(a.models.find(g=>g.model==='alpha').shares.input.value,100);
  assert.equal(f.stats({filters:{model:'beta'}}).analytics.totals.input.value,60);
});
test('analytics: ambiguous model and effort transitions remain Unknown; safe snapshot transitions attribute', t => {
  const f = setup(t); f.insert({time:before,current:[100,50,10,5]});
  f.insert({seq:2,model:'beta',effort:'medium',current:[160,80,30,10],last:[10,5,2,1]});
  f.insert({seq:3,model:'beta',effort:'high',current:[180,90,35,12],last:[20,10,5,2]});
  const a = f.stats().analytics;
  assert.equal(a.models.find(g=>g.model===null).totals.input.value,60);
  assert.equal(a.models.find(g=>g.model==='beta').totals.input.value,20);
  assert.equal(a.efforts.find(g=>g.effort===null).totals.input.value,60);
  assert.equal(a.efforts.find(g=>g.effort==='high').totals.input.value,20);
});
test('analytics: effort ambiguity alone does not discard reliable model attribution', t => {
  const f = setup(t); f.insert({time:before,current:[100,50,10,5]});
  f.insert({seq:2,effort:'medium',current:[160,80,30,10],last:[10,5,2,1]});
  const a = f.stats().analytics;
  assert.equal(a.models.find(g=>g.model==='alpha').totals.input.value,60);
  assert.equal(a.efforts.find(g=>g.effort===null).totals.input.value,60);
});
test('analytics: missing metrics and sequence gaps remain metric independent and cannot skip predecessors', t => {
  const f = setup(t); f.insert({time:before,current:[100,50,10,5]});
  f.insert({seq:2,current:[null,60,15,7],last:[null,10,5,2]});
  f.insert({seq:3,current:[160,80,20,9],last:[60,20,5,2]});
  f.insert({seq:5,current:[200,100,30,12],last:[40,20,10,3]});
  const a = f.stats().analytics, g = a.models.find(g=>g.model==='alpha');
  assert.equal(g.totals.input.value,null); assert.equal(g.totals.output.value,10); assert.equal(g.totals.output.complete,false);
  assert.equal(g.shares.input.value,null); assert.equal(g.cacheRatio.value,null);
  assert.equal(a.totals.cached.value,30); assert.equal(a.totals.fresh.value,null);
});
test('analytics: events are positive deltas; observed turns use canonical session + turn IDs; sessions overlap', t => {
  const f=setup(t); f.insert(); f.insert({seq:2,current:[100,60,20,10]});
  f.insert({seq:3,current:[120,70,25,12],last:[20,10,5,2]});
  f.insert({seq:4,model:'beta',current:[140,80,30,14],last:[20,10,5,2]});
  f.insert({session:'s2',model:'beta'});
  const s=f.stats(), a=s.analytics, alpha=a.models.find(g=>g.model==='alpha'), beta=a.models.find(g=>g.model==='beta');
  assert.equal(alpha.usageEvents,2); assert.equal(alpha.observedTurns.value,1); assert.equal(alpha.distinctSessions,1);
  assert.equal(beta.observedTurns.value,2); assert.equal(beta.distinctSessions,2); assert.equal(s.activity.sessions,2);
  assert.equal(alpha.distinctSessions+beta.distinctSessions,3);
});
test('analytics: unknown model, effort and turn identities stay explicit and never use current session metadata', t => {
  const f=setup(t); f.insert({model:null,effort:null,turn:null,current:[40,20,4,2]});
  const a=f.stats().analytics, unknown=a.models.find(g=>g.model===null);
  assert.equal(unknown.totals.input.value,40); assert.equal(unknown.observedTurns.value,0); assert.equal(unknown.observedTurns.complete,false);
  assert.equal(unknown.observedTurns.unknownIdentityEvents,1); assert.equal(a.efforts.find(g=>g.effort===null).totals.input.value,40);
  assert.equal(unknown.shares.input.value,100);
});
test('analytics: percentage denominators include Unknown and subsets are never added to combined workload', t => {
  const f=setup(t); f.insert({current:[80,60,10,8]}); f.insert({session:'s2',model:null,current:[20,10,10,5]});
  const a=f.stats().analytics, alpha=a.models.find(g=>g.model==='alpha');
  assert.equal(alpha.shares.input.value,80); assert.equal(alpha.shares.combined.value,75);
  assert.equal(alpha.shares.combined.denominatorValue,120); assert.equal(alpha.cacheRatio.value,75);
  assert.match(alpha.shares.input.denominator,/including Unknown/);
  assert.equal(f.stats({filters:{model:'absent'}}).analytics.models[0].shares.input.value,null);
});
test('analytics: untimed workload flags only its metrics and withholds affected shares/cohorts', t => {
  const f=setup(t); f.insert({time:null,current:[0,0,5,2]}); f.insert({seq:2,current:[50,30,10,4],last:[50,30,5,2]});
  const s=f.stats(), alpha=s.analytics.models.find(g=>g.model==='alpha');
  assert.equal(alpha.shares.input.value,100); assert.equal(alpha.shares.output.value,null);
  assert.equal(alpha.totals.input.complete,true); assert.equal(alpha.totals.output.complete,false);
  assert.equal(alpha.observedTurns.complete,false); assert.equal(alpha.buckets[0].state,'incomplete');
});
test('analytics: local day grouping and repeated fall DST hours reconcile for filtered models', t => {
  const f=setup(t); f.insert({time:'2025-11-02T08:30:00Z'}); f.insert({seq:2,time:'2025-11-02T09:30:00Z',current:[150,90,30,15],last:[50,30,10,5]});
  const options={from:'2025-11-02T07:00:00Z',to:'2025-11-02T12:00:00Z',timezone:'America/Vancouver',filters:{model:'alpha'}};
  const s=f.stats(options), g=s.analytics.models.find(g=>g.model==='alpha');
  assert.equal(g.buckets.length,5); assert.equal(g.buckets[1].totals.input.value,100); assert.equal(g.buckets[2].totals.input.value,50);
  const days=f.stats({...options,buckets:'day'}).analytics.models.find(g=>g.model==='alpha'); assert.equal(days.buckets.length,1); assert.equal(days.buckets[0].totals.input.value,150);
});
test('analytics: read-only grouping does not alter events, schema or Recorder metadata', t => {
  const f=setup(t); f.insert();
  const snapshot=()=>{const db=openReadOnlyDatabase(f.dbPath);try{return JSON.stringify(['sqlite_schema','recorder_meta','sources','telemetry_events'].map(table=>db.prepare('SELECT * FROM '+table).all()));}finally{db.close();}};
  const original=snapshot();f.stats();f.stats({filters:{model:'alpha'}});assert.equal(snapshot(),original);
});
test('analytics: many transitions reconcile even with duplicates, nulls, unknown timestamps and filters', t => {
  const f=setup(t);
  for(let session=0;session<5;session++)for(let i=0;i<35;i++) {
    const total=i*10;f.insert({session:'fuzz-'+session,seq:i+1,model:i%4===0?null:'m'+i%3,effort:i%6===0?null:i%2?'medium':'high',turn:i%7===0?null:'t'+Math.floor(i/4),time:i===7?null:at,
      current:[i===11?null:total,total*.6,total*.2,total*.1],last:i===0?[0,0,0,0]:[10,6,2,1]});
  }
  const s=f.stats();for(const key of ['input','cached','fresh','output','reasoning'])for(const groups of [s.analytics.models,s.analytics.efforts,s.analytics.cross])assert.equal(sum(groups,key),s.totals[key].value);
  for(const model of s.analytics.modelOptions){const filtered=f.stats({filters:{model}}).analytics;for(const key of ['input','cached','fresh','output','reasoning'])assert.equal(filtered.totals[key].value??0,s.analytics.models.find(g=>g.model===model)?.totals[key].value??0);}
});
test('heatmap: expanded calendar windows and week navigation preserve local calendar counts across DST',t=>{
  const f=setup(t), now=Date.parse('2025-11-03T12:00:00Z');
  for(const weeks of [12,26,52])for(const offset of [0,1]){
    const options=heatmapPeriod(now,'America/Vancouver',weeks,offset),s=f.stats({...options,analytics:false});
    assert.equal(s.buckets.length,weeks*7);
  }
  assert.throws(()=>heatmapPeriod(now,'UTC',100),/Invalid heatmap/); assert.throws(()=>heatmapPeriod(now,'UTC',12,-1),/Invalid heatmap/);
});
test('chart display: adaptive zero-based axes grow beyond 43M and retain legible major/minor intervals', async()=>{
  const {niceAxis}=await import('../gui/src/chart-math.mjs');
  const axis=niceAxis(43000000,true);assert.equal(axis.maximum,50000000);assert.equal(axis.step,5000000);assert.equal(axis.ticks[0],0);assert.equal(axis.minor.length,10);
  for(const max of [0,7,999,5300000000]){const a=niceAxis(max,true);assert(a.maximum>=max);assert(a.ticks.length<=12);assert.equal(a.ticks[0],0);}
});
test('chart display: dashed guides connect only known endpoints across missing buckets without synthetic values', async()=>{
  const {gapGuides}=await import('../gui/src/chart-math.mjs');
  const b=(key,value,state='observed',complete=true)=>({key,observations:state==='missing'?0:1,state,totals:{input:{value,complete}}});
  const buckets=[b('a',8),b('b',0,'missing'),b('c',0,'zero'),b('d',null,'incomplete',false),b('e',0,'missing'),b('f',10)];
  const before=JSON.stringify(buckets),guides=gapGuides(buckets,'input');
  assert.deepEqual(guides,[[{x:'a',y:8},{x:'c',y:0}]]);assert.equal(JSON.stringify(buckets),before);
});
