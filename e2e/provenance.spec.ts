import { test, expect } from '@playwright/test';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Recorder } = require('../lib/recorder');
const { startServer } = require('../lib/gui/server');
const { openDatabase } = require('../lib/recorder-db');
const { meta, context, token, usage, limit } = require('../test/helpers');
let directory: string, gui: any;
test.afterEach(async () => { await gui?.close(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
async function launch(page: any, malformed: boolean | 'missing-reasoning' = false) {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-provenance-browser-'));
  const home = path.join(directory, 'home'), dbPath = path.join(directory, 'synthetic.sqlite3');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  const now = Date.now() - 30000;
  const first = token(malformed === true ? {} : null, limit(), now);
  const second = token({ total_token_usage: usage(26106,12288,169,0), last_token_usage: usage(26106,12288,169,0) }, limit(), now + 1000);
  if(malformed==='missing-reasoning') delete second.payload.info.total_token_usage.reasoning_output_tokens;
  fs.writeFileSync(path.join(home, 'sessions', 'synthetic.jsonl'), [meta('synthetic'),context(),first,second].map(r => JSON.stringify(r)).join('\n')+'\n');
  const recorder = new Recorder({home,dbPath}); try { await recorder.scan(); } finally { recorder.close(); }
  // Exercise v1 read-only recovery through the actual GUI, not just persisted evidence.
  const db=openDatabase(dbPath);db.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'");db.close();
  gui=await startServer({home,dbPath,port:0});await page.goto(gui.url);await expect(page.locator('.metrics')).toBeVisible();
}
test('allowance-only legacy history shows exact complete usage in Dashboard and Statistics',async({page},info)=>{
  await launch(page);
  for(const view of ['Dashboard','Statistics']){
    if(page.viewportSize()!.width<761) await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
    await page.getByRole('button',{name:view,exact:true}).click();
    await expect(page.locator('.metric-input .token-value')).toHaveAttribute('data-exact-tokens','26106');
    await expect(page.locator('.metric-cached .token-value')).toHaveAttribute('data-exact-tokens','12288');
    await expect(page.locator('.metric-fresh .token-value')).toHaveAttribute('data-exact-tokens','13818');
    await expect(page.locator('.metric-output .token-value')).toHaveAttribute('data-exact-tokens','169');
    await expect(page.locator('.metric-reasoning .token-value')).toHaveAttribute('data-exact-tokens','0');
    await expect(page.locator('.metrics .partial-mark')).toHaveCount(0);
    await expect(page.locator('.cache-percentage strong')).not.toHaveText('—');
  }
  const available=await page.evaluate(async()=>{
    const boot=await(await fetch('/api/bootstrap')).json();
    const stats=await(await fetch('/api/stats?analytics=1',{headers:{'x-codex-hud-token':boot.token}})).json();
    return stats.analytics.models.filter((g:any)=>g.observations>0).every((g:any)=>g.shares.input.available);
  });
  expect(available).toBe(true);
  await page.screenshot({path:info.outputPath('corrected-statistics.png'),fullPage:true});
});
test('malformed usage retains per-metric explanations and withheld percentage',async({page},info)=>{
  await launch(page,true);await expect(page.locator('.metrics .partial-mark')).toHaveCount(5);
  await page.locator('.metric-input').getByText('Why incomplete?',{exact:true}).click();
  await expect(page.locator('.metric-input .metric-quality')).toContainText('Missing or invalid cumulative counter');
  await expect(page.locator('.cache-percentage strong')).toHaveText('—');
  await page.getByRole('button',{name:'简体中文',exact:true}).click();
  await expect(page.locator('.metric-input .metric-quality')).toContainText('累计计数缺失或无效');
  await page.screenshot({path:info.outputPath('incomplete-explanation.png'),fullPage:true});
});
test('bucket table labels incomplete Reasoning even when Input and Output are complete',async({page})=>{
  await launch(page,'missing-reasoning');
  if(page.viewportSize()!.width<761) await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
  await page.getByRole('button',{name:'Statistics',exact:true}).click();
  await page.getByText('Inspect accounted time buckets',{exact:true}).click();
  const observed=page.locator('.data-table tbody tr').filter({has:page.locator('[data-exact-tokens="26106"]')});
  await expect(observed).toHaveCount(1);await expect(observed.locator('td').last()).toHaveText('Incomplete');
  await expect(page.locator('.metric-input .partial-mark')).toHaveCount(0);await expect(page.locator('.metric-reasoning .partial-mark')).toHaveCount(1);
});
