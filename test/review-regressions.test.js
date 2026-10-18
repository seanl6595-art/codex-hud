'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {fixture,meta,context,token,usage,record}=require('./helpers');
const {Recorder,inspectRecorderSources}=require('../lib/recorder');
const {getHistoricalUsageStats}=require('../lib/stats');
const {startServer}=require('../lib/gui/server');
function forkRecords(id='child',options={}) {
  const inherited=[meta('parent'),context('parent-turn','parent-model'),token({total_token_usage:usage(10000,6000,1000,500),last_token_usage:usage(10000,6000,1000,500)})];
  const header=record('session_meta',{id,session_id:'parent',forked_from_id:'parent',parent_thread_id:'parent',multi_agent_version:'v2',history_mode:'paginated',
    source:{subagent:{thread_spawn:{parent_thread_id:'parent'}}},subagent_history_start_ordinal:inherited.length+1,...options});
  return [header,...inherited,record('event_msg',{type:'thread_settings_applied'}),record('event_msg',{type:'task_started',turn_id:'child-turn'}),context('child-turn','child-model'),
    token({total_token_usage:usage(100,60,10,5),last_token_usage:usage(100,60,10,5)})];
}
function setup(t){let cleanup;const f=fixture({after:fn=>{cleanup=fn;}}),dbPath=path.join(f.home,'test.sqlite3'),r=new Recorder({home:f.home,dbPath}),services=[];t.after(async()=>{for(const service of services)await service.close();r.close();cleanup();});return{...f,dbPath,r,services};}
const append=(file,records)=>fs.appendFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
const snapshot=db=>JSON.stringify(['recorder_meta','sources','telemetry_events'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all()));
test('review: paginated v2 forks keep child identity and exclude inherited parent counters and metadata',async t=>{
  const f=setup(t),file=f.write('sessions/child.jsonl',forkRecords());f.write('sessions/parent.jsonl',[meta('parent'),context('parent-turn','parent-model'),token({total_token_usage:usage(10000),last_token_usage:usage(10000)})]);
  const result=await f.r.scan();assert.deepEqual(result.errors,[]);assert.equal(result.inherited_history_sources,1);assert.equal(result.scanned_sources,2);assert.equal(result.inserted_events,2);
  let child=f.r.db.prepare("SELECT * FROM telemetry_events WHERE session_id='child'").all();assert.equal(child.length,1);assert.equal(child[0].model,'child-model');assert.equal(child[0].input_tokens,100);assert.equal(child[0].event_seq,1);
  assert.equal((await f.r.scan()).inserted_events,0);
  append(file,[token({total_token_usage:usage(160,90,15,8),last_token_usage:usage(60,30,5,3)})]);assert.equal((await f.r.scan()).inserted_events,1);
  child=f.r.db.prepare("SELECT * FROM telemetry_events WHERE session_id='child' ORDER BY event_seq").all();assert.deepEqual(child.map(r=>r.event_seq),[1,2]);assert.deepEqual(child.map(r=>r.model),['child-model','child-model']);
  const stats=getHistoricalUsageStats({home:f.home,dbPath:f.dbPath,from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z',timezone:'UTC',analytics:true});assert.equal(stats.totals.input.value,10160);
});
test('review: a child first snapshot cannot use inherited parent cumulative values as a predecessor',async t=>{
  const f=setup(t),rows=forkRecords();rows[rows.length-1]=token({total_token_usage:usage(10100,6060,1010,505),last_token_usage:usage(100,60,10,5)});f.write('sessions/child.jsonl',rows);assert.deepEqual((await f.r.scan()).errors,[]);
  const stats=getHistoricalUsageStats({home:f.home,dbPath:f.dbPath,from:'2026-01-01T00:00:00Z',to:'2026-01-02T00:00:00Z',timezone:'UTC'});assert.equal(stats.totals.input.value,null);assert.equal(stats.totals.input.complete,false);
});
test('review: genuine identity changes after the fork boundary still reject and preserve the checkpoint',async t=>{
  const f=setup(t),file=f.write('sessions/child.jsonl',forkRecords());await f.r.scan();const before=snapshot(f.r.db);append(file,[meta('different-child'),token()]);const result=await f.r.scan();assert.equal(result.errors[0].code,'SESSION_ID_CHANGED');assert.equal(result.failed_sources,1);assert.equal(snapshot(f.r.db),before);
});
test('review: undeclared inherited identities, wrong lineage and unrelated prefix metadata are rejected',async t=>{
  for(const options of [{multi_agent_version:'v1'},{source:{subagent:{thread_spawn:{parent_thread_id:'wrong-parent'}}}},{parent_thread_id:'wrong-parent'}]){
    const f=setup(t);f.write('sessions/child.jsonl',forkRecords('child',options));const result=await f.r.scan();assert.equal(result.errors[0].code,'UNSUPPORTED_INHERITED_HISTORY');assert.equal(f.r.counts().events,0);
  }
  const f=setup(t),rows=forkRecords();rows[1]=meta('unrelated-parent');f.write('sessions/child.jsonl',rows);assert.equal((await f.r.scan()).errors[0].code,'SESSION_ID_CHANGED');
});
test('review: invalid fork boundaries do not reinterpret records or overwrite checkpoints',async t=>{
  const f=setup(t);f.write('sessions/child.jsonl',forkRecords('child',{subagent_history_start_ordinal:3}));const result=await f.r.scan();assert.equal(result.errors[0].code,'FORK_HISTORY_BOUNDARY_INVALID');assert.equal(f.r.counts().sources,0);
});
test('review: incomplete fork history is pending, not a discarded source or a false successful collection',async t=>{
  const f=setup(t),all=forkRecords(),file=f.write('sessions/child.jsonl',all.slice(0,4));let result=await f.r.scan();assert.equal(result.outcome,'partial');assert.equal(result.skipped_sources,1);assert.equal(result.partial_sources,1);assert.equal(result.failed_sources,0);assert.deepEqual(result.errors,[]);assert.deepEqual(result.skip_types,[{code:'FORK_HISTORY_PENDING',count:1}]);assert.equal(f.r.counts().sources,0);
  append(file,all.slice(4));result=await f.r.scan();assert.equal(result.outcome,'complete');assert.equal(result.inserted_events,1);
});
test('review: existing nonzero event checkpoints cannot be moved past inherited history silently',async t=>{
  const f=setup(t);f.write('sessions/child.jsonl',forkRecords());await f.r.scan();f.r.db.prepare("UPDATE sources SET checkpoint_byte_offset=0,anchor_end_offset=0,anchor_sha256=? WHERE session_id='child'").run(createHash('sha256').update('').digest('hex'));const before=snapshot(f.r.db);
  assert.equal((await f.r.scan()).errors[0].code,'FORK_CHECKPOINT_CONFLICT');assert.equal(snapshot(f.r.db),before);
});
test('review: compatible replicas are counted as skipped files and conflicting copies still fail',async t=>{
  const f=setup(t),rows=forkRecords();f.write('sessions/child.jsonl',rows);f.write('archived_sessions/child.jsonl',rows);let result=await f.r.scan();assert.equal(result.skipped_files,1);assert.equal(result.inherited_history_sources,1);assert.equal(result.inserted_events,1);
  const before=snapshot(f.r.db);f.write('archived_sessions/child.jsonl',[...rows,token()]);f.write('sessions/child.jsonl',[...rows,token({last_token_usage:usage(999)})]);result=await f.r.scan();assert.equal(result.errors[0].code,'CONFLICTING_SESSION_COPIES');assert.equal(snapshot(f.r.db),before);
});
test('review: source inspection is read-only, counts pending events and does not create missing databases',async t=>{
  const f=setup(t),file=f.write('sessions/child.jsonl',forkRecords());await f.r.scan();append(file,[token()]);const before=snapshot(f.r.db),bytes=fs.readFileSync(file);
  const result=await inspectRecorderSources({home:f.home,dbPath:f.dbPath});assert.equal(result.readOnly,true);assert.equal(result.pending_events,1);assert.equal(result.inherited_history_sources,1);assert.deepEqual(result.errors,[]);assert.equal(snapshot(f.r.db),before);assert.deepEqual(fs.readFileSync(file),bytes);
  const missing=path.join(f.home,'never-create','missing.sqlite3');await inspectRecorderSources({home:f.home,dbPath:missing});assert.equal(fs.existsSync(path.dirname(missing)),false);
});
test('review: source failures are grouped by type without suppressing separate affected sources',async t=>{
  const f=setup(t);for(const id of ['bad-a','bad-b'])f.write('sessions/'+id+'.jsonl',[meta(id),token(),meta('wrong')]);f.write('sessions/good.jsonl',[meta('good'),token()]);const result=await f.r.scan();assert.equal(result.outcome,'partial');assert.equal(result.scanned_sources,1);assert.equal(result.failed_sources,2);assert.equal(result.errors.length,2);assert.deepEqual(result.error_types,[{code:'SESSION_ID_CHANGED',count:2}]);assert.equal(result.failed_source_history_preserved,true);assert.equal(f.r.counts().events,1);
});
test('review: read-only diagnostics preserve valid bare-CR JSON whitespace and CRLF byte boundaries',async t=>{
  const f=setup(t),rows=[meta('cr-session'),context(),token()],file=path.join(f.home,'sessions/cr.jsonl');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,rows.map(r=>JSON.stringify(r).replace('"payload":','"payload":\r')).join('\r\n')+'\r\n');assert.deepEqual((await f.r.scan()).errors,[]);const before=snapshot(f.r.db),result=await inspectRecorderSources({home:f.home,dbPath:f.dbPath});assert.deepEqual(result.errors,[]);assert.equal(result.scanned_sources,1);assert.equal(result.pending_events,0);assert.equal(snapshot(f.r.db),before);
});
test('review: GUI capabilities, real analytics contract and coverage are explicit; diagnostics never write',async t=>{
  const f=setup(t);f.write('sessions/a.jsonl',[meta('a'),context(),token()]);await f.r.scan();const gui=await startServer({home:f.home,dbPath:f.dbPath,port:0});f.services.push(gui);const boot=await(await fetch(gui.url+'/api/bootstrap')).json();assert.equal(boot.apiVersion,2);assert.equal(boot.capabilities.modelAnalytics,true);
  const headers={'x-codex-hud-token':boot.token},stats=await(await fetch(gui.url+'/api/stats?range=custom&from=2026-01-01T00%3A00&to=2026-01-02T00%3A00&timezone=UTC&analytics=1',{headers})).json();assert.equal(stats.analytics.modelOptions.includes('gpt-6.1-sol'),true);assert.equal(stats.analytics.effortOptions.includes('high'),true);assert.deepEqual(stats.analytics.coverage,{knownModelMetadata:1,knownEffortMetadata:1,validPrimaryDeltas:1});
  const before=snapshot(f.r.db);const diagnostics=await(await fetch(gui.url+'/api/recorder/diagnostics',{headers})).json();assert.equal(diagnostics.readOnly,true);assert.equal(snapshot(f.r.db),before);
});
test('review: Auto Review classification uses model evidence, preserves mixed sessions and leaves Stats totals unchanged',async t=>{
  const f=setup(t);f.write('sessions/review.jsonl',[meta('review'),context('r','codex-auto-review'),token()]);f.write('sessions/ordinary.jsonl',[meta('ordinary'),context(),token()]);f.write('sessions/mixed.jsonl',[meta('mixed'),context(),token(),context('r2','codex-auto-review'),token()]);f.write('session_index.jsonl',[{id:'ordinary',thread_name:'Guardian review (ordinary synthetic session)'},{id:'review',thread_name:'Unrelated synthetic title'}]);await f.r.scan();
  const before=snapshot(f.r.db),gui=await startServer({home:f.home,dbPath:f.dbPath,port:0});f.services.push(gui);const boot=await(await fetch(gui.url+'/api/bootstrap')).json(),headers={'x-codex-hud-token':boot.token};let result=await(await fetch(gui.url+'/api/sessions',{headers})).json();
  assert.equal(result.sessions.find(s=>s.id==='review').isAutoReview,true);assert.equal(result.sessions.find(s=>s.id==='ordinary').isAutoReview,false);assert.equal(result.sessions.find(s=>s.id==='mixed').isAutoReview,false);
  fs.unlinkSync(path.join(f.home,'sessions/review.jsonl'));result=await(await fetch(gui.url+'/api/sessions',{headers})).json();assert.equal(result.sessions.find(s=>s.id==='review').isAutoReview,true);assert.equal(result.sessions.find(s=>s.id==='review').hasLocalTelemetry,false);assert.equal(snapshot(f.r.db),before);
});
