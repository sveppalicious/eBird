// personal.js -- a user's own eBird export, as data the rest of the site can
// read exactly like everyone's.
//
// The export is reduced to a compact table of *observations*, not to totals.
// Everything else -- a region's species list, its cube, its checklists, the
// firsts -- is derived from that table in the same shapes the published files
// have. That is the whole trick: the pages do not know whose data they show.
//
// PRIVACY: this module is pure computation. It is handed text and lookup
// tables and returns objects; it does no I/O at all. Storage lives in
// data/mine.js, and nothing anywhere sends the table off the device.

import { parseCSV } from './csv.js';
import { isoToDay } from './format.js';
import { COUNTRY } from './regions.js';

const TABLE_VERSION = 1;

const REQUIRED = [
  'Submission ID', 'Scientific Name', 'Count', 'State/Province',
  'Location ID', 'Location', 'Latitude', 'Longitude', 'Date'
];
// Present in every export seen so far, but not worth refusing a file over.
const OPTIONAL = ['Time', 'Protocol', 'Duration (Min)', 'All Obs Reported',
                  'Distance Traveled (km)', 'Number of Observers'];

// ---- geometry: placing a locality the shipped index does not know -----------

function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}

// Ray casting. Holes work out because a point inside an even number of rings of
// the same feature ends up with an even crossing count.
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) &&
        lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonIndex(geo, key) {
  return geo.features.map(f => {
    const rings = ringsOf(f.geometry);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const [x, y] of r) {
      if (x < a) a = x; if (x > c) c = x;
      if (y < b) b = y; if (y > d) d = y;
    }
    return { props: f.properties, id: f.properties[key], rings, bbox: [a, b, c, d] };
  });
}

function locate(lon, lat, polys) {
  for (const p of polys) {
    const [a, b, c, d] = p.bbox;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    let hits = 0;
    for (const ring of p.rings) if (inRing(lon, lat, ring)) hits++;
    if (hits % 2 === 1) return p;
  }
  return null;
}

// eBird writes "X" for present-but-not-counted; it must not become 0.
function parseCount(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

const numOrNull = raw => {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
};

// ---- the import --------------------------------------------------------------

/**
 * Parse an export into the observation table.
 *
 * `lookups` is everything that has to come from the published data:
 *   sciIndex   scientific name -> reportable species code and its category
 *   locIndex   locality id -> sveitarfelag, area and hotspot flag
 *   geo        sveitarfelag polygons, for localities the index does not have
 *   areaGeo    area polygons, likewise
 *   known      Set of codes present in this EBD release
 *
 * Throws an Error whose `code` names what was wrong, so the page can say it in
 * the reader's language rather than this module's.
 */
function importExport(text, lookups, today = new Date().toISOString().slice(0, 10)) {
  const rows = parseCSV(text);
  if (!rows.length) throw Object.assign(new Error('empty file'), { code: 'empty' });

  const header = rows[0].map(h => h.trim());
  const col = {};
  for (const name of REQUIRED) {
    const i = header.indexOf(name);
    if (i < 0) {
      throw Object.assign(new Error(`missing column ${name}`), { code: 'column', column: name });
    }
    col[name] = i;
  }
  for (const name of OPTIONAL) col[name] = header.indexOf(name);

  // eBird drops trailing empty fields rather than padding to the header width:
  // a real export had rows of 16, 19, 20, 21, 22 and 23 fields against a
  // 23-column header. Requiring full-width rows silently discarded 98% of them.
  const needed = Math.max(...REQUIRED.map(n => col[n]));
  const opt = (row, name) => (col[name] >= 0 && col[name] < row.length ? row[col[name]] : '');

  const { sciIndex, locIndex, geo, areaGeo, known } = lookups;
  // Resolve to the reportable taxon and carry its category, so counting does
  // not depend on the taxon being present in the Iceland dataset.
  const sciToCode = new Map();
  for (let i = 0; i < sciIndex.sci.length; i++) {
    sciToCode.set(sciIndex.sci[i], { code: sciIndex.code[i], cat: sciIndex.cat[i] });
  }
  const indexed = new Map();
  for (let i = 0; i < locIndex.id.length; i++) {
    indexed.set(locIndex.id[i], {
      mun: locIndex.slugs[locIndex.mun[i]],
      // -1 marks a locality outside every area (open sea).
      area: locIndex.area[i] >= 0 ? locIndex.areas[locIndex.area[i]] : null,
      type: locIndex.type[i]
    });
  }
  let munPolys = null, areaPolys = null;      // built lazily; most files never need them

  const sp = [], spX = [], spIx = new Map();
  const locs = [], locIx = new Map();
  const cl = { sub: [], d: [], time: [], loc: [], proto: [], dur: [], dist: [], nobs: [], comp: [] };
  const clIx = new Map();
  const cells = new Map();                    // "k|si" -> count, merging sub-taxa
  const unplaced = new Map();
  const unknownTaxa = new Set();
  // Species they have seen that this EBD release does not contain -- pending
  // rarities, or records made after the cut-off. Worth surfacing, not hiding.
  const notInDataset = new Map();
  const stats = { rowsTotal: rows.length - 1, rowsIceland: 0, byPolygon: 0 };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length <= needed) continue;
    if (!row[col['State/Province']].startsWith('IS-')) continue;   // other countries
    stats.rowsIceland++;

    // --- where ---
    const locId = row[col['Location ID']];
    let li = locIx.get(locId);
    if (li === undefined) {
      const y = parseFloat(row[col.Latitude]), x = parseFloat(row[col.Longitude]);
      let place = indexed.get(locId);
      if (!place && Number.isFinite(x) && Number.isFinite(y)) {
        // Not in the index: typically a locality newer than the EBD release.
        // Try the areas first, since an area names its sveitarfelag too.
        if (!areaPolys) areaPolys = polygonIndex(areaGeo, 'area_id');
        const a = locate(x, y, areaPolys);
        if (a) place = { mun: a.props.slug, area: a.id, type: 'P' };
        else {
          if (!munPolys) munPolys = polygonIndex(geo, 'slug');
          const m = locate(x, y, munPolys);
          if (m) place = { mun: m.id, area: null, type: 'P' };
        }
        if (place) stats.byPolygon++;
      }
      if (!place) {
        const nm = row[col.Location] || locId;
        unplaced.set(nm, (unplaced.get(nm) || 0) + 1);
        locIx.set(locId, -1);
        continue;
      }
      li = locs.length;
      locs.push({ id: locId, n: row[col.Location], t: place.type || 'P',
                  y: Number.isFinite(y) ? +y.toFixed(5) : null,
                  x: Number.isFinite(x) ? +x.toFixed(5) : null,
                  mun: place.mun, area: place.area });
      locIx.set(locId, li);
    } else if (li < 0) {
      const nm = row[col.Location] || locId;
      unplaced.set(nm, (unplaced.get(nm) || 0) + 1);
      continue;
    }

    // --- what ---
    // The personal export names the sub-taxon; roll it up the way eBird does.
    const sci = row[col['Scientific Name']];
    const hit = sciToCode.get(sci);
    if (!hit) { unknownTaxa.add(sci); continue; }
    let si = spIx.get(hit.code);
    if (si === undefined) {
      si = sp.length;
      sp.push(hit.code);
      // Count as a species on the taxonomy's say-so, not on whether this
      // dataset happens to contain it: spuh/slash/hybrid never count, a real
      // species always does, even if it is too new or too rare to be in the EBD.
      spX.push(hit.cat === 'species' ? 1 : 0);
      spIx.set(hit.code, si);
      if (hit.cat === 'species' && known && !known.has(hit.code)) {
        notInDataset.set(hit.code, sci);
      }
    }

    // --- when, and on which checklist ---
    const sub = row[col['Submission ID']];
    let k = clIx.get(sub);
    if (k === undefined) {
      k = cl.sub.length;
      clIx.set(sub, k);
      cl.sub.push(sub);
      cl.d.push(isoToDay(row[col.Date]));
      cl.time.push(opt(row, 'Time') || null);
      cl.loc.push(li);
      cl.proto.push(opt(row, 'Protocol') || null);
      cl.dur.push(numOrNull(opt(row, 'Duration (Min)')));
      cl.dist.push(numOrNull(opt(row, 'Distance Traveled (km)')));
      cl.nobs.push(numOrNull(opt(row, 'Number of Observers')));
      // Absent column -> treated as incomplete, which only ever understates a
      // frequency rather than inventing one.
      cl.comp.push(opt(row, 'All Obs Reported') === '1' ? 1 : 0);
    }

    // Two sub-taxa of one species on one checklist are one record of it. Counts
    // add; an "X" beside a number leaves the number.
    const key = k * 100000 + si;
    const count = parseCount(row[col.Count]);
    if (cells.has(key)) {
      const prev = cells.get(key);
      cells.set(key, prev === null ? count : (count === null ? prev : prev + count));
    } else cells.set(key, count);
  }

  if (!stats.rowsIceland) throw Object.assign(new Error('no Icelandic rows'), { code: 'no-iceland' });

  // Observations sorted by checklist, so a checklist's rows are one slice.
  const keys = [...cells.keys()].sort((a, b) => a - b);
  const ob = { k: [], si: [], n: [] };
  for (const key of keys) {
    ob.k.push(Math.floor(key / 100000));
    ob.si.push(key % 100000);
    ob.n.push(cells.get(key));
  }

  return {
    version: TABLE_VERSION,
    imported: today,
    sp, spX, locs, cl, ob,
    stats: { ...stats, checklists: cl.sub.length, observations: ob.k.length },
    warnings: {
      unplaced: [...unplaced.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
      unplacedTotal: [...unplaced.values()].reduce((a, b) => a + b, 0),
      unknownTaxa: [...unknownTaxa].sort(),
      notInDataset: [...notInDataset.entries()].map(([code, sci]) => ({ code, sci }))
        .sort((a, b) => a.sci.localeCompare(b.sci))
    }
  };
}

// ---- derived views -----------------------------------------------------------

const derived = new WeakMap();

// Which checklists fall in which region, and where each checklist's rows are.
// A checklist belongs to up to three regions at once: the country, its
// sveitarfelag and its area.
function prep(table) {
  let p = derived.get(table);
  if (p) return p;
  const byRegion = new Map();
  const push = (id, k) => {
    if (!id) return;
    let a = byRegion.get(id);
    if (!a) byRegion.set(id, a = []);
    a.push(k);
  };
  for (let k = 0; k < table.cl.sub.length; k++) {
    const loc = table.locs[table.cl.loc[k]];
    push(COUNTRY, k); push(loc.mun, k); push(loc.area, k);
  }
  const start = new Array(table.cl.sub.length + 1).fill(0);
  for (let i = 0; i < table.ob.k.length; i++) start[table.ob.k[i] + 1]++;
  for (let k = 0; k < table.cl.sub.length; k++) start[k + 1] += start[k];
  p = { byRegion, start, cache: new Map() };
  derived.set(table, p);
  return p;
}

const regionsOf = (table, k) => {
  const loc = table.locs[table.cl.loc[k]];
  return [COUNTRY, loc.mun, loc.area];
};

// One record, in the shape summary.json uses. `b` (the observer) is null: on
// your own data that is you, and the page says so in its own words.
function record(table, k, n) {
  const loc = table.locs[table.cl.loc[k]];
  return { d: table.cl.d[k], s: table.cl.sub[k], b: null,
           l: loc.id, ln: loc.n, lt: loc.t, n };
}

// Fold a set of observations into one row per species. Shared by a region's
// summary and by a species' breakdown across regions.
function foldSpecies(table, forEach) {
  const rows = new Map();
  forEach((k, si, n) => {
    const d = table.cl.d[k];
    let r = rows.get(si);
    if (!r) {
      r = { c: table.sp[si], k: 0, kc: 0, x: table.spX[si],
            fk: k, fn: n, lk: k, ln: n, hk: k, hn: n };
      rows.set(si, r);
    }
    r.k++;
    if (table.cl.comp[k]) r.kc++;
    if (d < table.cl.d[r.fk]) { r.fk = k; r.fn = n; }
    if (d >= table.cl.d[r.lk]) { r.lk = k; r.ln = n; }
    if (n !== null && (r.hn === null || n > r.hn)) { r.hk = k; r.hn = n; }
  });
  return [...rows.values()].map(r => ({
    c: r.c, k: r.k, kc: r.kc, x: r.x,
    first: record(table, r.fk, r.fn),
    last: record(table, r.lk, r.ln),
    high: record(table, r.hk, r.hn)
  }));
}

function eachObs(table, checklists, fn) {
  const { start } = prep(table);
  for (const k of checklists) {
    for (let i = start[k]; i < start[k + 1]; i++) fn(k, table.ob.si[i], table.ob.n[i]);
  }
}

// summary.json for one region, from your data.
function summaryFor(table, id) {
  const p = prep(table);
  const key = 'summary|' + id;
  if (p.cache.has(key)) return p.cache.get(key);
  const cls = p.byRegion.get(id) || [];
  const species = foldSpecies(table, fn => eachObs(table, cls, fn));
  let complete = 0, observations = 0, first = null, last = null;
  const localities = new Set();
  for (const k of cls) {
    if (table.cl.comp[k]) complete++;
    observations += p.start[k + 1] - p.start[k];
    localities.add(table.cl.loc[k]);
    const d = table.cl.d[k];
    if (first === null || d < first) first = d;
    if (last === null || d > last) last = d;
  }
  const out = {
    id,
    stats: {
      species: species.filter(s => s.x).length, taxa: species.length,
      checklists: cls.length, complete, observations, observers: cls.length ? 1 : 0,
      localities: localities.size, firstDate: first, lastDate: last
    },
    species
  };
  p.cache.set(key, out);
  return out;
}

// cube.json for one region, from your data. Same columns, same order.
function cubeFor(table, id) {
  const p = prep(table);
  const key = 'cube|' + id;
  if (p.cache.has(key)) return p.cache.get(key);
  const cls = p.byRegion.get(id) || [];

  const year = k => new Date(table.cl.d[k] * 86400000).getUTCFullYear();
  const month = k => new Date(table.cl.d[k] * 86400000).getUTCMonth() + 1;

  const local = new Map();                 // table species index -> cube index
  const sp = [];
  const cells = new Map(), years = new Map(), effort = new Map();
  for (const k of cls) {
    const y = year(k), m = month(k), comp = table.cl.comp[k];
    const e = effort.get(y * 12 + m) || [y, m, 0, 0];
    e[2]++; e[3] += comp;
    effort.set(y * 12 + m, e);
  }
  eachObs(table, cls, (k, tsi) => {
    let si = local.get(tsi);
    if (si === undefined) { si = sp.length; sp.push(table.sp[tsi]); local.set(tsi, si); }
    const y = year(k), m = month(k), d = table.cl.d[k];
    const ck = si * 100000 + y * 12 + m;
    const c = cells.get(ck) || [si, y, m, 0, 0];
    c[3]++; c[4] += table.cl.comp[k];
    cells.set(ck, c);
    const yk = si * 10000 + y;
    const yr = years.get(yk);
    if (!yr) years.set(yk, [si, y, d, d]);
    else { if (d < yr[2]) yr[2] = d; if (d > yr[3]) yr[3] = d; }
  });

  const cc = [...cells.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const yy = [...years.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const ee = [...effort.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = {
    id, sp,
    si: cc.map(c => c[0]), y: cc.map(c => c[1]), m: cc.map(c => c[2]),
    n: cc.map(c => c[3]), c: cc.map(c => c[4]),
    ysi: yy.map(c => c[0]), yy: yy.map(c => c[1]), yf: yy.map(c => c[2]), yl: yy.map(c => c[3]),
    ey: ee.map(c => c[0]), em: ee.map(c => c[1]), en: ee.map(c => c[2]), ec: ee.map(c => c[3])
  };
  p.cache.set(key, out);
  return out;
}

// Your checklists in a region, newest first.
function checklistsFor(table, id) {
  const p = prep(table);
  const cls = (p.byRegion.get(id) || []).slice()
    .sort((a, b) => table.cl.d[b] - table.cl.d[a] || (table.cl.time[b] || '').localeCompare(table.cl.time[a] || ''));
  return cls.map(k => {
    const loc = table.locs[table.cl.loc[k]];
    return {
      sub: table.cl.sub[k], d: table.cl.d[k], time: table.cl.time[k],
      loc: { id: loc.id, name: loc.n, type: loc.t }, obsr: null,
      proto: table.cl.proto[k], dur: table.cl.dur[k], dist: table.cl.dist[k],
      nsp: p.start[k + 1] - p.start[k], comp: table.cl.comp[k], reg: loc.mun
    };
  });
}

// Every record of one species in one region, newest first.
function recordsFor(table, code, id) {
  const p = prep(table);
  const tsi = table.sp.indexOf(code);
  if (tsi < 0) return [];
  const out = [];
  eachObs(table, p.byRegion.get(id) || [], (k, si, n) => {
    if (si !== tsi) return;
    const loc = table.locs[table.cl.loc[k]];
    out.push({ d: table.cl.d[k], s: table.cl.sub[k], time: table.cl.time[k], b: null,
               l: loc.id, ln: loc.n, lt: loc.t, n, r: loc.mun });
  });
  return out.sort((a, b) => b.d - a.d);
}

// One species across every region you have it in: the mirror of summaryFor.
function speciesAcross(table, code) {
  const p = prep(table);
  const tsi = table.sp.indexOf(code);
  if (tsi < 0) return { c: code, regions: [] };
  const per = new Map();                   // region id -> checklists with it
  for (let i = 0; i < table.ob.k.length; i++) {
    if (table.ob.si[i] !== tsi) continue;
    for (const id of regionsOf(table, table.ob.k[i])) {
      if (!id) continue;
      if (!per.has(id)) per.set(id, []);
      per.get(id).push(i);
    }
  }
  const regions = [...per.entries()].map(([id, ix]) => {
    const [row] = foldSpecies(table, fn => { for (const i of ix) fn(table.ob.k[i], tsi, table.ob.n[i]); });
    return { id, k: row.k, kc: row.kc, first: row.first, last: row.last, high: row.high };
  });
  regions.sort((a, b) => (a.id !== COUNTRY) - (b.id !== COUNTRY) || b.k - a.k);
  return { c: code, regions };
}

// Headline numbers for every region at once, for the tree and the map.
function regionStats(table) {
  const p = prep(table);
  const key = 'stats';
  if (p.cache.has(key)) return p.cache.get(key);
  const out = new Map();
  for (const [id, cls] of p.byRegion) {
    const species = new Set(), taxa = new Set();
    let complete = 0, observations = 0;
    for (const k of cls) {
      if (table.cl.comp[k]) complete++;
      for (let i = p.start[k]; i < p.start[k + 1]; i++) {
        observations++;
        taxa.add(table.ob.si[i]);
        if (table.spX[table.ob.si[i]]) species.add(table.ob.si[i]);
      }
    }
    out.set(id, { species: species.size, taxa: taxa.size, checklists: cls.length,
                  complete, observations, observers: 1 });
  }
  p.cache.set(key, out);
  return out;
}

// Your localities with how much you have done at each, for the map.
function localities(table) {
  const p = prep(table);
  const key = 'locs';
  if (p.cache.has(key)) return p.cache.get(key);
  const k = new Array(table.locs.length).fill(0);
  const s = table.locs.map(() => new Set());
  for (let c = 0; c < table.cl.sub.length; c++) {
    const li = table.cl.loc[c];
    k[li]++;
    for (let i = p.start[c]; i < p.start[c + 1]; i++) {
      if (table.spX[table.ob.si[i]]) s[li].add(table.ob.si[i]);
    }
  }
  const out = table.locs
    .map((l, i) => ({ id: l.id, n: l.n, t: l.t, y: l.y, x: l.x, mun: l.mun, area: l.area,
                      k: k[i], s: s[i].size }))
    .filter(l => l.y !== null && l.x !== null)
    // Busiest first, so the map draws the small dots last, on top.
    .sort((a, b) => b.k - a.k);
  p.cache.set(key, out);
  return out;
}

// ---- firsts: when a species was new somewhere --------------------------------

// Your first day for every (region, species) pair. A "tick" is one such pair --
// the unit a regional life list is counted in.
function firstDays(table) {
  const p = prep(table);
  const key = 'firstDays';
  if (p.cache.has(key)) return p.cache.get(key);
  const out = new Map();                   // "regionId|code" -> day
  for (let i = 0; i < table.ob.k.length; i++) {
    const k = table.ob.k[i], d = table.cl.d[k], code = table.sp[table.ob.si[i]];
    for (const id of regionsOf(table, k)) {
      if (!id) continue;
      const key2 = id + '|' + code;
      const at = out.get(key2);
      if (at === undefined || d < at) out.set(key2, d);
    }
  }
  p.cache.set(key, out);
  return out;
}

/**
 * Every time a species was new for a region, newest first.
 *
 * One row per event rather than per tick: a bird that is new for a hverfi on
 * the same day it is new for the sveitarfelag around it is one thing that
 * happened, and listing it twice would make a first visit somewhere read as a
 * flurry of activity. Rows key on (species, day, sveitarfelag).
 *
 * `scope` narrows it to one region: a sveitarfelag keeps its own rows, an area
 * keeps the rows where it was the area that was new.
 */
function firsts(table, scope = COUNTRY, tree = null) {
  const days = firstDays(table);
  const countable = new Set(table.sp.filter((_, i) => table.spX[i]));
  const rows = new Map();
  const row = (code, day, mun) => {
    const key = `${code}|${day}|${mun}`;
    let r = rows.get(key);
    if (!r) rows.set(key, r = { code, day, mun, areas: [], newMun: false, lifer: false,
                                countable: countable.has(code) });
    return r;
  };
  // An area's sveitarfelag comes from the observations themselves: every
  // locality records both, so nothing has to be parsed back out of an id.
  const areaMun = new Map();
  for (const l of table.locs) if (l.area) areaMun.set(l.area, l.mun);

  for (const [key, day] of days) {
    const cut = key.lastIndexOf('|');
    const id = key.slice(0, cut), code = key.slice(cut + 1);
    if (id === COUNTRY) continue;
    if (areaMun.has(id)) row(code, day, areaMun.get(id)).areas.push(id);
    else row(code, day, id).newMun = true;
  }

  let out = [...rows.values()].sort((a, b) =>
    b.day - a.day || a.code.localeCompare(b.code) || a.mun.localeCompare(b.mun));

  // The lifer badge goes on exactly one row per species, and only on species.
  // A day spent driving can put a bird's national first date on several
  // municipalities at once, and "first in Iceland" three times over for one
  // bird is a claim nobody made. Nor is "gull sp." something you add to a list.
  const claimed = new Set();
  for (const r of out) {
    if (r.countable && days.get(COUNTRY + '|' + r.code) === r.day && !claimed.has(r.code)) {
      r.lifer = true;
      claimed.add(r.code);
    }
  }

  if (scope && scope !== COUNTRY) {
    const isArea = areaMun.has(scope) || (tree && tree.get(scope) && tree.get(scope).parent !== COUNTRY);
    out = isArea ? out.filter(r => r.areas.includes(scope))
                 : out.filter(r => r.mun === scope);
  }
  return out;
}

/**
 * What a new import added over the one it replaces.
 *
 * Set difference, deliberately, not "records dated since last time": exports
 * are frequently backfilled -- an old notebook typed up, or a shared checklist
 * accepted months later -- and those are new to your list even though the
 * sighting is not new. Returns null when there is nothing to compare against,
 * since "everything is new" is not news.
 */
function diffTables(prev, next) {
  if (!prev) return null;
  const before = firstDays(prev);
  const added = [], lifers = [];
  for (const [key, day] of firstDays(next)) {
    if (before.has(key)) continue;
    const cut = key.lastIndexOf('|');
    const id = key.slice(0, cut), code = key.slice(cut + 1);
    if (id === COUNTRY) {
      // Only species go on a life list.
      if (next.spX[next.sp.indexOf(code)]) lifers.push(code);
    } else added.push({ id, code, day });
  }
  added.sort((a, b) => b.day - a.day || a.code.localeCompare(b.code));
  return { at: next.imported, prevAt: prev.imported || null, added, lifers: lifers.sort() };
}

export {
  TABLE_VERSION, importExport, summaryFor, cubeFor, checklistsFor, recordsFor,
  speciesAcross, regionStats, localities, firstDays, firsts, diffTables
};
