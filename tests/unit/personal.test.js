// A personal export, from text to the same shapes the published data has.
//
// The whole design rests on one claim: that a region's summary and cube built
// from someone's own file are interchangeable with the ones off the server.
// These tests hold the claim to account, including by feeding a personal cube
// to the chart functions.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  importExport, summaryFor, cubeFor, checklistsFor, recordsFor, speciesAcross,
  regionStats, localities, firsts, diffTables
} from '../../site/js/lib/personal.js';
import { byYear, yearList } from '../../site/js/lib/cube.js';
import { isoToDay } from '../../site/js/lib/format.js';

// A square around Akureyri, for a locality the index has never heard of.
const square = (id, key, x0, y0, x1, y1, extra = {}) => ({
  type: 'Feature', properties: { [key]: id, ...extra },
  geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }
});

const lookups = {
  sciIndex: {
    sci:  ['Sterna paradisaea', 'Somateria mollissima', 'Somateria mollissima borealis',
           'Larus sp.', 'Tringa totanus', 'Spizelloides arborea'],
    code: ['arcter', 'comeid', 'comeid', 'larus1', 'comred', 'amtspa'],
    cat:  ['species', 'species', 'species', 'spuh', 'species', 'species']
  },
  locIndex: {
    slugs: ['aku', 'rvk'], areas: ['aku-600', 'rvk-arbaer', 'rvk-midborg'],
    id: ['L1', 'L2', 'L3', 'L9'], mun: [1, 1, 0, 1], area: [2, 1, 0, -1], type: ['H', 'P', 'H', 'P']
  },
  geo: { features: [square('aku', 'slug', -19, 65, -17, 66)] },
  areaGeo: { features: [square('aku-603', 'area_id', -18.2, 65.6, -18.0, 65.8, { slug: 'aku' })] },
  known: new Set(['arcter', 'comeid', 'comred', 'larus1'])
};

const HEADER = 'Submission ID,Common Name,Scientific Name,Taxonomic Order,Count,State/Province,County,' +
  'Location ID,Location,Latitude,Longitude,Date,Time,Protocol,Duration (Min),All Obs Reported';
const row = (sub, sci, count, loc, date, complete = 1, state = 'IS-1') => {
  const where = { L1: 'Tjörnin,64.145,-21.94', L2: 'Elliðaárdalur,64.11,-21.84',
                  L3: 'Akureyri,65.68,-18.09', L9: 'Out at sea,63.0,-25.0',
                  LX: 'A new place,65.7,-18.1', LZ: 'Nowhere,10.0,10.0' }[loc];
  return `${sub},x,${sci},1,${count},${state},,${loc},${where},${date},08:00,Stationary,30,${complete}`;
};
const csv = (...rows) => [HEADER, ...rows].join('\n');
const load = (...rows) => importExport(csv(...rows), lookups, '2026-08-01');

const base = () => load(
  row('S1', 'Sterna paradisaea', 3, 'L1', '2026-05-01'),
  row('S1', 'Somateria mollissima', 5, 'L1', '2026-05-01'),
  row('S2', 'Sterna paradisaea', 'X', 'L2', '2026-06-10', 0),
  row('S3', 'Sterna paradisaea', 40, 'L3', '2026-07-20')
);

describe('the import', () => {
  test('rows become checklists and observations', () => {
    const t = base();
    assert.equal(t.cl.sub.length, 3);
    assert.equal(t.ob.k.length, 4);
    assert.deepEqual(t.sp, ['arcter', 'comeid']);
    assert.equal(t.imported, '2026-08-01');
  });

  test('other countries are ignored', () => {
    const t = load(row('S1', 'Sterna paradisaea', 3, 'L1', '2026-05-01'),
                   row('S5', 'Sterna paradisaea', 3, 'L1', '2026-05-02', 1, 'GB-ENG'));
    assert.equal(t.cl.sub.length, 1);
    assert.equal(t.stats.rowsIceland, 1);
    assert.equal(t.stats.rowsTotal, 2);
  });

  test('a short row is read, not dropped', () => {
    // eBird omits trailing empty fields. Requiring full width once discarded
    // 98% of a real file. This row stops after the date.
    const short = 'S7,x,Sterna paradisaea,1,2,IS-1,,L1,Tjörnin,64.145,-21.94,2026-05-03';
    const t = importExport(csv(short), lookups);
    assert.equal(t.cl.sub.length, 1);
    assert.equal(t.cl.comp[0], 0, 'no completeness column means not complete');
  });

  test('"X" is present-but-uncounted, never zero', () => {
    const t = base();
    const i = t.ob.k.findIndex((k, j) => t.cl.sub[k] === 'S2');
    assert.equal(t.ob.n[i], null);
  });

  test('sub-taxa roll up to the species, on one row', () => {
    // The export names the subspecies; eBird's lists count the species.
    const t = load(row('S1', 'Somateria mollissima', 5, 'L1', '2026-05-01'),
                   row('S1', 'Somateria mollissima borealis', 2, 'L1', '2026-05-01'));
    assert.deepEqual(t.sp, ['comeid']);
    assert.equal(t.ob.k.length, 1);
    assert.equal(t.ob.n[0], 7);
  });

  test('a species missing from this EBD still counts, and is reported', () => {
    // American Tree Sparrow: the one-species gap between 104 and the 105 eBird
    // showed, before the category travelled with the taxonomy.
    const t = load(row('S1', 'Spizelloides arborea', 1, 'L1', '2026-05-01'));
    assert.equal(summaryFor(t, 'IS').stats.species, 1);
    assert.deepEqual(t.warnings.notInDataset.map(x => x.code), ['amtspa']);
  });

  test('an unknown scientific name is reported, not silently lost', () => {
    const t = load(row('S1', 'Sterna paradisaea', 1, 'L1', '2026-05-01'),
                   row('S1', 'Avis incognita', 1, 'L1', '2026-05-01'));
    assert.deepEqual(t.warnings.unknownTaxa, ['Avis incognita']);
    assert.equal(t.ob.k.length, 1);
  });

  test('a locality the index lacks is placed by polygon, area and all', () => {
    // Typically a locality newer than the EBD release.
    const t = load(row('S1', 'Sterna paradisaea', 1, 'LX', '2026-05-01'));
    assert.equal(t.locs[0].mun, 'aku');
    assert.equal(t.locs[0].area, 'aku-603');
    assert.equal(t.stats.byPolygon, 1);
  });

  test('a locality nowhere in Iceland is set aside and counted', () => {
    const t = load(row('S1', 'Sterna paradisaea', 1, 'L1', '2026-05-01'),
                   row('S2', 'Sterna paradisaea', 1, 'LZ', '2026-05-02'));
    assert.equal(t.cl.sub.length, 1);
    assert.equal(t.warnings.unplacedTotal, 1);
  });

  test('open sea is a place: a sveitarfélag-level region with no area', () => {
    const t = load(row('S1', 'Sterna paradisaea', 1, 'L9', '2026-05-01'));
    assert.equal(t.locs[0].mun, 'rvk');
    assert.equal(t.locs[0].area, null);
  });

  test('errors carry a code the page can translate', () => {
    assert.throws(() => importExport('', lookups), e => e.code === 'empty');
    assert.throws(() => importExport('a,b\n1,2', lookups), e => e.code === 'column');
    assert.throws(() => importExport(csv(row('S1', 'Sterna paradisaea', 1, 'L1', '2026-05-01', 1, 'GB-ENG')), lookups),
                  e => e.code === 'no-iceland');
  });
});

describe('a region, from your data', () => {
  test('the country is everything', () => {
    const s = summaryFor(base(), 'IS');
    assert.equal(s.stats.species, 2);
    assert.equal(s.stats.checklists, 3);
    assert.equal(s.stats.complete, 2);
    assert.equal(s.stats.firstDate, isoToDay('2026-05-01'));
    assert.equal(s.stats.lastDate, isoToDay('2026-07-20'));
  });

  test('a sveitarfélag is its own checklists', () => {
    const s = summaryFor(base(), 'rvk');
    assert.equal(s.stats.checklists, 2);
    assert.deepEqual(s.species.map(r => r.c).sort(), ['arcter', 'comeid']);
  });

  test('an area is narrower again', () => {
    const s = summaryFor(base(), 'rvk-midborg');
    assert.equal(s.stats.checklists, 1);
    const tern = s.species.find(r => r.c === 'arcter');
    assert.equal(tern.k, 1);
    assert.equal(tern.last.ln, 'Tjörnin');
  });

  test('the row has the shape the published summary has', () => {
    const tern = summaryFor(base(), 'IS').species.find(r => r.c === 'arcter');
    assert.equal(tern.k, 3);
    assert.equal(tern.kc, 2);                 // S2 was incomplete
    assert.equal(tern.x, 1);
    assert.equal(tern.first.d, isoToDay('2026-05-01'));
    assert.equal(tern.last.s, 'S3');
    assert.equal(tern.high.n, 40);
    assert.equal(tern.last.b, null, 'the observer is you, which the page says in its own words');
    for (const k of ['d', 's', 'l', 'ln', 'lt', 'n']) assert.ok(k in tern.first);
  });

  test('"your record there" is your record *there*', () => {
    // A Miðborg row once showed a Grafarvogur sighting, because the record kept
    // was the most recent in the whole city.
    const t = base();
    assert.equal(summaryFor(t, 'rvk-midborg').species.find(r => r.c === 'arcter').last.ln, 'Tjörnin');
    assert.equal(summaryFor(t, 'rvk-arbaer').species.find(r => r.c === 'arcter').last.ln, 'Elliðaárdalur');
  });

  test('a region you have never visited is empty, not an error', () => {
    const s = summaryFor(base(), 'somewhere-else');
    assert.equal(s.stats.checklists, 0);
    assert.deepEqual(s.species, []);
  });

  test('headline numbers for every region at once', () => {
    const st = regionStats(base());
    assert.equal(st.get('IS').species, 2);
    assert.equal(st.get('rvk').checklists, 2);
    assert.equal(st.get('aku-600').species, 1);
    assert.equal(st.has('nowhere'), false);
  });
});

describe('the personal cube', () => {
  test('is a cube: the chart functions read it unchanged', () => {
    const cube = cubeFor(base(), 'IS');
    const y = byYear(cube, 'arcter', { from: 2026, to: 2026 })[0];
    assert.equal(y.n, 3);
    assert.equal(y.c, 2);
    assert.equal(y.ec, 2);
    assert.equal(y.freq, 1);
  });

  test('year lists work on it', () => {
    const rows = yearList(cubeFor(base(), 'rvk'), 2026);
    assert.deepEqual(rows.map(r => r.c).sort(), ['arcter', 'comeid']);
    assert.equal(rows.find(r => r.c === 'arcter').first, isoToDay('2026-05-01'));
  });

  test('cells fold back to the summary beside them', () => {
    const t = base();
    for (const id of ['IS', 'rvk', 'rvk-midborg', 'aku']) {
      const cube = cubeFor(t, id), sum = summaryFor(t, id);
      for (const r of sum.species) {
        const si = cube.sp.indexOf(r.c);
        const n = cube.si.reduce((a, s, i) => a + (s === si ? cube.n[i] : 0), 0);
        assert.equal(n, r.k, `${id}/${r.c}`);
      }
      assert.equal(cube.en.reduce((a, b) => a + b, 0), sum.stats.checklists);
      assert.equal(cube.ec.reduce((a, b) => a + b, 0), sum.stats.complete);
    }
  });
});

describe('checklists, records and localities', () => {
  test('checklists newest first, with their species counts', () => {
    const rows = checklistsFor(base(), 'IS');
    assert.deepEqual(rows.map(r => r.sub), ['S3', 'S2', 'S1']);
    assert.equal(rows[2].nsp, 2);
    assert.equal(rows[2].proto, 'Stationary');
    assert.equal(rows[2].dur, 30);
    assert.equal(rows[1].comp, 0);
  });

  test('records of one species in one region', () => {
    const t = base();
    assert.deepEqual(recordsFor(t, 'arcter', 'IS').map(r => r.s), ['S3', 'S2', 'S1']);
    assert.deepEqual(recordsFor(t, 'arcter', 'rvk').map(r => r.s), ['S2', 'S1']);
    assert.deepEqual(recordsFor(t, 'comeid', 'aku'), []);
    assert.deepEqual(recordsFor(t, 'nosuch', 'IS'), []);
  });

  test('a species across every region you have it in', () => {
    const sp = speciesAcross(base(), 'arcter');
    assert.equal(sp.regions[0].id, 'IS', 'the country leads');
    assert.equal(sp.regions[0].k, 3);
    assert.deepEqual(sp.regions.map(r => r.id).sort(),
      ['IS', 'aku', 'aku-600', 'rvk', 'rvk-arbaer', 'rvk-midborg']);
  });

  test('localities carry what the map needs', () => {
    const locs = localities(base());
    assert.equal(locs.length, 3);
    const t = locs.find(l => l.id === 'L1');
    assert.equal(t.k, 1);
    assert.equal(t.s, 2);
    assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
  });
});

describe('firsts', () => {
  test('one row per event, not one per tick', () => {
    // New for the hverfi on the same day it was new for the sveitarfélag is one
    // thing that happened. Two rows would make a first visit read as a flurry.
    const rows = firsts(load(row('S1', 'Sterna paradisaea', 3, 'L1', '2026-05-01')));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].newMun, true);
    assert.deepEqual(rows[0].areas, ['rvk-midborg']);
  });

  test('a later area first is its own row, and not new for the sveitarfélag', () => {
    const rows = firsts(base()).filter(r => r.code === 'arcter' && r.mun === 'rvk');
    assert.equal(rows.length, 2);
    const later = rows.find(r => r.day === isoToDay('2026-06-10'));
    assert.equal(later.newMun, false);
    assert.deepEqual(later.areas, ['rvk-arbaer']);
  });

  test('the lifer badge appears once per species', () => {
    // A day out by car can put a bird's national first date on two
    // sveitarfélög at once. It was still added to the Iceland list once.
    const rows = firsts(load(row('S1', 'Sterna paradisaea', 1, 'L1', '2026-05-01'),
                             row('S2', 'Sterna paradisaea', 1, 'L3', '2026-05-01')));
    assert.equal(rows.length, 2);
    assert.equal(rows.filter(r => r.lifer).length, 1);
    assert.equal(rows.filter(r => r.newMun).length, 2);
  });

  test('a spuh can be a regional first but never a lifer', () => {
    const rows = firsts(load(row('S1', 'Larus sp.', 1, 'L1', '2026-05-01'),
                             row('S1', 'Sterna paradisaea', 1, 'L1', '2026-05-01')));
    const gull = rows.find(r => r.code === 'larus1');
    assert.equal(gull.lifer, false);
    assert.equal(gull.countable, false);
    assert.equal(rows.find(r => r.code === 'arcter').lifer, true);
  });

  test('lifers never outnumber species', () => {
    const t = base();
    const lifers = firsts(t).filter(r => r.lifer).length;
    assert.equal(lifers, summaryFor(t, 'IS').stats.species);
  });

  test('newest first', () => {
    const days = firsts(base()).map(r => r.day);
    assert.deepEqual(days, [...days].sort((a, b) => b - a));
  });

  test('scoped to a sveitarfélag, and to an area', () => {
    const t = base();
    assert.ok(firsts(t, 'aku').every(r => r.mun === 'aku'));
    assert.equal(firsts(t, 'aku').length, 1);
    const arbaer = firsts(t, 'rvk-arbaer');
    assert.equal(arbaer.length, 1);
    assert.deepEqual(arbaer[0].areas, ['rvk-arbaer']);
  });
});

describe('what an upload added', () => {
  test('nothing, on a first upload', () => {
    // "Everything is new" is not news.
    assert.equal(diffTables(null, base()), null);
  });

  test('an unchanged file adds nothing', () => {
    const d = diffTables(base(), base());
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.lifers, []);
  });

  test('a species new for a sveitarfélag and its area', () => {
    const next = load(
      row('S1', 'Sterna paradisaea', 3, 'L1', '2026-05-01'),
      row('S1', 'Somateria mollissima', 5, 'L1', '2026-05-01'),
      row('S2', 'Sterna paradisaea', 'X', 'L2', '2026-06-10', 0),
      row('S3', 'Sterna paradisaea', 40, 'L3', '2026-07-20'),
      row('S4', 'Tringa totanus', 2, 'L3', '2026-07-28'));
    const d = diffTables(base(), next);
    assert.deepEqual(d.added.map(a => a.id).sort(), ['aku', 'aku-600']);
    assert.deepEqual(d.lifers, ['comred']);
    assert.equal(d.prevAt, '2026-08-01');
  });

  test('a backdated record counts as new', () => {
    // Exports get backfilled: an old notebook typed up, a shared checklist
    // accepted late. New to your list though the sighting is not new -- which
    // is why this is a set difference and never a date cutoff.
    const next = load(
      row('S1', 'Sterna paradisaea', 3, 'L1', '2026-05-01'),
      row('S1', 'Somateria mollissima', 5, 'L1', '2026-05-01'),
      row('S2', 'Sterna paradisaea', 'X', 'L2', '2026-06-10', 0),
      row('S3', 'Sterna paradisaea', 40, 'L3', '2026-07-20'),
      row('S0', 'Tringa totanus', 2, 'L1', '1998-03-04'));
    const d = diffTables(base(), next);
    assert.ok(d.added.some(a => a.code === 'comred' && a.day === isoToDay('1998-03-04')));
  });

  test('a new spuh is a regional tick but not a lifer', () => {
    const next = load(
      row('S1', 'Sterna paradisaea', 3, 'L1', '2026-05-01'),
      row('S1', 'Somateria mollissima', 5, 'L1', '2026-05-01'),
      row('S2', 'Sterna paradisaea', 'X', 'L2', '2026-06-10', 0),
      row('S3', 'Sterna paradisaea', 40, 'L3', '2026-07-20'),
      row('S4', 'Larus sp.', 2, 'L3', '2026-07-28'));
    const d = diffTables(base(), next);
    assert.ok(d.added.some(a => a.code === 'larus1'));
    assert.deepEqual(d.lifers, []);
  });
});
