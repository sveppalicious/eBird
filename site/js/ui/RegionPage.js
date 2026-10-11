// RegionPage.js -- one page for Iceland, a sveitarfelag and a hverfi alike.
//
// The same sections in the same order at every level, drawn from the same
// provider calls. That is the point: the three levels used to be three
// different pages, and it showed.

import {
  html, useState, useMemo, useApp, useAsync, regionHref, speciesHref, replaceQuery,
  Stat, Tabs, Pills, Loading, ErrorBox, ExtLink
} from './core.js';
import { COUNTRY, municipalityOf, straddleSiblings } from '../lib/regions.js';
import { fmtNum, fmtDate, ebird, spName } from '../lib/format.js';
import { effortYears, yearList, activity, THIN_YEAR } from '../lib/cube.js';
import { firsts as firstsOf } from '../lib/personal.js';
import { RegionMap } from './RegionMap.js';
import { SpeciesTable, RegionTable, ChecklistTable, FirstsTable, Find } from './tables.js';
import { BarChart, ChartCard, PaleLegend } from './Charts.js';

function Breadcrumb({ regionId, hrefFor, tail }) {
  const { tree } = useApp();
  const path = tree.path(regionId);
  // A trail of one is the heading again; only show it once there is somewhere
  // to go back to.
  if (path.length < 2 && !tail) return null;
  return html`<nav class="crumbs" aria-label="Breadcrumb">
    ${path.map((r, i) => html`${i ? html`<span class="sep"> / </span>` : null}${
      i === path.length - 1 && !tail ? html`<span aria-current="page">${r.name}</span>`
                                     : html`<a href=${hrefFor(r.id)}>${r.name}</a>`}`)}
    ${tail ? html`<span class="sep"> / </span><span aria-current="page">${tail}</span>` : null}
  </nav>`;
}

// What a reader should know about this particular region before trusting it.
function RegionNotes({ region, stats }) {
  const { tree, t, source } = useApp();
  const notes = [];
  const others = straddleSiblings(tree, region.id);
  if (others.length) {
    notes.push(html`<p class="note">${t('region.straddle', { name: region.name, here: tree.get(region.parent).name })} ${
      others.map((o, i) => html`${i ? ', ' : ''}<a href=${regionHref(o.id)}>${tree.get(o.parent).name}</a>`)}.</p>`);
  }
  if (region.kind === 'sea') notes.push(html`<p class="note">${t('region.sea')}</p>`);
  else if (source === 'all' && stats.offshoreChecklists > 0.02 * stats.checklists) {
    notes.push(html`<p class="note">${t('region.offshore', { n: fmtNum(stats.offshoreChecklists), total: fmtNum(stats.checklists) })}</p>`);
  }
  return notes;
}

function RegionPage({ regionId, q }) {
  const app = useApp();
  const { tree, provider, t, lang, source, meta } = app;
  const region = tree.get(regionId);

  const summary = useAsync(() => (region ? provider.summary(regionId) : null), [regionId, provider]);
  // The map colours whatever is in focus by species count under this source.
  const values = useMemo(() => new Map(tree.all().map(r => [r.id, r.species])), [tree]);
  // After every hook: an unknown id must not change how many of them run.
  if (!region) return html`<div class="error"><h2>${t('notfound.region')}</h2><p><a href="#/">← ${t('nav.home')}</a></p></div>`;

  const kids = tree.children(regionId);
  const mine = source === 'mine';
  const tabs = [
    { id: 'species', label: t('tab.species') },
    kids.length ? { id: 'areas', label: `${t('tab.areas')} (${kids.length})` } : null,
    { id: 'checklists', label: t('tab.checklists') },
    { id: 'activity', label: t('tab.activity') },
    mine ? { id: 'firsts', label: t('tab.firsts') } : null
  ].filter(Boolean).map(tb => ({ ...tb, href: regionHref(regionId, tb.id === 'species' ? {} : { tab: tb.id }) }));
  const tab = tabs.some(tb => tb.id === q.tab) ? q.tab : 'species';

  const describe = id => {
    const r = tree.get(id);
    return r && r.species ? t(mine ? 'map.speciesMine' : 'map.species', { n: fmtNum(r.species) }) : t('map.none');
  };

  const stats = summary.data ? summary.data.stats : null;
  const parentMun = tree.get(municipalityOf(tree, regionId));
  const ebirdCode = region.ebird || (parentMun && parentMun.ebird);

  return html`<article class=${summary.loading && summary.data ? 'is-stale' : ''}>
    <header class="page-head">
      <${Breadcrumb} regionId=${regionId} hrefFor=${id => regionHref(id)} />
      <h1>${region.name}</h1>
      <p class="kind">
        <span>${t('kind.' + region.kind)}</span>
        ${region.ebirdName ? html`<span class="sep"> · </span><span>${region.ebirdName}</span>` : null}
        ${ebirdCode ? html`<span class="sep"> · </span><${ExtLink} href=${ebird.region(ebirdCode)}>eBird ↗<//>` : null}
      </p>
      ${stats ? html`<${RegionNotes} region=${region} stats=${stats} />` : null}
    </header>

    ${regionId === COUNTRY && !mine ? html`<p class="callout">
      <strong>${t('ebd.lead')} </strong>${t('ebd.body', { release: meta.ebdRelease })}
      <strong> ${fmtDate(meta.dateRange[1], lang)}</strong>. ${t('ebd.tail')}</p>` : null}

    ${summary.error ? html`<${ErrorBox} error=${summary.error} t=${t} />` : null}
    ${stats ? html`<div class="stats">
      <${Stat} lead value=${fmtNum(stats.species)} label=${t(mine ? 'stat.speciesMine' : 'stat.species')}
               sub=${stats.taxa > stats.species ? t('stat.taxa', { n: fmtNum(stats.taxa) }) : null} />
      <${Stat} value=${fmtNum(stats.checklists)} label=${t('stat.checklists')}
               sub=${t('stat.completeOf', { n: fmtNum(stats.complete) })} />
      ${mine
        ? html`<${Stat} value=${fmtNum(stats.localities)} label=${t('stat.localities')} />`
        : html`<${Stat} value=${fmtNum(stats.observers)} label=${t('stat.observers')} />`}
      <${Stat} value=${stats.lastDate === null ? '–' : fmtDate(stats.lastDate, lang)} label=${t('stat.latest')}
               sub=${stats.firstDate === null ? null : t('stat.since', { d: fmtDate(stats.firstDate, lang) })} />
    </div>` : (summary.loading ? html`<${Loading} t=${t} />` : null)}

    <${RegionMap} regionId=${regionId} values=${values} label=${t(mine ? 'map.legendMine' : 'map.legend')}
                  onSelect=${id => { location.hash = regionHref(id); }} describe=${describe} />

    <${Tabs} tabs=${tabs} active=${tab} />
    <section class="tab-body">
      ${tab === 'species' && summary.data ? html`<${SpeciesTab} regionId=${regionId} summary=${summary.data} year=${q.year} />` : null}
      ${tab === 'areas' ? html`<${RegionTable} regions=${kids} hrefFor=${id => regionHref(id)} />` : null}
      ${tab === 'checklists' ? html`<${ChecklistsTab} regionId=${regionId} />` : null}
      ${tab === 'activity' ? html`<${ActivityTab} regionId=${regionId} />` : null}
      ${tab === 'firsts' && mine ? html`<${FirstsTab} regionId=${regionId} />` : null}
    </section>
  </article>`;
}

// ---- species -----------------------------------------------------------------

function SpeciesTab({ regionId, summary, year }) {
  const { provider, t, source } = useApp();
  const [find, setFind] = useState('');
  const [sort, setSort] = useState(source === 'mine' ? 'first' : 'taxon');
  const y = year ? +year : null;

  // The cube is only fetched once a year is asked for, or to offer the years.
  const cube = useAsync(() => provider.cube(regionId), [regionId, provider]);
  const years = cube.data ? effortYears(cube.data).map(e => e.year).reverse() : [];

  const rows = useMemo(() => {
    if (!y) return summary.species;
    return cube.data ? yearList(cube.data, y) : [];
  }, [y, summary, cube.data]);
  const complete = useMemo(() => {
    if (!y) return summary.stats.complete;
    const e = cube.data ? effortYears(cube.data).find(r => r.year === y) : null;
    return e ? e.c : 0;
  }, [y, summary, cube.data]);

  return html`<div>
    <div class="controls">
      <${Find} value=${find} onInput=${setFind} label=${t('filter.find')} placeholder=${t('species.find')} />
      <div class="control-group">
        <label for="year">${t('filter.year')}</label>
        <select id="year" value=${y || ''} onChange=${e => replaceQuery({ year: e.target.value || null })}>
          <option value="">${t('filter.allyears')}</option>
          ${years.map(v => html`<option value=${v}>${v}</option>`)}
        </select>
      </div>
      <div class="control-group">
        <label>${t('sort.label')}</label>
        <${Pills} label=${t('sort.label')} value=${sort} onPick=${setSort} options=${[
          ['taxon', t('sort.taxon')], ['freq', t('sort.freq')], ['last', t('sort.last')], ['first', t('sort.first')]]} />
      </div>
    </div>
    ${y && cube.loading ? html`<${Loading} t=${t} />`
      : html`<${SpeciesTable} rows=${rows} year=${y} complete=${complete} regionId=${regionId} sort=${sort} find=${find} />`}
    <p class="note">${t('species.freqNote')}</p>
  </div>`;
}

// ---- checklists ----------------------------------------------------------------

function ChecklistsTab({ regionId }) {
  const { provider, t } = useApp();
  const res = useAsync(() => provider.checklists(regionId), [regionId, provider]);
  if (res.error) return html`<${ErrorBox} error=${res.error} t=${t} />`;
  if (!res.data) return html`<${Loading} t=${t} />`;
  return html`<${ChecklistTable} rows=${res.data.rows} total=${res.data.total} truncated=${res.data.truncated} />`;
}

// ---- activity: coverage over time ------------------------------------------------

function ActivityTab({ regionId }) {
  const { provider, tax, t } = useApp();
  const cube = useAsync(() => provider.cube(regionId), [regionId, provider]);
  if (cube.error) return html`<${ErrorBox} error=${cube.error} t=${t} />`;
  if (!cube.data) return html`<${Loading} t=${t} />`;

  const countable = new Set([...tax.values()].filter(x => x.cat === 'species').map(x => x.c));
  // Thirty years is as far back as a bar per year stays readable; before that
  // the record is a handful of checklists a year anyway.
  const all = activity(cube.data, countable);
  const rows = all.slice(-30);
  if (!rows.length) return html`<p class="empty">${t('activity.none')}</p>`;

  const speciesBars = rows.map(r => ({
    key: r.year, label: r.year, value: r.species, pale: r.thin,
    tipValue: fmtNum(r.species), tipLabel: `${t('stat.species')} ${r.year}`,
    tipDetail: t('chart.onChecklists', { n: fmtNum(r.checklists) })
  }));
  const checklistBars = rows.map(r => ({
    key: r.year, label: r.year, value: r.checklists, pale: r.thin,
    tipValue: fmtNum(r.checklists), tipLabel: `${t('stat.checklists')} ${r.year}`,
    tipDetail: t('stat.completeOf', { n: fmtNum(r.complete) })
  }));
  const tableLabel = t('chart.table');
  const pale = html`<${PaleLegend} text=${t('chart.pale', { n: THIN_YEAR })} />`;

  return html`<div class="chart-grid">
    <${ChartCard} title=${t('activity.species')} note=${t('activity.speciesNote')} legend=${pale} tableLabel=${tableLabel}
      table=${{ head: [t('filter.year'), t('stat.species')], rows: rows.map(r => [r.year, fmtNum(r.species)]) }}>
      <${BarChart} bars=${speciesBars} format=${v => fmtNum(Math.round(v))} />
    <//>
    <${ChartCard} title=${t('activity.checklists')} note=${t('activity.checklistsNote')} legend=${pale} tableLabel=${tableLabel}
      table=${{ head: [t('filter.year'), t('stat.checklists'), t('stat.complete')],
                rows: rows.map(r => [r.year, fmtNum(r.checklists), fmtNum(r.complete)]) }}>
      <${BarChart} bars=${checklistBars} format=${v => fmtNum(Math.round(v))} />
    <//>
  </div>`;
}

// ---- firsts (your data only) -------------------------------------------------------

function FirstsTab({ regionId }) {
  const { mine, tree, tax, t, lang } = useApp();
  const [filter, setFilter] = useState('all');
  const all = useMemo(() => (mine ? firstsOf(mine, regionId, tree) : []), [mine, regionId, tree]);
  const rows = all.filter(r =>
    filter === 'all' ? true : filter === 'lifer' ? r.lifer : filter === 'mun' ? r.newMun : r.areas.length > 0);

  // What the last upload added, narrowed to this region.
  const news = mine && mine.lastImport;
  const added = news ? news.added.filter(a => regionId === COUNTRY || a.id === regionId ||
    (tree.get(a.id) && tree.get(a.id).parent === regionId)) : [];

  return html`<div>
    ${added.length ? html`<div class="callout whatsnew">
      <strong>${t('firsts.since', { d: news.prevAt || '' })} </strong>
      <span>${[
        regionId === COUNTRY && news.lifers.length ? t('firsts.newIceland', { n: fmtNum(news.lifers.length) }) : null,
        t('firsts.newTicks', { n: fmtNum(added.length) })
      ].filter(Boolean).join(', ')}.</span>
      <ul class="whatsnew-list">
        ${added.slice(0, 8).map(a => html`<li>
          <span class="muted">${fmtDate(a.day, lang)} — </span>
          <strong><a href=${speciesHref(a.code, a.id)}>${spName(tax.get(a.code), lang)}</a></strong>
          <span> · ${tree.get(a.id) ? tree.get(a.id).name : a.id}</span>
        </li>`)}
      </ul>
    </div>` : null}
    <p class="lede">${t('firsts.lede', { n: fmtNum(all.length) })}</p>
    <div class="controls">
      <${Pills} value=${filter} onPick=${setFilter} label=${t('tab.firsts')} options=${[
        ['all', t('firsts.all')], ['lifer', t('firsts.lifer')],
        ['mun', t('kind.sveitarfelag')], ['area', t('firsts.areas')]]} />
    </div>
    <${FirstsTable} rows=${rows} />
  </div>`;
}

export { RegionPage, Breadcrumb };
