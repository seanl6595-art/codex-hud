import {test, expect} from '@playwright/test';
import type {Page} from '@playwright/test';
const {createTooltipFixture}=require('./tooltip-fixture.cjs');
const {startServer}=require('../lib/gui/server'),{createFixture}=require('./fixtures.cjs'),{addAnalyticsData}=require('./analytics-fixtures.cjs');
let gui: Awaited<ReturnType<typeof startServer>>, fixture: Awaited<ReturnType<typeof createFixture>>, errors: string[];
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));fixture=await createFixture();addAnalyticsData(fixture);gui=await startServer({home:fixture.home,dbPath:fixture.dbPath,port:0});await page.goto(gui.url);await expect(page.locator('.usage-panel')).toBeVisible();});
test.afterEach(async()=>{await gui?.close();fixture?.cleanup();expect(errors).toEqual([]);});
async function statistics(page:Page){if(page.viewportSize()!.width<761)await page.getByRole('button',{name:'Toggle navigation'}).click();await page.getByRole('button',{name:'Statistics',exact:true}).click();await expect(page.locator('.model-table tbody tr').first()).toBeVisible();}
test('expanded usage retains data and chart choices, traps focus and dismisses with Escape/backdrop',async({page})=>{
  const rangeResponse=page.waitForResponse(r=>r.url().includes('/api/stats?range=48h')&&r.ok());
  await page.getByRole('button',{name:'48 hours',exact:true}).click();const raw=await(await rangeResponse).json();await expect(page.locator('.metric-input .token-value')).toHaveAttribute('data-exact-tokens',String(raw.totals.input.value));
  const before=await page.locator('.metric-input .token-value').getAttribute('data-exact-tokens');let requests=0;page.on('request',r=>{if(r.url().includes('/api/stats?'))requests++;});
  const trigger=page.getByRole('button',{name:'Expand Usage over time',exact:true});await trigger.click();const dialog=page.getByRole('dialog',{name:'Usage over time',exact:true});await expect(dialog).toBeVisible();expect(requests).toBe(0);
  await expect(dialog.getByRole('button',{name:'Bar chart',exact:true})).toHaveAttribute('aria-pressed','true');
  await dialog.getByRole('button',{name:'Line chart',exact:true}).click();await expect(dialog.locator('.gap-guide').first()).toBeVisible();
  await dialog.getByLabel('Connect gaps', {exact:true}).uncheck();await expect(dialog.locator('.gap-guide')).toHaveCount(0);await dialog.getByLabel('Connect gaps',{exact:true}).check();
  await dialog.getByLabel('Separate Input / Output scales').check();await expect(dialog.locator('.split-pane')).toHaveCount(2);await expect(dialog.locator('.recharts-yAxis')).toHaveCount(2);
  await dialog.getByLabel('Output',{exact:true}).uncheck();await expect(dialog.locator('.split-pane')).toHaveCount(1);
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.closest('dialog')!==null)).toBe(true);
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
  expect(await page.locator('.metric-input .token-value').getAttribute('data-exact-tokens')).toBe(before);await expect(page.locator('.usage-panel')).toHaveAttribute('data-chart-type','line');
  await trigger.click();await page.mouse.click(1,1);await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('expanded usage brush zoom changes plotting range without an accounting request',async({page})=>{
  await statistics(page);await page.getByRole('button',{name:'Expand Usage over time',exact:true}).click();const dialog=page.getByRole('dialog');
  let requests=0;page.on('request',r=>{if(r.url().includes('/api/stats?'))requests++;});
  const traveller=dialog.locator('.recharts-brush-traveller').first();await traveller.focus();await page.keyboard.press('ArrowRight');await expect(dialog.getByRole('button',{name:'Reset zoom'})).toBeEnabled();
  await dialog.getByRole('button',{name:'Reset zoom'}).click();await expect(dialog.getByRole('button',{name:'Reset zoom'})).toBeDisabled();
  expect(requests).toBe(0);
});
test('chart tooltips distinguish missing observations from a recorded zero in Bar and Line views',async({page})=>{
  // The general rolling fixtures can overlap a zero observation with positive usage.
  // Isolate this case and inspect exactly the fixed response rendered by the chart.
  await gui.close();fixture.cleanup();
  fixture=await createTooltipFixture();
  gui=await startServer({home:fixture.home,dbPath:fixture.dbPath,port:0});
  await page.goto(gui.url);
  if(page.viewportSize()!.width<761)await page.getByRole('button',{name:'Toggle navigation'}).click();
  await page.getByRole('button',{name:'Statistics',exact:true}).click();
  await page.getByRole('button',{name:'Custom range',exact:true}).click();
  await page.getByLabel('Start date and time').fill('2026-03-08T00:00');
  await page.getByLabel('End date and time').fill('2026-03-08T05:00');
  await page.getByLabel('Timezone',{exact:true}).selectOption('America/Vancouver');
  const response=page.waitForResponse(r=>r.url().includes('/api/stats?range=custom')&&r.ok());
  await page.getByRole('button',{name:'Apply range'}).click();
  const raw=await(await response).json();
  expect(raw.period.from).toBe('2026-03-08T08:00:00.000Z');
  expect(raw.period.to).toBe('2026-03-08T12:00:00.000Z');
  expect(raw.buckets.map((b:{state:string})=>b.state)).toEqual(['observed','missing','zero','observed']);
  expect(raw.buckets.map((b:{observations:number})=>b.observations)).toEqual([1,0,1,1]);
  expect(raw.totals.input.value).toBe(150);expect(raw.totals.output.value).toBe(15);
  await expect(page.locator('.metric-input .token-value')).toHaveAttribute('data-exact-tokens','150');
  const chart=page.locator('.usage-panel .chart');await chart.scrollIntoViewIfNeeded();
  for(const type of ['Bar chart','Line chart']){
    await page.locator('.usage-panel').getByRole('button',{name:type,exact:true}).click();
    const svg=await chart.locator('svg.recharts-surface').boundingBox(),grid=chart.locator('.recharts-cartesian-grid-horizontal line').first();
    const left=Number(await grid.getAttribute('x1')),right=Number(await grid.getAttribute('x2'));
    for(const state of ['missing','zero']){
      const index=raw.buckets.findIndex((b:{state:string})=>b.state===state);expect(index).toBeGreaterThanOrEqual(0);
      const fraction=type==='Bar chart'?(index+.5)/raw.buckets.length:index/(raw.buckets.length-1);
      await page.mouse.move(svg!.x+left+(right-left)*fraction,svg!.y+80);
      await expect(chart.getByRole('tooltip')).toContainText(state==='missing'?'No recorded observations':'Recorded observations account for zero');
      const tooltip=await chart.getByRole('tooltip').boundingBox();expect(tooltip!.x).toBeGreaterThanOrEqual(0);expect(tooltip!.x+tooltip!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
  }
});
test('expanded blue calendar reuses 12 weeks and supports 26/52 weeks, date navigation and tooltips',async({page})=>{
  const cell=page.locator('.heatmap-grid button').first(), normal=(await cell.boundingBox())!.width;let requests=0;page.on('request',r=>{if(r.url().includes('/api/heatmap?'))requests++;});
  await page.getByRole('button',{name:'Expand Token activity',exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog.locator('.heatmap-grid button')).toHaveCount(84);expect(requests).toBe(0);
  expect((await dialog.locator('.heatmap-grid button').first().boundingBox())!.width).toBeGreaterThan(normal);
  for(const [weeks,count]of[['26',182],['52',364]] as const){await dialog.getByLabel('Calendar window').selectOption(weeks);await expect(dialog.locator('.heatmap-grid button')).toHaveCount(count);}
  await dialog.getByLabel('Calendar window').selectOption('12');await expect(dialog.locator('.heatmap-grid button')).toHaveCount(84);
  const first=await dialog.locator('.heatmap-grid button').first().getAttribute('data-date');await dialog.getByRole('button',{name:'Earlier week'}).click();await expect(dialog.locator('.heatmap-grid button').first()).not.toHaveAttribute('data-date',first!);
  const target=dialog.locator('.heatmap-grid .level-5').first();await target.focus();await expect(dialog.getByRole('tooltip')).toContainText('tokens');
  await dialog.getByRole('button',{name:'Close expanded chart'}).click();await expect(page.locator('.heatmap-grid button')).toHaveCount(84);
});
test('model/effort filters, workload denominator, sorting and related sessions use real analytics API',async({page})=>{
  await statistics(page);await expect(page.locator('.model-table')).toContainText('Observed Turns');await expect(page.locator('.effort-analytics')).toContainText('Unknown / Unattributed');
  await page.getByRole('button',{name:'7 days',exact:true}).click();await expect(page.locator('.usage-panel .panel-heading p')).toContainText('Daily');
  await page.getByLabel('Measured workload',{exact:true}).selectOption('combined');await expect(page.locator('.model-distribution .panel-heading p')).toContainText('Input + Output');
  const model='synthetic-model-alpha';await page.getByLabel('Model filter',{exact:true}).selectOption(JSON.stringify(model));await expect(page.locator('.related-sessions')).toContainText(model);
  await page.getByLabel('Effort filter',{exact:true}).selectOption(JSON.stringify('high'));await expect(page.locator('.effort-analytics tbody')).toContainText('High');
  const row=page.locator('.model-table tbody tr').filter({hasText:model});await expect(row).toContainText('100.0%');
  await page.locator('.model-table th').filter({has:page.getByRole('button',{name:'Input',exact:true})}).getByRole('button').click();await expect(page.locator('.model-table th[aria-sort=ascending]')).toContainText('Input');
  await page.getByLabel('Search models',{exact:true}).fill('no-synthetic-model-matches');await expect(page.locator('.model-table tbody tr')).toHaveCount(0);await page.getByLabel('Search models',{exact:true}).fill('');
  await page.getByRole('button',{name:'Clear analytics filters'}).click();await expect(page.getByLabel('Model filter',{exact:true})).toHaveValue('all');
  await page.getByLabel('Model display limit').selectOption('5');expect(await page.locator('.model-table tbody tr').count()).toBeLessThanOrEqual(5);
  await page.getByLabel('Model filter',{exact:true}).selectOption(JSON.stringify(model));await page.locator('.related-session-list button').first().click();await expect(page.getByRole('heading',{name:'Latest request snapshot'})).toBeVisible();
});
test('model trend expands, switches type and uses bilingual persistent UI',async({page})=>{
  await statistics(page);await page.getByRole('button',{name:'Expand Model usage over time',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Line chart'}).click();await expect(dialog.locator('.recharts-line').first()).toBeVisible();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'简体中文',exact:true}).click();await expect(page.getByRole('heading',{name:'模型用量分析',exact:true})).toBeVisible();await expect(page.getByLabel('强度筛选',{exact:true})).toBeVisible();await expect(page.locator('.quality-details')).toContainText('不可相加');
  await page.reload();await expect(page.getByRole('heading',{name:'用量概览'})).toBeVisible();
});
test('comfortable layouts fit 1280, 1920, 2560 and narrow desktops without page overflow',async({page})=>{
  for(const width of [1280,1920,2560,768,390]){
    await page.setViewportSize({width,height:1050});await expect(page.locator('.usage-panel .chart')).toBeVisible();
    const sizes=await page.evaluate(()=>({page:document.documentElement.scrollWidth,view:innerWidth,main:document.querySelector('main')!.getBoundingClientRect().width,workspace:document.querySelector('.workspace')!.getBoundingClientRect().width,body:parseFloat(getComputedStyle(document.body).fontSize),chart:document.querySelector('.usage-panel .chart')!.getBoundingClientRect().height}));
    expect(sizes.page).toBeLessThanOrEqual(sizes.view);expect(sizes.body).toBeGreaterThanOrEqual(14);expect(sizes.chart).toBeGreaterThanOrEqual(340);
    if(width>=1280){expect(sizes.main/sizes.workspace).toBeGreaterThan(.9);expect(sizes.main/sizes.workspace).toBeLessThan(.96);}
  }
});
test('review screenshots show enlarged dashboard, expanded charts, heatmap and bilingual analytics',async({page},info)=>{
  const mobile=info.project.name==='mobile-chrome',directory='.gui-preview/comfortable'+(mobile?'/mobile':'');require('node:fs').mkdirSync(directory,{recursive:true});if(!mobile)await page.setViewportSize({width:1920,height:1200});
  await page.screenshot({path:directory+'/01-dashboard.png',fullPage:true});
  await page.getByRole('button',{name:'Expand Usage over time',exact:true}).click();await page.screenshot({path:directory+'/02-expanded-bar.png'});
  await page.getByRole('dialog').getByRole('button',{name:'Line chart',exact:true}).click();await page.screenshot({path:directory+'/03-expanded-line.png'});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Expand Token activity',exact:true}).click();await page.screenshot({path:directory+'/04-expanded-heatmap.png'});await page.keyboard.press('Escape');
  await statistics(page);await page.getByRole('button',{name:'7 days',exact:true}).click();await expect(page.locator('.usage-panel .panel-heading p')).toContainText('Daily');
  await page.locator('.model-analytics').screenshot({path:directory+'/05-model-analytics.png'});await page.locator('.effort-analytics').screenshot({path:directory+'/06-effort-analytics.png'});
  await page.getByRole('button',{name:'简体中文',exact:true}).click();await page.screenshot({path:directory+'/07-chinese-statistics.png',fullPage:true});
});
