import { test, expect } from '@playwright/test';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Recorder } = require('../lib/recorder');
const { openDatabase } = require('../lib/recorder-db');
const { startServer } = require('../lib/gui/server');
const { meta, context, token, usage, limit } = require('../test/helpers');
let directory: string, gui: any;
test.afterEach(async () => { await gui?.close(); if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
async function launch(page: any, scenario: 'reset' | 'ambiguous' | 'subset' | 'integrity') {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hud-correction-browser-'));
  const home = path.join(directory, 'home'), dbPath = path.join(directory, 'synthetic.sqlite3');
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true }); const now = Date.now() - 30000;
  const measure = (v: number[], last = v, at = now) => token({ total_token_usage: usage(...v), last_token_usage: usage(...last) }, limit(), at);
  const first = measure(scenario === 'subset' ? [100,80,10,2] : [100,10,10,2]);
  const last = scenario === 'subset' ? measure([200,50,20,4], [10,50,10,2], now + 1000)
    : scenario === 'ambiguous' ? measure([20,15,14,3], [20,15,4,1], now + 1000) : measure([20,15,4,3], undefined, now + 1000);
  fs.writeFileSync(path.join(home, 'sessions', 'synthetic.jsonl'), [meta('review'), context(), first, token(null, limit(), now), last].map(r => JSON.stringify(r)).join('\n') + '\n');
  const r = new Recorder({ home, dbPath }); try { await r.scan(); } finally { r.close(); }
  if (scenario === 'integrity') { const db = openDatabase(dbPath); try { db.exec("DROP TABLE event_provenance_v1; DELETE FROM recorder_meta WHERE key='event_provenance_version'; DELETE FROM telemetry_events WHERE event_seq=1; UPDATE telemetry_events SET event_seq=event_seq-1; UPDATE sources SET last_event_seq=2"); } finally { db.close(); } }
  gui = await startServer({ home, dbPath, port: 0 }); await page.goto(gui.url); await expect(page.locator('.metrics')).toBeVisible();
}
test('coherent reset shows complete exact subset totals in Dashboard and Statistics', async ({ page }) => {
  await launch(page, 'reset');
  for (const view of ['Dashboard', 'Statistics']) {
    if (page.viewportSize()!.width < 761) await page.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await page.getByRole('button', { name: view, exact: true }).click();
    for (const [key, value] of Object.entries({ input: 120, cached: 25, fresh: 95, output: 14, reasoning: 5 })) {
      await expect(page.locator('.metric-' + key + ' .token-value')).toHaveAttribute('data-exact-tokens', String(value));
    }
    await expect(page.locator('.metrics .partial-mark')).toHaveCount(0);
  }
});
test('ambiguous reset explains uncertainty in both languages and withholds cache ratio', async ({ page }) => {
  await launch(page, 'ambiguous'); await page.locator('.metric-cached').getByText('Why incomplete?', { exact: true }).click();
  await expect(page.locator('.metric-cached .metric-quality')).toContainText('Counter reset scope is uncertain');
  await expect(page.locator('.cache-percentage strong')).toHaveText('—'); await expect(page.locator('.metric-input .partial-mark')).toHaveCount(0);
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.locator('.metric-cached .metric-quality')).toContainText('计数重置范围不明确');
});
test('invalid last cache subset keeps primary totals while withholding Fresh', async ({ page }) => {
  await launch(page, 'subset'); await expect(page.locator('.metric-input .token-value')).toHaveAttribute('data-exact-tokens', '200');
  await expect(page.locator('.metric-input .partial-mark')).toHaveCount(0); await expect(page.locator('.metric-output .partial-mark')).toHaveCount(0);
  await expect(page.locator('.metric-fresh .partial-mark')).toHaveCount(1); await expect(page.locator('.cache-percentage strong')).toHaveText('—');
});
test('corrupt canonical history shows a source integrity explanation instead of completeness', async ({ page }) => {
  await launch(page, 'integrity'); await expect(page.locator('.metrics .partial-mark')).toHaveCount(5);
  await page.locator('.metric-input').getByText('Why incomplete?', { exact: true }).click();
  await expect(page.locator('.metric-input .metric-quality')).toContainText('Recorded history conflicts with verified source evidence');
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.locator('.metric-input .metric-quality')).toContainText('已记录历史与已验证来源证据不一致');
});
