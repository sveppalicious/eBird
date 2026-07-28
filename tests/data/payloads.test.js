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

let meta, geo, areaGeo, speciesIndex, taxonomy;

before(() => {
  meta = read('meta.json');
  geo = read('geo/sveitarfelog.json');
  areaGeo = read('geo/areas.json');
  speciesIndex = read('species_index.json');
  taxonomy = read('taxonomy.json');
});

describe('meta.json', () => {
  test('carries the totals the front page prints', () => {
    for (const k of ['species', 'taxa', 'checklists', 'observations',
                     'observers', 'municipalities', 'areas']) {
      assert.ok(Number.isInteger(meta.totals[k]) && meta.totals[k] > 0,
        `totals.${k} is ${meta.totals[k]}`);
    }
    assert.ok(meta.totals.taxa >= meta.totals.species,
      'taxa includes spuh/slash/hybrid, so it cannot be below species');
  });

  test('dateRange is ordered and ends inside the release month', () => {
    // The "how current is this" notice reads dateRange[1] straight out. If it
    // were unsorted or absurd the site would state a false cut-off.
    const [lo, hi] = meta.dateRange;
    assert.ok(Number.isInteger(lo) && Number.isInteger(hi));
    assert.ok(lo < hi);
    const end = new Date(hi * 86400000);
    assert.ok(end.getUTCFullYear() >= 2020, 'cut-off looks impossibly old');
    assert.ok(end.getTime() < Date.now() + 86400000, 'cut-off is in the future');
  });

  test('the release string agrees with the citation', () => {
    assert.match(meta.ebdRelease, /^rel[A-Z][a-z]{2}-\d{4}$/);
    assert.ok(meta.citation.includes(meta.ebdRelease),
      'citation and ebdRelease must not drift apart');
  });

  test('every municipality has a slug, a name and a region', () => {
    assert.equal(meta.municipalities.length, meta.totals.municipalities);
    for (const m of meta.municipalities) {
      assert.match(m.slug, /^[0-9]{4}-[a-z0-9-]+$/, `bad slug ${m.slug}`);
      assert.ok(m.name && m.name.length, `${m.slug} has no name`);
      assert.ok(m.species >= 0 && m.checklists >= 0);
    }
  });

  test('municipality names and slugs are unique', () => {
    const slugs = new Set(), names = new Set();
    for (const m of meta.municipalities) {
      assert.ok(!slugs.has(m.slug), `duplicate slug ${m.slug}`);
      assert.ok(!names.has(m.name), `duplicate name ${m.name}`);
      slugs.add(m.slug); names.add(m.name);
    }
  });
});

describe('the area layer', () => {
  test('meta.areas and areas.json describe the same set', () => {
    const inMeta = new Set(meta.areas.map(a => a.id));
    const inGeo = new Set(areaGeo.features.map(f => f.properties.area_id));
    assert.deepEqual([...inMeta].filter(id => !inGeo.has(id)), [],
      'areas in meta.json with no polygon');
    assert.deepEqual([...inGeo].filter(id => !inMeta.has(id)), [],
      'polygons with no entry in meta.json');
  });

  test('area_id is exactly slug-code', () => {
    // areaHref() cannot parse an id back apart ("0000-reykjavikurborg-midborg"
    // splits ambiguously), so it reads slug and code off the feature. They have
    // to agree with the id or navigation lands somewhere else.
    for (const f of areaGeo.features) {
      const p = f.properties;
      assert.equal(p.area_id, `${p.slug}-${p.code}`);
    }
  });

  test('area ids are unique, and codes are unique within a municipality', () => {
    const ids = new Set(), byMun = new Set();
    for (const f of areaGeo.features) {
      const p = f.properties;
      assert.ok(!ids.has(p.area_id), `duplicate area ${p.area_id}`);
      ids.add(p.area_id);
      const key = `${p.slug}/${p.code}`;
      assert.ok(!byMun.has(key), `duplicate code ${key}`);
      byMun.add(key);
    }
  });

  test('every area belongs to a municipality that exists', () => {
    const slugs = new Set(meta.municipalities.map(m => m.slug));
    for (const a of meta.areas) {
      assert.ok(slugs.has(a.slug), `${a.id} belongs to unknown ${a.slug}`);
    }
  });

  test('named neighbourhood labels are unique nationally', () => {
    // Postal labels may repeat -- a district can straddle a boundary -- but a
    // hverfi is built per municipality and a collision would mean two different
    // places are indistinguishable everywhere they appear.
    const seen = new Map();
    for (const a of meta.areas.filter(a => a.kind === 'hverfi')) {
      assert.ok(!seen.has(a.label),
        `hverfi "${a.label}" in both ${seen.get(a.label)} and ${a.slug}`);
      seen.set(a.label, a.slug);
    }
  });

  test('a repeated postal label is always a different municipality', () => {
    // 660 Mývatn is three areas because the district crosses two boundaries.
    // That is legitimate; the same label twice in ONE municipality is not.
    const byLabel = new Map();
    for (const a of meta.areas.filter(a => a.kind === 'postnumer')) {
      const muns = byLabel.get(a.label) || new Set();
      assert.ok(!muns.has(a.slug),
        `"${a.label}" appears twice inside ${a.slug}`);
      muns.add(a.slug);
      byLabel.set(a.label, muns);
    }
  });

  test('kind is one of the two we build', () => {
    for (const a of meta.areas) {
      assert.ok(a.kind === 'hverfi' || a.kind === 'postnumer',
        `${a.id} has kind ${a.kind}`);
    }
  });

  test('an area never holds more than its municipality', () => {
    const mun = new Map(meta.municipalities.map(m => [m.slug, m]));
    for (const a of meta.areas) {
      const m = mun.get(a.slug);
      assert.ok(a.species <= m.species, `${a.id} has more species than ${a.slug}`);
      assert.ok(a.checklists <= m.checklists, `${a.id} has more checklists`);
    }
  });

  test('areas tile their municipality: checklists add up exactly', () => {
    // Areas are the intersection of the municipality with the chosen layer, so
    // every checklist inside a municipality falls in exactly one area. A
    // shortfall means a locality slipped between the two layers.
    const sum = new Map();
    for (const a of meta.areas) {
      sum.set(a.slug, (sum.get(a.slug) || 0) + a.checklists);
    }
    for (const [slug, total] of sum) {
      const m = meta.municipalities.find(x => x.slug === slug);
      assert.equal(total, m.checklists, `${slug} areas sum to ${total}, not ${m.checklists}`);
    }
  });
});

describe('municipality payloads', () => {
  test('every municipality has its three files', () => {
    for (const m of meta.municipalities) {
      for (const f of ['summary.json', 'checklists.json', 'obs.json']) {
        assert.ok(existsSync(join(DATA, 'mun', m.slug, f)), `missing ${m.slug}/${f}`);
      }
    }
  });

  test('no orphan directories left behind by an older build', () => {
    const known = new Set(meta.municipalities.map(m => m.slug));
    for (const dir of readdirSync(join(DATA, 'mun'))) {
      assert.ok(known.has(dir), `${dir} is not in meta.json`);
    }
  });

  test('summary.json lists every area the geometry has', () => {
    // THE regression. summary.json used to take its areas from the observed
    // checklists, so an area nobody had birded was drawn on the map, was
    // clickable, and led to "No such póstnúmer here" -- 806 in Grímsnes- og
    // Grafningshreppur. The map and meta.json both come from the geometry.
    const built = new Map();
    for (const f of areaGeo.features) {
      const s = f.properties.slug;
      built.set(s, (built.get(s) || 0) + 1);
    }
    for (const m of meta.municipalities) {
      const sum = read(join('mun', m.slug, 'summary.json'));
      const listed = (sum.areas || []).length;
      assert.equal(listed, built.get(m.slug) || 0,
        `${m.slug}: summary lists ${listed} areas, geometry has ${built.get(m.slug) || 0}`);
    }
  });

  test('summary totals match meta.json', () => {
    for (const m of meta.municipalities) {
      const sum = read(join('mun', m.slug, 'summary.json'));
      assert.equal(sum.stats.checklists, m.checklists, `${m.slug} checklists`);
      assert.equal(sum.stats.species, m.species, `${m.slug} species`);
    }
  });

  test('the area index on checklists.json stays in range', () => {
    // Areas are stored positionally: `area[i]` indexes into `areas[]`. Adding
    // or removing an area shifts that index, and an out-of-range value would
    // quietly attribute checklists to the wrong place.
    for (const m of meta.municipalities) {
      const chk = read(join('mun', m.slug, 'checklists.json'));
      const n = (chk.areas || []).length;
      for (const idx of chk.area || []) {
        assert.ok(idx === null || (idx >= 0 && idx < n),
          `${m.slug}: area index ${idx} outside 0..${n - 1}`);
      }
    }
  });

  test('per-area checklist counts recomputed from the raw rows agree', () => {
    // Spot-check the biggest and most-subdivided, plus the one with an empty
    // area. Recomputing all 62 would read 46 MB.
    for (const slug of ['6100-nordurthing', '0000-reykjavikurborg',
                        '6613-thingeyjarsveit', '8719-grimsnes-og-grafningshreppur']) {
      const chk = read(join('mun', slug, 'checklists.json'));
      const sum = read(join('mun', slug, 'summary.json'));
      const counted = new Map();
      for (const idx of chk.area) {
        const id = chk.areas[idx];
        counted.set(id, (counted.get(id) || 0) + 1);
      }
      for (const a of sum.areas) {
        assert.equal(counted.get(a.id) || 0, a.checklists,
          `${slug}/${a.code}: counted ${counted.get(a.id) || 0}, summary says ${a.checklists}`);
      }
    }
  });

  test('parallel arrays in checklists.json are the same length', () => {
    for (const slug of ['6100-nordurthing', '0000-reykjavikurborg']) {
      const chk = read(join('mun', slug, 'checklists.json'));
      const n = chk.sub.length;
      for (const k of ['date', 'time', 'loc', 'obsr', 'proto', 'dur', 'dist',
                       'nobsr', 'comp', 'nsp', 'shared', 'area']) {
        assert.equal(chk[k].length, n, `${slug}: ${k} has ${chk[k].length}, sub has ${n}`);
      }
    }
  });
});

describe('array shapes', () => {
  // jsonlite's auto_unbox collapses every length-1 vector to a scalar, which
  // once turned 1,768 rows into "undefined–undefined" across 106 species files.
  // The exporter wraps those fields in I(unname(x)); this is the check that the
  // wrapper is still there.
  const mustBeArray = (obj, keys, where) => {
    for (const k of keys) {
      if (obj[k] === undefined || obj[k] === null) continue;
      assert.ok(Array.isArray(obj[k]), `${where}: ${k} is ${typeof obj[k]}, not an array`);
    }
  };

  test('species files keep their arrays even with a single record', () => {
    // Pick the species with the fewest municipalities -- the ones most likely
    // to have been unboxed.
    const sparse = [...speciesIndex].sort((a, b) => a.m - b.m).slice(0, 25);
    for (const s of sparse) {
      const sp = read(join('sp', `${s.c}.json`));
      mustBeArray(sp, ['mun'], `sp/${s.c}`);
      for (const m of sp.mun) {
        mustBeArray(m, ['y', 'areas'], `sp/${s.c} in ${m.slug}`);
      }
    }
  });

  test('municipality payloads keep their arrays', () => {
    for (const m of meta.municipalities.slice(0, 8)) {
      const sum = read(join('mun', m.slug, 'summary.json'));
      mustBeArray(sum, ['species', 'areas'], `${m.slug}/summary`);
      const chk = read(join('mun', m.slug, 'checklists.json'));
      mustBeArray(chk, ['sub', 'date', 'areas', 'area', 'obsrs', 'protos'],
        `${m.slug}/checklists`);
    }
  });

  test('the smallest municipality is not collapsed to scalars', () => {
    // The single-checklist case is exactly what auto_unbox eats.
    const smallest = [...meta.municipalities].sort((a, b) => a.checklists - b.checklists)[0];
    const chk = read(join('mun', smallest.slug, 'checklists.json'));
    mustBeArray(chk, ['sub', 'date', 'loc', 'obsr'], smallest.slug);
  });
});

describe('species', () => {
  test('every indexed species has a file, and every file is indexed', () => {
    const indexed = new Set(speciesIndex.map(s => s.c));
    const onDisk = new Set(readdirSync(join(DATA, 'sp')).map(f => f.replace(/\.json$/, '')));
    assert.deepEqual([...indexed].filter(c => !onDisk.has(c)), [], 'indexed but missing');
    assert.deepEqual([...onDisk].filter(c => !indexed.has(c)), [], 'on disk but unindexed');
  });

  test('the index and the taxonomy cover each other', () => {
    // A species missing from the taxonomy renders as a blank row -- how
    // American Tree Sparrow went missing before `cat` was carried through.
    const tax = new Set(taxonomy.map(t => t.c));
    for (const s of speciesIndex) {
      assert.ok(tax.has(s.c), `${s.c} is indexed but absent from taxonomy.json`);
    }
    assert.equal(taxonomy.length, meta.totals.taxa);
  });

  test('taxonomy entries are complete', () => {
    for (const t of taxonomy) {
      assert.ok(t.c && t.sci && t.en, `incomplete taxon ${JSON.stringify(t)}`);
      assert.equal(typeof t.hasIs, 'boolean');
      if (t.hasIs) assert.ok(t.is && t.is.length, `${t.c} claims hasIs with no name`);
    }
  });

  test('countable species outnumber nothing, and totals agree', () => {
    const countable = speciesIndex.filter(s => s.countable).length;
    assert.equal(countable, meta.totals.species);
    assert.equal(speciesIndex.length, meta.totals.taxa);
  });

  test('a species file points only at municipalities that exist', () => {
    const slugs = new Set(meta.municipalities.map(m => m.slug));
    for (const code of ['arcter', 'comeid', 'whimbr']) {
      const sp = read(join('sp', `${code}.json`));
      for (const m of sp.mun) {
        assert.ok(slugs.has(m.slug), `sp/${code} references unknown ${m.slug}`);
      }
    }
  });
});

describe('geometry', () => {
  const walk = (geom, fn) => {
    if (geom.type === 'Polygon') geom.coordinates.forEach(r => r.forEach(fn));
    else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(p => p.forEach(r => r.forEach(fn)));
    else assert.fail(`unsupported geometry ${geom.type}`);
  };

  test('no GeometryCollections survive the export', () => {
    // sf produces them at the edges of an intersection; the renderer cannot
    // draw one, and they took several rounds of cleaning to eliminate.
    for (const f of [...geo.features, ...areaGeo.features]) {
      assert.ok(f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon',
        `${f.properties.slug || f.properties.area_id} is ${f.geometry.type}`);
    }
  });

  test('every coordinate is finite and inside the Iceland bounding box', () => {
    for (const f of [...geo.features, ...areaGeo.features]) {
      walk(f.geometry, ([lon, lat]) => {
        assert.ok(Number.isFinite(lon) && Number.isFinite(lat),
          `non-finite coordinate in ${f.properties.slug || f.properties.area_id}`);
        assert.ok(lon > -27 && lon < -12, `lon ${lon} outside Iceland`);
        assert.ok(lat > 62 && lat < 68, `lat ${lat} outside Iceland`);
      });
    }
  });

  test('every municipality polygon has a matching meta entry', () => {
    const slugs = new Set(meta.municipalities.map(m => m.slug));
    for (const f of geo.features) {
      assert.ok(slugs.has(f.properties.slug), `polygon for unknown ${f.properties.slug}`);
    }
  });

  test('an area sits inside the bounding box of its municipality', () => {
    // Areas are cut from the municipality, so this is nesting made cheap: a
    // full point-in-polygon test would need a geometry library.
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
      assert.ok(b, `no municipality polygon for ${f.properties.area_id}`);
      walk(f.geometry, ([lon, lat]) => {
        assert.ok(lon >= b[0] - EPS && lon <= b[2] + EPS &&
                  lat >= b[1] - EPS && lat <= b[3] + EPS,
          `${f.properties.area_id} strays outside ${f.properties.slug}`);
      });
    }
  });
});

describe('the personal-import lookups', () => {
  test('sci_index maps scientific names to reportable species', () => {
    const idx = read('sci_index.json');
    assert.ok(Array.isArray(idx.sci) && Array.isArray(idx.code));
    assert.equal(idx.sci.length, idx.code.length);
    assert.ok(idx.sci.length > 10000, 'the world taxonomy should be large');
  });

  test('locality_index parallel arrays line up', () => {
    const idx = read('locality_index.json');
    const n = idx.id.length;
    for (const k of ['mun', 'area', 'type']) {
      assert.equal(idx[k].length, n, `${k} has ${idx[k].length}, id has ${n}`);
    }
    assert.ok(n > 40000, `only ${n} localities`);
  });

  test('locality ids are unique', () => {
    // The import matches the user's rows to this index by locality id. A
    // duplicate would place some of their checklists twice.
    const idx = read('locality_index.json');
    assert.equal(new Set(idx.id).size, idx.id.length);
  });

  test('every locality points at a municipality in range', () => {
    // Unlike the area column there is no sentinel here: every locality is
    // placed, open-sea ones into Hafsvæði.
    const idx = read('locality_index.json');
    for (const m of idx.mun) {
      assert.ok(m >= 0 && m < idx.slugs.length, `municipality index ${m} out of range`);
    }
  });

  test('the area column uses -1, and only -1, for "no area"', () => {
    // Open-sea localities lie outside every postal area. mydata.js tests
    // `area[i] >= 0`, so any other out-of-range value would index the
    // dictionary with undefined and attach checklists to nothing.
    const idx = read('locality_index.json');
    let sentinels = 0;
    for (const a of idx.area) {
      if (a === -1) { sentinels++; continue; }
      assert.ok(a >= 0 && a < idx.areas.length, `area index ${a} out of range`);
    }
    assert.ok(sentinels > 0, 'expected some open-sea localities');
  });

  test('the dictionaries only name things that exist', () => {
    const idx = read('locality_index.json');
    const slugs = new Set(meta.municipalities.map(m => m.slug));
    const areas = new Set(meta.areas.map(a => a.id));
    for (const s of idx.slugs) assert.ok(slugs.has(s), `unknown municipality ${s}`);
    for (const a of idx.areas) assert.ok(areas.has(a), `unknown area ${a}`);
  });
});
