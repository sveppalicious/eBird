// Behaviour that only a real browser can check.
//
// Every test here is a bug that shipped. The map went unclickable for a whole
// release because pointer capture retargets the click, and the search boxes
// took one character per click because the redraw destroyed the focused input.
// Neither is visible to a data test or a unit test -- both need a real pointer,
// real focus and a real event loop.

import { test, expect } from '@playwright/test';

// Find a point that actually lies inside a given polygon. Bounding-box centres
// miss constantly here: Icelandic municipalities are fjord-shaped.
async function pointInside(page, slug) {
  return page.evaluate((wanted) => {
    const svg = document.querySelector('svg.map-svg');
    svg.scrollIntoView({ block: 'center' });
    const r = svg.getBoundingClientRect();
    for (let i = 1; i < 80; i++) {
      for (let j = 1; j < 80; j++) {
        const x = Math.round(r.left + r.width * i / 80);
        const y = Math.round(r.top + r.height * j / 80);
        if (y < 2 || y > innerHeight - 2) continue;
        const el = document.elementFromPoint(x, y);
        if (el && el.dataset && el.dataset.slug === wanted) return { x, y };
      }
    }
    return null;
  }, slug);
}

async function anyPolygonExcept(page, excluded) {
  return page.evaluate((skip) => {
    const svg = document.querySelector('svg.map-svg');
    svg.scrollIntoView({ block: 'center' });
    const r = svg.getBoundingClientRect();
    for (let i = 1; i < 80; i++) {
      for (let j = 1; j < 80; j++) {
        const x = Math.round(r.left + r.width * i / 80);
        const y = Math.round(r.top + r.height * j / 80);
        if (y < 2 || y > innerHeight - 2) continue;
        const el = document.elementFromPoint(x, y);
        if (el && el.classList.contains('map-area') && el.dataset.slug !== skip) {
          return { x, y, slug: el.dataset.slug };
        }
      }
    }
    return null;
  }, excluded);
}

test.describe('the map is clickable', () => {
  test('clicking a sveitarfélag opens it and zooms in', async ({ page }) => {
    // Regression: setPointerCapture on pointerdown retargets the following
    // click to the <svg>, so the polygons never saw it. Everything else about
    // the map still worked -- hover, tooltip, cursor -- which is what made it
    // so hard to spot.
    await page.goto('/#/');
    await page.waitForSelector('path.map-area');

    const before = await page.getAttribute('svg.map-svg', 'viewBox');
    const pt = await pointInside(page, '6100-nordurthing');
    expect(pt, 'Norðurþing should be visible on the country map').not.toBeNull();

    await page.mouse.click(pt.x, pt.y);
    await expect(page).toHaveURL(/#\/mun\/6100-nordurthing$/);
    await expect(page.locator('h1')).toHaveText('Norðurþing');

    // "Zooms in" is the other half of the request: the frame must tighten.
    const after = await page.getAttribute('svg.map-svg', 'viewBox');
    expect(parseFloat(after.split(' ')[2])).toBeLessThan(parseFloat(before.split(' ')[2]));
  });

  test('a neighbour stays clickable from a zoomed view', async ({ page }) => {
    await page.goto('/#/mun/6100-nordurthing');
    await page.waitForSelector('path.map-area');

    const hit = await anyPolygonExcept(page, '6100-nordurthing');
    expect(hit).not.toBeNull();
    await page.mouse.click(hit.x, hit.y);
    await expect(page).toHaveURL(new RegExp(`#/mun/${hit.slug}$`));
  });

  test('dragging pans without navigating', async ({ page }) => {
    // The other half of the pointer-capture fix: past the 4px threshold the
    // gesture is a pan, and the click that ends it must not select anything.
    await page.goto('/#/mun/6100-nordurthing');
    await page.waitForSelector('path.map-area');

    const pt = await anyPolygonExcept(page, '');
    const before = await page.getAttribute('svg.map-svg', 'viewBox');

    await page.mouse.move(pt.x, pt.y);
    await page.mouse.down();
    await page.mouse.move(pt.x - 60, pt.y + 40, { steps: 10 });
    await page.mouse.up();

    await expect(page).toHaveURL(/#\/mun\/6100-nordurthing$/);
    expect(await page.getAttribute('svg.map-svg', 'viewBox')).not.toBe(before);
  });

  test('scrolling zooms the map instead of the page', async ({ page }) => {
    await page.goto('/#/');
    await page.waitForSelector('path.map-area');
    await page.locator('svg.map-svg').scrollIntoViewIfNeeded();

    const box = await page.locator('svg.map-svg').boundingBox();
    const before = await page.getAttribute('svg.map-svg', 'viewBox');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);

    await expect.poll(async () =>
      parseFloat((await page.getAttribute('svg.map-svg', 'viewBox')).split(' ')[2])
    ).toBeLessThan(parseFloat(before.split(' ')[2]));
  });

  test('the basemap switcher loads tiles and keeps the choice', async ({ page }) => {
    await page.goto('/#/');
    await page.waitForSelector('path.map-area');

    await page.getByRole('button', { name: 'Kort' }).click();
    await expect(page.locator('.map-tiles image').first()).toBeAttached();
    await expect(page.locator('.map-attrib')).toContainText('OpenStreetMap');

    await page.reload();
    await expect(page.locator('.map-btn.is-active').first()).toHaveText('Kort');
  });
});

test.describe('the Find boxes keep focus', () => {
  // Regression: oninput called draw(), which wiped the host including the
  // <input> being typed into. The browser destroyed the focused element, so
  // every keystroke needed another click.
  for (const [name, url, query] of [
    ['species index', '/#/species', 'skua'],
    ['checklist browser', '/#/mun/0000-reykjavikurborg/checklists', 'tjorn']
  ]) {
    test(`${name}: a whole word can be typed in one go`, async ({ page }) => {
      await page.goto(url);
      const input = page.locator('input[type=search]');
      await input.waitFor();
      await input.click();
      await page.keyboard.type(query, { delay: 40 });

      await expect(input).toHaveValue(query);
      await expect(input).toBeFocused();
    });
  }

  test('typing actually filters the species table', async ({ page }) => {
    await page.goto('/#/species');
    const input = page.locator('input[type=search]');
    await input.waitFor();
    await input.click();
    await page.keyboard.type('skua', { delay: 40 });

    await expect(page.locator('tbody tr')).toHaveCount(2);
    await expect(page.locator('tbody tr').first()).toContainText('Skua');
  });
});

test.describe('the fourth level', () => {
  test('a straddling postal district explains itself', async ({ page }) => {
    // 660 Mývatn is three areas because the district crosses two municipality
    // boundaries. Without the note they look like duplicated data.
    await page.goto('/#/mun/6613-thingeyjarsveit/area/660');
    await expect(page.locator('h1')).toHaveText('660 Mývatn');

    const note = page.locator('.mun-head .note', { hasText: 'also reaches into' });
    await expect(note).toBeVisible();
    await expect(note.getByRole('link', { name: 'Norðurþing' })).toBeVisible();
    await expect(note.getByRole('link', { name: 'Múlaþing' })).toBeVisible();
  });

  test('the sibling links land on the sibling areas', async ({ page }) => {
    await page.goto('/#/mun/6613-thingeyjarsveit/area/660');
    await page.locator('.mun-head .note').getByRole('link', { name: 'Norðurþing' }).click();
    await expect(page).toHaveURL(/#\/mun\/6100-nordurthing\/area\/660$/);
    await expect(page.locator('h1')).toHaveText('660 Mývatn');
  });

  test('an area nobody has birded still has a page', async ({ page }) => {
    // Regression: summary.json took its areas from the observed checklists, so
    // 806 was drawn on the map, was clickable, and led to "No such póstnúmer
    // here".
    await page.goto('/#/mun/8719-grimsnes-og-grafningshreppur/area/806');
    await expect(page.locator('h1')).toHaveText('806 Selfoss, dreifbýli');
    await expect(page.locator('.error')).toHaveCount(0);
  });

  test('and its municipality offers the tab that reaches it', async ({ page }) => {
    await page.goto('/#/mun/8719-grimsnes-og-grafningshreppur');
    await expect(page.getByRole('link', { name: /^Póstnúmer \(2\)$/ })).toBeVisible();
  });
});

test.describe('routing and data', () => {
  const routes = [
    '/#/',
    '/#/species',
    '/#/species/arcter',
    '/#/me',
    '/#/mun/0000-reykjavikurborg',
    '/#/mun/0000-reykjavikurborg/checklists',
    '/#/mun/0000-reykjavikurborg/areas',
    '/#/mun/0000-reykjavikurborg/area/midborg',
    '/#/mun/0000-reykjavikurborg/area/midborg/checklists',
    '/#/mun/0000-reykjavikurborg/area/midborg/species/arcter',
    '/#/mun/6100-nordurthing/area/640'
  ];

  for (const route of routes) {
    test(`${route} renders without console errors`, async ({ page }) => {
      const errors = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(e.message));

      await page.goto(route);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('.loading')).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }

  test('an unknown municipality is a handled miss, not a crash', async ({ page }) => {
    const crashes = [];
    page.on('pageerror', e => crashes.push(e.message));
    await page.goto('/#/mun/9999-does-not-exist');
    await expect(page.locator('.error')).toBeVisible();
    expect(crashes).toEqual([]);
  });

  test('the EBD cut-off notice is on the front page and in the footer', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('.callout')).toContainText('eBird Basic Dataset');
    await expect(page.locator('.callout')).toContainText('2026');
    await expect(page.locator('.foot')).toContainText('Records through');
  });

  test('the ÍS/EN switch changes the species name', async ({ page }) => {
    await page.goto('/#/species');
    await page.waitForSelector('tbody tr');

    await page.locator('[data-lang="en"]').click();
    await expect(page.locator('tbody tr td').first()).toContainText('Bar-headed Goose');

    await page.locator('[data-lang="is"]').click();
    await expect(page.locator('tbody tr td').first()).toContainText('Taumgæs');
  });
});

test.describe('the personal import stays local', () => {
  test('no request carries the user\'s file anywhere', async ({ page }) => {
    // The strongest form of the privacy promise this project makes: watch the
    // network while an import runs and assert nothing goes out but same-origin
    // GETs of the site's own files.
    const outbound = [];
    page.on('request', r => {
      const method = r.method();
      const url = r.url();
      if (method !== 'GET' || !url.startsWith('http://127.0.0.1:8788/')) {
        outbound.push(`${method} ${url}`);
      }
    });

    await page.goto('/#/me');
    const csv = [
      'Submission ID,Common Name,Scientific Name,Taxonomic Order,Count,State/Province,' +
        'County,Location ID,Location,Latitude,Longitude,Date,Time',
      'S100,Arctic Tern,Sterna paradisaea,6081,3,IS-1,,L1234,Tjörnin,64.145,-21.94,' +
        '2026-06-01,08:00'
    ].join('\n');

    await page.locator('input[type=file]').setInputFiles({
      name: 'MyEBirdData.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
    });

    await page.waitForTimeout(2500);
    expect(outbound, 'the export must never leave the browser').toEqual([]);
  });
});

test.describe('firsts: when a species was new somewhere', () => {
  // A tiny export, then the same one with two extra rows. This is the real
  // workflow -- upload, bird, upload again -- compressed into one test.
  //
  // The locality ids are real ones from locality_index.json, so the import
  // resolves them to a hverfi as well as a sveitarfélag. Made-up ids fall back
  // to a point-in-polygon municipality lookup and get no area at all, which
  // would quietly leave half the feature untested.
  const HEADER = 'Submission ID,Common Name,Scientific Name,Count,State/Province,' +
    'Location ID,Location,Latitude,Longitude,Date,Time';
  const MIDBORG = 'IS-1,L10020805,Tjörnin,64.1450,-21.9400';
  const AKUREYRI = 'IS-6,L10029578,Akureyri,65.6835,-18.0878';

  const base = [
    HEADER,
    `S1,Arctic Tern,Sterna paradisaea,3,${MIDBORG},2026-05-01,08:00`,
    `S2,Common Eider,Somateria mollissima,5,${MIDBORG},2026-05-01,08:00`
  ].join('\n');

  const later = [
    base,
    `S3,Common Redshank,Tringa totanus,2,${MIDBORG},2026-07-28,09:00`,
    `S4,Arctic Tern,Sterna paradisaea,9,${AKUREYRI},2026-07-30,10:00`
  ].join('\n');

  async function upload(page, csv, selector = '#csvfile') {
    await page.locator(selector).setInputFiles({
      name: 'MyEBirdData.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
    });
    await expect(page.locator('.stats')).toBeVisible();
  }

  test('the first upload reports no news, the second does', async ({ page }) => {
    await page.goto('/#/me');
    await upload(page, base);
    // Nothing to compare against yet: "everything is new" is not news.
    await expect(page.locator('.whatsnew')).toHaveCount(0);

    await page.locator('#csvreplace').setInputFiles({
      name: 'MyEBirdData.csv', mimeType: 'text/csv', buffer: Buffer.from(later)
    });

    const news = page.locator('.whatsnew');
    await expect(news).toBeVisible();
    await expect(news).toContainText('Since your previous upload');
    // Species names follow the ÍS/EN switch, and ÍS is the default.
    await expect(news).toContainText('Stelkur');          // new for Iceland
    await expect(news).toContainText('Reykjavíkurborg');
    await expect(news).toContainText('Akureyrarbær');     // Kría, new there only
    // Both levels are counted: the hverfi ticks are the point of this site.
    await expect(news).toContainText('hverfi');
  });

  test('the firsts list shows each species where it was new', async ({ page }) => {
    await page.goto('/#/me');
    await upload(page, later);

    await page.getByRole('link', { name: 'Firsts', exact: true }).click();
    await expect(page).toHaveURL(/#\/me\/firsts$/);

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toContainText('30 júl 2026');
    await expect(rows.first()).toContainText('Akureyrarbær');

    // Four events: three species first seen in Reykjavík, and the Tern again
    // in Akureyrarbær. The Tern being new for both the sveitarfélag and the
    // hverfi on one day stays one row.
    await expect(rows).toHaveCount(4);
  });

  test('the filters narrow it to lifers and to area ticks', async ({ page }) => {
    await page.goto('/#/me');
    await upload(page, later);
    await page.getByRole('link', { name: 'Firsts', exact: true }).click();

    const rows = page.locator('tbody tr');
    await page.getByRole('button', { name: 'First in Iceland' }).click();
    await expect(rows).toHaveCount(3);          // three species, three lifers
    await expect(page.locator('.tick-lifer').first()).toBeVisible();

    await page.getByRole('button', { name: 'Hverfi & póstnúmer' }).click();
    await expect(rows).toHaveCount(4);

    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(rows).toHaveCount(4);
  });

  test('a firsts row links to that species in that region', async ({ page }) => {
    await page.goto('/#/me');
    await upload(page, later);
    await page.goto('/#/me/firsts');

    await page.locator('tbody tr').first()
      .getByRole('link', { name: 'Akureyrarbær' }).click();
    await expect(page).toHaveURL(/#\/mun\/6000-akureyrarbaer\/species\/arcter$/);
  });
});
