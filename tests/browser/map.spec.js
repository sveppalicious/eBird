// The map: the three faults that prompted the rewrite, and the behaviour that
// has to survive it.
//
// The old map's height was derived from its viewBox. It changed on 13 of 14
// wheel ticks, stood anywhere from 475px to 1,819px tall depending on the shape
// of the sveitarfélag, and destroyed and re-requested every tile on every tick.
// Each of those is a test here, so none of them can come back unnoticed.

import { test, expect } from '@playwright/test';
import { pointInside, anyShapeExcept, mapState, settled, mapReady } from './helpers.js';

const frameHeight = page => page.locator('.map-frame').evaluate(el => el.getBoundingClientRect().height);

test.describe('the map holds still', () => {
  test('it is the same height for every region, whatever its shape', async ({ page }) => {
    // Grindavík is wide and flat, Eyjafjarðarsveit and Akureyrarbær long and
    // thin: 475px, 1,819px and worse under the old map.
    const routes = ['#/', '#/r/2300-grindavikurbaer', '#/r/6513-eyjafjardarsveit', '#/r/6000-akureyrarbaer',
      '#/r/0000-reykjavikurborg', '#/r/0000-reykjavikurborg-midborg', '#/r/6100-nordurthing',
      '#/r/1100-seltjarnarnesbaer', '#/r/0000-hafsvaedi', '#/s/arcter', '#/s/arcter/6613-thingeyjarsveit'];
    const heights = new Set();
    for (const r of routes) {
      await page.goto('/' + r);
      await mapReady(page);
      heights.add(Math.round(await frameHeight(page)));
    }
    expect([...heights]).toHaveLength(1);
    // And it is a map, not a collapsed box: zero is also "the same everywhere".
    expect([...heights][0]).toBeGreaterThan(250);
    expect([...heights][0]).toBeLessThanOrEqual(520);
  });

  test('zooming does not change its height or move the page', async ({ page }) => {
    // THE shake: every wheel tick used to resize the map by a pixel or two, so
    // everything below it jittered.
    await page.goto('/#/r/0000-reykjavikurborg');
    await mapReady(page);
    const box = await page.locator('.map-frame').boundingBox();
    const tabsTop = () => page.locator('.tabs').evaluate(el => el.getBoundingClientRect().top + window.scrollY);
    const before = { h: await frameHeight(page), tabs: await tabsTop(), zoom: (await mapState(page)).zoom };

    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.45);
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, i % 4 === 3 ? 100 : -120);
      await page.waitForTimeout(60);
      seen.add(await frameHeight(page));
      expect(await tabsTop()).toBe(before.tabs);
    }
    expect([...seen]).toEqual([before.h]);
    await settled(page);
    expect((await mapState(page)).zoom, 'the wheel should still zoom the map').toBeGreaterThan(before.zoom);
  });

  test('zooming and panning keep the shapes; nothing is torn down and redrawn', async ({ page }) => {
    // THE flash: every tick used to throw the tiles away and ask for them again.
    await page.goto('/#/');
    await mapReady(page);
    const count = await page.evaluate(() => {
      const shapes = document.querySelectorAll('.region-shape');
      shapes.forEach((el, i) => { el.__kept = i; });
      return shapes.length;
    });
    const box = await page.locator('.map-frame').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(80); }
    await settled(page);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 + 30, { steps: 8 });
    await page.mouse.up();

    const kept = await page.evaluate(() =>
      [...document.querySelectorAll('.region-shape')].filter(el => el.__kept !== undefined).length);
    expect(kept).toBe(count);
  });

  test('no page ever asks another host for anything', async ({ page }) => {
    // No tiles means no third parties. Watch the network across the whole site.
    const foreign = [];
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8788/')) foreign.push(r.url()); });
    for (const r of ['#/', '#/r/0000-reykjavikurborg', '#/s/arcter', '#/r/6100-nordurthing?tab=checklists', '#/me']) {
      await page.goto('/' + r);
      await page.locator('h1').waitFor();
      await page.waitForTimeout(300);
    }
    expect(foreign).toEqual([]);
  });
});

test.describe('the map is how you get around', () => {
  test('clicking a sveitarfélag opens it and flies to it', async ({ page }) => {
    // Pointer capture once retargeted every click to the <svg>, so the map
    // looked alive -- hover, tooltip, cursor -- and went nowhere.
    await page.goto('/#/');
    await mapReady(page);
    const before = await mapState(page);
    const pt = await pointInside(page, '6100-nordurthing');
    await page.mouse.click(pt.x, pt.y);

    await expect(page).toHaveURL(/#\/r\/6100-nordurthing$/);
    await expect(page.locator('h1')).toHaveText('Norðurþing');
    await settled(page);
    expect((await mapState(page)).zoom).toBeGreaterThan(before.zoom);
  });

  test('a neighbour stays clickable from a zoomed view', async ({ page }) => {
    await page.goto('/#/r/6100-nordurthing');
    await mapReady(page);
    await settled(page);
    // Its own areas are in focus; anything else on screen is a neighbour.
    const own = await page.evaluate(() =>
      [...document.querySelectorAll('.region-shape')].map(e => e.getAttribute('data-id')).filter(id => id.startsWith('6100-')));
    const hit = await anyShapeExcept(page, own);
    expect(hit).not.toBeNull();
    await page.mouse.click(hit.x, hit.y);
    await expect(page).toHaveURL(new RegExp(`#/r/${hit.id}$`));
  });

  test('clicking a hverfi goes one level deeper', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    await page.locator('.region-shape[data-id="0000-reykjavikurborg-midborg"]').waitFor({ state: 'attached' });
    await mapReady(page);
    await settled(page);
    const pt = await pointInside(page, '0000-reykjavikurborg-arbaer');
    await page.mouse.click(pt.x, pt.y);
    await expect(page).toHaveURL(/#\/r\/0000-reykjavikurborg-arbaer$/);
    await expect(page.locator('h1')).toHaveText('Árbær');
  });

  test('dragging pans without navigating', async ({ page }) => {
    await page.goto('/#/r/6100-nordurthing');
    await mapReady(page);
    await settled(page);
    const hit = await anyShapeExcept(page, []);
    const before = await mapState(page);

    await page.mouse.move(hit.x, hit.y);
    await page.mouse.down();
    await page.mouse.move(hit.x - 70, hit.y + 40, { steps: 10 });
    await page.mouse.up();
    await settled(page);

    await expect(page).toHaveURL(/#\/r\/6100-nordurthing$/);
    const after = await mapState(page);
    expect(Math.abs(after.lng - before.lng) + Math.abs(after.lat - before.lat)).toBeGreaterThan(0.001);
  });

  test('the reset button returns to the region', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    await mapReady(page);
    await settled(page);
    const home = await mapState(page);
    const box = await page.locator('.map-frame').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
    await settled(page);
    expect((await mapState(page)).zoom).not.toBe(home.zoom);

    await page.locator('.map-btn').first().click();
    await settled(page);
    expect((await mapState(page)).zoom).toBe(home.zoom);
  });

  test('the tooltip names the sveitarfélag an area belongs to', async ({ page }) => {
    // Three shapes read "660 Mývatn": the district crosses two boundaries.
    await page.goto('/#/r/6613-thingeyjarsveit');
    await page.locator('.region-shape[data-id="6613-thingeyjarsveit-660"]').waitFor({ state: 'attached' });
    await mapReady(page);
    await settled(page);
    const pt = await pointInside(page, '6613-thingeyjarsveit-660');
    await page.mouse.move(pt.x, pt.y);
    const tip = page.locator('.map-tip');
    await expect(tip).toContainText('660 Mývatn');
    await expect(tip.locator('.tip-sub')).toHaveText('Þingeyjarsveit');
  });
});
