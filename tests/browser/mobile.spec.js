// Small screens -- the size most birders actually carry.
//
// Own file because a viewport override has to be top-level in Playwright. The
// emulation is spelled out rather than taken from devices['iPhone 13'], which
// carries defaultBrowserType: 'webkit' and would pull a second browser into CI
// for no benefit here. `isMobile` is the part that matters: it is what makes
// Chromium honour the viewport meta tag.

import { test, expect } from '@playwright/test';
import { mapReady } from './helpers.js';

test.use({ viewport: { width: 390, height: 664 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

test.describe('on a phone', () => {
  const routes = ['/#/', '/#/r/0000-reykjavikurborg', '/#/r/0000-reykjavikurborg?tab=checklists',
                  '/#/s/arcter', '/#/s/arcter/6100-nordurthing', '/#/me'];

  for (const route of routes) {
    test(`${route} lays out at the real device width`, async ({ page }) => {
      // The bug this catches is invisible and affects every page: if anything
      // has a min-content width wider than the phone, Chrome widens the layout
      // viewport and scales the whole document down to fit. Nothing looks
      // broken -- it just renders at ~80% and slightly soft.
      await page.goto(route);
      await page.locator('h1').waitFor();
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => ({
        inner: window.innerWidth, client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
      }));
      expect(m.inner, 'layout viewport must equal the device width').toBe(m.client);
      expect(m.scroll, 'the page must not scroll sideways').toBeLessThanOrEqual(m.client + 1);
    });
  }

  test('everything in the top bar is on screen', async ({ page }) => {
    await page.goto('/#/');
    for (const sel of ['.brand', '.search input', '[data-source="all"]', '[data-source="mine"]',
                       '[data-lang="is"]', '[data-lang="en"]', '.topnav-link']) {
      await expect(page.locator(sel)).toBeInViewport();
    }
  });

  test('the map is the same modest height for a long thin sveitarfélag as for any other', async ({ page }) => {
    // Akureyrarbær is 1:5.6. The old map drew it roughly 1,800px tall.
    const heights = [];
    for (const r of ['/#/', '/#/r/6000-akureyrarbaer', '/#/r/2300-grindavikurbaer']) {
      await page.goto(r);
      await mapReady(page);
      heights.push(Math.round((await page.locator('.map-frame').boundingBox()).height));
    }
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeLessThan(664 * 0.6);
  });

  test('a one-finger drag on the map scrolls the page', async ({ page }) => {
    // A map that swallows the scroll gesture traps a phone user above it.
    // Pinch still zooms; taps still select.
    await page.goto('/#/');
    await mapReady(page);
    const dragging = await page.evaluate(() => document.querySelector('.region-map').leafletMap.dragging.enabled());
    expect(dragging).toBe(false);
    const touchAction = await page.locator('.region-map').evaluate(el => getComputedStyle(el).touchAction);
    expect(touchAction).not.toBe('none');
  });

  test('tapping a region still opens it', async ({ page }) => {
    await page.goto('/#/');
    await page.locator('.region-shape[data-id="6100-nordurthing"]').waitFor({ state: 'attached' });
    await mapReady(page);
    await page.locator('.region-shape[data-id="6100-nordurthing"]').dispatchEvent('click');
    await expect(page).toHaveURL(/#\/r\/6100-nordurthing$/);
  });

  test('the first table column stays put while the rest scrolls', async ({ page }) => {
    // Scrolled right, a row is otherwise an anonymous set of numbers.
    await page.goto('/#/r/0000-reykjavikurborg?tab=checklists');
    const first = page.locator('.tab-body tbody tr').first().locator('td').first();
    await first.waitFor();
    const before = (await first.boundingBox()).x;
    await page.locator('.tab-body .table-wrap').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(200);
    expect((await first.boundingBox()).x).toBeCloseTo(before, 0);
  });

  test('charts are drawn at phone size, not shrunk', async ({ page }) => {
    await page.goto('/#/s/arcter');
    const svg = page.locator('.chart-plot svg').first();
    await svg.waitFor();
    const w = await svg.evaluate(el => el.getBoundingClientRect().width);
    expect(w).toBeLessThanOrEqual(390);
    expect(w).toBeGreaterThan(300);
    // Axis text keeps its designed size instead of scaling with the chart.
    const size = await page.locator('.chart-axis').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBe(11);
  });
});
