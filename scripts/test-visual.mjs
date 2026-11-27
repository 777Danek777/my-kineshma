import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(path.join(path.resolve(process.env.PLAYWRIGHT_MODULE || 'storage/private/visual-qa-runtime/node_modules/playwright-core'), 'index.mjs')).href);

// Dedicated ephemeral Chromium profile. Only the local site is reachable;
// no editor credentials, publication writes or user browser profile are used.
const origin = 'http://127.0.0.1:3000';
const output = path.resolve('storage/private/visual-qa', 'run-' + new Date().toISOString().replaceAll(':', '-'));
fs.mkdirSync(output, { recursive: true });
const report = { output, checks: [], errors: [], screenshots: [] };
let page; let browser;
const pause = ms => page.waitForTimeout(ms);
async function shot(name) { await page.screenshot({ path: path.join(output, name + '.png') }); report.screenshots.push(name + '.png'); }
function pass(name) { report.checks.push(name); console.log('PASS: ' + name); }
async function context(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
  await ctx.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await ctx.newPage(); page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  return ctx;
}
async function visit(route = '/demo') {
  const response = await page.goto(origin + route); assert.equal(response.status(), 200);
  await page.evaluate(() => document.fonts.ready); await pause(350);
}
async function position() { return page.locator('.cm-category-viewport').evaluate(el => el.scrollLeft); }
async function top() { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await page.mouse.move(8, 180); await pause(100); }
async function noHorizontalOverflow() {
  const sizes = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(sizes.body <= sizes.viewport + 1, JSON.stringify(sizes));
}
async function cardsUnclipped(scope) {
  const failures = await page.locator(scope).evaluate(root => {
    const selectors = ['.cm-vk-card .button', '.cm-topics button:last-child', '.cm-latest .cm-latest-item:last-child', '.cm-suggest-card .cm-panel-foot'];
    return selectors.flatMap(selector => {
      const el = root.querySelector(selector); if (!el) return [];
      const card = el.closest('section'); const a = el.getBoundingClientRect(); const b = card.getBoundingClientRect();
      return a.bottom > b.bottom + 1 || a.left < b.left - 1 || a.right > b.right + 1 ? [{selector,cardHeight:b.height,contentBottom:a.bottom-b.top}] : [];
    });
  });
  assert.deepEqual(failures, [], 'Sidebar content must fit inside each card');
}
async function swipe(ctx, from, to) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x-from.x)*i/12, y: from.y + (to.y-from.y)*i/12 }] });
    await pause(18);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach(); await pause(450);
}
async function main() {
  browser = await chromium.launch({ headless: true, executablePath: process.env.VISUAL_CHROMIUM_PATH || chromium.executablePath() });
  report.browser = browser.version();
  let ctx = await context(); await visit();
  assert.ok((await page.locator('.ch-feedbar-title').innerText()).startsWith('Пульс города'));
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await cardsUnclipped('.cm-sidebar--desktop'); await noHorizontalOverflow(); await shot('desktop-dark');
  pass('Desktop title, initial dark theme, sidebar text and layout');
  let start = await position(); await pause(1300); assert.ok(Math.abs(await position()-start) > 8); pass('Carousel actually advances');
  for (const name of ['Источник публикаций', 'Порядок публикаций']) {
    const trigger = page.getByRole('combobox', { name }); await trigger.click(); await page.mouse.move(8,180);
    start = await position(); await pause(1300);
    assert.ok(Math.abs(await position()-start) > 8, 'Carousel must keep moving for this regression check');
    assert.equal(await page.getByRole('listbox').count(), 1, 'Moving carousel must not dismiss dropdown');
    await shot(name === 'Источник публикаций' ? 'source-menu-moving' : 'sort-menu-moving');
    await page.getByRole('option', { name: name === 'Источник публикаций' ? 'От жителя' : 'Сначала старые', exact: true }).click();
    assert.equal(await page.getByRole('listbox').count(), 0);
    assert.ok((await trigger.innerText()).includes(name === 'Источник публикаций' ? 'От жителя' : 'Сначала старые'));
    await trigger.click(); await page.getByRole('option', { name: name === 'Источник публикаций' ? 'Все источники' : 'Сначала новые', exact: true }).click();
    pass(name + ': open, keep open and select with active carousel');
  }
  await page.getByRole('combobox', { name: 'Порядок публикаций' }).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.ok((await page.getByRole('combobox', { name:'Порядок публикаций' }).innerText()).includes('Сначала старые'));
  await page.getByRole('combobox', { name:'Источник публикаций' }).click(); await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('listbox').count(),0); pass('Dropdown keyboard navigation and Escape');
  await top(); await page.locator('.cm-category-viewport').hover(); start=await position(); await pause(850); assert.ok(Math.abs(await position()-start)<2);
  await page.mouse.move(8,180); start=await position(); await pause(1000); assert.ok(Math.abs(await position()-start)>5); pass('Hover pauses and leaving resumes');
  const selected=await page.locator('.cm-category-track [aria-pressed="true"]').innerText(); const rail=await page.locator('.cm-category-viewport').boundingBox();
  start=await position(); await page.mouse.move(rail.x+rail.width*0.75,rail.y+rail.height/2); await page.mouse.down(); await page.mouse.move(rail.x+rail.width*0.75-140,rail.y+rail.height/2,{steps:12}); await page.mouse.up(); await pause(200);
  assert.ok(await position()>start+60); assert.equal(await page.locator('.cm-category-track [aria-pressed="true"]').innerText(),selected);
  await page.getByRole('button',{name:'Включить движение тем',exact:true}).click(); await page.mouse.move(8,180); start=await position(); await pause(1000); assert.ok(Math.abs(await position()-start)>5); pass('Mouse drag avoids accidental selection; resume works');
  await page.getByRole('combobox',{name:'Источник публикаций'}).click(); await page.mouse.move(20,800); await page.mouse.wheel(0,500); await pause(300); assert.equal(await page.getByRole('listbox').count(),0);
  const sticky=await page.locator('.cm-sidebar--desktop').boundingBox(); const header=await page.locator('#community-header').boundingBox();
  assert.ok(Math.abs(sticky.y-(header.y+header.height+14))<4, 'Sidebar stays below header'); await shot('desktop-sticky');
  await page.locator('.cm-sidebar--desktop').evaluate(el=>{el.scrollTop=el.scrollHeight}); await pause(100); await shot('desktop-sidebar-bottom');
  const bottom=await page.locator('.cm-sidebar--desktop .cm-panel-foot').boundingBox(); assert.ok(bottom.y+bottom.height<=sticky.y+sticky.height); pass('Sticky panel and complete internal scrolling; page scroll dismisses dropdown');
  await top(); await page.locator('.cm-sidebar--desktop').evaluate(el=>{el.scrollTop=0}); await page.getByRole('switch',{name:'Тёмная тема'}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light'); await cardsUnclipped('.cm-sidebar--desktop'); await shot('desktop-light');
  assert.equal(await page.locator('.cm-feed-composer').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','Theme switch must not fade the reading surface through gray');
  await page.reload(); await page.evaluate(()=>document.fonts.ready); assert.equal(await page.locator('html').getAttribute('data-theme'),'light'); pass('Light theme and persisted preference');
  await page.setViewportSize({width:1024,height:768}); await pause(150); await noHorizontalOverflow(); await cardsUnclipped('.cm-sidebar--desktop'); await shot('desktop-1024-light'); pass('1024px desktop layout');
  await page.setViewportSize({width:1920,height:1000}); await pause(150); await noHorizontalOverflow(); await cardsUnclipped('.cm-sidebar--desktop'); await shot('desktop-1920-light'); pass('1920px desktop layout');
  await ctx.close();

  for(const width of [390,360,320,768]) {
    ctx=await context({viewport:{width,height:width===768?1024:844},isMobile:true,hasTouch:true,deviceScaleFactor:1}); await visit();
    await noHorizontalOverflow(); start=await position(); await pause(900); assert.ok(Math.abs(await position()-start)<2,'No touch autoplay');
    const heading = await page.locator('#feed-title').evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight)}));
    assert.ok(heading.height <= heading.line+1,'Feed heading should stay on one line');
    assert.ok(await page.locator('.cm-banner-copy p').evaluate(el=>el.getBoundingClientRect().bottom<=el.closest('.cm-city-banner').getBoundingClientRect().bottom-10),'Mobile banner needs room below text');
    const touchRail=await page.locator('.cm-category-viewport').boundingBox();
    const beforeSelection=await page.locator('.cm-category-track [aria-pressed="true"]').innerText();
    await swipe(ctx,{x:touchRail.x+touchRail.width-15,y:touchRail.y+touchRail.height/2},{x:touchRail.x+15,y:touchRail.y+touchRail.height/2});
    assert.ok(await position()>20,'Horizontal touch swipe must scroll categories'); assert.equal(await page.locator('.cm-category-track [aria-pressed="true"]').innerText(),beforeSelection);
    await shot(`mobile-${width}-dark`);
    await page.getByRole('combobox',{name:'Источник публикаций'}).tap(); await pause(500); assert.equal(await page.getByRole('listbox').count(),1);
    const menu=await page.getByRole('listbox').boundingBox(); assert.ok(menu.x>=0&&menu.x+menu.width<=width+1); await page.getByRole('option',{name:'Все источники',exact:true}).tap();
    await page.getByRole('button',{name:'Город рядом',exact:true}).tap(); const dialog=page.getByRole('dialog',{name:'Город рядом',exact:true}); await dialog.waitFor();
    const sheet=await dialog.boundingBox(); assert.ok(sheet.x>=-1&&sheet.x+sheet.width<=width+1&&sheet.y>=0);
    await cardsUnclipped('.cm-sidebar--sheet'); await shot(`mobile-${width}-sheet`);
    for(let n=0;n<7;n++){await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));}
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'}); assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
    assert.ok(await page.getByRole('button',{name:'Город рядом',exact:true}).evaluate(el=>el===document.activeElement));
    await page.getByRole('switch',{name:'Тёмная тема'}).tap(); await shot(`mobile-${width}-light`);
    pass(`${width}px: touch swipe, no autoplay/overflow, dropdown, full drawer, focus trap, Escape, both themes`);
    if(width===390){
      await page.getByRole('button',{name:'Город рядом',exact:true}).tap(); await page.locator('.cm-sidebar--sheet .cm-latest-item').first().tap();
      await page.locator('.cm-dialog[open]').waitFor(); assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
      await page.getByRole('button',{name:'Закрыть окно',exact:true}).tap(); await page.locator('.cm-dialog[open]').waitFor({state:'detached'}); assert.notEqual(await page.evaluate(()=>document.body.style.overflow),'hidden');
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})); const b=await page.locator('.cm-category-viewport').boundingBox();
      await swipe(ctx,{x:b.x+b.width/2,y:b.y+b.height/2},{x:b.x+b.width/2,y:b.y-180}); assert.ok(await page.evaluate(()=>window.scrollY)>70); pass('Mobile dialog-to-article transition and vertical swipe over categories');
    }
    await ctx.close();
  }
  ctx=await context({reducedMotion:'reduce'}); await visit(); start=await position(); await pause(1000); assert.ok(Math.abs(await position()-start)<2); assert.equal(await page.locator('.cm-rail-play').isVisible(),false); pass('Reduced motion respected');
  await visit('/suggest-news'); await page.getByRole('link',{name:'В объективе',exact:true}).click(); await page.waitForURL('**/?view=photos#community-feed'); assert.equal(await page.getByRole('button',{name:'В объективе',exact:true}).getAttribute('aria-pressed'),'true'); pass('Cross-page pulse navigation');
  await visit('/'); await cardsUnclipped('.cm-sidebar--desktop'); await shot('live-home-dark'); pass('Live home renders with full sidebar content');
  await ctx.close(); assert.deepEqual(report.errors,[],'Browser console/runtime errors'); report.result='PASS';
}
main().catch(async error=>{report.result='FAIL';report.failure=error.stack;console.error(error.message);if(page&&!page.isClosed())await shot('failure').catch(()=>{});process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('REPORT: '+output)});
