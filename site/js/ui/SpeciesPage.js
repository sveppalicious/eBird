// SpeciesPage.js -- one species, scoped to any region.
//
// Same sections at every level: when it is here (by year, by month, the two
// together, and when it arrives), where within the region, and the records.
// The national species page used to have a map and no charts and the municipal
// one a chart and no map; this is both, everywhere.

import {
  html, useMemo, useApp, useAsync, regionHref, speciesHref, Stat, Loading, ErrorBox, ExtLink
} from './core.js';
import { municipalityOf } from '../lib/regions.js';
import { fmtNum, fmtDate, fmtDayMonth, fmtCount, fmtPct, ebird, spName, spSecondary, MONTHS } from '../lib/format.js';
import { chartSpan, byYear, byMonth, heat, isSeasonal, arrivals, THIN_YEAR } from '../lib/cube.js';
import { RegionMap } from './RegionMap.js';
import { RegionTable, RecordsTable, DateLink } from './tables.js';
import { BarChart, Heatmap, DotChart, ChartCard, PaleLegend } from './Charts.js';
import { Breadcrumb } from './RegionPage.js';

function SpeciesPage({ code, regionId }) {
  const { tree, provider, tax, t, lang, source } = useApp();
  const region = tree.get(regionId);
  const tx = tax.get(code);
  const mine = source === 'mine';

  const sp = useAsync(() => provider.species(code), [code, provider]);
  const cube = useAsync(() => (region ? provider.cube(regionId) : null), [regionId, provider]);
  const records = useAsync(() => (region ? provider.records(code, regionId) : null), [code, regionId, provider]);

  const byRegion = useMemo(
    () => new Map(((sp.data && sp.data.regions) || []).map(r => [r.id, r])), [sp.data]);
  // Checklists with the species in each child, for the map and the table.
  const values = useMemo(() => new Map([...byRegion].map(([id, r]) => [id, r.k])), [byRegion]);

  if (!region) return html`<div class="error"><h2>${t('notfound.region')}</h2><p><a href="#/">← ${t('nav.home')}</a></p></div>`;

  const name = tx ? spName(tx, lang) : code;
  const here = byRegion.get(regionId);
  const parentMun = tree.get(municipalityOf(tree, regionId));
  const ebirdCode = region.ebird || (parentMun && parentMun.ebird) || 'IS';
  const kids = tree.children(regionId);
  const describe = id => {
    const r = byRegion.get(id);
    return r ? t('map.checklists', { n: fmtNum(r.k) }) : t('map.notRecorded');
  };

  const head = html`<header class="page-head">
    <${Breadcrumb} regionId=${regionId} hrefFor=${id => speciesHref(code, id)} />
    <h1>${name}</h1>
    <p class="kind">
      ${/* In English the secondary name *is* the scientific one; say it once. */
        tx && spSecondary(tx, lang) !== tx.sci ? html`<span>${spSecondary(tx, lang)}</span><span class="sep"> · </span>` : null}
      ${tx ? html`<i>${tx.sci}</i><span class="sep"> · </span>` : null}
      <a href=${regionHref(regionId)}>${t('species.backTo', { name: region.name })}</a>
      <span class="sep"> · </span>
      <${ExtLink} href=${ebird.species(code, ebirdCode)}>eBird ↗<//>
    </p>
  </header>`;

  if (sp.error) return html`<article>${head}<${ErrorBox} error=${sp.error} t=${t} /></article>`;
  if (!sp.data) return html`<article>${head}<${Loading} t=${t} /></article>`;

  if (!here) {
    // Not recorded here -- say so, and offer the way up to where it has been.
    const up = tree.path(regionId).reverse().find(r => byRegion.has(r.id));
    return html`<article>${head}
      <p class="empty">${t(mine ? 'species.noneMine' : 'species.noneHere', { name, region: region.name })}</p>
      ${up ? html`<p><a href=${speciesHref(code, up.id)}>${t('species.seeIn', { name, region: up.name })} →</a></p>` : null}
      <${RegionMap} regionId=${regionId} values=${values} label=${t('map.legendChecklists')}
                    onSelect=${id => { location.hash = speciesHref(code, id); }} describe=${describe} />
    </article>`;
  }

  const complete = region.complete;
  return html`<article class=${cube.loading && cube.data ? 'is-stale' : ''}>
    ${head}
    <div class="stats">
      <${Stat} lead value=${complete ? fmtPct(here.kc / complete) : '–'} label=${t('stat.frequency')}
               sub=${t('stat.frequencySub')} />
      <${Stat} value=${fmtNum(here.k)} label=${t('stat.checklists')} />
      <${Stat} value=${html`<${DateLink} rec=${here.first} />`} label=${t('col.first')} />
      <${Stat} value=${html`<${DateLink} rec=${here.last} />`} label=${t('col.last')} />
      <${Stat} value=${html`<${ExtLink} href=${ebird.checklist(here.high.s)}>${fmtCount(here.high.n)}<//>`}
               label=${t('col.high')} sub=${fmtDate(here.high.d, lang)} />
    </div>

    ${cube.error ? html`<${ErrorBox} error=${cube.error} t=${t} />` : null}
    ${cube.data ? html`<${SpeciesCharts} cube=${cube.data} code=${code} />` : html`<${Loading} t=${t} />`}

    <h2>${t('species.where', { region: region.name })}</h2>
    <${RegionMap} regionId=${regionId} values=${values} label=${t('map.legendChecklists')}
                  onSelect=${id => { location.hash = speciesHref(code, id); }} describe=${describe} />
    ${kids.length ? html`<${RegionTable}
        regions=${kids.filter(k => byRegion.has(k.id)).map(k => ({ ...k, withSpecies: byRegion.get(k.id).k }))}
        hrefFor=${id => speciesHref(code, id)}
        extra=${{ key: 'withSpecies', label: t('col.withSpecies') }} />` : null}

    <h2>${t('species.records')}</h2>
    ${records.error ? html`<${ErrorBox} error=${records.error} t=${t} />`
      : records.data ? html`<${RecordsTable} rows=${records.data.rows} total=${records.data.total} truncated=${records.data.truncated} />`
      : html`<${Loading} t=${t} />`}
  </article>`;
}

// ---- the four charts -----------------------------------------------------------

function SpeciesCharts({ cube, code }) {
  const { t, lang } = useApp();
  const span = chartSpan(cube);
  if (!span) return html`<p class="empty">${t('chart.none')}</p>`;

  const months = MONTHS[lang] || MONTHS.en;
  const pct = v => fmtPct(v);
  const of = (c, ec) => t('chart.ofComplete', { c: fmtNum(c), ec: fmtNum(ec) });
  const tableLabel = t('chart.table');
  const spanLabel = `${span.from}–${span.to}`;

  const years = byYear(cube, code, span);
  const monthly = byMonth(cube, code, span);
  const grid = heat(cube, code, span);
  const seasonal = isSeasonal(cube, code, span);
  const arr = seasonal ? arrivals(cube, code, span) : [];
  const anyThin = years.some(y => y.thin);

  const yearBars = years.map(y => ({
    key: y.year, label: y.year, value: y.ec ? y.freq : null, pale: y.thin,
    tipValue: y.ec ? pct(y.freq) : '–', tipLabel: String(y.year), tipDetail: of(y.c, y.ec)
  }));
  const monthBars = monthly.map(m => ({
    key: m.month, label: months[m.month], value: m.ec ? m.freq : null, pale: m.thin,
    tipValue: m.ec ? pct(m.freq) : '–', tipLabel: months[m.month], tipDetail: of(m.c, m.ec)
  }));
  const heatMax = Math.max(0, ...grid.flatMap(r => r.months.map(c => c.freq || 0)));

  // Arrival dates, as a dot per year against the calendar.
  let arrivalChart = null;
  if (arr.length >= 3) {
    const solid = arr.filter(a => !a.thin);
    const ds = arr.map(a => a.doy);
    const lo = Math.min(...ds) - 4, hi = Math.max(...ds) + 4;
    const sorted = (solid.length >= 3 ? solid : arr).map(a => a.doy).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // Day-of-year back to a date in a non-leap year, for the axis labels.
    const asDay = doy => Math.round(Date.UTC(2023, 0, doy) / 86400000);
    const step = hi - lo > 60 ? 20 : hi - lo > 24 ? 10 : 5;
    const ticks = [];
    for (let d = Math.ceil(lo / step) * step; d <= hi; d += step) ticks.push({ y: d, label: fmtDayMonth(asDay(d), lang) });
    const byYearMap = new Map(arr.map(a => [a.year, a]));
    const points = [];
    for (let y = span.from; y <= span.to; y++) {
      const a = byYearMap.get(y);
      points.push(a ? { key: y, label: y, y: a.doy, pale: a.thin, tipValue: fmtDayMonth(a.day, lang), tipLabel: String(y),
                        tipDetail: a.thin ? t('chart.thinYear') : null }
                    : { key: y, label: y, y: null });
    }
    arrivalChart = html`<${ChartCard} title=${t('chart.arrivals')} note=${t('chart.arrivalsNote')} tableLabel=${tableLabel}
      legend=${html`<div class="chart-legend"><span class="legend-dot is-hollow"></span><span>${t('chart.pale', { n: THIN_YEAR })}</span></div>`}
      table=${{ head: [t('filter.year'), t('col.first')], rows: arr.map(a => [a.year, fmtDayMonth(a.day, lang)]) }}>
      <${DotChart} points=${points} yTicks=${ticks} yMin=${lo} yMax=${hi}
                   guide=${{ y: median, label: t('chart.median', { d: fmtDayMonth(asDay(median), lang) }) }} />
    <//>`;
  }

  return html`<section>
    <h2>${t('species.when')} <span class="h2-sub">${spanLabel}</span></h2>
    <p class="note">${t('chart.freqNote')}</p>
    <div class="chart-grid">
      <${ChartCard} title=${t('chart.byYear')} tableLabel=${tableLabel}
        legend=${anyThin ? html`<${PaleLegend} text=${t('chart.pale', { n: THIN_YEAR })} />` : null}
        table=${{ head: [t('filter.year'), t('col.freq'), t('stat.checklists')],
                  rows: years.map(y => [y.year, y.ec ? pct(y.freq) : '–', fmtNum(y.n)]) }}>
        <${BarChart} bars=${yearBars} format=${pct} />
      <//>
      <${ChartCard} title=${t('chart.byMonth')} tableLabel=${tableLabel}
        table=${{ head: [t('chart.month'), t('col.freq'), t('stat.checklists')],
                  rows: monthly.map(m => [months[m.month], m.ec ? pct(m.freq) : '–', fmtNum(m.n)]) }}>
        <${BarChart} bars=${monthBars} format=${pct} labelEvery=${1} />
      <//>
    </div>
    <div class="chart-grid">
      <${ChartCard} title=${t('chart.heat')} note=${t('chart.heatNote')} tableLabel=${tableLabel}
        table=${{ head: [t('filter.year'), ...months],
                  rows: grid.map(r => [r.year, ...r.months.map(c => (c.freq === null ? '–' : pct(c.freq)))]) }}>
        <${Heatmap} columns=${months} max=${heatMax} format=${pct}
          rows=${grid.map(r => ({ label: r.year, pale: r.thin, cells: r.months.map((c, m) => ({
            value: c.freq, tipValue: c.freq === null ? '–' : pct(c.freq), tipLabel: `${months[m]} ${r.year}`,
            tipDetail: c.freq === null ? t('chart.noEffort') : of(c.c, c.ec) })) }))} />
      <//>
      ${arrivalChart}
    </div>
  </section>`;
}

export { SpeciesPage };
