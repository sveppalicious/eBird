// mine.js -- your own data: where the table is kept, and the same provider
// interface as data/remote.js on top of it.
//
// PRIVACY: the table is written to this browser's IndexedDB and nowhere else.
// This file has no network code of any kind -- no fetch, no upload, no beacon --
// and the tests check that it stays that way. If accounts are ever added, the
// three storage functions below are the only place that would change.

import { buildTree, COUNTRY } from '../lib/regions.js';
import {
  TABLE_VERSION, summaryFor, cubeFor, checklistsFor, recordsFor, speciesAcross,
  regionStats, localities
} from '../lib/personal.js';

const DB_NAME = 'ebird-island';
const STORE = 'kv';
const KEY = 'table';

// What the first version of the site left in localStorage. Its shape is
// unrelated to the table, so it is cleared rather than migrated: the CSV it
// came from is still on the user's machine.
const LEGACY_KEY = 'myEbirdData.v1';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}

async function loadMine() {
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* storage disabled */ }
  try {
    const table = await tx('readonly', s => s.get(KEY));
    // A table saved by an older build may not have the columns this one reads.
    // Drop it and ask for the file again rather than half-reading it.
    if (table && table.version !== TABLE_VERSION) { await clearMine(); return null; }
    return table || null;
  } catch { return null; }
}

// Returns false when the table could not be persisted -- private browsing, or
// storage disabled. It still works for this session.
async function saveMine(table) {
  try { await tx('readwrite', s => s.put(table, KEY)); return true; }
  catch { return false; }
}

async function clearMine() {
  try { await tx('readwrite', s => s.delete(KEY)); } catch { /* nothing to do */ }
}

// The provider. `baseTree` is the published tree: the regions are the same
// regions, only the numbers on them are yours.
function mineProvider(table, baseTree) {
  const stats = regionStats(table);
  // Every count the published tree carries is somebody else's; blank them all
  // before laying yours over the top, or a region you have never visited would
  // keep showing the country's numbers.
  const zero = { species: 0, taxa: 0, checklists: 0, complete: 0, observations: 0,
                 observers: 0, localities: 0, media: 0, offshoreChecklists: 0,
                 firstDate: null, lastDate: null };
  const tree = buildTree(baseTree.all().map(r => ({ ...r, ...zero, ...(stats.get(r.id) || {}) })));

  return {
    id: 'mine',
    tree,
    summary: async id => summaryFor(table, id),
    cube: async id => cubeFor(table, id),
    checklists: async id => {
      const rows = checklistsFor(table, id);
      return { rows, total: rows.length, truncated: false };
    },
    species: async code => speciesAcross(table, code),
    records: async (code, id) => {
      const rows = recordsFor(table, code, id);
      return { rows, total: rows.length, truncated: false };
    },
    localities: () => localities(table)
  };
}

export { loadMine, saveMine, clearMine, mineProvider, COUNTRY };
