import { test, expect } from '@playwright/test';
const { startServer } = require('../lib/gui/server');
const { createFixture } = require('./fixtures.cjs');
const { addRankings, addPrecision } = require('./revision-fixtures.cjs');
let gui: Awaited<ReturnType<typeof startServer>>, fixture: Awaited<ReturnType<typeof createFixture>>, errors: string[];
test.beforeEach(async ({ page }) => {
  errors = []; page.on('pageerror', e => errors.push(e.message));
});
test.afterEach(async () => {
  if (gui) await gui.close(); if (fixture) fixture.cleanup();
  expect(errors).toEqual([]);
});
async function launch(page: import('@playwright/test').Page, mode = 'populated', seed?: (f: typeof fixture) => void) {
  fixture = await createFixture(mode); if (seed) seed(fixture); gui = await startServer({ home: fixture.home, dbPath: fixture.dbPath, port: 0, interval: 1000 });
  await page.goto(gui.url);
}
async function navigate(page: import('@playwright/test').Page, name: string) {
  if (page.viewportSize()!.width < 761) await page.getByRole('button', { name: /Toggle navigation|展开或收起导航/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
}
test('dashboard renders five heatmap intensities, distinct states and working tooltips', async ({ page }) => {
  await launch(page);
  await expect(page.locator('.heatmap-grid button')).toHaveCount(84);
  for (let level = 1; level <= 5; level++) expect(await page.locator('.heatmap-grid .level-' + level).count()).toBeGreaterThan(0);
  for (const state of ['zero', 'missing', 'incomplete']) expect(await page.locator('.heatmap-grid .' + state).count()).toBeGreaterThan(0);
  const cell = page.locator('.heatmap-grid .level-5').first();
  await cell.scrollIntoViewIfNeeded();
  if (page.viewportSize()!.width < 761) await cell.tap(); else await cell.hover();
  await cell.focus();
  await expect(page.locator('.heat-tooltip .token-exact')).toContainText('tokens');
  await expect(page.locator('.heat-tooltip .token-compact')).not.toBeEmpty();
  await expect(page.getByRole('tooltip')).toContainText('Complete');
  const rect = await cell.boundingBox(); expect(Math.abs(rect!.width - rect!.height)).toBeLessThan(1);
  const keys = await page.locator('.heatmap-grid button').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-date')));
  await page.getByRole('button', { name: '7 days', exact: true }).click();
  await expect(page.locator('.usage-panel .panel-heading p')).toContainText('Daily');
  expect(await page.locator('.heatmap-grid button').evaluateAll(nodes => nodes.map(n => n.getAttribute('data-date')))).toEqual(keys);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
test('presets, lookback, custom bounds and DST errors reach actual accounting API', async ({ page }) => {
  await launch(page); await navigate(page, 'Statistics'); await expect(page.locator('.metrics')).toBeVisible();
  for (const [name, unit] of [['48 hours','Hourly'], ['7 days','Daily'], ['30 days','Daily'], ['24 hours','Hourly']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.usage-panel .panel-heading p')).toContainText(unit);
  }
  await page.getByRole('button', { name: 'Lookback', exact: true }).click();
  await page.getByLabel('Lookback amount').fill('36'); await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.locator('.usage-panel .panel-heading p')).toContainText('Hourly');
  await page.getByRole('button', { name: 'Custom range', exact: true }).click();
  await page.getByLabel('Start date and time').fill('2026-01-01T00:00');
  await page.getByLabel('End date and time').fill('2026-01-08T00:00');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.locator('.period-caption')).toContainText('Jan 1, 2026');
  await expect(page.locator('.usage-panel .panel-heading p')).toContainText('Daily');
  await page.getByLabel('Start date and time').fill('2025-11-02T01:30');
  await page.getByLabel('End date and time').fill('2025-11-02T03:00');
  await page.getByRole('button', { name: 'Apply range' }).click();
  await expect(page.getByRole('alert')).toContainText('ambiguous');
});
test('sessions can be searched and opened with snapshot, context and recent activity', async ({ page }) => {
  await launch(page); await navigate(page, 'Sessions');
  await expect(page.locator('.session-item')).toHaveCount(6);
  await page.getByLabel('Search sessions').fill('Core API');
  await expect(page.locator('.session-item')).toHaveCount(1);
  await page.locator('.session-item').click();
  await expect(page.getByRole('heading', { name: 'Latest request snapshot' })).toBeVisible();
  await expect(page.getByRole('meter')).toBeVisible();
  await expect(page.locator('.session-detail tbody tr')).toHaveCount(12);
  await page.getByLabel('Search sessions').fill('no synthetic session matches this');
  await expect(page.getByText('No sessions match your search.')).toBeVisible();
});
test('missing history offers opt-in Recorder sync, start and stop controls', async ({ page }) => {
  await launch(page, 'missing');
  await expect(page.getByRole('heading', { name: 'Your history starts here' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Recorder' }).click();
  await expect(page.getByRole('button', { name: 'Sync once' })).toBeEnabled();
  await page.getByRole('button', { name: 'Sync once' }).click();
  await expect(page.getByRole('heading', { name: 'Last sync result' })).toBeVisible();
  await expect(page.locator('.recorder-panel .database-path')).toContainText('Available');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.locator('.recorder-panel .status-badge')).toHaveText('Recording');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('.recorder-panel .status-badge')).toHaveText('GUI recorder stopped');
  await navigate(page, 'Dashboard');
  await expect(page.locator('.heatmap-grid button')).toHaveCount(84);
});
test('empty database renders missing observations without invented percentages', async ({ page }) => {
  await launch(page, 'empty');
  await expect(page.locator('.heatmap-grid .missing')).toHaveCount(84);
  await expect(page.locator('.cache-percentage strong')).toHaveText('—');
  await expect(page.getByText('No accounted Usage Events in this period. Try a wider range or sync local history.')).toBeVisible();
});
test('loading and API error states are visible and recoverable', async ({ page }) => {
  let release: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/stats?**', async route => {
    await gate;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic database read failure.', code: 'READ_ERROR' }) });
  });
  await launch(page);
  await expect(page.getByRole('status', { name: 'Loading dashboard' })).toBeVisible();
  release!();
  await expect(page.getByRole('alert')).toContainText('Synthetic database read failure');
  await page.unroute('**/api/stats?**');
  await page.getByRole('button', { name: 'Refresh dashboard' }).click();
  await expect(page.locator('.metrics')).toBeVisible();
});


test('language switch localizes navigation, analysis, sessions, Recorder and persists', async ({ page }) => {
  await launch(page); await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang','zh-CN');
  await expect(page.getByRole('heading', { name: '用量概览', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Token 活动', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '深入分析此范围' }).click();
  await expect(page.getByLabel('排行显示数量')).toHaveValue('10');
  await page.getByRole('button', { name: '自定义范围', exact: true }).click();
  await page.getByLabel('开始日期和时间').fill('2025-11-02T01:30');
  await page.getByLabel('结束日期和时间').fill('2025-11-02T03:00');
  await page.getByRole('button', { name: '应用范围', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('歧义');
  await navigate(page, '会话');
  await expect(page.getByLabel('搜索会话')).toBeVisible();
  await expect(page.getByRole('heading', { name: '最近一次请求快照' })).toBeVisible();
  await navigate(page, '记录器');
  await expect(page.getByRole('button', { name: '同步一次' })).toBeEnabled();
  await expect(page.locator('.recorder-panel')).toContainText('独立 CLI 记录器的状态未知');
  await page.reload();
  await expect(page.getByRole('heading', { name: '用量概览' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('codex-hud.language.v1'))).toBe('zh-CN');
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Usage overview' })).toBeVisible();
});

test('Bar and Line share precise accounted values and chart preference survives reload', async ({ page }) => {
  await launch(page, 'empty', addPrecision);
  await expect(page.locator('.usage-panel')).toHaveAttribute('data-chart-type','bar');
  await page.locator('.recharts-bar-rectangle path').first().scrollIntoViewIfNeeded();
  await page.locator('.recharts-bar-rectangle path').first().hover();
  await expect(page.locator('.chart-tooltip .tooltip-input .token-compact')).toHaveText('31.1M');
  await expect(page.locator('.chart-tooltip .tooltip-input .token-exact')).toHaveText('31,050,070 tokens');
  await expect(page.locator('.chart-tooltip .tooltip-output .token-compact')).toHaveText('153.5K');
  await expect(page.locator('.chart-tooltip .tooltip-output .token-exact')).toHaveText('153,528 tokens');
  const exactBefore = await page.locator('.metric-input .token-value').getAttribute('data-exact-tokens');
  await page.getByRole('button', { name: 'Line chart', exact: true }).click();
  await expect(page.locator('.usage-panel')).toHaveAttribute('data-chart-type','line');
  await expect(page.locator('.recharts-line')).toHaveCount(2);
  expect(await page.locator('.metric-input .token-value').getAttribute('data-exact-tokens')).toBe(exactBefore);
  await page.reload(); await expect(page.locator('.usage-panel')).toHaveAttribute('data-chart-type','line');
  expect(await page.evaluate(() => localStorage.getItem('codex-hud.chart-type.v1'))).toBe('line');
});

test('rankings search the full data, preserve shares and bound All to paginated rows', async ({ page }) => {
  await launch(page, 'populated', addRankings); await navigate(page, 'Statistics');
  await page.getByRole('button', { name: '30 days', exact: true }).click();
  await expect(page.locator('.analysis-ranking .ranking-row')).toHaveCount(10);
  await page.getByLabel('Ranking limit').selectOption('25');
  await expect(page.locator('.analysis-ranking .ranking-row')).toHaveCount(25);
  await page.getByLabel('Ranking limit').selectOption('50');
  await expect(page.locator('.analysis-ranking .ranking-row')).toHaveCount(25);
  await expect(page.locator('.page-controls')).toContainText('Page 1 of 2');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.page-controls')).toContainText('Page 2 of 2');
  await page.getByLabel('Ranking limit').selectOption('all');
  await expect(page.locator('.analysis-ranking .ranking-row')).toHaveCount(25);
  await page.getByRole('button', { name: 'Show less', exact: true }).click();
  await expect(page.getByLabel('Ranking limit')).toHaveValue('10');
  await page.getByLabel('Search all ranked sessions').fill('Deep search target 080');
  await expect(page.locator('.analysis-ranking .ranking-row')).toHaveCount(1);
  await expect(page.locator('.rank-name')).toContainText('Deep search target 080');
  expect(Number(await page.locator('.rank-index').textContent())).toBeGreaterThan(10);
  const boot = await (await fetch(gui.url + '/api/bootstrap')).json();
  const raw = await (await fetch(gui.url + '/api/stats?range=30d', { headers: {'x-codex-hud-token':boot.token} })).json();
  const target = raw.sessions.find((s: {sessionId:string}) => s.sessionId === 'synthetic-ranking-080');
  await expect(page.locator('.rank-value small')).toHaveText(target.inputShare.value.toFixed(1) + '% of Input');
  await page.getByLabel('Search all ranked sessions').fill('unmatched-synthetic-filter');
  await expect(page.getByText('No sessions match this filter. Search covers the full ranking dataset.')).toBeVisible();
});

test('Chinese missing, empty and API error states are localized', async ({ page }) => {
  await launch(page, 'missing'); await page.getByRole('button', {name:'简体中文',exact:true}).click();
  await expect(page.getByRole('heading', {name:'从这里开始记录历史'})).toBeVisible();
  await page.route('**/api/stats?**', route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic database read failure.',code:'READ_ERROR'})}));
  await page.getByRole('button', {name:'刷新仪表盘'}).click();
  await expect(page.getByRole('alert')).toContainText('无法读取本地数据库');
  await page.unroute('**/api/stats?**');
});
