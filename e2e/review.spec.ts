import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
const fs=require('node:fs'),path=require('node:path');
const {createFixture}=require('./fixtures.cjs'),{startServer}=require('../lib/gui/server'),{Recorder}=require('../lib/recorder'),{openReadOnlyDatabase,openDatabase}=require('../lib/recorder-db');
const {meta,context,token,record}=require('../test/helpers');
let fixture:Awaited<ReturnType<typeof createFixture>>,gui:Awaited<ReturnType<typeof startServer>>,errors:string[];
function snapshot(){const db=openReadOnlyDatabase(fixture.dbPath);try{return JSON.stringify(['recorder_meta','sources','telemetry_events'].map(t=>db.prepare('SELECT * FROM '+t+' ORDER BY 1,2').all()));}finally{db.close();}}
function write(name:string,rows:unknown[]){fs.writeFileSync(path.join(fixture.home,'sessions',name+'.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');}
test.beforeEach(async({page})=>{
  errors=[];page.on('pageerror',e=>errors.push(e.message));fixture=await createFixture();
  for(const [id,model,name]of[['synthetic-review','codex-auto-review','Synthetic Guardian review'],['synthetic-ordinary','gpt-6.1-sol','Synthetic Guardian review ordinary work'],['synthetic-mixed','gpt-6.1-sol','Synthetic mixed model work']]){
    const rows=[meta(id),context('t-'+id,model),token()];if(id==='synthetic-mixed')rows.push(context('t-review','codex-auto-review'),token());write(id,rows);fs.appendFileSync(path.join(fixture.home,'session_index.jsonl'),JSON.stringify({id,thread_name:name})+'\n');
  }
  const recorder=new Recorder({home:fixture.home,dbPath:fixture.dbPath});try{await recorder.scan();}finally{recorder.close();}
  gui=await startServer({home:fixture.home,dbPath:fixture.dbPath,port:0});await page.goto(gui.url);await expect(page.locator('.usage-panel')).toBeVisible();
});
test.afterEach(async()=>{await gui?.close();fixture?.cleanup();expect(errors).toEqual([]);});
async function navigate(page:Page,name:string){if(page.viewportSize()!.width<761)await page.getByRole('button',{name:/Toggle navigation|展开或收起导航/}).click();await page.getByRole('button',{name,exact:true}).click();}
test('missing analytics contract is an actionable restart message in both languages',async({page})=>{
  await page.route('**/api/stats?**',async route=>{const response=await route.fetch(),data=await response.json();delete data.analytics;await route.fulfill({response,json:data});});
  await navigate(page,'Statistics');await expect(page.locator('.analytics-unavailable')).toContainText('Stop and relaunch Codex HUD');await expect(page.locator('.analytics-unavailable')).toContainText('Reloading the page alone');
  await page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(page.locator('.analytics-unavailable')).toContainText('仅刷新页面无法更新');
});
test('unattributed history retains real totals and displays explicit coverage instead of selectors alone',async({page})=>{
  const db=openDatabase(fixture.dbPath);try{db.exec('UPDATE telemetry_events SET model=NULL,reasoning_effort=NULL');}finally{db.close();}
  await navigate(page,'Statistics');await expect(page.locator('.attribution-unknown')).toContainText('Unknown / Unattributed');await expect(page.locator('.model-table tbody')).toContainText('Unknown / Unattributed');await expect(page.getByLabel('Model filter',{exact:true}).locator('option')).toHaveCount(2);await expect(page.getByLabel('Effort filter',{exact:true}).locator('option')).toHaveCount(2);await expect(page.locator('.effort-analytics tbody')).toContainText('Unknown / Unattributed');
  await page.getByRole('button',{name:'7 days',exact:true}).click();await expect(page.locator('.usage-panel .panel-heading p')).toContainText('Daily');await expect(page.locator('.analytics-coverage')).toContainText('model metadata: 0');
});
test('Auto Review defaults hidden, title-only matches stay visible, search counts and preference persist',async({page})=>{
  const before=snapshot();await navigate(page,'Sessions');await expect(page.getByLabel('Include Auto Review Sessions')).not.toBeChecked();await expect(page.getByTestId('visible-session-count')).toHaveText('8');await expect(page.locator('.session-item')).toHaveCount(8);
  await page.getByLabel('Search sessions',{exact:true}).fill('Guardian review');await expect(page.locator('.session-item')).toHaveCount(1);await expect(page.getByTestId('visible-session-count')).toHaveText('1');
  await page.getByLabel('Include Auto Review Sessions').check();await expect(page.locator('.session-item')).toHaveCount(2);await expect(page.getByTestId('visible-session-count')).toHaveText('2');await page.reload();await navigate(page,'Sessions');await expect(page.getByLabel('Include Auto Review Sessions')).toBeChecked();await expect(page.locator('.session-item')).toHaveCount(9);
  await page.getByLabel('Include Auto Review Sessions').uncheck();await page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(page.getByLabel('包含自动审核会话')).not.toBeChecked();await expect(page.locator('.session-visibility-controls')).toContainText('历史分析仍包含');expect(snapshot()).toBe(before);
});
test('Recorder sync groups genuine identity failures and read-only inspection preserves all database rows',async({page},info)=>{
  for(const id of ['bad-a','bad-b'])write(id,[meta(id),token(),meta('different-id')]);
  await navigate(page,'Recorder');const before=snapshot();await page.getByRole('button',{name:'Check sources (read-only)',exact:true}).click();await expect(page.locator('.source-inspection .collection-issues tbody tr')).toHaveCount(1);await expect(page.locator('.source-inspection .collection-issues tbody')).toContainText('SESSION_ID_CHANGED');await expect(page.locator('.source-inspection .collection-issues td').nth(1)).toHaveText('2');expect(snapshot()).toBe(before);
  await page.getByRole('button',{name:'Sync once',exact:true}).click();await expect(page.locator('.sync-result .collection-outcome')).toContainText('Sync completed with source issues');await expect(page.locator('.sync-result .collection-issues tbody tr')).toHaveCount(1);await expect(page.locator('.sync-result .collection-issues td').nth(1)).toHaveText('2');await expect(page.locator('.sync-result')).toContainText('History for failed sources stays intact');
  await page.getByRole('button',{name:'Sync once',exact:true}).click();await expect(page.locator('.sync-result .collection-counts>div').filter({hasText:'New events collected'}).locator('strong')).toHaveText('0');await expect(page.locator('.error-box')).toHaveCount(0);
  if(info.project.name==='desktop-chrome'){fs.mkdirSync('.gui-preview/diagnostic',{recursive:true});await page.locator('.recorder-diagnostic-columns').screenshot({path:'.gui-preview/diagnostic/recorder-sync-synthetic.png'});}
  await page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(page.locator('.sync-result')).toContainText('部分数据源需处理');await expect(page.locator('.sync-result')).toContainText('SESSION_ID_CHANGED');
});
test('Sessions review screenshots preserve Dashboard and show the visible review toggle',async({page},info)=>{
  await navigate(page,'Sessions');await expect(page.getByLabel('Include Auto Review Sessions')).not.toBeChecked();
  if(info.project.name==='desktop-chrome'){fs.mkdirSync('.gui-preview/diagnostic',{recursive:true});await page.screenshot({path:'.gui-preview/diagnostic/sessions-hidden-synthetic.png',fullPage:true});}
  await page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(page.getByLabel('包含自动审核会话')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
