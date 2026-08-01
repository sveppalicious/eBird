// mydata.js -- read a user's own "Download my data" export from eBird and
// place it in Icelandic municipalities.
//
// PRIVACY: everything here runs in the browser. The file is read with the
// FileReader API, parsed in memory, and (only if the user asks) cached in this
// browser's localStorage. It is never sent anywhere -- the site has no backend
// to send it to. That is not incidental: this file is a complete history of
// where somebody has been and when.

import { loadGeo, loadTaxonomy } from './data.js';

const STORAGE_KEY = 'myEbirdData.v1';

// Bump whenever the saved shape changes. Anything older is discarded rather
// than half-read, so a stale import cannot render as blanks or undefined.
const SCHEMA_VERSION = 8;

// ---- CSV ---------------------------------------------------------------------

// eBird's export quotes any field containing a comma, a quote or a newline --
// Observation Details and Checklist Comments routinely do, and a real export
// had 3,236 quote characters. Splitting on commas mangles those rows, so this
// is a proper RFC4180 reader: "" is an escaped quote, and newlines inside
// quotes do not end the record.
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);   // strip BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---- geometry ----------------------------------------------------------------

function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(ringsOf);
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

function buildPolygonIndex(geo) {
  return geo.features.map(f => {
    const rings = ringsOf(f.geometry);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of rings) for (const [x, y] of r) {
      if (x < a) a = x; if (x > c) c = x;
      if (y < b) b = y; if (y > d) d = y;
    }
    return { slug: f.properties.slug, rings, bbox: [a, b, c, d] };
  });
}

// Only used for localities absent from the shipped index -- typically records
// newer than the EBD release. The bbox test keeps this cheap.
function locateByPolygon(lon, lat, polys) {
  for (const p of polys) {
    const [a, b, c, d] = p.bbox;
    if (lon < a || lon > c || lat < b || lat > d) continue;
    let hits = 0;
    for (const ring of p.rings) if (inRing(lon, lat, ring)) hits++;
    if (hits % 2 === 1) return p.slug;
  }
  return null;
}

// ---- the import --------------------------------------------------------------

const COLUMNS = [
  'Submission ID', 'Scientific Name', 'Count', 'State/Province',
  'Location ID', 'Location', 'Latitude', 'Longitude', 'Date'
];

// eBird writes "X" for present-but-not-counted; it must not become 0.
function parseCount(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an eBird personal export and reduce it to per-municipality species.
 * Returns a summary object small enough to keep in localStorage; the raw rows
 * are dropped once aggregated.
 */
async function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) throw new Error('That file is empty.');

  const header = rows[0].map(h => h.trim());
  const col = {};
  for (const name of COLUMNS) {
    const i = header.indexOf(name);
    if (i < 0) {
      throw new Error(
        `This does not look like an eBird export — the column "${name}" is ` +
        `missing. Use the CSV from ebird.org → My eBird → Download my data.`);
    }
    col[name] = i;
  }

  // eBird drops trailing empty fields rather than padding to the header width:
  // a real export had rows of 16, 19, 20, 21, 22 and 23 fields against a
  // 23-column header. Requiring full-width rows silently discarded 98% of them.
  // Every column read here sits at index 11 or lower, so short rows are fine.
  const needed = Math.max(...Object.values(col));

  const [geo, tax, sciIndex, locIndex] = await Promise.all([
    loadGeo(), loadTaxonomy(),
    fetch('data/sci_index.json').then(r => r.json()),
    fetch('data/locality_index.json').then(r => r.json())
  ]);

  // Resolve to the reportable taxon and carry its category, so counting does
  // not depend on the taxon being present in the Iceland dataset.
  const sciToCode = new Map();
  for (let i = 0; i < sciIndex.sci.length; i++) {
    sciToCode.set(sciIndex.sci[i], { code: sciIndex.code[i], cat: sciIndex.cat[i] });
  }
  const locToMun = new Map();
  const locToType = new Map();
  const locToArea = new Map();
  for (let i = 0; i < locIndex.id.length; i++) {
    locToMun.set(locIndex.id[i], locIndex.slugs[locIndex.mun[i]]);
    if (locIndex.type) locToType.set(locIndex.id[i], locIndex.type[i]);
    if (locIndex.area && locIndex.area[i] >= 0) {
      locToArea.set(locIndex.id[i], locIndex.areas[locIndex.area[i]]);
    }
  }

  let polys = null;   // built lazily; most files never need it

  const mun = new Map();          // slug -> { species:Set, checklists:Map, first, last }
  const areas = new Map();        // area_id -> { species:Set, checklists:Set }
  // Your localities, kept with their coordinates so they can be drawn on the
  // maps: the choropleth says which sveitarfelag you birded, this says where.
  const locs = new Map();         // locality id -> { name, type, lat, lon, ... }
  const unplacedLocs = new Map(); // locality name -> count
  const unknownTaxa = new Set();
  // Species they have seen that this EBD release does not contain -- pending
  // rarities, or records made after the cut-off. Worth surfacing, not hiding.
  // Keyed by code but carrying the scientific name, because the site's taxonomy
  // covers only taxa recorded in Iceland and so cannot name these.
  const notInDataset = new Map();
  const stats = {
    rowsTotal: rows.length - 1, rowsIceland: 0, checklists: new Set(),
    species: new Set(), byPolygon: 0, firstDate: null, lastDate: null
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length <= needed) continue;

    const region = row[col['State/Province']];
    if (!region.startsWith('IS-')) continue;      // other countries: ignored
    stats.rowsIceland++;

    const locId = row[col['Location ID']];
    let slug = locToMun.get(locId);
    if (!slug) {
      const lon = parseFloat(row[col.Longitude]);
      const lat = parseFloat(row[col.Latitude]);
      if (Number.isFinite(lon) && Number.isFinite(lat)) {
        if (!polys) polys = buildPolygonIndex(geo);
        slug = locateByPolygon(lon, lat, polys);
        if (slug) stats.byPolygon++;
      }
    }
    if (!slug) {
      const nm = row[col.Location] || locId;
      unplacedLocs.set(nm, (unplacedLocs.get(nm) || 0) + 1);
      continue;
    }

    // The personal export names the sub-taxon; roll it up the way eBird does.
    const sci = row[col['Scientific Name']];
    const hit = sciToCode.get(sci);
    if (!hit) { unknownTaxa.add(sci); continue; }
    const { code, cat } = hit;
    // Count as a species on the taxonomy's say-so, not on whether this dataset
    // happens to contain it: spuh/slash/hybrid never count, a real species
    // always does, even if it is too new or too rare to be in the EBD yet.
    const isSpecies = cat === 'species';
    if (isSpecies && !tax.has(code)) notInDataset.set(code, sci);

    const sub = row[col['Submission ID']];
    const date = row[col.Date];

    const locName = row[col.Location];
    const locType = locToType.get(locId) || 'P';   // unknown -> no hotspot link
    const count = parseCount(row[col.Count]);

    let L = locs.get(locId);
    if (!L) {
      L = { id: locId, n: locName, t: locType,
            y: parseFloat(row[col.Latitude]), x: parseFloat(row[col.Longitude]),
            slug, k: new Set(), s: new Set() };
      locs.set(locId, L);
    }
    L.k.add(sub);
    if (isSpecies) L.s.add(code);

    let m = mun.get(slug);
    if (!m) {
      m = { species: new Set(), checklists: new Map(), first: date, last: date,
            sp: new Map() };
      mun.set(slug, m);
    }
    if (isSpecies) m.species.add(code);
    if (date < m.first) m.first = date;
    if (date > m.last) m.last = date;

    // Keep enough of your own record to show it in the bird list instead of a
    // stranger's: the most recent sighting, plus your highest count.
    let sp = m.sp.get(code);
    if (!sp) {
      // `d` is your latest sighting, `f` your first: the first is what a life
      // list numbers species by, and both are needed to sort by your own dates
      // rather than by when anyone else last saw the bird.
      sp = { d: date, f: date, n: count, s: sub, l: locId, ln: locName,
             lt: locType, hi: count, k: 0 };
      m.sp.set(code, sp);
    } else {
      if (date >= sp.d) {
        sp.d = date; sp.n = count; sp.s = sub;
        sp.l = locId; sp.ln = locName; sp.lt = locType;
      }
      if (date < sp.f) sp.f = date;
    }
    if (count !== null && (sp.hi === null || count > sp.hi)) sp.hi = count;
    sp.k++;

    // Same, one level down. The per-species record is kept here too, not just
    // per municipality: on a neighbourhood page "your record" has to be your
    // record *there*, otherwise a Midborg row shows the Grafarvogur sighting
    // that happened to be your most recent one in the city.
    const areaId = locToArea.get(locId);
    if (areaId) {
      let a = areas.get(areaId);
      if (!a) {
        a = { species: new Set(), checklists: new Set(), sp: new Map(),
              first: date, last: date };
        areas.set(areaId, a);
      }
      if (isSpecies) a.species.add(code);
      a.checklists.add(sub);
      if (date < a.first) a.first = date;
      if (date > a.last) a.last = date;

      let asp = a.sp.get(code);
      if (!asp) {
        asp = { d: date, f: date, n: count, s: sub, l: locId, ln: locName,
                lt: locType, hi: count, k: 0 };
        a.sp.set(code, asp);
      } else {
        if (date >= asp.d) {
          asp.d = date; asp.n = count; asp.s = sub;
          asp.l = locId; asp.ln = locName; asp.lt = locType;
        }
        if (date < asp.f) asp.f = date;
      }
      if (count !== null && (asp.hi === null || count > asp.hi)) asp.hi = count;
      asp.k++;
    }

    // Your checklists here, with how many taxa you logged on each.
    let cl = m.checklists.get(sub);
    if (!cl) {
      cl = { s: sub, d: date, l: locId, ln: locName, lt: locType, n: 0 };
      m.checklists.set(sub, cl);
    }
    cl.n++;

    stats.checklists.add(sub);
    if (isSpecies) stats.species.add(code);
    if (!stats.firstDate || date < stats.firstDate) stats.firstDate = date;
    if (!stats.lastDate || date > stats.lastDate) stats.lastDate = date;
  }

  if (!stats.rowsIceland) {
    throw new Error(
      'No Icelandic records in that file. This site only covers Iceland, and ' +
      'rows are matched on a State/Province of IS-1 … IS-8.');
  }

  const municipalities = {};
  for (const [slug, m] of mun) {
    const cl = [...m.checklists.values()].sort((a, b) => b.d.localeCompare(a.d));
    municipalities[slug] = {
      species: [...m.species].sort(),
      checklists: cl.length,
      first: m.first,
      last: m.last,
      sp: Object.fromEntries(m.sp),   // code -> your record here
      cl                              // your checklists here, newest first
    };
  }

  return {
    version: SCHEMA_VERSION,
    imported: new Date().toISOString().slice(0, 10),
    stats: {
      rowsTotal: stats.rowsTotal,
      rowsIceland: stats.rowsIceland,
      checklists: stats.checklists.size,
      species: stats.species.size,
      municipalities: mun.size,
      placedByPolygon: stats.byPolygon,
      firstDate: stats.firstDate,
      lastDate: stats.lastDate
    },
    allSpecies: [...stats.species].sort(),
    // Sorted busiest first so the map draws the small dots last, on top.
    locs: [...locs.values()]
      .filter(L => Number.isFinite(L.y) && Number.isFinite(L.x))
      .map(L => ({ id: L.id, n: L.n, t: L.t, y: +L.y.toFixed(5), x: +L.x.toFixed(5),
                   slug: L.slug, k: L.k.size, s: L.s.size }))
      .sort((a, b) => b.k - a.k),
    municipalities,
    areas: Object.fromEntries([...areas].map(([id, a]) =>
      [id, { species: [...a.species].sort(), checklists: a.checklists.size,
             first: a.first, last: a.last, sp: Object.fromEntries(a.sp) }])),
    warnings: {
      unplaced: [...unplacedLocs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
      unplacedTotal: [...unplacedLocs.values()].reduce((a, b) => a + b, 0),
      unknownTaxa: [...unknownTaxa].sort(),
      notInDataset: [...notInDataset.entries()]
        .map(([code, sci]) => ({ code, sci }))
        .sort((a, b) => a.sci.localeCompare(b.sci))
    }
  };
}

// ---- persistence -------------------------------------------------------------

let cached = null;

function getMyData() {
  if (cached !== null) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : undefined;
    // An import saved by an older build may not have the fields this one reads.
    // Drop it and ask for the file again; there is no user data to lose, since
    // the CSV they imported from is still on their machine.
    if (parsed && parsed.version !== SCHEMA_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      cached = undefined;
    } else {
      cached = parsed;
    }
  } catch { cached = undefined; }
  return cached;
}

function saveMyData(data) {
  cached = data;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    // Quota, or storage disabled. The data still works for this session.
    return false;
  }
}

function clearMyData() {
  cached = undefined;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to do */ }
}

function hasMyData() {
  return !!getMyData();
}

// Species this user has seen in one municipality, as a Set.
function mySpeciesIn(slug) {
  const d = getMyData();
  if (!d || !d.municipalities[slug]) return null;
  return new Set(d.municipalities[slug].species);
}

// Your own most recent record of each species in one municipality, keyed by
// species code: { d, n, s, l, ln, lt, hi, k }.
function myRecordsIn(slug) {
  const d = getMyData();
  return (d && d.municipalities[slug] && d.municipalities[slug].sp) || null;
}

// Your checklists in one municipality, newest first.
function myChecklistsIn(slug) {
  const d = getMyData();
  return (d && d.municipalities[slug] && d.municipalities[slug].cl) || null;
}

// The same two, one level down, for a postal area.
function mySpeciesInArea(areaId) {
  const d = getMyData();
  if (!d || !d.areas || !d.areas[areaId]) return null;
  return new Set(d.areas[areaId].species);
}

// Your own record of each species *in that area*.
function myRecordsInArea(areaId) {
  const d = getMyData();
  return (d && d.areas && d.areas[areaId] && d.areas[areaId].sp) || null;
}

function myChecklistCountInArea(areaId) {
  const d = getMyData();
  return (d && d.areas && d.areas[areaId] && d.areas[areaId].checklists) || 0;
}

// Your localities, for drawing on a map. Every one of them: the callers zoom by
// moving the viewBox, so a map framed on one sveitarfelag still wants its
// neighbours' dots. Each carries `slug`, if anything ever does need to filter.
function myLocalities() {
  const d = getMyData();
  return (d && d.locs) || null;
}

// Your species counts for every area, for colouring an area map by your data.
function myAreaSpeciesCounts() {
  const d = getMyData();
  if (!d || !d.areas) return null;
  return new Map(Object.entries(d.areas).map(([id, a]) => [id, a.species.length]));
}

// Your first/last dates in one area.
function myDateRangeInArea(areaId) {
  const d = getMyData();
  const a = d && d.areas && d.areas[areaId];
  return a ? { first: a.first, last: a.last } : null;
}

// ---- firsts: when a species was new somewhere ---------------------------------

// A "tick" is one (region, species) pair -- the unit a regional life list is
// counted in. Both levels are included: a species can be new for a hverfi long
// after it stopped being new for the sveitarfélag around it.
function tickKeys(data) {
  const keys = new Set();
  if (!data) return keys;
  for (const [slug, m] of Object.entries(data.municipalities || {})) {
    for (const code of Object.keys(m.sp || {})) keys.add(`m|${slug}|${code}`);
  }
  for (const [id, a] of Object.entries(data.areas || {})) {
    for (const code of Object.keys(a.sp || {})) keys.add(`a|${id}|${code}`);
  }
  return keys;
}

/**
 * What a new import added over the one it replaces.
 *
 * Set difference, deliberately, not "records dated since last time": eBird
 * exports are frequently backfilled -- an old notebook typed up, or a shared
 * checklist accepted months later -- and those are new to your list even though
 * the sighting is not new. Returns null when there is nothing to compare
 * against, since "everything is new" is not news.
 */
function diffImports(prev, next) {
  if (!prev) return null;
  const before = tickKeys(prev);
  const prevSpecies = new Set(prev.allSpecies || []);
  const added = [];

  for (const [slug, m] of Object.entries(next.municipalities || {})) {
    for (const [code, sp] of Object.entries(m.sp || {})) {
      if (!before.has(`m|${slug}|${code}`)) {
        added.push({ scope: 'm', id: slug, code, date: sp.f });
      }
    }
  }
  for (const [id, a] of Object.entries(next.areas || {})) {
    for (const [code, sp] of Object.entries(a.sp || {})) {
      if (!before.has(`a|${id}|${code}`)) {
        added.push({ scope: 'a', id, code, date: sp.f });
      }
    }
  }
  added.sort((x, y) => y.date.localeCompare(x.date));

  return {
    at: new Date().toISOString().slice(0, 10),
    prevAt: prev.imported || null,
    added,
    // Species that were not on your Iceland list at all before this import.
    lifers: (next.allSpecies || []).filter(c => !prevSpecies.has(c))
  };
}

/**
 * Every time a species was new for a region, newest first.
 *
 * One row per event rather than per tick: a bird that is new for a hverfi on
 * the same day it is new for the sveitarfélag around it is one thing that
 * happened, and listing it twice would make a first visit somewhere read as a
 * flurry of activity. `areaSlug` maps an area id to its municipality, which the
 * stored data does not record -- the caller has it from meta.json.
 */
function myFirsts(data, areaSlug) {
  if (!data) return [];

  // The per-region records include spuh, slash and hybrid rows -- "gull sp."
  // is a real thing to have logged in a place, but it is not something you add
  // to a life list, so it can be a regional first and never a lifer.
  const countable = new Set(data.allSpecies || []);

  // Your first date for each species anywhere in Iceland, which is what makes
  // a row a lifer rather than a regional tick.
  const national = new Map();
  for (const m of Object.values(data.municipalities || {})) {
    for (const [code, sp] of Object.entries(m.sp || {})) {
      const at = national.get(code);
      if (at === undefined || sp.f < at) national.set(code, sp.f);
    }
  }

  const rows = new Map();       // code|date|slug -> row
  const row = (code, date, slug) => {
    const key = `${code}|${date}|${slug}`;
    let r = rows.get(key);
    if (!r) {
      r = { code, date, slug, areas: [], newMun: false, lifer: false,
            countable: countable.has(code) };
      rows.set(key, r);
    }
    return r;
  };

  for (const [slug, m] of Object.entries(data.municipalities || {})) {
    for (const [code, sp] of Object.entries(m.sp || {})) {
      row(code, sp.f, slug).newMun = true;
    }
  }
  for (const [id, a] of Object.entries(data.areas || {})) {
    const slug = areaSlug ? areaSlug.get(id) : null;
    if (!slug) continue;        // an area from a rebuild we no longer know
    for (const [code, sp] of Object.entries(a.sp || {})) {
      row(code, sp.f, slug).areas.push(id);
    }
  }

  const out = [...rows.values()].sort((x, y) =>
    y.date.localeCompare(x.date) || x.code.localeCompare(y.code) ||
    x.slug.localeCompare(y.slug));

  // The lifer badge goes on exactly one row per species. A day spent driving
  // can put a bird's national first date on several municipalities at once,
  // and "first in Iceland" three times over for one bird is a claim nobody
  // made -- you added it to the list once. The remaining rows are still
  // regional firsts, which is what they are.
  const claimed = new Set();
  for (const r of out) {
    if (r.countable && national.get(r.code) === r.date && !claimed.has(r.code)) {
      r.lifer = true;
      claimed.add(r.code);
    }
  }
  return out;
}

export {
  parseCSV, importCSV, getMyData, saveMyData, clearMyData, hasMyData,
  mySpeciesIn, myRecordsIn, myChecklistsIn,
  mySpeciesInArea, myRecordsInArea, myChecklistCountInArea,
  myAreaSpeciesCounts, myDateRangeInArea, myLocalities,
  tickKeys, diffImports, myFirsts, STORAGE_KEY
};
