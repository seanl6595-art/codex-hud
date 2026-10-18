import { test, expect } from '@playwright/test';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Recorder } = require('../lib/recorder');
const { startServer } = require('../lib/gui/server');
const { meta, context, token, usage, limit } = require('../test/helpers');
let root: string, gui: any;
test.afterEach(async () => { await gui?.close(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
async function launch(page: any) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-history-browser-'));
  const home = path.join(root, 'home'), dbPath = path.join(root, 'synthetic.sqlite3');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true }); const now = Date.now() - 30000;
  fs.writeFileSync(path.join(home, 'sessions', 'synthetic.jsonl'), [meta('test'), context(), token(null, limit(), now),
    token({total_token_usage:usage(100,50,10,2),last_token_usage:usage(100,50,10,2)},limit(),now+1000)].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const r = new Recorder({home,dbPath}); try { await r.scan(); } finally { r.close(); }
  gui = await startServer({home,dbPath,port:0}); await page.goto(gui.url); await expect(page.locator('.metrics')).toBeVisible();
}
test('historical evidence scope and verification time are visible in both languages', async ({page}) => {
  await launch(page); const evidence = page.getByTestId('history-verification');
  await expect(evidence).toContainText('files are not rechecked on every filter change'); await expect(evidence).toContainText('Oldest source check:');
  await expect(evidence.getByRole('button',{name:'Recheck source files'})).toBeEnabled();
  await page.getByRole('button',{name:'简体中文',exact:true}).click();
  await expect(evidence).toContainText('更改筛选条件不会每次重新检查文件'); await expect(evidence.getByRole('button',{name:'重新验证来源文件'})).toBeEnabled();
});
test('warm filter requests reuse evidence and an explicit recheck performs a fresh read-only verification', async ({page}) => {
  await launch(page);
  const warm = await page.evaluate(async () => {
    const boot=await(await fetch('/api/bootstrap')).json();
    return (await(await fetch('/api/stats?range=7d&analytics=1&effort=%22high%22',{headers:{'x-codex-hud-token':boot.token}})).json()).verification;
  });
  expect(warm.reusedSources).toBe(1); expect(warm.checkedSources).toBe(0); expect(warm.liveSourceAttestation).toBe(false);
  const response = page.waitForResponse((r:any)=>r.url().includes('/api/stats?')&&r.url().includes('verification=fresh'));
  await page.getByRole('button',{name:'Recheck source files',exact:true}).click(); const fresh = await (await response).json();
  expect(fresh.verification.mode).toBe('fresh'); expect(fresh.verification.checkedSources).toBe(1); expect(fresh.verification.reusedSources).toBe(0);
  expect(fresh.totals.input.value).toBe(100); expect(fresh.totals.input.complete).toBe(true);
  await expect(page.getByRole('button',{name:'Recheck source files',exact:true})).toBeEnabled();
});
test('source recheck changes the evidence revision used by filtered analytics', async ({page}) => {
  await launch(page);
  if(page.viewportSize()!.width<761)await page.getByRole('button',{name:'Toggle navigation',exact:true}).click();
  await page.getByRole('button',{name:'Statistics',exact:true}).click();
  await expect(page.locator('.analytics-filters')).toBeVisible();
  const selects = page.locator('.analytics-filters select');
  const first = page.waitForResponse((r:any)=>r.url().includes('/api/stats?')&&r.url().includes('effort=')&&r.url().includes('evidenceRevision='));
  await selects.nth(1).selectOption('"high"'); const before = await (await first).json();
  const changedFilter = page.waitForResponse((r:any)=>r.url().includes('/api/stats?')&&r.url().includes('effort=')
    &&new URL(r.url()).searchParams.get('evidenceRevision')!==before.verification.snapshotId);
  const freshResponse = page.waitForResponse((r:any)=>r.url().includes('verification=fresh'));
  await page.getByRole('button',{name:'Recheck source files',exact:true}).click(); const fresh = await (await freshResponse).json();
  expect(fresh.verification.snapshotId).not.toBe(before.verification.snapshotId);
  const filterResponse = await changedFilter;
  expect(new URL(filterResponse.url()).searchParams.get('evidenceRevision')).toBe(fresh.verification.snapshotId);
  expect((await filterResponse.json()).verification.snapshotId).toBe(fresh.verification.snapshotId);
  await expect(page.locator('.metric-input .token-value')).toHaveAttribute('data-exact-tokens','100');
});
