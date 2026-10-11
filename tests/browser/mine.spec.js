// Your own data: the same pages, drawn from a file that never leaves the
// browser.

import { test, expect } from '@playwright/test';
import { BASE_CSV, LATER_CSV, upload, importFile } from './helpers.js';

test.describe('bringing your own export in', () => {
  test('nothing about the file leaves the browser', async ({ page }) => {
    // The strongest form of the privacy promise this project makes: watch the
    // network while an import runs and assert nothing goes out but same-origin
    // GETs of the site's own files.
    const outbound = [];
    page.on('request', r => {
      if (r.method() !== 'GET' || !r.url().startsWith('http://127.0.0.1:8788/')) outbound.push(`${r.method()} ${r.url()}`);
    });
    await importFile(page, LATER_CSV);
    await page.goto('/#/');
    await page.locator('.tab-body tbody tr').first().waitFor();
    await page.goto('/#/s/arcter');
    await page.locator('.chart').first().waitFor();
    expect(outbound, 'the export must never leave the browser').toEqual([]);
  });

  test('after an upload the site is showing your data', async ({ page }) => {
    await importFile(page, BASE_CSV);
    await expect(page.locator('[data-source="mine"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.stats .stat').first()).toContainText('2');     // two species
    await page.goto('/#/');
    await expect(page.locator('.stats .stat').first()).toContainText('My species');
    await expect(page.locator('.tab-body tbody tr')).toHaveCount(2);
  });

  test('it is still there after a reload', async ({ page }) => {
    await importFile(page, BASE_CSV);
    await page.goto('/#/');
    await page.reload();
    await expect(page.locator('[data-source="mine"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.tab-body tbody tr')).toHaveCount(2);
  });

  test('"Mín gögn" with no file takes you to the upload page', async ({ page }) => {
    await page.goto('/#/');
    await page.locator('[data-source="mine"]').click();
    await expect(page).toHaveURL(/#\/me$/);
    await expect(page.locator('.dropzone')).toBeVisible();
  });

  test('removing it puts everyone\'s data back', async ({ page }) => {
    await importFile(page, BASE_CSV);
    await page.getByRole('button', { name: 'Remove my data' }).click();
    await expect(page.locator('.dropzone')).toBeVisible();
    await expect(page.locator('[data-source="all"]')).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/#/');
    await expect(page.locator('.stats .stat').first()).toContainText('412');
    await page.reload();
    await expect(page.locator('.stats .stat').first()).toContainText('412');
  });

  test('a file that is not an eBird export is refused in plain words', async ({ page }) => {
    await page.goto('/#/me');
    await upload(page, 'name,age\nAnna,30\n');
    await expect(page.locator('.upload-status.is-error')).toContainText('does not look like an eBird export');
    await expect(page.locator('.dropzone')).toBeVisible();
  });
});

test.describe('your data on the same pages', () => {
  test.beforeEach(async ({ page }) => { await importFile(page, LATER_CSV); });

  test('a region page has the same sections, plus Firsts', async ({ page }) => {
    for (const [url, name] of [['/#/', 'Ísland'], ['/#/r/0000-reykjavikurborg', 'Reykjavíkurborg'],
                               ['/#/r/0000-reykjavikurborg-midborg', 'Miðborg']]) {
      await page.goto(url);
      await expect(page.locator('h1')).toHaveText(name);
      await expect(page.locator('.stats .stat')).toHaveCount(4);
      await expect(page.locator('.map-frame .region-shape').first()).toBeAttached();
      for (const tab of ['species', 'checklists', 'activity', 'firsts']) {
        await expect(page.locator(`.tab[data-tab="${tab}"]`)).toBeVisible();
      }
      await expect(page.locator('.tab-body tbody tr').first()).toBeVisible();
    }
  });

  test('the list is yours: your species, your dates, no one else\'s', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    const rows = page.locator('.tab-body tbody tr');
    await expect(rows).toHaveCount(3);            // tern, eider, redshank
    await expect(page.locator('.tab-body thead')).not.toContainText('Observer');
    await expect(page.locator('.tab-body tbody')).toContainText('Tjörnin');
    await expect(page.locator('.tab-body tbody')).not.toContainText('obsr');
  });

  test('a species page charts your records', async ({ page }) => {
    await page.goto('/#/s/arcter');
    await expect(page.locator('h1')).toHaveText('Arctic Tern');
    await expect(page.locator('.stats .stat')).toHaveCount(5);
    await expect(page.locator('.stats .stat').nth(1)).toContainText('3');      // three checklists
    await expect(page.locator('.chart figcaption h3').first()).toHaveText('By year');
    await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();
    await expect(page.locator('article .table-wrap').last().locator('tbody tr')).toHaveCount(3);
  });

  test('year lists work on your data', async ({ page }) => {
    await page.goto('/#/');
    await page.locator('#year').selectOption('2025');
    await expect(page.locator('.tab-body tbody tr')).toHaveCount(1);
    await expect(page.locator('.tab-body tbody')).toContainText('Arctic Tern');
  });

  test('your checklists are browsable', async ({ page }) => {
    await page.goto('/#/?tab=checklists');
    await expect(page.locator('.tab-body tbody tr')).toHaveCount(4);
    await expect(page.locator('.tab-body tbody')).toContainText('Stationary');
    await expect(page.locator('.tab-body thead')).not.toContainText('Observer');
  });

  test('the map counts your species and shows where you have been', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.locator('.map-legend')).toContainText('species on your list');
    await expect(page.locator('.map-btn', { hasText: 'My localities (2)' })).toBeVisible();
  });

  test('switching back to everyone is one click and changes the numbers', async ({ page }) => {
    await page.goto('/#/r/0000-reykjavikurborg');
    await expect(page.locator('.stats .stat').first()).toContainText('3');
    await page.locator('[data-source="all"]').click();
    await expect(page.locator('.stats .stat').first()).toContainText('173');
    await expect(page.locator('.tab[data-tab="firsts"]')).toHaveCount(0);
  });
});

test.describe('firsts: when a species was new somewhere', () => {
  test('the first upload reports no news, the second does', async ({ page }) => {
    // "Everything is new" is not news.
    await importFile(page, BASE_CSV);
    await expect(page.locator('.whatsnew')).toHaveCount(0);

    await upload(page, LATER_CSV, '#csvreplace');
    const news = page.locator('.whatsnew');
    await expect(news).toBeVisible();
    await expect(news).toContainText('Since your previous file');
    await expect(news).toContainText('1 new for your Iceland list');        // the redshank
    await news.getByRole('link').click();
    await expect(page).toHaveURL(/tab=firsts/);
    await expect(page.locator('.whatsnew-list')).toContainText('Common Redshank');
    await expect(page.locator('.whatsnew-list')).toContainText('Akureyrarbær');
  });

  test('one row per event, with the lifer badge once per species', async ({ page }) => {
    await importFile(page, LATER_CSV);
    await page.goto('/#/?tab=firsts');
    const rows = page.locator('.tab-body tbody tr');
    // Three species first seen in Reykjavík, and the tern again in Akureyrarbær.
    // New for a sveitarfélag and its hverfi on one day stays one row.
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText('Akureyrarbær');
    await expect(page.locator('.tick-lifer')).toHaveCount(3);
  });

  test('the filters, and narrowing to a region', async ({ page }) => {
    await importFile(page, LATER_CSV);
    await page.goto('/#/?tab=firsts');
    const rows = page.locator('.tab-body tbody tr');
    await page.getByRole('button', { name: 'First in Iceland' }).click();
    await expect(rows).toHaveCount(3);
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await expect(rows).toHaveCount(4);

    await page.goto('/#/r/6000-akureyrarbaer?tab=firsts');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Arctic Tern');
  });

  test('a firsts row links to that species in that region', async ({ page }) => {
    await importFile(page, LATER_CSV);
    await page.goto('/#/?tab=firsts');
    await page.locator('.tab-body tbody tr').first().getByRole('link', { name: 'Akureyrarbær' }).click();
    await expect(page).toHaveURL(/#\/s\/arcter\/6000-akureyrarbaer$/);
  });

  test('the old firsts URL lands on your firsts', async ({ page }) => {
    await importFile(page, LATER_CSV);
    await page.locator('[data-source="all"]').click();
    await page.goto('about:blank');
    await page.goto('/#/me/firsts');
    await expect(page).toHaveURL(/#\/\?tab=firsts$/);
    await expect(page.locator('.tab.is-active')).toHaveAttribute('data-tab', 'firsts');
  });
});
