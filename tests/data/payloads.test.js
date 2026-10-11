// Validation of the generated payloads under site/data.
//
// CI cannot rebuild these: the EBD is 735 MB, licensed, and not in the repo. So
// what CI can do is check that what *is* committed -- the thing actually served
// to people -- is internally consistent. Every check here corresponds to a bug
// that shipped or to an invariant R/run_all.R asserts at build time.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = fileURLToPath(new URL('../../site/data/', import.meta.url));
const read = p => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const sum = a => a.reduce((x, y) => x + y, 0);

let meta, regions, byId, geo, areaGeo, taxonomy;
const kids = id => regions.filter(r => r.parent === id);
const isMun = r => r.kind === 'sveitarfelag' || r.kind === 'sea';
const isArea = r => r.kind === 'hverfi' || r.kind === 'postnumer';

before(() => {
  meta = read('meta.json');
  regions = read('regions.json').regions;
  byId = new Map(regions.map(r => [r.id, r]));
  geo = read('geo/sveitarfelog.json');
  areaGeo = read('geo/areas.json');
  taxonomy = read('taxonomy.json');
});

describe('meta.json', () => {
  test('carries the totals', () => {
    for (const k of ['species', 'taxa', 'checklists', 'observations', 'observers',
                     'municipalities', 'areas']) {
      assert.ok(Number.isInteger(meta.totals[k]) && meta.totals[k] > 0, `totals.${k}`);
    }
    assert.ok(meta.totals.taxa >= meta.totals.species);
  });

  test('dateRange is ordered and ends in the past', () => {
    // The "how current is this" notice reads dateRange[1] straight out.
    const [lo, hi] = meta.dateRange;
    assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && lo < hi);
    const end = new Date(hi * 86400000);
    assert.ok(end.getUTCFullYear() >= 2020, 'cut-off looks impossibly old');
    assert.ok(end.getTime() < Date.now() + 86400000, 'cut-off is in the future');
  });

  test('the release string agrees with the citation', () => {
    assert.match(meta.ebdRelease, /^rel[A-Z][a-z]{2}-\d{4}$/);
    assert.ok(meta.citation.includes(meta.ebdRelease));
  });
});

describe('the region tree', () => {
  test('one country, and it is the root', () => {
    const roots = regions.filter(r => !r.parent);
    assert.deepEqual(roots.map(r => r.id), ['IS']);
    assert.equal(roots[0].kind, 'country');
  });

  test('ids are unique', () => {
    assert.equal(new Set(regions.map(r => r.id)).size, regions.length);
  });

  test('every region has a parent that exists, of the right kind', () => {
    for (const r of regions) {
      if (!r.parent) continue;
      const p = byId.get(r.parent);
      assert.ok(p, `${r.id} has unknown parent ${r.parent}`);
      if (isMun(r)) assert.equal(p.kind, 'country', r.id);
      if (isArea(r)) assert.equal(p.kind, 'sveitarfelag', r.id);
    }
  });

  test('the counts match meta.json', () => {
    assert.equal(regions.filter(isMun).length, meta.totals.municipalities);
    assert.equal(regions.filter(isArea).length, meta.totals.areas);
    const is = byId.get('IS');
    assert.equal(is.species, meta.totals.species);
    assert.equal(is.checklists, meta.totals.checklists);
  });

  test('an area id is exactly its sveitarfélag and its code', () => {
    // Old URLs are redirected by joining the two, so the id has to be nothing
    // else.
    for (const r of regions.filter(isArea)) assert.equal(r.id, `${r.parent}-${r.code}`);
  });

  test('sveitarfélög partition the country: checklists add up exactly', () => {
    assert.equal(sum(regions.filter(isMun).map(r => r.checklists)), byId.get('IS').checklists);
    assert.equal(sum(regions.filter(isMun).map(r => r.observations)), byId.get('IS').observations);
  });

  test('areas tile their sveitarfélag: checklists add up exactly', () => {
    // Areas are the intersection of the municipality with the chosen layer, so
    // every checklist inside one falls in exactly one area. A shortfall means a
    // locality slipped between the two layers.
    for (const m of regions.filter(r => r.kind === 'sveitarfelag')) {
      const a = kids(m.id);
      assert.ok(a.length >= 1, `${m.id} has no areas`);
      assert.equal(sum(a.map(r => r.checklists)), m.checklists, m.id);
    }
  });

  test('a child never holds more than its parent', () => {
    for (const r of regions) {
      const p = byId.get(r.parent);
      if (!p) continue;
      assert.ok(r.species <= p.species, `${r.id} species`);
      assert.ok(r.checklists <= p.checklists, `${r.id} checklists`);
    }
  });

  test('named neighbourhoods are unique nationally', () => {
    const seen = new Map();
    for (const r of regions.filter(r => r.kind === 'hverfi')) {
      assert.ok(!seen.has(r.name), `hverfi "${r.name}" in ${seen.get(r.name)} and ${r.parent}`);
      seen.set(r.name, r.parent);
    }
  });

  test('a repeated postal label is always a different sveitarfélag', () => {
    // 660 Mývatn is three regions because the district crosses two boundaries.
    // That is legitimate; the same label twice in ONE sveitarfélag is not.
    const seen = new Set();
    for (const r of regions.filter(r => r.kind === 'postnumer')) {
      const key = `${r.parent}|${r.name}`;
      assert.ok(!seen.has(key), key);
      seen.add(key);
    }
  });
});

describe('every region has the same files', () => {
  test('summary.json and cube.json exist for all of them', () => {
    // THE regression, generalised: an area nobody had birded was once drawn on
    // the map, clickable, and absent from the data -- a link to nowhere.
    for (const r of regions) {
      for (const f of ['summary.json', 'cube.json']) {
        assert.ok(existsSync(join(DATA, 'region', r.id, f)), `${r.id}/${f}`);
      }
    }
  });

  test('no directory is left over from a region that no longer exists', () => {
    for (const d of readdirSync(join(DATA, 'region'))) assert.ok(byId.has(d), d);
  });

  test('sveitarfélög carry their checklists and observations', () => {
    for (const r of regions.filter(isMun)) {
      for (const f of ['checklists.json', 'obs.json']) {
        assert.ok(existsSync(join(DATA, 'region', r.id, f)), `${r.id}/${f}`);
      }
    }
  });

  test('the old layout is gone', () => {
    assert.ok(!existsSync(join(DATA, 'mun')));
    assert.ok(!existsSync(join(DATA, 'species_index.json')));
  });

  test('summary stats match the tree', () => {
    for (const r of regions) {
      const s = read(join('region', r.id, 'summary.json'));
      assert.equal(s.id, r.id);
      assert.equal(s.stats.species, r.species, `${r.id} species`);
      assert.equal(s.stats.checklists, r.checklists, `${r.id} checklists`);
      assert.equal(s.species.filter(x => x.x).length, r.species, `${r.id} countable rows`);
      assert.equal(s.species.length, r.taxa, `${r.id} taxa`);
    }
  });

  test('species rows carry the three records and their links', () => {
    for (const id of ['IS', '0000-reykjavikurborg', '0000-reykjavikurborg-midborg']) {
      for (const row of read(join('region', id, 'summary.json')).species) {
        assert.ok(row.k >= row.kc && row.kc >= 0, `${id}/${row.c}`);
        for (const rec of [row.first, row.last, row.high]) {
          assert.match(rec.s, /^S\d+$/);
          assert.match(rec.b, /^obsr\d+$/);
          assert.match(rec.l, /^L\d+$/);
          assert.ok(rec.ln && (rec.lt === 'H' || rec.lt === 'P'));
        }
        assert.ok(row.first.d <= row.last.d);
      }
    }
  });
});

describe('cubes', () => {
  const COLS = ['si', 'y', 'm', 'n', 'c'];

  test('the cube folds back to the summary beside it, in every region', () => {
    // The same data cut by year and month. Per species its cells must sum to
    // the species' checklist count; the effort cells to the region's.
    let cells = 0;
    for (const r of regions) {
      const cube = read(join('region', r.id, 'cube.json'));
      const s = read(join('region', r.id, 'summary.json'));
      for (const k of COLS) assert.equal(cube[k].length, cube.si.length, `${r.id} ${k}`);
      assert.deepEqual(cube.sp, s.species.map(x => x.c), `${r.id} species order`);
      const n = new Array(cube.sp.length).fill(0), c = new Array(cube.sp.length).fill(0);
      for (let i = 0; i < cube.si.length; i++) { n[cube.si[i]] += cube.n[i]; c[cube.si[i]] += cube.c[i]; }
      assert.deepEqual(n, s.species.map(x => x.k), `${r.id} checklists per species`);
      assert.deepEqual(c, s.species.map(x => x.kc), `${r.id} complete per species`);
      assert.equal(sum(cube.en), s.stats.checklists, `${r.id} effort`);
      assert.equal(sum(cube.ec), s.stats.complete, `${r.id} complete effort`);
      cells += cube.si.length;
    }
    assert.ok(cells > 600000, `only ${cells} cells`);
  });

  test('a cell never has more complete checklists than checklists', () => {
    for (const id of ['IS', '6100-nordurthing', '0000-reykjavikurborg-midborg']) {
      const cube = read(join('region', id, 'cube.json'));
      for (let i = 0; i < cube.si.length; i++) assert.ok(cube.c[i] <= cube.n[i]);
      for (let i = 0; i < cube.ey.length; i++) assert.ok(cube.ec[i] <= cube.en[i]);
    }
  });

  test('a species cannot be on more checklists in a month than were submitted', () => {
    const cube = read('region/IS/cube.json');
    const effort = new Map(cube.ey.map((y, i) => [y * 12 + cube.em[i], [cube.en[i], cube.ec[i]]]));
    for (let i = 0; i < cube.si.length; i++) {
      const e = effort.get(cube.y[i] * 12 + cube.m[i]);
      assert.ok(e, `no effort for ${cube.y[i]}-${cube.m[i]}`);
      assert.ok(cube.n[i] <= e[0] && cube.c[i] <= e[1]);
    }
  });

  test('months are 1 to 12, and cells are sorted by species', () => {
    const cube = read('region/IS/cube.json');
    assert.ok(cube.m.every(m => m >= 1 && m <= 12));
    for (let i = 1; i < cube.si.length; i++) assert.ok(cube.si[i] >= cube.si[i - 1]);
  });

  test('first and last day of each species-year sit inside that year', () => {
    const cube = read('region/IS/cube.json');
    for (let i = 0; i < cube.ysi.length; i++) {
      assert.ok(cube.yf[i] <= cube.yl[i]);
      assert.equal(new Date(cube.yf[i] * 86400000).getUTCFullYear(), cube.yy[i]);
      assert.equal(new Date(cube.yl[i] * 86400000).getUTCFullYear(), cube.yy[i]);
    }
  });

  test('an empty region has an empty cube, not a missing one', () => {
    const empty = regions.find(r => r.checklists === 0);
    assert.ok(empty, 'expected at least one area nobody has birded');
    const cube = read(join('region', empty.id, 'cube.json'));
    for (const k of [...COLS, 'sp', 'ey']) assert.deepEqual(cube[k], [], `${empty.id} ${k}`);
  });
});

describe('array shapes', () => {
  // jsonlite's auto_unbox collapses every length-1 vector to a scalar, which
  // once turned 1,768 rows into "undefined–undefined" across 106 species files.
  // The thinnest regions and rarest species are where it bites.
  const arrays = (obj, keys, where) => {
    for (const k of keys) assert.ok(Array.isArray(obj[k]), `${where}: ${k} is ${typeof obj[k]}`);
  };

  test('the thinnest regions keep their arrays', () => {
    const thin = regions.filter(r => r.checklists > 0).sort((a, b) => a.checklists - b.checklists).slice(0, 12);
    for (const r of thin) {
      arrays(read(join('region', r.id, 'summary.json')), ['species'], r.id);
      arrays(read(join('region', r.id, 'cube.json')),
        ['sp', 'si', 'y', 'm', 'n', 'c', 'ysi', 'yy', 'yf', 'yl', 'ey', 'em', 'en', 'ec'], r.id);
    }
  });

  test('checklists and observations keep theirs', () => {
    const smallest = regions.filter(isMun).sort((a, b) => a.checklists - b.checklists)[0];
    arrays(read(join('region', smallest.id, 'checklists.json')),
      ['sub', 'date', 'time', 'loc', 'obsr', 'proto', 'nsp', 'comp', 'obsrs', 'protos', 'areas', 'area'], smallest.id);
    arrays(read(join('region', smallest.id, 'obs.json')), ['sp', 'si', 'k', 'n', 'media'], smallest.id);
  });

  test('the rarest species keep theirs', () => {
    const rare = read('region/IS/summary.json').species.sort((a, b) => a.k - b.k).slice(0, 25);
    for (const s of rare) arrays(read(join('sp', `${s.c}.json`)), ['regions', 'recent'], s.c);
  });
});

describe('checklists and observations', () => {
  test('parallel columns are the same length, and indexes stay in range', () => {
    for (const id of ['6100-nordurthing', '0000-reykjavikurborg', '8719-grimsnes-og-grafningshreppur']) {
      const chk = read(join('region', id, 'checklists.json'));
      const n = chk.sub.length;
      for (const k of ['date', 'time', 'loc', 'obsr', 'proto', 'dur', 'dist', 'nobsr', 'comp', 'nsp', 'shared', 'area']) {
        assert.equal(chk[k].length, n, `${id} ${k}`);
      }
      assert.ok(chk.area.every(a => a >= 0 && a < chk.areas.length), `${id} area index`);
      assert.ok(chk.loc.every(l => l >= 0 && l < chk.locs.id.length), `${id} loc index`);
      const obs = read(join('region', id, 'obs.json'));
      assert.ok(obs.k.every(k => k >= 0 && k < n), `${id} obs -> checklist index`);
      assert.ok(obs.si.every(s => s >= 0 && s < obs.sp.length), `${id} obs -> species index`);
    }
  });

  test('an area\'s checklists, counted from its parent\'s file, match the tree', () => {
    // Areas have no checklist file of their own; they filter the parent's.
    for (const id of ['0000-reykjavikurborg', '6613-thingeyjarsveit', '8719-grimsnes-og-grafningshreppur']) {
      const chk = read(join('region', id, 'checklists.json'));
      const counted = new Array(chk.areas.length).fill(0);
      for (const a of chk.area) counted[a]++;
      chk.areas.forEach((areaId, i) => assert.equal(counted[i], byId.get(areaId).checklists, areaId));
    }
  });

  test('checklists are newest first', () => {
    const d = read('region/0000-reykjavikurborg/checklists.json').date;
    for (let i = 1; i < d.length; i++) assert.ok(d[i] <= d[i - 1]);
  });

  test('the country file is the latest few, and says how many there are', () => {
    const chk = read('region/IS/checklists.json');
    assert.equal(chk.total, meta.totals.checklists);
    assert.equal(chk.sub.length, meta.countryChecklists);
    assert.ok(chk.sub.length < chk.total);
    assert.equal(chk.date[0], meta.dateRange[1]);
    assert.ok(chk.reg.every(r => r >= 0 && r < chk.regs.length));
    for (const r of chk.regs) assert.ok(byId.has(r), r);
    assert.ok(!existsSync(join(DATA, 'region', 'IS', 'obs.json')), 'no national obs.json: 1.6M rows');
  });
});

describe('species files', () => {
  test('every taxon in the country summary has a file, and nothing else does', () => {
    const listed = new Set(read('region/IS/summary.json').species.map(s => s.c));
    const onDisk = new Set(readdirSync(join(DATA, 'sp')).map(f => f.replace(/\.json$/, '')));
    assert.deepEqual([...listed].filter(c => !onDisk.has(c)), []);
    assert.deepEqual([...onDisk].filter(c => !listed.has(c)), []);
  });

  test('the taxonomy covers every species, completely', () => {
    const tax = new Map(taxonomy.map(t => [t.c, t]));
    for (const s of read('region/IS/summary.json').species) assert.ok(tax.has(s.c), s.c);
    assert.equal(taxonomy.length, meta.totals.taxa);
    for (const t of taxonomy) {
      assert.ok(t.c && t.sci && t.en, JSON.stringify(t));
      assert.equal(typeof t.hasIs, 'boolean');
    }
  });

  test('a species file is the mirror of the region summaries', () => {
    for (const code of ['arcter', 'comeid', 'whimbr']) {
      const sp = read(join('sp', `${code}.json`));
      assert.equal(sp.regions[0].id, 'IS', 'the country leads');
      for (const row of sp.regions) {
        assert.ok(byId.has(row.id), `${code}: unknown region ${row.id}`);
        const there = read(join('region', row.id, 'summary.json')).species.find(s => s.c === code);
        assert.ok(there, `${code} listed for ${row.id} but absent from its summary`);
        assert.equal(row.k, there.k, `${code} in ${row.id}`);
        assert.equal(row.last.s, there.last.s, `${code} last in ${row.id}`);
      }
    }
  });

  test('recent records are newest first, and in sveitarfélög that exist', () => {
    const sp = read('sp/arcter.json');
    assert.ok(sp.recent.length > 0 && sp.recent.length <= 50);
    for (let i = 1; i < sp.recent.length; i++) assert.ok(sp.recent[i].d <= sp.recent[i - 1].d);
    for (const r of sp.recent) assert.ok(byId.has(r.r), r.r);
  });
});

describe('geometry', () => {
  const walk = (geom, fn) => {
    if (geom.type === 'Polygon') geom.coordinates.forEach(r => r.forEach(fn));
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(r => r.forEach(fn)));
    else assert.fail(`unsupported geometry ${geom.type}`);
  };

  test('only polygons, with finite coordinates inside Iceland', () => {
    for (const f of [...geo.features, ...areaGeo.features]) {
      walk(f.geometry, ([lon, lat]) => {
        assert.ok(Number.isFinite(lon) && Number.isFinite(lat));
        assert.ok(lon > -27 && lon < -12 && lat > 62 && lat < 68);
      });
    }
  });

  test('every shape on the map is a region, and every region but the sea has a shape', () => {
    // A shape with no region is a click to nowhere; a region with no shape
    // cannot be reached from the map.
    const shapes = new Set([...geo.features.map(f => f.properties.slug),
                            ...areaGeo.features.map(f => f.properties.area_id)]);
    for (const id of shapes) assert.ok(byId.has(id), `shape ${id} is not a region`);
    for (const r of regions) {
      if (r.kind === 'country' || r.kind === 'sea') continue;
      assert.ok(shapes.has(r.id), `${r.id} has no shape`);
    }
  });

  test('an area sits inside the bounding box of its sveitarfélag', () => {
    const box = new Map();
    for (const f of geo.features) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      walk(f.geometry, ([lon, lat]) => {
        if (lon < x0) x0 = lon; if (lon > x1) x1 = lon;
        if (lat < y0) y0 = lat; if (lat > y1) y1 = lat;
      });
      box.set(f.properties.slug, [x0, y0, x1, y1]);
    }
    const EPS = 0.02;   // simplification moves vertices by a little
    for (const f of areaGeo.features) {
      const b = box.get(f.properties.slug);
      walk(f.geometry, ([lon, lat]) => assert.ok(
        lon >= b[0] - EPS && lon <= b[2] + EPS && lat >= b[1] - EPS && lat <= b[3] + EPS,
        `${f.properties.area_id} strays outside ${f.properties.slug}`));
    }
  });
});

describe('the personal-import lookups', () => {
  test('sci_index maps scientific names to reportable species', () => {
    const idx = read('sci_index.json');
    assert.equal(idx.sci.length, idx.code.length);
    assert.equal(idx.sci.length, idx.cat.length);
    assert.ok(idx.sci.length > 10000);
  });

  test('locality_index: parallel columns, unique ids, indexes in range', () => {
    const idx = read('locality_index.json');
    const n = idx.id.length;
    for (const k of ['mun', 'area', 'type']) assert.equal(idx[k].length, n, k);
    assert.equal(new Set(idx.id).size, n);
    assert.ok(n > 40000);
    assert.ok(idx.mun.every(m => m >= 0 && m < idx.slugs.length));
    // -1, and only -1, means "outside every area": the importer tests `>= 0`.
    let sea = 0;
    for (const a of idx.area) { if (a === -1) sea++; else assert.ok(a >= 0 && a < idx.areas.length); }
    assert.ok(sea > 0);
  });

  test('the lookups only name regions that exist', () => {
    const idx = read('locality_index.json');
    for (const s of idx.slugs) assert.ok(byId.has(s), s);
    for (const a of idx.areas) assert.ok(byId.has(a), a);
  });
});
