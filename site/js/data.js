// data.js -- fetching and caching the generated payloads.
//
// summary.json is small and loads with the Bird List. checklists.json and
// obs.json are heavier and only fetched when a view actually needs them
// (checklist browser, species detail, or any year/month filter).

const BASE = 'data';
const cache = new Map();

function get(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(`${BASE}/${path}`).then(r => {
      if (!r.ok) throw new Error(`${path}: ${r.status} ${r.statusText}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

const loadMeta     = () => get('meta.json');
const loadGeo      = () => get('geo/sveitarfelog.json');
const loadAreaGeo  = () => get('geo/areas.json');
const loadSummary  = slug => get(`mun/${slug}/summary.json`);
const loadChecklists = slug => get(`mun/${slug}/checklists.json`);
const loadObs      = slug => get(`mun/${slug}/obs.json`);

// The mirror of summary.json: one taxon, broken down by municipality.
const loadSpecies      = code => get(`sp/${code}.json`);
const loadSpeciesIndex = () => get('species_index.json');

// Taxonomy is one file for the whole site; index it by species code once.
let taxIndex = null;
async function loadTaxonomy() {
  if (!taxIndex) {
    const rows = await get('taxonomy.json');
    taxIndex = new Map(rows.map(r => [r.c, r]));
  }
  return taxIndex;
}

// ---- derived views ----------------------------------------------------------

// Recompute the Bird List for a date window. summary.json already holds the
// all-years answer; anything narrower has to go back to the observations.
//
// Returns rows shaped like summary.species so the table renderer does not care
// which path produced them.
function birdListForRange(obs, chk, { yearFrom, yearTo, month, areaIdx = null }) {
  const byDay = chk.date;
  const rows = new Map();
  const checklists = new Set();
  const media = new Set(obs.media);
  const mediaSpecies = new Set();
  let observations = 0;

  for (let i = 0; i < obs.si.length; i++) {
    const k = obs.k[i];
    // The postal area lives on the checklist, so a fourth level costs nothing
    // more than this test -- obs.json already indexes into the checklists.
    if (areaIdx !== null && chk.area[k] !== areaIdx) continue;
    const d = byDay[k];
    const dt = new Date(d * 86400000);
    const y = dt.getUTCFullYear();
    if (yearFrom !== null && y < yearFrom) continue;
    if (yearTo !== null && y > yearTo) continue;
    if (month !== null && dt.getUTCMonth() !== month) continue;

    checklists.add(k);
    observations++;
    const code = obs.sp[obs.si[i]];
    if (media.has(i)) mediaSpecies.add(code);
    let r = rows.get(code);
    if (!r) {
      r = { c: code, o: 0, k: 0, _subs: new Set(), _years: new Set(),
            first: null, last: null, high: null };
      rows.set(code, r);
    }
    r.o++;
    r._subs.add(k);
    r._years.add(y);

    const n = obs.n[i];
    const rec = { d, s: chk.sub[k], b: chk.obsrs[chk.obsr[k]], l: chk.loc[k], n };
    if (!r.first || d < r.first.d) r.first = rec;
    if (!r.last  || d > r.last.d)  r.last  = rec;
    if (n !== null && (!r.high || r.high.n === null || n > r.high.n)) r.high = rec;
  }

  for (const r of rows.values()) {
    r.k = r._subs.size;
    r.y = [...r._years].sort();
    if (!r.high) r.high = r.last;
    delete r._subs; delete r._years;
  }

  // Totals for the stat tiles, so they follow the filter instead of silently
  // continuing to show all-years numbers above a filtered table.
  let complete = 0;
  const observers = new Set();
  for (const k of checklists) {
    if (chk.comp[k]) complete++;
    observers.add(chk.obsr[k]);
  }

  return {
    rows,
    totals: {
      checklists: checklists.size,
      complete,
      observations,
      observers: observers.size,
      mediaSpecies: mediaSpecies.size
    }
  };
}

// Every observation of one species in one municipality, newest first.
function observationsForSpecies(obs, chk, code, areaIdx = null) {
  const si = obs.sp.indexOf(code);
  if (si < 0) return [];
  const media = new Set(obs.media);
  const out = [];
  for (let i = 0; i < obs.si.length; i++) {
    if (obs.si[i] !== si) continue;
    const k = obs.k[i];
    if (areaIdx !== null && chk.area[k] !== areaIdx) continue;
    out.push({
      d: chk.date[k], sub: chk.sub[k], time: chk.time[k],
      obsr: chk.obsrs[chk.obsr[k]], loc: chk.loc[k],
      n: obs.n[i], media: media.has(i)
    });
  }
  out.sort((a, b) => b.d - a.d);
  return out;
}

export {
  loadMeta, loadGeo, loadAreaGeo, loadSummary, loadChecklists, loadObs, loadTaxonomy,
  loadSpecies, loadSpeciesIndex,
  birdListForRange, observationsForSpecies
};
