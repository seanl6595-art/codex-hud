'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { Recorder } = require('../lib/recorder');
const { openDatabase, openReadOnlyDatabase } = require('../lib/recorder-db');
const { classifyTokenEvent, hasProvenance } = require('../lib/event-provenance');
const { upgradeProvenance } = require('../lib/provenance-upgrade');
const { getHistoricalUsageStats } = require('../lib/stats');
const { fixture, meta, context, token, usage, limit, NOW } = require('./helpers');
const KEYS = ['input', 'cached', 'fresh', 'output', 'reasoning'];
const exact = [26106, 12288, 13818, 169, 0];
const measurement = (values = [26106,12288,169,0], last = values, time = NOW + 1000) => token({total_token_usage:usage(...values),last_token_usage:usage(...last)},limit(),time);
async function setup(t, events, { legacy = false } = {}) {
  const f = fixture(t), dbPath = path.join(f.home,'synthetic.sqlite3');
  const file = f.write('sessions/source.jsonl',[meta('synthetic'),context(),...events]);
  const recorder = new Recorder({home:f.home,dbPath}); let summary;
  try {summary=await recorder.scan();} finally {recorder.close();}
  if(legacy) {const db=openDatabase(dbPath);db.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'");db.close();}
  return {...f,dbPath,file,summary,stats:(options={})=>getHistoricalUsageStats({home:f.home,dbPath,from:new Date(NOW).toISOString(),to:new Date(NOW+3600000).toISOString(),timezone:'UTC',buckets:'hour',analytics:true,...options})};
}
function read(f, fn) {const db=openReadOnlyDatabase(f.dbPath);try{return fn(db);}finally{db.close();}}
function mutate(f, fn) {const db=openDatabase(f.dbPath);try{return fn(db);}finally{db.close();}}
function snapshot(f, all=false) {return read(f,db=>JSON.stringify((all?['sqlite_schema','recorder_meta','sources','telemetry_events',...(hasProvenance(db)?['event_provenance_v1']:[])]:['sources','telemetry_events']).map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())));}
function complete(s, values=exact) {assert.deepEqual(KEYS.map(k=>s.totals[k].value),values);assert.ok(KEYS.every(k=>s.totals[k].complete));assert.ok(KEYS.every(k=>s.totals[k].indeterminateObservations===0));}

for (const legacy of [false,true]) test(`provenance: audited allowance prefix recovers exact first usage, legacy=${legacy}`,async t=>{
 const allowance=token(null),firstUsage=measurement();allowance.ordinal=15;firstUsage.ordinal=28;
 const f=await setup(t,[allowance,firstUsage],{legacy}),before=snapshot(f,true),s=f.stats();
 assert.equal(f.summary.outcome,'complete');complete(s);assert.equal(s.coverage.observations,1);assert.equal(s.coverage.allowanceOnlyObservations,1);
 assert.equal(s.activity.usageEvents,1);assert.equal(s.ratios.cachedPercent.value,12288/26106*100);
 assert.equal(s.analytics.models.find(g=>g.model==='gpt-6.1-sol').totals.input.value,26106);
 complete({totals:s.buckets[0].totals});assert.equal(snapshot(f,true),before);
});
test('provenance: consecutive and interleaved allowance updates never add or erase usage',async t=>{
 const f=await setup(t,[token(null),token(null),measurement(),token(null),token(null),measurement([27106,12788,179,0],[1000,500,10,0],NOW+2000),measurement([27106,12788,179,0],[1000,500,10,0],NOW+3000)]);
 complete(f.stats(),[27106,12788,14318,179,0]);assert.equal(f.stats().activity.usageEvents,2);assert.equal(f.stats().coverage.allowanceOnlyObservations,4);
});
test('provenance: unknown and malformed all-NULL usage cannot be skipped',async t=>{
 for(const event of [token({}),token({total_token_usage:{},last_token_usage:{}}),token({model_context_window:1000}),token(undefined),{type:'event_msg',timestamp:new Date(NOW).toISOString(),payload:{type:'token_count',rate_limits:limit()}},token(null,null),token(false),token([])]){
  if(event.payload.info?.total_token_usage?.input_tokens===1000) delete event.payload.info;
  const f=await setup(t,[event,measurement()]);const s=f.stats();assert.equal(s.coverage.allowanceOnlyObservations,0);assert.ok(KEYS.every(k=>!s.totals[k].complete));
 }
});
test('provenance: unrecognized envelopes and invalid allowance shapes fail closed',()=>{
 for(const value of [null,{},[],{primary:{used_percent:'10',window_minutes:300,resets_at:1}},{primary:{used_percent:10,window_minutes:0,resets_at:1}}])assert.equal(classifyTokenEvent(token(null,value)),'unknown');
 const future=token(null);future.payload.usage={input_tokens:12};assert.equal(classifyTokenEvent(future),'unknown');
 const futureEnvelope=token(null);futureEnvelope.usage={input_tokens:12};assert.equal(classifyTokenEvent(futureEnvelope),'unknown');
 for(const ordinal of [-1,1.5,'15',null]){const badOrdinal=token(null);badOrdinal.ordinal=ordinal;assert.equal(classifyTokenEvent(badOrdinal),'unknown');}
 const ordinal=token(null);ordinal.ordinal=15;assert.equal(classifyTokenEvent(ordinal),'allowance_only');
 assert.equal(classifyTokenEvent(token(null,{primary:{used_percent:0,window_minutes:15,resets_at:1}})),'allowance_only');
});
test('provenance: persisted evidence survives source deletion; legacy unknown remains incomplete',async t=>{
 for(const legacy of [false,true]){const f=await setup(t,[token(null),measurement()],{legacy});fs.unlinkSync(f.file);const s=f.stats();if(legacy){assert.equal(s.totals.input.complete,false);assert.equal(s.coverage.unknownProvenanceObservations,1);}else complete(s);}
});
test('provenance: legacy reads verify archived copies and reject rewritten prefixes',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true});const archive=path.join(f.home,'archived_sessions');fs.mkdirSync(archive);fs.renameSync(f.file,path.join(archive,'moved.jsonl'));complete(f.stats());
 fs.appendFileSync(path.join(archive,'moved.jsonl'),'\n');complete(f.stats());
 const source=path.join(archive,'moved.jsonl'),beforeRewrite=fs.statSync(source);fs.writeFileSync(source,fs.readFileSync(source,'utf8').replace('26106','26107'));
 // Snapshot verification evicts observable file changes. Windows can coalesce
 // consecutive same-size writes into an identical metadata stamp; make this
 // fixture's change observable. Hidden-stamp mutations have separate fresh-audit
 // coverage in history-verification.test.js; no accounting assertion is relaxed.
 fs.utimesSync(source,beforeRewrite.atime,new Date(beforeRewrite.mtimeMs+1000));
 assert.equal(f.stats().totals.input.complete,false);
});
test('provenance: matching copies may recover; conflicting copies never override authenticated history',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true});const content=fs.readFileSync(f.file);fs.unlinkSync(f.file);
 f.write('sessions/conflict.jsonl',[meta('synthetic'),token({}),measurement()]);fs.mkdirSync(path.join(f.home,'archived_sessions'));fs.writeFileSync(path.join(f.home,'archived_sessions','copy.jsonl'),content);complete(f.stats());
});
test('provenance: mismatched row hash or canonical ordinal prevents legacy recovery',async t=>{
 for(const sql of ["UPDATE telemetry_events SET raw_event_sha256='bad' WHERE event_seq=1","UPDATE telemetry_events SET event_seq=5 WHERE event_seq=2"]){const f=await setup(t,[token(null),measurement()],{legacy:true});mutate(f,db=>db.exec(sql));assert.equal(f.stats().totals.input.complete,false);}
});
test('provenance: stale stored hash and contradictory counters never suppress a row',async t=>{
 const f=await setup(t,[token(null),measurement()]);fs.unlinkSync(f.file);mutate(f,db=>db.exec("UPDATE event_provenance_v1 SET raw_event_sha256='bad' WHERE event_seq=1"));assert.equal(f.stats().totals.input.complete,false);
 const g=await setup(t,[token(null),measurement()]);mutate(g,db=>db.exec('UPDATE telemetry_events SET cumulative_input_tokens=20 WHERE event_seq=1'));assert.equal(g.stats().totals.input.complete,false);assert.equal(g.stats().coverage.allowanceOnlyObservations,0);
 const h=await setup(t,[token(null),measurement()]);fs.unlinkSync(h.file);mutate(h,db=>db.exec("UPDATE telemetry_events SET raw_event_sha256='invalid' WHERE event_seq=1; UPDATE event_provenance_v1 SET raw_event_sha256='invalid' WHERE event_seq=1"));assert.equal(h.stats().totals.input.complete,false);
});
test('provenance: gaps hidden behind allowance records remain unresolved even with no subsequent usage',async t=>{
 const f=await setup(t,[measurement(),token(null),token(null)],{});mutate(f,db=>db.exec('DELETE FROM telemetry_events WHERE event_seq=2'));
 assert.equal(f.stats().totals.input.complete,false);assert.ok(f.stats().totals.input.incompleteReasons.sequence_gap);
});
test('provenance: unsafe first usage stays unsafe; coherent resets and duplicates remain safe',async t=>{
 const f=await setup(t,[token(null),measurement([100,50,10,4],[20,10,2,1])]);assert.equal(f.stats().totals.input.complete,false);assert.equal(f.stats().totals.input.incompleteReasons.unsafe_baseline,1);
 const g=await setup(t,[measurement([100,50,10,4]),token(null),measurement([20,10,2,1]),measurement([20,10,2,1]),measurement([10,15,3,1],[5,5,1,0])]);const s=g.stats();assert.equal(s.totals.input.value,120);assert.equal(s.totals.input.incompleteReasons.unrecognized_reset,1);assert.equal(s.totals.cached.complete,false);assert.equal(s.totals.cached.incompleteReasons.ambiguous_reset,1);
});
test('provenance: time filtering must not reset usage adjacency across allowance metadata',async t=>{
 const f=await setup(t,[measurement([100,50,10,4],undefined,NOW-2000),token(null,limit(),NOW-1000),measurement([150,75,15,6],[150,75,15,6])]);complete(f.stats(),[50,25,25,5,2]);
});
test('provenance: attribution uses previous usage context, not intervening allowance context',async t=>{
 const next=context('second','new-model');next.payload.effort='low';
 const f=await setup(t,[measurement([100,50,10,4]),next,token(null),measurement([200,100,20,8],[25,10,3,1])]);const s=f.stats();
 assert.equal(s.analytics.models.find(g=>g.model===null).totals.input.value,100);assert.equal(s.analytics.efforts.find(g=>g.effort===null).totals.input.value,100);
 const g=await setup(t,[token(null),next,measurement()]);assert.equal(g.stats().analytics.models.find(m=>m.model==='new-model').totals.input.value,26106);
});
test('provenance: each missing metric stays independent after valid allowance exclusion',async t=>{
 for(const [column,invalid] of [['input_tokens',['input','fresh']],['cached_input_tokens',['cached','fresh']],['output_tokens',['output']],['reasoning_output_tokens',['reasoning']]]){
  const m=measurement();delete m.payload.info.total_token_usage[column];const f=await setup(t,[token(null),m]);const s=f.stats();for(const k of KEYS)assert.equal(s.totals[k].complete,!invalid.includes(k));
 }
});
test('provenance: invalid Cache/Input withholds Fresh/ratio; invalid Reasoning/Output withholds Reasoning only',async t=>{
 const f=await setup(t,[measurement([100,110,10,20])]);const s=f.stats();assert.equal(s.totals.input.complete,true);assert.equal(s.totals.cached.value,110);assert.equal(s.totals.fresh.complete,false);assert.equal(s.ratios.cachedPercent.available,false);assert.equal(s.totals.reasoning.complete,false);assert.equal(s.totals.output.complete,true);assert.equal(s.totals.reasoning.incompleteReasons.invalid_reasoning_subset,1);
});
test('adversarial: invalid cumulative subsets cannot produce falsely complete later deltas',async t=>{
 const f=await setup(t,[measurement([100,110,10,20],undefined,NOW-2000),measurement([200,150,30,35])]);const s=f.stats();
 assert.equal(s.totals.input.complete,true);assert.equal(s.totals.fresh.complete,false);assert.equal(s.totals.reasoning.complete,false);
 const g=await setup(t,[measurement([100,50,100,20],[100,50,10,20])]);assert.equal(g.stats().totals.reasoning.complete,false);
});
test('adversarial: known reset can establish a valid subset after an invalid historical subset',async t=>{
 const f=await setup(t,[measurement([100,50,10,20],undefined,NOW-2000),measurement([20,10,4,2])]);complete(f.stats(),[20,10,10,4,2]);
});
test('adversarial: allowance timestamp cannot create unknown-time usage, but a real untimed usage still does',async t=>{
 const only=token(null);delete only.timestamp;const f=await setup(t,[only,measurement()]);complete(f.stats());
 const m=measurement();delete m.timestamp;const g=await setup(t,[token(null),m]);assert.equal(g.stats().totals.input.complete,false);assert.equal(g.stats().totals.input.incompleteReasons.unknown_timestamp,1);
});
test('adversarial: extension rows follow Recorder rebuilds and source transaction rollback',async t=>{
 const f=await setup(t,[token(null),measurement()]);const before=snapshot(f,true);fs.appendFileSync(f.file,JSON.stringify(token(null))+'\n');
 const r=new Recorder({...f,beforeCommit(){throw Error('synthetic failure');}});try{const summary=await r.scan();assert.equal(summary.failed_sources,1);}finally{r.close();}assert.equal(snapshot(f,true),before);
 fs.writeFileSync(f.file,[meta('synthetic'),context(),measurement()].map(x=>JSON.stringify(x)).join('\n')+'\n');const rebuilt=new Recorder(f);try{assert.equal((await rebuilt.scan()).rebuilt_sources,1);assert.equal(rebuilt.db.prepare('SELECT count(*) n FROM event_provenance_v1').get().n,1);}finally{rebuilt.close();}complete(f.stats());
});
test('upgrade: explicit extension preserves history, is idempotent and survives source removal',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true}),before=snapshot(f);const result=upgradeProvenance(f);assert.equal(result.verified,2);assert.equal(snapshot(f),before);const once=snapshot(f,true);upgradeProvenance(f);assert.equal(snapshot(f,true),once);fs.unlinkSync(f.file);complete(f.stats());
});
test('upgrade: interrupted transaction rolls back extension and can restart safely',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true}),before=snapshot(f,true);assert.throws(()=>upgradeProvenance({...f,beforeCommit(){throw Error('synthetic interruption');}}));assert.equal(snapshot(f,true),before);upgradeProvenance(f);complete(f.stats());
});
test('upgrade: process termination before COMMIT leaves no partial migration and restart succeeds',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true}),before=snapshot(f,true);
 const script=`require(${JSON.stringify(path.resolve(__dirname,'../lib/provenance-upgrade'))}).upgradeProvenance({dbPath:process.argv[1],home:process.argv[2],beforeCommit(){process.exit(73)}})`;
 const child=spawnSync(process.execPath,['-e',script,f.dbPath,f.home],{encoding:'utf8'});assert.equal(child.status,73,child.stderr);assert.equal(snapshot(f,true),before);upgradeProvenance(f);complete(f.stats());
});
test('upgrade: disposable database copy upgrades without modifying its original',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true}),before=snapshot(f,true),copy={...f,dbPath:path.join(f.home,'copy.sqlite3')};
 fs.copyFileSync(f.dbPath,copy.dbPath);upgradeProvenance(copy);assert.equal(snapshot(f,true),before);assert.equal(read(copy,db=>hasProvenance(db)),true);
});
test('upgrade: missing source preserves unknown and existing rows; later source recovery is retryable',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true}),bytes=fs.readFileSync(f.file),before=snapshot(f);fs.unlinkSync(f.file);assert.equal(upgradeProvenance(f).unknown,2);assert.equal(snapshot(f),before);assert.equal(f.stats().totals.input.complete,false);fs.writeFileSync(f.file,bytes);assert.equal(upgradeProvenance(f).verified,2);complete(f.stats());
});
test('upgrade: opening legacy Recorder never silently installs extension; upgraded recorder persists appended evidence',async t=>{
 const f=await setup(t,[measurement()],{legacy:true});const r=new Recorder(f);assert.equal(hasProvenance(r.db),false);r.close();upgradeProvenance(f);fs.appendFileSync(f.file,JSON.stringify(token(null))+'\n');const second=new Recorder(f);try{await second.scan();assert.equal(second.db.prepare('SELECT usage_kind FROM event_provenance_v1 WHERE event_seq=2').get().usage_kind,'allowance_only');}finally{second.close();}
});
test('upgrade: missing or unsupported DB fails without creation; unsupported extension is explicit',async t=>{
 const f=fixture(t),dbPath=path.join(f.home,'absent.sqlite3');assert.throws(()=>upgradeProvenance({dbPath,home:f.home}));assert.equal(fs.existsSync(dbPath),false);
 const g=await setup(t,[measurement()]);mutate(g,db=>db.exec("UPDATE recorder_meta SET value='2' WHERE key='event_provenance_version'"));assert.throws(()=>g.stats(),/Unsupported event provenance/);assert.throws(()=>upgradeProvenance(g),/Unsupported event provenance/);
});
test('provenance: zero observation remains complete and allowance-only has no usage or ratio denominator',async t=>{
 const f=await setup(t,[token(null),measurement([0,0,0,0])]);complete(f.stats(),[0,0,0,0,0]);assert.equal(f.stats().ratios.cachedPercent.available,false);
 const g=await setup(t,[token(null)]);assert.equal(g.stats().coverage.observations,0);assert.equal(g.stats().buckets[0].state,'missing');
});
test('provenance: CLI and actual GUI API share corrected exact totals',async t=>{
 const f=await setup(t,[token(null),measurement()],{legacy:true});const run=spawnSync(process.execPath,[path.resolve(__dirname,'../bin/codex-hud.js'),'stats','--db',f.dbPath,'--codex-home',f.home,'--from','2026-01-01 12:00','--to','2026-01-01 13:00'],{encoding:'utf8',env:{...process.env,TZ:'UTC'}});assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Total\s+26,106/);assert.doesNotMatch(run.stdout,/incomplete/);
 const gui=await require('../lib/gui/server').startServer({...f,port:0});try{const boot=await(await fetch(gui.url+'/api/bootstrap')).json();const res=await fetch(gui.url+'/api/stats?range=custom&from=2026-01-01T12:00&to=2026-01-01T13:00&timezone=UTC',{headers:{'x-codex-hud-token':boot.token}});assert.equal(res.status,200);const api=await res.json();complete(api);assert.deepEqual(api.totals,f.stats().totals);}finally{await gui.close();}
});
