// Shared by the browser specs.

import { expect } from '@playwright/test';

// A point that actually lies inside a given shape. Bounding-box centres miss
// constantly here: Icelandic municipalities are fjord-shaped.
export async function pointInside(page, id) {
  await page.locator('.map-frame').scrollIntoViewIfNeeded();
  const pt = await page.evaluate((wanted) => {
    const r = document.querySelector('.map-frame').getBoundingClientRect();
    for (let i = 2; i < 78; i++) {
      for (let j = 2; j < 78; j++) {
        const x = Math.round(r.left + r.width * i / 80), y = Math.round(r.top + r.height * j / 80);
        if (y < 2 || y > innerHeight - 2) continue;
        const el = document.elementFromPoint(x, y);
        if (el && el.getAttribute && el.getAttribute('data-id') === wanted) return { x, y };
      }
    }
    return null;
  }, id);
  expect(pt, `shape ${id} should be visible on the map`).not.toBeNull();
  return pt;
}

// Any clickable shape other than the ones named.
export async function anyShapeExcept(page, excluded = []) {
  await page.locator('.map-frame').scrollIntoViewIfNeeded();
  return page.evaluate((skip) => {
    const r = document.querySelector('.map-frame').getBoundingClientRect();
    for (let i = 4; i < 76; i++) {
      for (let j = 4; j < 76; j++) {
        const x = Math.round(r.left + r.width * i / 80), y = Math.round(r.top + r.height * j / 80);
        if (y < 2 || y > innerHeight - 2) continue;
        const el = document.elementFromPoint(x, y);
        const id = el && el.getAttribute && el.getAttribute('data-id');
        if (id && !skip.includes(id)) return { x, y, id };
      }
    }
    return null;
  }, excluded);
}

export const mapState = page => page.evaluate(() => {
  const el = document.querySelector('.region-map');
  const m = el.leafletMap, c = m.getCenter();
  // getZoom() does not move until a zoom animation *ends*, so "the numbers
  // have stopped changing" is not enough to call the map settled.
  return { zoom: m.getZoom(), lat: c.lat, lng: c.lng, busy: el.classList.contains('is-moving') };
});

// Leaflet animates; wait until it has stopped moving.
export async function settled(page) {
  let prev = null;
  await expect.poll(async () => {
    const st = await mapState(page);
    const s = JSON.stringify(st);
    const same = s === prev && !st.busy;
    prev = s;
    return same;
  }, { intervals: [150, 150, 200, 250, 300] }).toBe(true);
}

// The map is ready when its shapes exist and it has stopped moving. Not "when
// the first shape is visible": Leaflet clips anything outside the view to an
// empty path, so whether the first shape in the file is visible depends on
// which region is on screen -- a race that passes by luck for Reykjavík and
// fails half the time for Norðurþing.
export async function mapReady(page) {
  await page.locator('.region-shape').first().waitFor({ state: 'attached' });
  await settled(page);
}

// A tiny export, then the same one with more in it. The locality ids are real
// ones from locality_index.json, so the import resolves them to a hverfi as
// well as a sveitarfélag; made-up ids would fall back to a polygon lookup and
// quietly leave the index path untested.
const HEADER = 'Submission ID,Common Name,Scientific Name,Taxonomic Order,Count,State/Province,County,' +
  'Location ID,Location,Latitude,Longitude,Date,Time,Protocol,Duration (Min),All Obs Reported';
const MIDBORG = 'IS-1,,L10020805,Tjörnin,64.1450,-21.9400';
const AKUREYRI = 'IS-6,,L10029578,Akureyri,65.6835,-18.0878';
const line = (sub, name, sci, n, where, date) => `${sub},${name},${sci},1,${n},${where},${date},08:00,Stationary,30,1`;

export const BASE_CSV = [
  HEADER,
  line('S1', 'Arctic Tern', 'Sterna paradisaea', 3, MIDBORG, '2026-05-01'),
  line('S1', 'Common Eider', 'Somateria mollissima', 5, MIDBORG, '2026-05-01'),
  line('S2', 'Arctic Tern', 'Sterna paradisaea', 4, MIDBORG, '2025-05-20')
].join('\n');

export const LATER_CSV = [
  BASE_CSV,
  line('S3', 'Common Redshank', 'Tringa totanus', 2, MIDBORG, '2026-06-28'),
  line('S4', 'Arctic Tern', 'Sterna paradisaea', 9, AKUREYRI, '2026-06-30')
].join('\n');

export async function upload(page, csv, selector = '#csvfile') {
  await page.locator(selector).setInputFiles({
    name: 'MyEBirdData.csv', mimeType: 'text/csv', buffer: Buffer.from(csv)
  });
}

// Go to the upload page, load a file, and wait until it is on show.
export async function importFile(page, csv) {
  await page.goto('/#/me');
  await page.locator('#csvfile').waitFor({ state: 'attached' });
  await upload(page, csv);
  await expect(page.locator('#csvreplace')).toBeAttached();
}
