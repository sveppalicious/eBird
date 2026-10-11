// The arithmetic behind every chart, year list and arrival date.
//
// The cube here is built from a small invented world whose answers are known
// in advance: ten complete checklists a month, a tern that is on six of them
// from May to July, and a gull that is on two of them all year. If frequency
// comes out as anything but 60% and 20%, the function is wrong, not the data.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  THIN_YEAR, effortYears, chartSpan, byYear, byMonth, heat, isSeasonal, arrivals,
  yearList, activity
} from '../../site/js/lib/cube.js';
import { isoToDay } from '../../site/js/lib/format.js';

// Fold a list of checklists into the columnar shape cube.json has.
function makeCube(checklists, sp = ['tern', 'gull', 'gullsp']) {
  const cells = new Map(), years = new Map(), effort = new Map();
  for (const c of checklists) {
    const y = +c.date.slice(0, 4), m = +c.date.slice(5, 7), d = isoToDay(c.date);
    const e = effort.get(y * 12 + m) || [y, m, 0, 0];
    e[2]++; e[3] += c.complete ? 1 : 0; effort.set(y * 12 + m, e);
    for (const code of c.sp) {
      const si = sp.indexOf(code);
      const k = `${si}|${y}|${m}`;
      const cell = cells.get(k) || [si, y, m, 0, 0];
      cell[3]++; cell[4] += c.complete ? 1 : 0; cells.set(k, cell);
      const yk = `${si}|${y}`;
      const yr = years.get(yk) || [si, y, d, d];
      yr[2] = Math.min(yr[2], d); yr[3] = Math.max(yr[3], d); years.set(yk, yr);
    }
  }
  const cc = [...cells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const yy = [...years.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ee = [...effort.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const col = (rows, i) => rows.map(r => r[i]);
  return { sp, si: col(cc, 0), y: col(cc, 1), m: col(cc, 2), n: col(cc, 3), c: col(cc, 4),
           ysi: col(yy, 0), yy: col(yy, 1), yf: col(yy, 2), yl: col(yy, 3),
           ey: col(ee, 0), em: col(ee, 1), en: col(ee, 2), ec: col(ee, 3) };
}

const pad = n => String(n).padStart(2, '0');

function world() {
  const out = [];
  for (let y = 2020; y <= 2025; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let i = 0; i < 10; i++) {
        const sp = [];
        if (i < 2) sp.push('gull');
        // The tern arrives a day earlier each year: 25 May 2020 ... 20 May 2025.
        if (m >= 5 && m <= 7 && i < 6) sp.push('tern');
        const day = m === 5 ? 25 - (y - 2020) + i % 3 : 1 + i * 2;
        out.push({ date: `${y}-${pad(m)}-${pad(day)}`, complete: true, sp });
      }
    }
  }
  // 2019: a handful of visits, all of which found a tern.
  for (let i = 0; i < 5; i++) out.push({ date: `2019-06-${pad(10 + i)}`, complete: true, sp: ['tern'] });
  // And an incomplete list, which is effort that must not count.
  out.push({ date: '2024-06-15', complete: false, sp: ['tern', 'gullsp'] });
  return out;
}

const cube = makeCube(world());

describe('effort', () => {
  test('a year with too few complete checklists is flagged, not hidden', () => {
    const ys = effortYears(cube);
    assert.equal(ys.find(y => y.year === 2019).thin, true);
    assert.equal(ys.find(y => y.year === 2024).thin, false);
    assert.equal(ys.find(y => y.year === 2019).c, 5);
    assert.ok(5 < THIN_YEAR);
  });

  test('an incomplete checklist is counted as a checklist but not as effort', () => {
    const y = effortYears(cube).find(r => r.year === 2024);
    assert.equal(y.n, 121);
    assert.equal(y.c, 120);
  });

  test('the default span starts where the data can carry a frequency', () => {
    // 2019 is five checklists. Starting the axis there puts a 100% bar at the
    // left edge that means "five people went out in June".
    assert.deepEqual(chartSpan(cube), { from: 2020, to: 2025 });
  });

  test('lighter years just before it are kept, to be drawn pale', () => {
    // One person's data is "thin" every year by national standards. Dropping
    // those years would hide most of their birding; flagging them does not.
    const light = [];
    for (let i = 0; i < 12; i++) light.push({ date: `2019-06-${pad(1 + i)}`, complete: true, sp: ['tern'] });
    for (let i = 0; i < 15; i++) light.push({ date: `2018-06-${pad(1 + i)}`, complete: true, sp: ['tern'] });
    const c = makeCube([...world().filter(x => !x.date.startsWith('2019')), ...light]);
    assert.deepEqual(chartSpan(c), { from: 2018, to: 2025 });
    assert.equal(byYear(c, 'tern')[0].thin, true);
  });

  test('but not across a gap, and not a year with almost nothing', () => {
    const old = [];
    for (let i = 0; i < 20; i++) old.push({ date: `2010-06-${pad(1 + i)}`, complete: true, sp: ['tern'] });
    assert.deepEqual(chartSpan(makeCube([...world(), ...old])), { from: 2020, to: 2025 });
  });

  test('data that is light throughout is still charted', () => {
    const light = [];
    for (const y of [2022, 2023, 2024]) {
      for (let i = 0; i < 14; i++) light.push({ date: `${y}-06-${pad(1 + i)}`, complete: true, sp: ['tern'] });
    }
    assert.deepEqual(chartSpan(makeCube(light)), { from: 2022, to: 2024 });
  });

  test('the span is capped, keeping the recent end', () => {
    assert.deepEqual(chartSpan(cube, 3), { from: 2023, to: 2025 });
  });

  test('an empty cube has no span rather than a NaN one', () => {
    assert.equal(chartSpan(makeCube([])), null);
    assert.deepEqual(byYear(makeCube([]), 'tern'), []);
  });
});

describe('by year', () => {
  test('frequency is complete checklists with the species over complete checklists', () => {
    // 6 of 10 for three months of twelve: 18 of 120.
    const y = byYear(cube, 'tern').find(r => r.year === 2023);
    assert.equal(y.c, 18);
    assert.equal(y.ec, 120);
    assert.equal(y.freq, 0.15);
  });

  test('the incomplete record is in the count and out of the frequency', () => {
    const y = byYear(cube, 'tern').find(r => r.year === 2024);
    assert.equal(y.n, 19);          // every checklist with a tern
    assert.equal(y.c, 18);          // only the complete ones divide
    assert.equal(y.freq, 0.15);
  });

  test('a year without the species still has a bar slot', () => {
    // Otherwise the bars close up and 2021 sits where 2020 should be.
    const cube2 = makeCube(world().filter(c => !(c.date.startsWith('2022') && c.sp.includes('tern'))));
    const ys = byYear(cube2, 'tern');
    assert.deepEqual(ys.map(r => r.year), [2020, 2021, 2022, 2023, 2024, 2025]);
    assert.equal(ys.find(r => r.year === 2022).freq, 0);
  });

  test('a species this region has never had is all zeros, not a crash', () => {
    const ys = byYear(cube, 'nosuchbird');
    assert.equal(ys.length, 6);
    assert.ok(ys.every(r => r.n === 0 && r.freq === 0));
  });

  test('thin years carry the flag through to the bars', () => {
    const ys = byYear(cube, 'tern', { from: 2019, to: 2020 });
    assert.equal(ys[0].thin, true);
    assert.equal(ys[0].freq, 1);    // five of five: exactly why it is flagged
    assert.equal(ys[1].thin, false);
  });
});

describe('by month', () => {
  test('each month is divided by its own effort', () => {
    const ms = byMonth(cube, 'tern');
    assert.equal(ms.length, 12);
    assert.equal(ms[4].freq, 0.6);            // May
    assert.equal(ms[5].freq, 0.6);            // June
    assert.equal(ms[0].freq, 0);              // January
    assert.equal(ms[4].ec, 60);               // 10 a month for six years
  });

  test('the gull is level all year', () => {
    assert.ok(byMonth(cube, 'gull').every(m => m.freq === 0.2));
  });

  test('a span narrows the months to those years', () => {
    const ms = byMonth(cube, 'tern', { from: 2024, to: 2024 });
    assert.equal(ms[5].ec, 10);
    assert.equal(ms[5].c, 6);
    assert.equal(ms[5].n, 7);                 // the incomplete June list too
  });
});

describe('year by month', () => {
  test('newest year first', () => {
    assert.deepEqual(heat(cube, 'tern').map(r => r.year), [2025, 2024, 2023, 2022, 2021, 2020]);
  });

  test('"no data" and "0%" are different cells', () => {
    // Nobody went out in a month vs. people went out and it was not there.
    const cube2 = makeCube(world().filter(c => !c.date.startsWith('2025-11')));
    const row = heat(cube2, 'tern').find(r => r.year === 2025);
    assert.equal(row.months[10].freq, null);  // November: no effort
    assert.equal(row.months[0].freq, 0);      // January: effort, no terns
    assert.equal(row.months[5].freq, 0.6);
  });
});

describe('seasonality and arrivals', () => {
  test('a summer visitor is seasonal, a resident is not', () => {
    assert.equal(isSeasonal(cube, 'tern'), true);
    assert.equal(isSeasonal(cube, 'gull'), false);
  });

  test('a species with no records is not "seasonal"', () => {
    assert.equal(isSeasonal(cube, 'nosuchbird'), false);
  });

  test('arrival is the first day of each year, comparable across years', () => {
    const a = arrivals(cube, 'tern');
    assert.deepEqual(a.map(r => r.year), [2020, 2021, 2022, 2023, 2024, 2025]);
    // 25 May 2020 is day 146 in a leap year; a day earlier each year after.
    assert.equal(a[0].day, isoToDay('2020-05-25'));
    assert.equal(a[5].day, isoToDay('2025-05-20'));
    assert.ok(a[5].doy < a[1].doy, 'the trend towards earlier must survive the conversion');
  });

  test('a thin year keeps its date and says so', () => {
    const a = arrivals(cube, 'tern', { from: 2019, to: 2020 });
    assert.equal(a[0].year, 2019);
    assert.equal(a[0].thin, true);
  });
});

describe('year list', () => {
  test('one row per species recorded that year, with its dates', () => {
    const rows = yearList(cube, 2024);
    assert.deepEqual(rows.map(r => r.c).sort(), ['gull', 'gullsp', 'tern']);
    const tern = rows.find(r => r.c === 'tern');
    assert.equal(tern.k, 19);
    assert.equal(tern.kc, 18);
    assert.equal(tern.first, isoToDay('2024-05-21'));
    assert.ok(tern.last >= isoToDay('2024-07-01'));
  });

  test('a year with nothing is an empty list', () => {
    assert.deepEqual(yearList(cube, 1999), []);
  });
});

describe('activity', () => {
  test('species per year counts species, not every taxon', () => {
    // "gull sp." was logged in 2024. It is on the list and not on the count.
    const rows = activity(cube, new Set(['tern', 'gull']));
    assert.equal(rows.find(r => r.year === 2024).species, 2);
    assert.equal(rows.find(r => r.year === 2019).species, 1);
  });

  test('checklists and complete checklists per year', () => {
    const y = activity(cube, new Set(['tern', 'gull'])).find(r => r.year === 2024);
    assert.equal(y.checklists, 121);
    assert.equal(y.complete, 120);
  });
});

describe('the cube folds back to its totals', () => {
  test('summing a species over years gives all its checklists', () => {
    const total = world().filter(c => c.sp.includes('tern')).length;
    const span = { from: 2019, to: 2025 };
    assert.equal(byYear(cube, 'tern', span).reduce((a, r) => a + r.n, 0), total);
    assert.equal(byMonth(cube, 'tern', span).reduce((a, r) => a + r.n, 0), total);
  });
});
