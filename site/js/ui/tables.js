// tables.js -- the five tables. Each takes rows in one shape and does not care
// whether they came off the server or out of a personal export.

import { html, useState, useMemo, useApp, ExtLink, Pager, PAGE, regionHref, speciesHref } from './core.js';
import { fmtDate, fmtNum, fmtCount, fmtDuration, fmtPct, ebird, spName, spSecondary, fold } from '../lib/format.js';

// ---- shared cells -------------------------------------------------------------

const SpeciesCell = ({ code, regionId, rank, badge }) => {
  const { tax, lang } = useApp();
  const tx = tax.get(code);
  return html`<td>
    ${rank !== undefined ? html`<span class="rank">${rank || ''}</span>` : null}
    <a class="sp-name" href=${speciesHref(code, regionId)}>${spName(tx, lang) === '?' ? code : spName(tx, lang)}</a>
    <span class="sp-sec">${spSecondary(tx, lang)}</span>
    ${badge || null}
  </td>`;
};

// A date that opens its checklist on eBird.
const DateLink = ({ rec }) => {
  const { lang } = useApp();
  if (!rec) return null;
  return html`<${ExtLink} href=${ebird.checklist(rec.s)}>${fmtDate(rec.d, lang)}<//>`;
};

// Only hotspots have a public page; a personal location is plain text.
const Place = ({ id, name, type }) =>
  html`<${ExtLink} href=${ebird.hotspot(id, type)} class="place">${name}<//>`;

// eBird distributes observer ids, not names. `null` is the reader's own record.
const Observer = ({ id }) => {
  const { t } = useApp();
  if (!id) return html`<span class="obsr is-you">${t('you')}</span>`;
  return html`<${ExtLink} href=${ebird.observer(id)} class="obsr">${id}<//>`;
};

const Find = ({ value, onInput, placeholder, label }) => html`<div class="control-group grow">
  <label>${label}</label>
  <input type="search" value=${value} placeholder=${placeholder}
         onInput=${e => onInput(e.target.value)} />
</div>`;

// A header that sorts its column. Numbers start high, text starts low.
function SortTh({ id, sort, onSort, num, children }) {
  const active = sort.key === id;
  return html`<th class=${(num ? 'num ' : '') + 'sortable' + (active ? (sort.dir > 0 ? ' sort-asc' : ' sort-desc') : '')}
    aria-sort=${active ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick=${() => onSort({ key: id, dir: active ? -sort.dir : (num ? -1 : 1) })}>${children}</button>
  </th>`;
}

// ---- species -----------------------------------------------------------------

/**
 * The species list of a region.
 *   rows       all years: { c, k, kc, x, first, last, high } with full records
 *              one year:  { c, k, kc, first, last } with days only
 *   complete   complete checklists in scope -- the denominator of frequency
 */
function SpeciesTable({ rows, year, complete, regionId, sort, find }) {
  const { tax, lang, t, source } = useApp();
  const [page, setPage] = useState(0);
  const mine = source === 'mine';

  const sorted = useMemo(() => {
    const ord = c => (tax.get(c) ? tax.get(c).ord : 1e9);
    const day = v => (v && typeof v === 'object' ? v.d : v);
    const by = {
      taxon: (a, b) => ord(a.c) - ord(b.c),
      freq: (a, b) => b.kc - a.kc || b.k - a.k || ord(a.c) - ord(b.c),
      // Ties fall back to taxonomic order, in the direction that keeps the
      // numbering monotonic.
      last: (a, b) => day(b.last) - day(a.last) || ord(a.c) - ord(b.c),
      first: (a, b) => day(b.first) - day(a.first) || ord(b.c) - ord(a.c)
    }[sort] || (() => 0);
    const list = [...rows].sort(by);
    // Number the species, and only the species: "gull sp." is on the list but
    // not on the count. Sorted by first date the number is the life-list
    // ordinal, so it counts down from the newest.
    const countable = r => (r.x !== undefined ? r.x : (tax.get(r.c) ? tax.get(r.c).cat === 'species' : true));
    const n = list.filter(countable).length;
    let i = 0;
    for (const r of list) {
      r._countable = countable(r);
      r._rank = r._countable ? (sort === 'first' ? n - i : i + 1) : 0;
      if (r._countable) i++;
    }
    return list;
  }, [rows, sort, tax]);

  const shown = useMemo(() => {
    const q = fold(find.trim());
    if (!q) return sorted;
    return sorted.filter(r => {
      const tx = tax.get(r.c);
      return fold(tx ? `${tx.is} ${tx.en} ${tx.sci}` : r.c).includes(q);
    });
  }, [sorted, find, tax]);

  const start = Math.min(page, Math.max(0, Math.ceil(shown.length / PAGE) - 1)) * PAGE;
  const slice = shown.slice(start, start + PAGE);

  if (!rows.length) return html`<p class="empty">${t('species.none')}</p>`;

  return html`<div>
    <div class="table-wrap"><table class="table birdlist">
      <thead><tr>
        <th>${t('col.species')}</th>
        <th class="num">${t('col.freq')}</th>
        <th class="num">${t('col.checklists')}</th>
        <th>${t('col.first')}</th>
        <th>${t('col.last')}</th>
        ${year ? null : html`<th>${t('col.location')}</th>`}
        ${year || mine ? null : html`<th>${t('col.observer')}</th>`}
        ${year ? null : html`<th class="num">${t('col.high')}</th>`}
      </tr></thead>
      <tbody>
        ${slice.map(r => html`<tr key=${r.c} class=${r._countable ? '' : 'is-other'}>
          <${SpeciesCell} code=${r.c} regionId=${regionId} rank=${r._rank} />
          <td class="num strong">${complete ? fmtPct(r.kc / complete) : ''}</td>
          <td class="num">${fmtNum(r.k)}</td>
          ${year
            ? html`<td class="nowrap">${fmtDate(r.first, lang)}</td><td class="nowrap">${fmtDate(r.last, lang)}</td>`
            : html`<td class="nowrap muted"><${DateLink} rec=${r.first} /></td>
                   <td class="nowrap"><${DateLink} rec=${r.last} /></td>
                   <td><${Place} id=${r.last.l} name=${r.last.ln} type=${r.last.lt} /></td>
                   ${mine ? null : html`<td><${Observer} id=${r.last.b} /></td>`}
                   <td class="num"><${ExtLink} href=${ebird.checklist(r.high.s)}>${fmtCount(r.high.n)}<//></td>`}
        </tr>`)}
      </tbody>
    </table></div>
    ${shown.length ? null : html`<p class="empty">${t('find.none')}</p>`}
    <${Pager} page=${start / PAGE} total=${shown.length} onPage=${setPage} t=${t} />
  </div>`;
}

// ---- child regions -------------------------------------------------------------

function RegionTable({ regions, hrefFor, extra }) {
  const { t, source } = useApp();
  const [sort, setSort] = useState({ key: 'species', dir: -1 });
  const mine = source === 'mine';
  const rows = useMemo(() => [...regions].sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    const cmp = typeof va === 'string' ? va.localeCompare(vb, 'is') : (va || 0) - (vb || 0);
    return sort.dir * cmp || a.name.localeCompare(b.name, 'is');
  }), [regions, sort]);

  return html`<div class="table-wrap"><table class="table">
    <thead><tr>
      <${SortTh} id="name" sort=${sort} onSort=${setSort}>${t('col.region')}<//>
      ${extra ? html`<${SortTh} id=${extra.key} sort=${sort} onSort=${setSort} num>${extra.label}<//>` : null}
      <${SortTh} id="species" sort=${sort} onSort=${setSort} num>${t('stat.species')}<//>
      <${SortTh} id="checklists" sort=${sort} onSort=${setSort} num>${t('stat.checklists')}<//>
      ${mine ? null : html`<${SortTh} id="observers" sort=${sort} onSort=${setSort} num>${t('stat.observers')}<//>`}
      <${SortTh} id="areaKm2" sort=${sort} onSort=${setSort} num>km²<//>
    </tr></thead>
    <tbody>
      ${rows.map(r => html`<tr key=${r.id} class=${r.checklists ? '' : 'is-other'}>
        <td><a class="sp-name" href=${hrefFor(r.id)}>${r.name}</a>
            <span class="sp-sec">${t('kind.' + r.kind)}</span></td>
        ${extra ? html`<td class="num strong">${fmtNum(r[extra.key] || 0)}</td>` : null}
        <td class=${'num' + (extra ? '' : ' strong')}>${fmtNum(r.species)}</td>
        <td class="num">${fmtNum(r.checklists)}</td>
        ${mine ? null : html`<td class="num">${fmtNum(r.observers)}</td>`}
        <td class="num muted">${r.areaKm2 ? fmtNum(Math.round(r.areaKm2 * 10) / 10) : ''}</td>
      </tr>`)}
    </tbody>
  </table></div>`;
}

// ---- checklists ----------------------------------------------------------------

function ChecklistTable({ rows, total, truncated }) {
  const { t, lang, tree, source } = useApp();
  const [find, setFind] = useState('');
  const [sort, setSort] = useState({ key: 'd', dir: -1 });
  const [page, setPage] = useState(0);
  const mine = source === 'mine';
  // Only the national list needs to say which sveitarfelag a location is in.
  const showRegion = rows.length > 0 && rows.some(r => r.reg) && new Set(rows.map(r => r.reg)).size > 1;

  const shown = useMemo(() => {
    const q = fold(find.trim());
    let list = rows;
    if (q) list = list.filter(r => fold(`${r.loc.name} ${r.obsr || ''}`).includes(q));
    const val = r => (sort.key === 'loc' ? r.loc.name : r[sort.key]);
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      // Unknown durations and distances sink to the bottom whichever way the
      // column is sorted, rather than leading the list as "smallest".
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return sort.dir * (typeof va === 'string' ? va.localeCompare(vb, 'is') : va - vb) ||
             b.d - a.d || (b.time || '').localeCompare(a.time || '');
    });
  }, [rows, find, sort]);

  const onFind = v => { setFind(v); setPage(0); };
  const start = Math.min(page, Math.max(0, Math.ceil(shown.length / PAGE) - 1)) * PAGE;

  return html`<div>
    <div class="controls">
      <${Find} value=${find} onInput=${onFind} label=${t('filter.find')} placeholder=${t('checklists.find')} />
      <div class="control-group"><span class="muted">${t('checklists.count', { n: fmtNum(total) })}</span></div>
    </div>
    ${truncated ? html`<p class="note">${t('checklists.truncated', { n: fmtNum(rows.length), total: fmtNum(total) })}</p>` : null}
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <${SortTh} id="d" sort=${sort} onSort=${setSort} num>${t('col.date')}<//>
        <${SortTh} id="loc" sort=${sort} onSort=${setSort}>${t('col.location')}<//>
        ${showRegion ? html`<th>${t('col.region')}</th>` : null}
        ${mine ? null : html`<th>${t('col.observer')}</th>`}
        <th>${t('col.protocol')}</th>
        <${SortTh} id="dur" sort=${sort} onSort=${setSort} num>${t('col.duration')}<//>
        <${SortTh} id="dist" sort=${sort} onSort=${setSort} num>${t('col.distance')}<//>
        <${SortTh} id="nsp" sort=${sort} onSort=${setSort} num>${t('col.species')}<//>
      </tr></thead>
      <tbody>
        ${shown.slice(start, start + PAGE).map(r => html`<tr key=${r.sub}>
          <td class="nowrap"><${ExtLink} href=${ebird.checklist(r.sub)}>${fmtDate(r.d, lang)}<//>
              ${r.time ? html` <span class="muted">${r.time.slice(0, 5)}</span>` : null}</td>
          <td><${Place} id=${r.loc.id} name=${r.loc.name} type=${r.loc.type} /></td>
          ${showRegion ? html`<td>${tree.get(r.reg)
            ? html`<a href=${regionHref(r.reg, { tab: 'checklists' })}>${tree.get(r.reg).name}</a>` : ''}</td>` : null}
          ${mine ? null : html`<td><${Observer} id=${r.obsr} /></td>`}
          <td class="muted">${r.proto || ''}${r.comp ? '' : html` <span class="tag" title=${t('checklists.incompleteTitle')}>${t('checklists.incomplete')}</span>`}</td>
          <td class="num">${fmtDuration(r.dur)}</td>
          <td class="num">${r.dist === null || r.dist === undefined ? '' : `${String(Math.round(r.dist * 10) / 10).replace('.', ',')} km`}</td>
          <td class="num strong">${fmtNum(r.nsp)}</td>
        </tr>`)}
      </tbody>
    </table></div>
    ${shown.length ? null : html`<p class="empty">${t('find.none')}</p>`}
    <${Pager} page=${start / PAGE} total=${shown.length} onPage=${setPage} t=${t} />
  </div>`;
}

// ---- records of one species ------------------------------------------------------

function RecordsTable({ rows, total, truncated }) {
  const { t, tree, source } = useApp();
  const [page, setPage] = useState(0);
  const mine = source === 'mine';
  const showRegion = rows.some(r => r.r) && new Set(rows.map(r => r.r)).size > 1;
  const start = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1)) * PAGE;

  if (!rows.length) return html`<p class="empty">${t('records.none')}</p>`;
  return html`<div>
    ${truncated ? html`<p class="note">${t('records.truncated', { n: fmtNum(rows.length), total: fmtNum(total) })}</p>` : null}
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th>${t('col.date')}</th><th class="num">${t('col.count')}</th><th>${t('col.location')}</th>
        ${showRegion ? html`<th>${t('col.region')}</th>` : null}
        ${mine ? null : html`<th>${t('col.observer')}</th>`}
      </tr></thead>
      <tbody>
        ${rows.slice(start, start + PAGE).map((r, i) => html`<tr key=${r.s + i}>
          <td class="nowrap"><${DateLink} rec=${r} />${r.time ? html` <span class="muted">${r.time.slice(0, 5)}</span>` : null}</td>
          <td class="num strong">${fmtCount(r.n)}</td>
          <td><${Place} id=${r.l} name=${r.ln} type=${r.lt} /></td>
          ${showRegion ? html`<td>${tree.get(r.r) ? html`<a href=${regionHref(r.r)}>${tree.get(r.r).name}</a>` : ''}</td>` : null}
          ${mine ? null : html`<td><${Observer} id=${r.b} /></td>`}
        </tr>`)}
      </tbody>
    </table></div>
    <${Pager} page=${start / PAGE} total=${rows.length} onPage=${setPage} t=${t} />
  </div>`;
}

// ---- firsts ----------------------------------------------------------------------

function FirstsTable({ rows }) {
  const { t, lang, tree } = useApp();
  const [page, setPage] = useState(0);
  const start = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1)) * PAGE;
  if (!rows.length) return html`<p class="empty">${t('firsts.none')}</p>`;

  return html`<div>
    <div class="table-wrap"><table class="table birdlist">
      <thead><tr><th>${t('col.species')}</th><th>${t('col.date')}</th><th>${t('col.newfor')}</th></tr></thead>
      <tbody>
        ${rows.slice(start, start + PAGE).map(r => {
          const mun = tree.get(r.mun);
          const areas = r.areas.map(id => tree.get(id)).filter(Boolean);
          return html`<tr key=${`${r.code}|${r.day}|${r.mun}`} class=${r.countable ? '' : 'is-other'}>
            <${SpeciesCell} code=${r.code} badge=${r.lifer
              ? html`<span class="tick-lifer" title=${t('firsts.liferTitle')}>${t('firsts.lifer')}</span>` : null} />
            <td class="nowrap muted">${fmtDate(r.day, lang)}</td>
            <td>
              ${r.newMun && mun ? html`<a href=${speciesHref(r.code, mun.id)}>${mun.name}</a>` : null}
              ${areas.map((a, i) => html`${r.newMun || i ? html`<span class="muted"> · </span>` : null}<a href=${speciesHref(r.code, a.id)}>${a.name}</a>`)}
              ${/* An area-only row still has to say which sveitarfelag it is in:
                   "Miðborg" on its own means nothing on a national list. */
                !r.newMun && mun ? html`<span class="muted"> (${mun.name})</span>` : null}
            </td>
          </tr>`;
        })}
      </tbody>
    </table></div>
    <${Pager} page=${start / PAGE} total=${rows.length} onPage=${setPage} t=${t} />
  </div>`;
}

export { SpeciesTable, RegionTable, ChecklistTable, RecordsTable, FirstsTable, Find, DateLink, Place, Observer };
