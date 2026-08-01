// Regional firsts: when a species was new for a sveitarfélag, hverfi or
// póstnúmer, and what an upload added over the one before it.
//
// Both are pure functions over the stored shape, which is what makes them
// testable without a browser -- and worth testing, because the arithmetic of
// "new" is easy to get subtly wrong in ways that look plausible on screen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { diffImports, myFirsts, tickKeys } from '../../site/js/mydata.js';

// A minimal stored object. `sp` entries only need `f` here -- the first date.
// `allSpecies` defaults to every code mentioned, i.e. "these are all real
// species"; pass it explicitly to model a spuh or a hybrid, which lives in the
// per-region records but never on a life list.
const store = ({ mun = {}, areas = {}, allSpecies, imported = '2026-07-01' }) => ({
  imported,
  allSpecies: allSpecies || [...new Set([
    ...Object.values(mun).flatMap(sp => Object.keys(sp)),
    ...Object.values(areas).flatMap(sp => Object.keys(sp))
  ])],
  municipalities: Object.fromEntries(Object.entries(mun).map(([slug, sp]) => [
    slug, { sp: Object.fromEntries(Object.entries(sp).map(([c, f]) => [c, { f }])) }
  ])),
  areas: Object.fromEntries(Object.entries(areas).map(([id, sp]) => [
    id, { sp: Object.fromEntries(Object.entries(sp).map(([c, f]) => [c, { f }])) }
  ]))
});

const AREA_SLUG = new Map([
  ['rvk-midborg', 'rvk'],
  ['rvk-arbaer', 'rvk'],
  ['aku-600', 'aku']
]);

describe('tickKeys', () => {
  test('counts a species once per region, at both levels', () => {
    const keys = tickKeys(store({
      mun: { rvk: { arcter: '2026-05-01' }, aku: { arcter: '2026-06-01' } },
      areas: { 'rvk-midborg': { arcter: '2026-05-01' } }
    }));
    assert.deepEqual([...keys].sort(),
      ['a|rvk-midborg|arcter', 'm|aku|arcter', 'm|rvk|arcter']);
  });

  test('an empty or missing store has no ticks', () => {
    assert.equal(tickKeys(null).size, 0);
    assert.equal(tickKeys(store({})).size, 0);
  });
});

describe('diffImports', () => {
  test('reports nothing when there is no previous import', () => {
    // "Everything is new" is not news, and showing it on a first upload would
    // bury the feature under a list of every record the user has ever made.
    const next = store({ mun: { rvk: { arcter: '2026-05-01' } } });
    assert.equal(diffImports(null, next), null);
    assert.equal(diffImports(undefined, next), null);
  });

  test('finds a species new for a sveitarfélag', () => {
    const prev = store({ mun: { rvk: { arcter: '2026-05-01' } } });
    const next = store({ mun: { rvk: { arcter: '2026-05-01', comeid: '2026-07-20' } } });
    const d = diffImports(prev, next);
    assert.deepEqual(d.added, [{ scope: 'm', id: 'rvk', code: 'comeid', date: '2026-07-20' }]);
  });

  test('finds a species new for an area but not for its municipality', () => {
    // The whole point of the fourth level: Kría was already on the Reykjavík
    // list, and is still a tick for Árbær.
    const prev = store({
      mun: { rvk: { arcter: '2026-05-01' } },
      areas: { 'rvk-midborg': { arcter: '2026-05-01' } }
    });
    const next = store({
      mun: { rvk: { arcter: '2026-05-01' } },
      areas: { 'rvk-midborg': { arcter: '2026-05-01' }, 'rvk-arbaer': { arcter: '2026-07-22' } }
    });
    const d = diffImports(prev, next);
    assert.equal(d.added.length, 1);
    assert.equal(d.added[0].scope, 'a');
    assert.equal(d.added[0].id, 'rvk-arbaer');
  });

  test('a backdated record counts as new', () => {
    // eBird exports get backfilled: an old notebook typed up, or a shared
    // checklist accepted late. It is new to your list even though the sighting
    // is not new, so the diff is a set difference and never a date cutoff.
    const prev = store({ mun: { rvk: { arcter: '2026-05-01' } } });
    const next = store({ mun: { rvk: { arcter: '2026-05-01', comeid: '1998-03-04' } } });
    const d = diffImports(prev, next);
    assert.equal(d.added.length, 1);
    assert.equal(d.added[0].date, '1998-03-04');
  });

  test('an unchanged re-import adds nothing', () => {
    const same = () => store({
      mun: { rvk: { arcter: '2026-05-01' } },
      areas: { 'rvk-midborg': { arcter: '2026-05-01' } },
      allSpecies: ['arcter']
    });
    assert.deepEqual(diffImports(same(), same()).added, []);
  });

  test('lifers are species not previously on the Iceland list', () => {
    const prev = store({ mun: { rvk: { arcter: '2026-05-01' } }, allSpecies: ['arcter'] });
    const next = store({
      mun: { rvk: { arcter: '2026-05-01' }, aku: { comeid: '2026-07-20' } },
      allSpecies: ['arcter', 'comeid']
    });
    assert.deepEqual(diffImports(prev, next).lifers, ['comeid']);
  });

  test('a species new for a region but not for the country is not a lifer', () => {
    const prev = store({ mun: { rvk: { arcter: '2026-05-01' } }, allSpecies: ['arcter'] });
    const next = store({
      mun: { rvk: { arcter: '2026-05-01' }, aku: { arcter: '2026-07-20' } },
      allSpecies: ['arcter']
    });
    const d = diffImports(prev, next);
    assert.equal(d.added.length, 1);
    assert.deepEqual(d.lifers, []);
  });

  test('newest first, and it remembers when the previous import was', () => {
    const prev = store({ mun: { rvk: {} }, imported: '2026-06-15' });
    const next = store({ mun: { rvk: { a: '2026-01-02', b: '2026-07-30', c: '2026-04-05' } } });
    const d = diffImports(prev, next);
    assert.deepEqual(d.added.map(x => x.date), ['2026-07-30', '2026-04-05', '2026-01-02']);
    assert.equal(d.prevAt, '2026-06-15');
  });
});

describe('myFirsts', () => {
  test('one row per event, not one per tick', () => {
    // New for the hverfi on the same day it was new for the sveitarfélag is a
    // single thing that happened. Two rows would make one morning's walk read
    // as a flurry of separate achievements.
    const rows = myFirsts(store({
      mun: { rvk: { arcter: '2026-05-01' } },
      areas: { 'rvk-midborg': { arcter: '2026-05-01' } }
    }), AREA_SLUG);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].newMun, true);
    assert.deepEqual(rows[0].areas, ['rvk-midborg']);
  });

  test('a later area first is its own row', () => {
    const rows = myFirsts(store({
      mun: { rvk: { arcter: '2026-05-01' } },
      areas: { 'rvk-midborg': { arcter: '2026-05-01' }, 'rvk-arbaer': { arcter: '2026-07-22' } }
    }), AREA_SLUG);

    assert.equal(rows.length, 2);
    const later = rows.find(r => r.date === '2026-07-22');
    assert.equal(later.newMun, false, 'Reykjavík was not new that day');
    assert.deepEqual(later.areas, ['rvk-arbaer']);
  });

  test('the lifer flag marks the earliest date in the country, once', () => {
    const rows = myFirsts(store({
      mun: { rvk: { arcter: '2026-05-01' }, aku: { arcter: '2026-07-20' } }
    }), AREA_SLUG);

    assert.equal(rows.filter(r => r.lifer).length, 1);
    assert.equal(rows.find(r => r.lifer).date, '2026-05-01');
    assert.equal(rows.find(r => r.slug === 'aku').lifer, false);
  });

  test('sorted newest first', () => {
    const rows = myFirsts(store({
      mun: { rvk: { a: '2024-01-01', b: '2026-07-30' }, aku: { c: '2025-06-06' } }
    }), AREA_SLUG);
    assert.deepEqual(rows.map(r => r.date), ['2026-07-30', '2025-06-06', '2024-01-01']);
  });

  test('an area whose municipality is unknown is dropped, not guessed', () => {
    // Area ids cannot be split back apart -- "0000-reykjavikurborg-midborg" is
    // ambiguous -- so an id missing from meta.json has no municipality and is
    // skipped rather than attributed to the wrong place.
    const rows = myFirsts(store({
      areas: { 'gone-away-101': { arcter: '2026-05-01' } }
    }), AREA_SLUG);
    assert.deepEqual(rows, []);
  });

  test('no data at all yields no rows', () => {
    assert.deepEqual(myFirsts(null, AREA_SLUG), []);
    assert.deepEqual(myFirsts(store({}), AREA_SLUG), []);
  });
});

describe('myFirsts: the lifer badge', () => {
  test('appears once per species even when two regions share the first date', () => {
    // A day out by car can put a bird's national first date on two
    // municipalities at once. It was still added to the Iceland list once.
    const rows = myFirsts(store({
      mun: { rvk: { arcter: '2026-05-01' }, aku: { arcter: '2026-05-01' } }
    }), AREA_SLUG);

    assert.equal(rows.length, 2);
    assert.equal(rows.filter(r => r.lifer).length, 1);
    // The other is still a regional first, just not a lifer.
    assert.equal(rows.filter(r => r.newMun).length, 2);
  });

  test('the badge is deterministic, not whichever iterated first', () => {
    const build = mun => myFirsts(store({ mun }), AREA_SLUG)
      .find(r => r.lifer).slug;
    assert.equal(
      build({ rvk: { arcter: '2026-05-01' }, aku: { arcter: '2026-05-01' } }),
      build({ aku: { arcter: '2026-05-01' }, rvk: { arcter: '2026-05-01' } }));
  });

  test('lifer rows never outnumber the species on the list', () => {
    const rows = myFirsts(store({
      mun: {
        rvk: { arcter: '2026-05-01', comeid: '2026-05-01' },
        aku: { arcter: '2026-05-01', comeid: '2026-06-01' },
        isa: { arcter: '2026-05-01' }
      }
    }), AREA_SLUG);
    const species = new Set(rows.map(r => r.code));
    assert.ok(rows.filter(r => r.lifer).length <= species.size);
    assert.equal(rows.filter(r => r.lifer).length, 2);
  });
});

describe('myFirsts: taxa that are not species', () => {
  test('a spuh can be a regional first but never a lifer', () => {
    // "gull sp." is a real thing to have logged in a place. It is not
    // something you add to a life list, and eBird does not count it either.
    const rows = myFirsts(store({
      mun: { rvk: { arcter: '2026-05-01', larus1: '2026-05-01' } },
      allSpecies: ['arcter']
    }), AREA_SLUG);

    const gull = rows.find(r => r.code === 'larus1');
    const tern = rows.find(r => r.code === 'arcter');
    assert.equal(gull.lifer, false);
    assert.equal(gull.countable, false);
    assert.equal(tern.lifer, true);
    assert.equal(tern.countable, true);
  });

  test('it is still listed, so the row is not silently dropped', () => {
    const rows = myFirsts(store({
      mun: { rvk: { larus1: '2026-05-01' } }, allSpecies: []
    }), AREA_SLUG);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].newMun, true);
  });
});
