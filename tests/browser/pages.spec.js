// The two page types, and the claim the rewrite makes about them: the same
// sections, in the same order, at every level.
//
// Before, Iceland was a map and a table of children with no bird list, a
// sveitarfélag was a bird list with its children behind a tab, and a póstnúmer
// was a bird list computed another way. Species pages split the same way.

import { test, expect } from '@playwright/test';

const LEVELS = [
  ['Iceland', '', 'Ísland'],
  ['a sveitarfélag', '0000-reykjavikurborg', 'Reykjavíkurborg'],
  ['a hverfi', '0000-reykjavikurborg-midborg', 'Miðborg'],
  ['a póstnúmer', '6100-nordurthing-640', '640 Húsavík']
];
const regionUrl = (id, q = '') => (id ? `/#/r/${id}${q}` : `/#/${q}`);
const speciesUrl = (code, id) => (id ? `/#/s/${code}/${id}` : `/#/s/${code}`);

test.describe('a region page is the same page at every level', () => {
  for (const [what, id, name] of LEVELS) {
    test(`${what}: heading, four stats, map, tabs, species list`, async ({ page }) => {
      await page.goto(regionUrl(id));
      await expect(page.locator('h1')).toHaveText(name);
      await expect(page.locator('.stats .stat')).toHaveCount(4);
      await expect(page.locator('.map-frame .region-shape').first()).toBeAttached();
      for (const tab of ['species', 'checklists', 'activity']) {
        await expect(page.locator(`.tab[data-tab="${tab}"]`)).toBeVisible();
      }
      // The species list is the default tab everywhere -- including Iceland,
      // which used to have no bird list at all.
      await expect(page.locator('.tab.is-active')).toHaveAttribute('data-tab', 'species');
      await expect(page.locator('.tab-body tbody tr').first()).toBeVisible();
      await expect(page.locator('.tab-body thead th').first()).toHaveText('Species');
    });

    test(`${what}: checklists and activity tabs work`, async ({ page }) => {
      await page.goto(regionUrl(id, '?tab=checklists'));
      await expect(page.locator('.tab-body tbody tr').first()).toBeVisible();
      await expect(page.locator('.tab-body thead')).toContainText('Protocol');

      await page.locator('.tab[data-tab="activity"]').click();
      await expect(page).toHaveURL(/tab=activity/);
      await expect(page.locator('.chart figcaption h3')).toHaveText(['Species per year', 'Checklists per year']);
    });
  }

  test('the Areas tab is there exactly when there is a level below', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('.tab[data-tab="areas"]')).toHaveText('Areas (62)');
    await page.goto('/#/r/0000-reykjavikurborg');
    await expect(page.locator('.tab[data-tab="areas"]')).toHaveText('Areas (13)');
    await page.goto('/#/r/0000-reykjavikurborg-midborg');
    await expect(page.locator('.tab[data-tab="areas"]')).toHaveCount(0);
    // One postal area covers the whole of Seltjarnarnesbær: that is not a
    // subdivision, so no tab offers it.
    await page.goto('/#/r/1100-seltjarnarnesbaer');
    await expect(page.locator('h1')).toHaveText('Seltjarnarnesbær');
    await expect(page.locator('.tab[data-tab="areas"]')).toHaveCount(0);
  });

  test('the Areas tab lists the children and links down a level', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg?tab=areas');
    await expect(page.locator('.tab-body tbody tr')).toHaveCount(13);
    await page.locator('.tab-body').getByRole('link', { name: 'Miðborg', exact: true }).click();
    await expect(page).toHaveURL(/#\/r\/0000-reykjavikurborg-midborg$/);
  });

  test('the breadcrumb climbs back up', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg-midborg');
    await page.locator('.crumbs').getByRole('link', { name: 'Reykjavíkurborg' }).click();
    await expect(page).toHaveURL(/#\/r\/0000-reykjavikurborg$/);
    await page.locator('.crumbs').getByRole('link', { name: 'Ísland' }).click();
    await expect(page.locator('h1')).toHaveText('Ísland');
  });
});

test.describe('a species page is the same page at every level', () => {
  for (const [what, id, name] of LEVELS) {
    test(`${what}: stats, the charts, map and records`, async ({ page }) => {
      await page.goto(speciesUrl('arcter', id));
      await expect(page.locator('h1')).toHaveText('Arctic Tern');
      await expect(page.locator('.stats .stat')).toHaveCount(5);
      // By year and by month at every level: the request that started this.
      // The national page used to have a map and no charts.
      const titles = page.locator('.chart figcaption h3');
      await expect(titles.nth(0)).toHaveText('By year');
      await expect(titles.nth(1)).toHaveText('By month');
      await expect(titles.nth(2)).toHaveText('Year by month');
      await expect(page.locator('.chart-plot svg').first()).toBeVisible();
      await expect(page.locator('.map-frame .region-shape').first()).toBeAttached();
      await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();
      await expect(page.locator('article > div > .table-wrap tbody tr, article > div .table-wrap tbody tr').first()).toBeVisible();
      await expect(page.locator('.crumbs, h1').first()).toContainText(id ? 'Ísland' : 'Arctic Tern');
    });
  }

  test('a summer migrant gets its arrival dates; a resident does not', async ({ page }) => {
    // A resident's "first date" is whenever somebody first went out in January.
    await page.goto('/#/s/arcter');
    await expect(page.locator('.chart figcaption h3')).toContainText(['First record of each year']);
    await page.goto('/#/s/comeid');
    await expect(page.locator('.chart figcaption h3').first()).toHaveText('By year');
    await expect(page.locator('.chart figcaption h3')).toHaveCount(3);
  });

  test('a bar answers to hover and to the keyboard, and has a table twin', async ({ page }) => {
    await page.goto('/#/s/arcter');
    const chart = page.locator('.chart').first();
    const hit = chart.locator('.chart-hit').last();
    await hit.hover();
    await expect(chart.locator('.chart-tip')).toContainText('%');
    await expect(chart.locator('.chart-tip')).toContainText('complete checklists');

    await page.mouse.move(0, 0);
    await expect(chart.locator('.chart-tip')).toHaveCount(0);
    await hit.focus();
    await expect(chart.locator('.chart-tip')).toContainText('%');

    // A tooltip must never be the only way to read a value.
    await chart.locator('summary').click();
    await expect(chart.locator('.chart-table tbody tr').first()).toBeVisible();
  });

  test('bars are thin, and the frequency axis is in percent', async ({ page }) => {
    await page.goto('/#/s/arcter');
    const month = page.locator('.chart').nth(1);
    const widths = await month.locator('svg path').evaluateAll(ps => ps.map(p => p.getBBox().width));
    expect(Math.max(...widths)).toBeLessThanOrEqual(24);
    await expect(month.locator('.chart-axis').first()).toContainText('%');
    // Twelve months, each labelled.
    await expect(month.locator('svg')).toContainText('Jan');
    await expect(month.locator('svg')).toContainText('Dec');
  });

  test('the species page lists the regions below and scopes into them', async ({ page }) => {
    await page.goto('/#/s/arcter/0000-reykjavikurborg');
    const row = page.locator('.table-wrap').getByRole('link', { name: 'Miðborg', exact: true });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page).toHaveURL(/#\/s\/arcter\/0000-reykjavikurborg-midborg$/);
    await expect(page.locator('h1')).toHaveText('Arctic Tern');
  });

  test('clicking the map on a species page stays on the species', async ({ page }) => {
    await page.goto('/#/s/arcter');
    await page.locator('.region-shape[data-id="6100-nordurthing"]').waitFor({ state: 'attached' });
    await page.locator('.region-shape[data-id="6100-nordurthing"]').dispatchEvent('click');
    await expect(page).toHaveURL(/#\/s\/arcter\/6100-nordurthing$/);
  });

  test('a species not recorded in a region says so and points to where it was', async ({ page }) => {
    // Mallard-common in the country, never in the open sea region.
    await page.goto('/#/s/eurwig/0000-hafsvaedi');
    await expect(page.locator('.empty')).toContainText('No records');
    await page.locator('article').getByRole('link', { name: /See .* in Ísland/ }).click();
    await expect(page).toHaveURL(/#\/s\/eurwig$/);
  });

  test('a link from the species list keeps the region', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    await page.locator('.tab-body .sp-name').first().click();
    await expect(page).toHaveURL(/#\/s\/[a-z0-9]+\/0000-reykjavikurborg$/);
  });
});

test.describe('the species list', () => {
  test('the Find box takes a whole word in one go', async ({ page }) => {
    // The old list rebuilt its controls on every keystroke, destroying the
    // input being typed into: one character per click.
    await page.goto('/#/');
    const input = page.locator('.tab-body input[type=search]');
    await input.click();
    await page.keyboard.type('skua', { delay: 40 });
    await expect(input).toHaveValue('skua');
    await expect(input).toBeFocused();
    await expect(page.locator('.tab-body tbody tr')).toHaveCount(2);
    await expect(page.locator('.tab-body tbody')).toContainText('Great Skua');
  });

  test('accents are optional when searching', async ({ page }) => {
    await page.goto('/#/');
    await page.locator('[data-lang="is"]').click();
    await page.locator('.tab-body input[type=search]').fill('kria');
    await expect(page.locator('.tab-body tbody tr').first()).toContainText('Kría');
  });

  test('choosing a year gives that year\'s list, and the URL remembers it', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    const rows = page.locator('.tab-body tbody tr');
    await expect(rows.first()).toBeVisible();
    // All years: 8 columns, with the location, observer and high count of the
    // last record. One year: the list for that year, with its own dates.
    await expect(page.locator('.tab-body thead th')).toHaveCount(8);
    await page.locator('#year').selectOption('2026');
    await expect(page).toHaveURL(/year=2026/);
    await expect(page.locator('.tab-body thead th')).toHaveCount(5);
    await expect(rows.first()).toContainText('2026');
    // Every date on a 2026 list is in 2026.
    const dates = await rows.locator('td:nth-child(4), td:nth-child(5)').allTextContents();
    expect(dates.length).toBeGreaterThan(20);
    expect(dates.every(d => d.endsWith('2026'))).toBe(true);

    await page.reload();
    await expect(page.locator('#year')).toHaveValue('2026');
    await expect(page.locator('.tab-body tbody tr').first()).toContainText('2026');

    await page.locator('#year').selectOption('');
    await expect(page).not.toHaveURL(/year=/);
  });

  test('sorting by frequency puts the commonest first', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    await page.getByRole('button', { name: 'Most frequent' }).click();
    const pcts = await page.locator('.tab-body tbody tr td:nth-child(2)').evaluateAll(
      tds => tds.slice(0, 10).map(td => parseFloat(td.textContent.replace(',', '.').replace('<', ''))));
    expect(pcts).toEqual([...pcts].sort((a, b) => b - a));
    expect(pcts[0]).toBeGreaterThan(20);
  });

  test('the four links out to eBird are there', async ({ page }) => {
    // Date to the checklist, location to the hotspot, observer to the profile,
    // and the species to its own page -- the original brief.
    await page.goto('/#/r/0000-reykjavikurborg');
    const body = page.locator('.tab-body tbody');
    await expect(body.locator('a[href^="https://ebird.org/checklist/"]').first()).toBeVisible();
    await expect(body.locator('a[href^="https://ebird.org/hotspot/"]').first()).toBeVisible();
    await expect(body.locator('a[href^="https://ebird.org/profile/"]').first()).toBeVisible();
    await expect(body.locator('a.sp-name[href^="#/s/"]').first()).toBeVisible();
  });
});

test.describe('checklists', () => {
  test('the country shows the latest and says so', async ({ page }) => {
    await page.goto('/#/?tab=checklists');
    await expect(page.locator('.tab-body .note')).toContainText('latest 2.000 of 235.811');
    // Only here does a location need its sveitarfélag beside it.
    await expect(page.locator('.tab-body thead')).toContainText('Region');
  });

  test('the Find box keeps focus, and finds a place', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg?tab=checklists');
    const input = page.locator('.tab-body input[type=search]');
    await input.click();
    await page.keyboard.type('tjorn', { delay: 40 });
    await expect(input).toHaveValue('tjorn');
    await expect(input).toBeFocused();
    await expect(page.locator('.tab-body tbody tr').first()).toContainText(/Tj[oö]rn/);
  });

  test('an area shows only its own checklists', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg-midborg?tab=checklists');
    await expect(page.locator('.tab-body .controls')).toContainText('7.670 checklists');
  });
});

test.describe('search, language and the odd corners', () => {
  test('the search box finds a species and a place, accents optional', async ({ page }) => {
    await page.goto('/#/');
    const box = page.locator('.search input');
    await box.fill('arctic te');
    await expect(page.locator('.search-results li').first()).toContainText('Arctic Tern');
    await box.press('Enter');
    await expect(page).toHaveURL(/#\/s\/arcter$/);

    await box.fill('thingey');
    await expect(page.locator('.search-results li').first()).toContainText('Þingeyjarsveit');
    await page.locator('.search-results li').first().click();
    await expect(page).toHaveURL(/#\/r\/6613-thingeyjarsveit$/);
    await expect(page.locator('h1')).toHaveText('Þingeyjarsveit');
  });

  test('ÍS / EN switches the whole interface, not only the bird names', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    await page.locator('[data-lang="en"]').click();
    await expect(page.locator('.tab[data-tab="species"]')).toHaveText('Species');
    await expect(page.locator('.tab-body thead th').nth(1)).toHaveText('Frequency');

    await page.locator('[data-lang="is"]').click();
    await expect(page.locator('.tab[data-tab="species"]')).toHaveText('Tegundir');
    await expect(page.locator('.tab-body thead th').nth(1)).toHaveText('Tíðni');
    await expect(page.locator('html')).toHaveAttribute('lang', 'is');
    // And it is remembered.
    await page.reload();
    await expect(page.locator('.tab[data-tab="checklists"]')).toHaveText('Gátlistar');
  });

  test('a postal district that crosses a boundary explains itself', async ({ page }) => {
    await page.goto('/#/r/6613-thingeyjarsveit-660');
    await expect(page.locator('h1')).toHaveText('660 Mývatn');
    const note = page.locator('.page-head .note').first();
    await expect(note).toContainText('crosses a municipality boundary');
    await note.getByRole('link', { name: 'Norðurþing' }).click();
    await expect(page).toHaveURL(/#\/r\/6100-nordurthing-660$/);
  });

  test('an area nobody has birded still has a page', async ({ page }) => {
    // Once drawn on the map, clickable, and missing from the data.
    await page.goto('/#/r/8719-grimsnes-og-grafningshreppur-806');
    await expect(page.locator('h1')).toHaveText('806 Selfoss, dreifbýli');
    await expect(page.locator('.stats .stat').first()).toContainText('0');
    await expect(page.locator('.error')).toHaveCount(0);
  });

  test('the data cut-off is stated on the front page and in every footer', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('.callout')).toContainText('eBird Basic Dataset');
    await expect(page.locator('.callout')).toContainText('30 Jun 2026');
    await page.goto('/#/s/arcter');
    await expect(page.locator('.foot')).toContainText('Records through 30 Jun 2026');
  });

  test('an unknown region or page is a handled miss, not a crash', async ({ page }) => {
    const crashes = [];
    page.on('pageerror', e => crashes.push(e.message));
    await page.goto('/#/r/9999-does-not-exist');
    await expect(page.locator('.error')).toContainText('No such region');
    await page.goto('/#/nonsense/here');
    await expect(page.locator('.error')).toContainText('Page not found');
    expect(crashes).toEqual([]);
  });

  test('the old URLs still arrive somewhere sensible', async ({ page }) => {
    // The first version of the site was public. A bookmark that 404s is a
    // small betrayal.
    const moved = [
      ['#/mun/0000-reykjavikurborg', /#\/r\/0000-reykjavikurborg$/, 'Reykjavíkurborg'],
      ['#/mun/0000-reykjavikurborg/checklists', /#\/r\/0000-reykjavikurborg\?tab=checklists$/, 'Reykjavíkurborg'],
      ['#/mun/0000-reykjavikurborg/areas', /#\/r\/0000-reykjavikurborg\?tab=areas$/, 'Reykjavíkurborg'],
      ['#/mun/0000-reykjavikurborg/area/midborg', /#\/r\/0000-reykjavikurborg-midborg$/, 'Miðborg'],
      ['#/mun/6100-nordurthing/area/640/checklists', /#\/r\/6100-nordurthing-640\?tab=checklists$/, '640 Húsavík'],
      ['#/mun/0000-reykjavikurborg/species/arcter', /#\/s\/arcter\/0000-reykjavikurborg$/, 'Arctic Tern'],
      ['#/mun/0000-reykjavikurborg/area/midborg/species/arcter', /#\/s\/arcter\/0000-reykjavikurborg-midborg$/, 'Arctic Tern'],
      ['#/species/arcter', /#\/s\/arcter$/, 'Arctic Tern'],
      ['#/species', /#\/$/, 'Ísland']
    ];
    for (const [from, to, h1] of moved) {
      await page.goto('about:blank');
      await page.goto('/' + from);
      await expect(page).toHaveURL(to);
      await expect(page.locator('h1')).toHaveText(h1);
    }
  });

  const routes = ['#/', '#/?tab=areas', '#/?tab=checklists', '#/?tab=activity', '#/?year=2025',
    '#/r/0000-reykjavikurborg', '#/r/0000-reykjavikurborg?tab=areas', '#/r/0000-reykjavikurborg-midborg?tab=activity',
    '#/r/0000-hafsvaedi', '#/s/arcter', '#/s/arcter/6100-nordurthing', '#/s/arcter/6100-nordurthing-640', '#/me'];
  for (const route of routes) {
    test(`${route} renders without console errors`, async ({ page }) => {
      const errors = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('/' + route);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.loading')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});
