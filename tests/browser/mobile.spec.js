// Small screens -- the size most birders actually carry.
//
// Own file because a viewport override has to be top-level in Playwright; in a
// describe block it fails, since changing it forces a new worker.
//
// The emulation is spelled out rather than taken from devices['iPhone 13'],
// which carries defaultBrowserType: 'webkit' and would pull a second browser
// into CI for no benefit here. `isMobile` is the part that matters: it is what
// makes Chromium honour the viewport meta tag, and therefore what makes the
// layout-viewport check below mean anything. iPhone 13 dimensions.

import { test, expect } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 664 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
});

test.describe('on a phone', () => {
  const routes = ['/#/', '/#/mun/0000-reykjavikurborg',
                  '/#/mun/0000-reykjavikurborg/checklists', '/#/species', '/#/me'];

  for (const route of routes) {
    test(`${route} lays out at the real device width`, async ({ page }) => {
      // The bug this catches is invisible and affects every page: if anything
      // has a min-content width wider than the phone, Chrome widens the layout
      // viewport and scales the whole document down to fit. Nothing looks
      // broken -- it just renders at ~80% and slightly soft. The top bar did
      // exactly this, at 484px against a 390px screen.
      await page.goto(route);
      await page.waitForSelector('h1');

      const m = await page.evaluate(() => ({
        inner: window.innerWidth,
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth
      }));
      expect(m.inner, 'layout viewport must equal the device width').toBe(m.client);
      expect(m.scroll, 'the page must not scroll sideways').toBeLessThanOrEqual(m.client + 1);
    });
  }

  test('every destination in the top bar is reachable', async ({ page }) => {
    // They used to run off the right edge: EN and the eBird link were simply
    // not on screen, with no way to scroll to them.
    await page.goto('/#/');
    for (const name of ['Kort', 'Tegundir', 'Mín gögn', 'eBird Iceland ↗']) {
      await expect(page.locator('.topnav').getByText(name, { exact: true })).toBeInViewport();
    }
    await expect(page.locator('[data-lang="en"]')).toBeInViewport();
  });

  test('a long thin municipality does not become a map several screens tall', async ({ page }) => {
    // Akureyrarbær is 1:5.6. Framed literally that was ~1,800px of map.
    await page.goto('/#/mun/6000-akureyrarbaer');
    await page.waitForSelector('svg.map-svg');
    const box = await page.locator('svg.map-svg').boundingBox();
    expect(box.height / box.width).toBeLessThan(1.7);
  });

  test('the first table column stays put while the rest scrolls', async ({ page }) => {
    // Scrolled right, a row is otherwise an anonymous set of numbers.
    await page.goto('/#/mun/0000-reykjavikurborg/checklists');
    await page.waitForSelector('tbody tr');
    const firstCell = page.locator('tbody tr').first().locator('td').first();
    const before = (await firstCell.boundingBox()).x;

    await page.locator('.table-wrap').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(200);

    expect((await firstCell.boundingBox()).x).toBeCloseTo(before, 0);
    await expect(firstCell).toBeInViewport();
  });
});
