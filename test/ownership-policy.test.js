'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { canonicalSource } = require('../lib/rollout-identity');
const { Recorder, inspectRecorderSources } = require('../lib/recorder');
const { openDatabase } = require('../lib/recorder-db');
const { getHistoricalUsageStats } = require('../lib/stats');
const { upgradeProvenance } = require('../lib/provenance-upgrade');
const cache = require('../lib/verified-history-cache');
const { fixture, record, meta, token, usage, NOW } = require('./helpers');
const measure = n => token({ total_token_usage: usage(n,n/2,10,2), last_token_usage: usage(n,n/2,10,2) });
const marker = id => record('event_msg', { type: 'thread_settings_applied', thread_id: id });
const header = (extra = {}) => record('session_meta', { id:'child', session_id:'family', forked_from_id:'parent',
  parent_thread_id:'parent', multi_agent_version:'v2', history_mode:'paginated',
  source:{subagent:{thread_spawn:{parent_thread_id:'parent'}}}, subagent_history_start_ordinal:4, ...extra });
const fork = (item = marker('parent')) => [header(), meta('parent'), item, measure(100), marker('child'), token(null), measure(20)];
function parse(rows) { const c=canonicalSource(), kept=[]; rows.forEach((r,i)=>{if(c.accept(r,i))kept.push(i);}); c.finish('child'); return kept; }
function edit(f, fn) { const d=openDatabase(f.dbPath); try {return fn(d);} finally {d.close();} }
async function setup(t, rows=fork(), legacy=false) {
  cache.clear();const f=fixture(t); f.dbPath=path.join(f.home,'synthetic.sqlite3'); f.file=f.write('sessions/test.jsonl',rows);
  const r=new Recorder(f); try { f.summary=await r.scan(); } finally {r.close();}
  f.options={home:f.home,dbPath:f.dbPath,from:new Date(NOW-1).toISOString(),to:new Date(NOW+3600000).toISOString(),timezone:'UTC',buckets:'hour',analytics:true};
  f.stats=(options={})=>getHistoricalUsageStats({...f.options,...options});
  if(legacy)edit(f,d=>d.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'"));
  t.after(()=>cache.clear());return f;
}
function rewrite(f,rows) {
  const data=rows.map(r=>JSON.stringify(r)).join('\n')+'\n';fs.writeFileSync(f.file,data);
  edit(f,d=>d.prepare('UPDATE sources SET checkpoint_byte_offset=?,anchor_end_offset=?,last_seen_file_size=?,anchor_sha256=?')
    .run(Buffer.byteLength(data),Buffer.byteLength(data),Buffer.byteLength(data),createHash('sha256').update(data).digest('hex')));
}
const typed = ['item_started','item_completed','agent_message_content_delta','plan_delta',
  'reasoning_content_delta','reasoning_raw_content_delta','token_usage','token_usage_record'];
for(const type of typed) for(const owner of ['parent','child',null]) test(`policy: ${type} inherited owner=${owner}`,()=>{
  const rows=fork(record('event_msg',{type,thread_id:owner}));
  if(owner==='parent')assert.deepEqual(parse(rows),[4,5,6]);else assert.throws(()=>parse(rows),/SOURCE_OWNERSHIP/);
});
const metadata = [
  owner=>record('turn_context',{thread_id:owner}),
  owner=>record('event_msg',{type:'thread_goal_updated',threadId:owner,goal:{threadId:owner}}),
  owner=>record('event_msg',{type:'thread_queue_changed',threadId:owner}),
  owner=>record('event_msg',{type:'session_configured',thread_id:owner,session_id:'family'}),
  owner=>record('event_msg',{type:'session_configured',session_id:owner}),
  owner=>record('event_msg',{type:'collab_agent_spawn_end',sender_thread_id:owner,new_thread_id:'child',agents:[{thread_id:'child'}]}),
  owner=>({...record('response_item',{type:'message',content:[]}),thread_id:owner}),
  owner=>record('token_usage_record',{thread_id:owner})
  ,owner=>record('event_msg',{type:'raw_response_item',item:{type:'message',thread_id:owner,content:[]}})
];
for(const [i,make] of metadata.entries())test(`policy: owner path ${i} validates parent and child, references remain opaque`,()=>{
  const good=fork(make('parent'));
  parse(good);
  assert.throws(()=>parse(fork(make('child'))));
});
test('policy: nested goal contradiction and mixed outer/payload ownership are rejected',()=>{
  for(const r of [record('event_msg',{type:'thread_goal_updated',threadId:'parent',goal:{threadId:'child'}}),
    {...marker('parent'),thread_id:'child'}, {...meta('parent'),payload:{id:'parent',thread_id:'child'}}]) assert.throws(()=>parse(fork(r)),/SOURCE_OWNERSHIP/);
});
test('policy: unknown envelopes, event variants, response variants and JSON null cannot be excluded',()=>{
  for(const r of [record('future',{thread_id:'parent'}),record('event_msg',{type:'future',thread_id:'parent'}),
    record('response_item',{type:'future'}),record('event_msg',{type:'raw_response_item',item:{type:'future'}}),null,42,[]])assert.throws(()=>parse(fork(r)));
});
test('policy: arbitrary thread references inside tool output do not become owners',()=>{
  parse(fork(record('response_item',{type:'function_call_output',output:{thread_id:'child',sender_thread_id:'child'}})));
  parse(fork(record('world_state',{full:true,state:{thread_id:'reference'}})));
  assert.throws(()=>parse(fork(record('world_state',{full:true,state:{},thread_id:'child'}))),/SOURCE_OWNERSHIP_CONFLICT/);
});
test('policy: repeated root and fork headers are supported only with unchanged declarations',()=>{
  parse([meta('child'),meta('child'),measure(20)]);
  const rows=fork();rows.push(header());parse(rows);
  for(const changed of [header({multi_agent_version:'v3'}),header(),meta('child'),header({subagent_history_start_ordinal:5})]){
    const base=changed.payload.forked_from_id? [meta('child'),changed,measure(20)] : [...fork(),changed];
    assert.throws(()=>parse(base));
  }
});
test('policy: repeated copied-parent headers also validate inherited declarations',()=>{
  const rows=fork();rows[2]=meta('parent');parse(rows);
  rows[2].payload.history_base={thread_id:'ancestor',end_ordinal_exclusive:3,end_byte_offset:99};assert.throws(()=>parse(rows),/UNSUPPORTED_INHERITED_HISTORY/);
});
for(const extra of [{history_base:{thread_id:'parent'}},{forked_from_ordinal_exclusive:5},{subagent_history_start_ordinal:5},
  {forked_from_id:'parent'},{multi_agent_version:'v3',parent_thread_id:'parent'}])test(`policy: unsupported declaration ${Object.keys(extra).join(',')} rejected on every header`,()=>{
    for(const repeated of [false,true]){const h=meta('child');Object.assign(h.payload,extra);assert.throws(()=>parse([...(repeated?[meta('child')]:[]),h,measure(20)]),/UNSUPPORTED_INHERITED_HISTORY/);}
  });
test('policy: supplied fork ordinals corroborate actual record order',()=>{
  const rows=fork().map((r,ordinal)=>({...r,ordinal}));parse(rows);
  for(const bad of [-1,null,'2',999]){const copy=structuredClone(rows);copy[2].ordinal=bad;assert.throws(()=>parse(copy));}
  const reordered=structuredClone(rows);[reordered[1],reordered[2]]=[reordered[2],reordered[1]];assert.throws(()=>parse(reordered));
});
test('policy: ordinary roots and non-inheriting children retain unknown records',()=>{
  parse([meta('child'),record('future',{data:{thread_id:'reference'}}),measure(20)]);
  const h=header();delete h.payload.forked_from_id;delete h.payload.subagent_history_start_ordinal;parse([h,measure(20)]);
});
for(const type of ['item_started','item_completed','thread_goal_updated']) for(const legacy of [false,true])test(`recovery: ${type}, legacy=${legacy}, cannot persist or revive invalid history`,async t=>{
  const valid=type==='thread_goal_updated'?record('event_msg',{type,threadId:'parent',goal:{threadId:'parent'}}):record('event_msg',{type,thread_id:'parent'});
  const rows=fork(valid),f=await setup(t,rows,legacy);assert.equal(f.summary.failed_sources,0);assert.equal(f.stats().totals.input.complete,true);
  if(type==='thread_goal_updated')rows[2].payload.goal.threadId='child';else rows[2].payload.thread_id='child';rewrite(f,rows);
  assert.equal(f.stats({verification:'fresh'}).totals.input.complete,false);
  const up=upgradeProvenance(f);assert.equal(up.verified,0);assert.equal(up.conflictingSources,1);
  const archive=path.join(f.home,'archived_sessions','moved.jsonl');fs.mkdirSync(path.dirname(archive));fs.renameSync(f.file,archive);
  assert.equal(f.stats().totals.input.complete,false);fs.unlinkSync(archive);assert.equal(f.stats().totals.input.complete,false);
  cache.clear();assert.equal(f.stats().totals.input.complete,false);
});
test('persistence: pre-v4 numeric-only certificates cannot certify missing source history',async t=>{
  const f=await setup(t,[meta('child'),measure(20)]);
  edit(f,d=>d.exec("DELETE FROM recorder_meta WHERE key LIKE 'ownership_proof_%'"));
  fs.unlinkSync(f.file);cache.clear();assert.equal(f.stats().totals.input.complete,false);
  assert.equal(upgradeProvenance(f).verified,0);cache.clear();assert.equal(f.stats().totals.input.complete,false);
});
test('persistence: rejected numeric-only legacy upgrade survives deletion and cache restart',async t=>{
  const rows=fork();rows.splice(5,1);const f=await setup(t,rows,true);
  rows[2]=record('event_msg',{type:'item_started',thread_id:'child'});rewrite(f,rows);
  assert.equal(f.stats().totals.input.complete,false);assert.equal(upgradeProvenance(f).verified,0);
  fs.unlinkSync(f.file);cache.clear();assert.equal(f.stats().totals.input.complete,false);
});
test('persistence: fresh upgrade and valid archive relocation retain evidence after deletion',async t=>{
  const f=await setup(t,fork(),true),archive=path.join(f.home,'archived_sessions','moved.jsonl');
  fs.mkdirSync(path.dirname(archive));fs.renameSync(f.file,archive);assert.equal(f.stats().totals.input.value,20);
  assert.equal(upgradeProvenance(f).verified,2);fs.unlinkSync(archive);cache.clear();assert.equal(f.stats().totals.input.complete,true);
});
test('Recorder: current ownership proof refreshes earlier event classifications from verified bytes',async t=>{
  const f=await setup(t,[meta('child'),token({}),measure(20)]);
  edit(f,d=>d.exec("UPDATE event_provenance_v1 SET usage_kind='allowance_only' WHERE event_seq=1; DELETE FROM recorder_meta WHERE key LIKE 'ownership_proof_%'"));
  const r=new Recorder(f);try{assert.equal((await r.scan()).failed_sources,0);}finally{r.close();}
  fs.unlinkSync(f.file);cache.clear();assert.equal(f.stats().totals.input.complete,false);
  assert.equal(edit(f,d=>d.prepare('SELECT usage_kind FROM event_provenance_v1 WHERE event_seq=1').get().usage_kind),'usage');
});
for(const variant of ['unsupported','late-supported','changed-boundary'])test(`Recorder and inspection: appended ${variant} header cannot bypass shared policy`,async t=>{
  const f=await setup(t,variant==='changed-boundary'?fork():[meta('child'),measure(20)]);
  const before=edit(f,d=>JSON.stringify(d.prepare('SELECT * FROM telemetry_events').all()));
  const h=header(variant==='unsupported'?{multi_agent_version:'v3'}:variant==='changed-boundary'?{subagent_history_start_ordinal:5}:{});
  fs.appendFileSync(f.file,JSON.stringify(h)+'\n'+JSON.stringify(measure(40))+'\n');
  assert.equal((await inspectRecorderSources(f)).failed_sources,1);
  const r=new Recorder(f);try{assert.equal((await r.scan()).failed_sources,1);}finally{r.close();}
  assert.equal(edit(f,d=>JSON.stringify(d.prepare('SELECT * FROM telemetry_events').all())),before);
});
test('GUI: invalid recovered ownership is incomplete through the historical analytics API',async t=>{
  const f=await setup(t,fork(),true),rows=fork(marker('child'));rewrite(f,rows);
  const server=await require('../lib/gui/server').startServer({...f,port:0});
  try {const boot=await(await fetch(server.url+'/api/bootstrap')).json();
    const q=new URLSearchParams({range:'absolute',from:f.options.from,to:f.options.to,timezone:'UTC',analytics:'1'});
    const response=await fetch(server.url+'/api/stats?'+q,{headers:{'x-codex-hud-token':boot.token}});
    assert.equal(response.status,200);const body=await response.json();assert.equal(body.totals.input.complete,false);assert.equal(body.verification.conflictingSources,1);
  }finally{await server.close();}
});
