// remote.js -- everyone's data: the published files, fetched once and cached.
//
// Exposes the provider interface that data/mine.js also implements. A page asks
// its provider for a region's summary or cube and never learns which it got.

import { buildTree, COUNTRY } from '../lib/regions.js';

const BASE = 'data';
const cache = new Map();

function get(path) {
  if (!cache.has(path)) {
    const p = fetch(`${BASE}/${path}`).then(r => {
      if (!r.ok) throw Object.assign(new Error(`${path}: ${r.status}`), { status: r.status });
      return r.json();
    });
    // A failed fetch must not be remembered as the answer.
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

const loadMeta    = () => get('meta.json');
const loadGeo     = () => get('geo/sveitarfelog.json');
const loadAreaGeo = () => get('geo/areas.json');

let taxIndex = null;
async function loadTaxonomy() {
  if (!taxIndex) {
    const rows = await get('taxonomy.json');
    taxIndex = new Map(rows.map(r => [r.c, r]));
  }
  return taxIndex;
}

let tree = null;
async function loadTree() {
  if (!tree) tree = buildTree((await get('regions.json')).regions);
  return tree;
}

// The lookups an import needs. Fetched only when somebody actually uploads.
const loadImportLookups = async () => {
  const [sciIndex, locIndex, geo, areaGeo, tax] = await Promise.all([
    get('sci_index.json'), get('locality_index.json'), loadGeo(), loadAreaGeo(), loadTaxonomy()
  ]);
  return { sciIndex, locIndex, geo, areaGeo, known: new Set(tax.keys()) };
};

// Checklists and observations live with the sveitarfelag. An area reads its
// parent's files and keeps its own rows, which is what stops the fourth level
// tripling the number of large files.
function filesFor(t, id) {
  const r = t.get(id);
  if (!r) return null;
  const isArea = r.kind === 'hverfi' || r.kind === 'postnumer';
  return { owner: isArea ? r.parent : id, area: isArea ? id : null };
}

function decodeChecklists(file, areaIdx) {
  const rows = [];
  for (let i = 0; i < file.sub.length; i++) {
    if (areaIdx !== null && file.area[i] !== areaIdx) continue;
    const li = file.loc[i];
    rows.push({
      i,
      sub: file.sub[i], d: file.date[i], time: file.time[i],
      loc: { id: file.locs.id[li], name: file.locs.name[li], type: file.locs.type[li] },
      obsr: file.obsrs[file.obsr[i]], proto: file.protos[file.proto[i]],
      dur: file.dur[i], dist: file.dist[i], nsp: file.nsp[i], comp: file.comp[i],
      reg: file.regs ? file.regs[file.reg[i]] : null
    });
  }
  return rows;
}

const remote = {
  id: 'all',

  summary: id => get(`region/${id}/summary.json`),
  cube: id => get(`region/${id}/cube.json`),

  // { rows, total, truncated }. Only the country is truncated: 235k checklists
  // is not something to hand a browser.
  async checklists(id) {
    const t = await loadTree();
    const f = filesFor(t, id);
    if (!f) return { rows: [], total: 0, truncated: false };
    const file = await get(`region/${f.owner}/checklists.json`);
    const areaIdx = f.area ? file.areas.indexOf(f.area) : null;
    const rows = decodeChecklists(file, areaIdx);
    const total = id === COUNTRY ? file.total : rows.length;
    return { rows, total, truncated: total > rows.length };
  },

  // One species across every region: { c, regions: [...], recent: [...] }.
  // A species nobody has recorded has no file, which is an answer, not an error.
  species: code => get(`sp/${code}.json`).catch(e => {
    if (e.status === 404) return { c: code, regions: [], recent: [] };
    throw e;
  }),

  // Records of one species in one region, newest first. The country gets the
  // latest few from the species file; anything smaller gets all of them.
  async records(code, id) {
    if (id === COUNTRY) {
      const sp = await remote.species(code);
      const row = sp.regions.find(r => r.id === COUNTRY);
      return { rows: sp.recent || [], total: row ? row.k : 0,
               truncated: !!row && row.k > (sp.recent || []).length };
    }
    const t = await loadTree();
    const f = filesFor(t, id);
    if (!f) return { rows: [], total: 0, truncated: false };
    const [chk, obs] = await Promise.all([
      get(`region/${f.owner}/checklists.json`), get(`region/${f.owner}/obs.json`)
    ]);
    const si = obs.sp.indexOf(code);
    const rows = [];
    if (si >= 0) {
      const areaIdx = f.area ? chk.areas.indexOf(f.area) : null;
      for (let i = 0; i < obs.si.length; i++) {
        if (obs.si[i] !== si) continue;
        const k = obs.k[i];
        if (areaIdx !== null && chk.area[k] !== areaIdx) continue;
        const li = chk.loc[k];
        rows.push({ d: chk.date[k], s: chk.sub[k], time: chk.time[k],
                    b: chk.obsrs[chk.obsr[k]], l: chk.locs.id[li],
                    ln: chk.locs.name[li], lt: chk.locs.type[li], n: obs.n[i] });
      }
      rows.sort((a, b) => b.d - a.d || (b.time || '').localeCompare(a.time || ''));
    }
    return { rows, total: rows.length, truncated: false };
  },

  localities: () => null
};

export {
  remote, loadMeta, loadGeo, loadAreaGeo, loadTaxonomy, loadTree, loadImportLookups
};
