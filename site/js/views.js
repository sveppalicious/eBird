// views.js -- the four screens.
//
//   home        Iceland choropleth + sortable municipality table
//   birdlist    the Bird List for one sveitarfelag (mirrors eBird's layout)
//   species     every record of one species in one sveitarfelag
//   checklists  checklist browser

import {
  fmtDate, fmtNum, fmtCount, fmtDuration, ebird, spName, spSecondary,
  el, extLink, dayYear, dayMonth, isoToDay, MONTHS_EN, MONTHS_IS
} from './format.js';
import {
  loadMeta, loadGeo, loadAreaGeo, loadSummary, loadChecklists, loadObs,
  loadTaxonomy, loadSpecies, loadSpeciesIndex,
  birdListForRange, observationsForSpecies
} from './data.js';
import { renderMap } from './map.js';
import {
  importCSV, getMyData, saveMyData, clearMyData, hasMyData,
  mySpeciesIn, myRecordsIn, myChecklistsIn,
  mySpeciesInArea, myRecordsInArea, myChecklistCountInArea,
  myAreaSpeciesCounts, myDateRangeInArea, myLocalities
} from './mydata.js';

// Must match OPEN_SEA_SLUG in R/00_config.R.
const OPEN_SEA_SLUG = '0000-hafsvaedi';

const state = {
  lang: localStorage.getItem('lang') || 'is',
  sort: 'last',
  year: 'all',
  month: 'all',
  query: '',
  page: 0,
  // all | seen | needed. In "Min gogn" the table is meant to *be* your life
  // list for the region, so it starts on your own species rather than on
  // everyone's; "Not seen here" is still there as the needs list.
  seenFilter: localStorage.getItem('mapMode') === 'mine' ? 'seen' : 'all',
  // Which dataset the maps and the headline figures describe. Persisted, so
  // that following a municipality link out of "Mín gögn" keeps showing your
  // data rather than silently reverting to everyone's.
  mapMode: localStorage.getItem('mapMode') === 'mine' ? 'mine' : 'all'
};

function setMapMode(m) {
  state.mapMode = m;
  localStorage.setItem('mapMode', m);
  // Switching to your data switches the table to your life list, and back
  // again -- otherwise "All eBirders" would still be filtered to your species.
  state.seenFilter = m === 'mine' ? 'seen' : 'all';
  state.page = 0;
}

// Available only once a personal export is loaded; otherwise there is nothing
// to switch to.
function mapModeToggle(onChange) {
  if (!hasMyData()) return null;
  return el('div', { class: 'controls' },
    el('div', { class: 'control-group' },
      el('label', { text: 'Show' }),
      pills([['all', 'All eBirders'], ['mine', 'Mín gögn']], state.mapMode,
        v => { setMapMode(v); onChange(); })));
}

// Species-per-municipality values for whichever dataset is selected.
function mapValues(meta) {
  if (state.mapMode === 'mine') {
    const d = getMyData();
    if (d) {
      return {
        values: new Map(Object.entries(d.municipalities)
          .map(([slug, m]) => [slug, m.species.length])),
        label: 'species seen'
      };
    }
  }
  return {
    values: new Map(meta.municipalities.map(m => [m.slug, m.species])),
    label: 'species'
  };
}

// The same switch, one level down. `meta.areas` covers every area in the
// country, not just the one municipality being viewed -- otherwise the
// neighbours render grey, which reads as "no records" when they simply belong
// to the next sveitarfelag.
// Your localities, but only when the maps are describing your data.
//
// Deliberately never filtered to the selected sveitarfelag: a zoomed map still
// shows its neighbours, and dropping their dots made places you have birded
// plenty look untouched. The viewBox does the clipping, and the country map
// already draws all of them, so this adds no new worst case.
function myPoints() {
  return state.mapMode === 'mine' ? (myLocalities() || []) : [];
}

function areaMapValues(meta) {
  if (state.mapMode === 'mine') {
    const mine = myAreaSpeciesCounts();
    if (mine) return { values: mine, label: 'species seen' };
  }
  return {
    values: new Map((meta.areas || []).map(a => [a.id, a.species])),
    label: 'species'
  };
}

const PAGE = 100;

function setLang(l) {
  state.lang = l;
  localStorage.setItem('lang', l);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function loading(msg) {
  return el('div', { class: 'loading', text: msg || 'Loading…' });
}

// "2019" for a single year, "2004–2011 · 2 years" for a span.
function yearSpan(years) {
  if (!years || !years.length) return '';
  const a = years[0], b = years[years.length - 1];
  if (years.length === 1) return String(a);
  return `${a}–${b} · ${years.length} years`;
}

function statTile(value, label, sub) {
  return el('div', { class: 'stat' },
    el('div', { class: 'stat-value', text: fmtNum(value) }),
    el('div', { class: 'stat-label', text: label }),
    sub ? el('div', { class: 'stat-sub', text: sub }) : null);
}

// The group moves its own highlight before calling back. Most callers redraw
// only the table below, not these buttons, so without this the highlight stays
// on whatever was selected when the controls were last built -- the table would
// re-sort or re-filter while the pills still pointed at the previous choice.
function pills(options, current, onPick) {
  const wrap = el('div', { class: 'pills' });
  for (const [v, label] of options) {
    const b = el('button', {
      class: 'pill' + (v === current ? ' is-active' : ''),
      onclick: () => {
        for (const other of wrap.children) other.classList.remove('is-active');
        b.classList.add('is-active');
        onPick(v);
      }
    }, label);
    wrap.appendChild(b);
  }
  return wrap;
}

// -----------------------------------------------------------------------------
// home
// -----------------------------------------------------------------------------

async function viewHome(root) {
  root.appendChild(loading());
  const [meta, geo] = await Promise.all([loadMeta(), loadGeo()]);
  root.textContent = '';

  root.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Ísland' },
      el('span', { class: 'page-head-sub', text: ' — sveitarfélög' })),
    el('p', { class: 'lede' },
      `eBird stops at ${Object.keys(meta.regions).length} landshlutar. This goes one level ` +
      `deeper, to the ${meta.totals.municipalities - 1} sveitarfélög, by placing every ` +
      `eBird locality inside a municipality boundary from Landmælingar Íslands.`)
  ));

  // Headline follows the same switch as the map below it.
  const statsHost = el('div', {});
  root.appendChild(statsHost);

  function drawStats() {
    statsHost.textContent = '';
    const d = state.mapMode === 'mine' ? getMyData() : null;
    if (d) {
      statsHost.appendChild(el('div', { class: 'stats' },
        statTile(d.stats.species, 'My species', `of ${meta.totals.species} in Iceland`),
        statTile(d.stats.municipalities, 'Sveitarfélög',
          `of ${meta.totals.municipalities} visited`),
        statTile(d.stats.checklists, 'My checklists'),
        statTile(d.stats.rowsIceland, 'My observations',
          `${d.stats.firstDate} – ${d.stats.lastDate}`)));
    } else {
      statsHost.appendChild(el('div', { class: 'stats' },
        statTile(meta.totals.species, 'Species recorded',
          `${meta.totals.taxa} taxa incl. spuh/hybrids`),
        statTile(meta.totals.checklists, 'Checklists', 'shared checklists counted once'),
        statTile(meta.totals.observations, 'Observations'),
        statTile(meta.totals.observers, 'eBirders')));
    }
  }

  const mapHost = el('div', {});
  root.appendChild(mapHost);

  function drawMap() {
    drawStats();
    mapHost.textContent = '';
    const t = mapModeToggle(drawMap);
    if (t) mapHost.appendChild(t);
    const { values, label } = mapValues(meta);
    const pts = myPoints();
    mapHost.appendChild(renderMap(geo, values, {
      onSelect: slug => { location.hash = `#/mun/${slug}`; },
      label, points: pts
    }));
    if (state.mapMode === 'mine') {
      mapHost.appendChild(el('p', { class: 'note',
        text: 'Coloured by the species you have recorded in each sveitarfélag, ' +
              `grey where you have none. The ${fmtNum(pts.length)} dots are your ` +
              'own localities — hover for the checklist and species count.' }));
    }
  }
  drawMap();

  // --- municipality table ---
  const tableWrap = el('div', { class: 'table-wrap' });
  let sortKey = 'species', sortDir = -1;

  const cols = [
    ['name', 'Sveitarfélag', 'l'],
    ['regionName', 'eBird region', 'l'],
    ['species', 'Species', 'n'],
    ['checklists', 'Checklists', 'n'],
    ['observations', 'Observations', 'n'],
    ['observers', 'eBirders', 'n'],
    ['areaKm2', 'Area km²', 'n']
  ];

  function draw() {
    const rows = [...meta.municipalities].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') return sortDir * x.localeCompare(y, 'is');
      return sortDir * ((x || 0) - (y || 0));
    });

    tableWrap.textContent = '';
    tableWrap.appendChild(el('table', { class: 'table' },
      el('thead', {}, el('tr', {}, cols.map(([k, label, al]) =>
        el('th', {
          class: (al === 'n' ? 'num ' : '') + 'sortable' +
                 (k === sortKey ? (sortDir < 0 ? ' sort-desc' : ' sort-asc') : ''),
          onclick: () => {
            if (sortKey === k) sortDir = -sortDir;
            else { sortKey = k; sortDir = (typeof rows[0][k] === 'string') ? 1 : -1; }
            draw();
          }
        }, label)))),
      el('tbody', {}, rows.map(m => el('tr', {},
        el('td', {}, el('a', { href: `#/mun/${m.slug}` }, m.name)),
        el('td', { class: 'muted' }, m.region
          ? extLink(ebird.region(m.region), m.regionName) : '—'),
        el('td', { class: 'num strong', text: fmtNum(m.species) }),
        el('td', { class: 'num', text: fmtNum(m.checklists) }),
        el('td', { class: 'num', text: fmtNum(m.observations) }),
        el('td', { class: 'num', text: fmtNum(m.observers) }),
        el('td', { class: 'num muted', text: m.areaKm2 ? fmtNum(Math.round(m.areaKm2)) : '—' })
      )))
    ));
  }
  draw();
  root.appendChild(tableWrap);
  root.appendChild(footer(meta));
}

// -----------------------------------------------------------------------------
// bird list
// -----------------------------------------------------------------------------

// `areaCode` is the postal number when viewing one area of a sveitarfelag.
// The area view is the same page with an extra filter rather than a parallel
// implementation: its rows come from the municipality's own obs.json, which
// already indexes into checklists that carry the area.
async function viewBirdList(root, slug, areaCode) {
  root.appendChild(loading());
  const [sum, tax, meta] = await Promise.all([
    loadSummary(slug), loadTaxonomy(), loadMeta()
  ]);
  root.textContent = '';

  const area = areaCode ? findArea(sum, areaCode) : null;
  if (areaCode && !area) {
    root.appendChild(el('div', { class: 'error' },
      el('h2', { text: `No such ${areaKindLabel(sum.areas).toLowerCase()} here` }),
      el('p', {}, el('a', { href: `#/mun/${slug}` }, `← ${sum.name}`))));
    return;
  }

  root.appendChild(munHeader(sum, 'birdlist', area));

  const statsHost = el('div', {});
  root.appendChild(statsHost);

  const mapHost = el('div', {});
  root.appendChild(mapHost);

  if (slug !== OPEN_SEA_SLUG) {
    const drawMap = async () => {
      mapHost.textContent = '';
      const t = mapModeToggle(() => { drawMap(); draw(); });
      if (t) mapHost.appendChild(t);
      if (area) {
        // Zoomed to the area, with its sibling areas drawn and clickable --
        // the same drill-down the municipality level gets.
        const ageo = await loadAreaGeo();
        const { values, label } = areaMapValues(meta);
        mapHost.appendChild(renderMap(ageo, values, {
          zoomTo: area.id, selected: area.id,
          idKey: 'area_id', nameKey: 'label',
          onSelect: id => areaHref(id, ageo),
          onZoomOut: () => { location.hash = `#/mun/${slug}/areas`; },
          label, points: myPoints()
        }));
      } else {
        const geo = await loadGeo();
        const { values, label } = mapValues(meta);
        mapHost.appendChild(renderMap(geo, values, {
          zoomTo: slug, selected: slug,
          onSelect: s => { location.hash = `#/mun/${s}`; },
          onZoomOut: () => { location.hash = '#/'; },
          label, points: myPoints()
        }));
      }
    };
    drawMap();
  }

  const body = el('div', { class: 'birdlist-body' });
  root.appendChild(body);
  root.appendChild(footer(meta));

  const years = [...new Set(sum.species.flatMap(s => s.y))].sort((a, b) => b - a);

  async function draw() {
    body.textContent = '';

    // Controls
    const monthNames = state.lang === 'is' ? MONTHS_IS : MONTHS_EN;
    body.appendChild(el('div', { class: 'controls' },
      el('div', { class: 'control-group' },
        el('label', { text: 'Year' }),
        el('select', {
          onchange: e => { state.year = e.target.value; state.page = 0; draw(); }
        },
          el('option', { value: 'all', selected: state.year === 'all' }, 'All years'),
          years.map(y => el('option', { value: String(y), selected: state.year === String(y) }, String(y))))
      ),
      el('div', { class: 'control-group' },
        el('label', { text: 'Month' }),
        el('select', {
          onchange: e => { state.month = e.target.value; state.page = 0; draw(); }
        },
          el('option', { value: 'all', selected: state.month === 'all' }, 'All months'),
          monthNames.map((m, i) => el('option', {
            value: String(i), selected: state.month === String(i)
          }, m)))
      ),
      el('div', { class: 'control-group grow' },
        el('label', { text: 'Find' }),
        el('input', {
          type: 'search', placeholder: 'species name…', value: state.query,
          oninput: e => { state.query = e.target.value; state.page = 0; redrawTable(); }
        })
      ),
      pills([['last', 'Last Observed'], ['first', 'First Observed'],
             ['high', 'High Count'], ['taxon', 'Taxonomic']],
        state.sort, v => { state.sort = v; state.page = 0; redrawTable(); })
    ));

    // With a personal export loaded, the useful question stops being "what is
    // here" and becomes "what is here that I still need".
    const mine = area ? mySpeciesInArea(area.id) : mySpeciesIn(slug);
    const where = area ? area.label : sum.name;
    if (hasMyData()) {
      // Your list can contain species this list does not: a record still under
      // review, or made after the EBD cut-off. Say so rather than letting the
      // two counts quietly disagree.
      const inList = new Set(sum.species.map(s => s.c));
      const absent = mine ? [...mine].filter(c => !inList.has(c)) : [];

      body.appendChild(el('div', { class: 'controls' },
        el('div', { class: 'control-group' },
          el('label', { text: 'My records' }),
          pills([['all', 'All species'], ['seen', 'Seen here'], ['needed', 'Not seen here']],
            state.seenFilter, v => { state.seenFilter = v; state.page = 0; redrawTable(); })),
        el('span', { class: 'muted', text: mine && mine.size
          ? `you have ${mine.size} species here`
          : `you have no records from ${where}` })));

      if (absent.length) {
        const one = absent.length === 1;
        body.appendChild(el('p', { class: 'note' },
          `${absent.length} of your ${mine.size} species here ` +
          `(${absent.map(c => spName(tax.get(c), state.lang)).join(', ')}) ` +
          `${one ? 'is' : 'are'} not in this EBD release for ${where}, so ` +
          `${one ? 'it cannot' : 'they cannot'} be ticked below — most likely ` +
          `still under review, or recorded after 30 Jun 2026.`));
      }
    }

    const tableHost = el('div', {});
    body.appendChild(tableHost);

    // All-years comes straight from summary.json. Anything narrower is
    // recomputed from the observations, which have to be fetched first.
    let rows, totals;
    const filtered = state.year !== 'all' || state.month !== 'all';
    // summary.json answers the all-years municipality question directly. An
    // area, or any narrower date range, has to be recomputed from the
    // observations.
    if (!filtered && !area) {
      rows = sum.species.map(s => ({ ...s }));
      totals = {
        checklists: sum.stats.checklists, complete: sum.stats.complete,
        observations: sum.stats.observations, observers: sum.stats.observers,
        mediaSpecies: sum.stats.media
      };
    } else {
      tableHost.appendChild(loading('Filtering observations…'));
      const [obs, chk] = await Promise.all([loadObs(slug), loadChecklists(slug)]);
      const y = state.year === 'all' ? null : +state.year;
      const m = state.month === 'all' ? null : +state.month;
      const areaIdx = area ? chk.areas.indexOf(area.id) : null;
      const res = birdListForRange(obs, chk,
        { yearFrom: y, yearTo: y, month: m, areaIdx });
      const byCode = new Map(sum.species.map(s => [s.c, s]));
      rows = [...res.rows.values()].map(r => ({ ...r, x: byCode.get(r.c)?.x ?? 1,
                                                ord: byCode.get(r.c)?.ord ?? 0 }));
      totals = res.totals;
    }

    // Tiles follow the filter, so the headline numbers always describe the
    // table underneath them.
    const nSpecies = rows.filter(r => r.x).length;
    statsHost.textContent = '';

    const myData = getMyData();
    const myRange = area ? myDateRangeInArea(area.id) : null;
    const myHere = area
      ? (mine && mine.size
          ? { species: [...mine], checklists: myChecklistCountInArea(area.id),
              first: myRange && myRange.first, last: myRange && myRange.last }
          : null)
      : (myData && myData.municipalities[slug]);
    if (state.mapMode === 'mine' && myData) {
      // In "Mín gögn" mode the headline has to be about you, not about everyone
      // -- showing the all-eBirders totals above your own map is the mismatch
      // this mode exists to fix.
      const mineCount = myHere ? myHere.species.length : 0;
      const pct = nSpecies ? Math.round(100 * mineCount / nSpecies) : 0;
      statsHost.appendChild(el('div', { class: 'stats' },
        statTile(mineCount, 'My species', `of ${nSpecies} recorded here`),
        statTile(myHere ? myHere.checklists : 0, 'My checklists'),
        statTile(pct, 'Coverage', '% of what is recorded here'),
        statTile(nSpecies, 'Recorded here', 'by all eBirders')));
      statsHost.appendChild(el('p', { class: 'note' }, myHere
        ? `Your records here run ${myHere.first} – ${myHere.last}. ` +
          `The list below is everything recorded in ${sum.name}, with yours ticked.`
        : `You have no records from ${sum.name}. The list below is everything ` +
          `other eBirders have recorded here.`));
    } else {
      statsHost.appendChild(el('div', { class: 'stats' },
        statTile(nSpecies, 'Species observed',
          `${rows.length} taxa incl. spuh/hybrids`),
        statTile(totals.complete, 'Complete checklists', `${fmtNum(totals.checklists)} total`),
        statTile(totals.mediaSpecies, 'Species w/ media', 'photo or audio'),
        statTile(totals.observers, 'eBirders')));
    }
    if (filtered) {
      statsHost.appendChild(el('p', { class: 'note',
        text: `Filtered to ${state.year === 'all' ? 'all years' : state.year}` +
              `${state.month === 'all' ? '' : ', ' +
                (state.lang === 'is' ? MONTHS_IS : MONTHS_EN)[+state.month]}.` }));
    }

    function redrawTable() {
      tableHost.textContent = '';
      tableHost.appendChild(birdTable(rows, sum, tax, slug, redrawTable, mine,
                                      area ? myRecordsInArea(area.id)
                                           : myRecordsIn(slug), areaCode));
    }
    redrawTable();
  }

  draw();
}

function birdTable(rows, sum, tax, slug, redraw, mine, myRecs, areaCode) {
  const lang = state.lang;
  const showSeen = hasMyData();
  // In "Mín gögn" mode the row describes *your* sighting where you have one.
  // Species you have not seen keep the all-eBirders record, which is exactly
  // the information you need in order to go and find them.
  const personal = showSeen && state.mapMode === 'mine' && myRecs;
  // When every row is yours the table is simply your life list: the observer is
  // always you, and a tick against every row says nothing. eBird's own life
  // list shows neither. On the needs list both earn their place again -- those
  // rows are other people's records, and who found the bird is the useful part.
  const mineOnly = personal && state.seenFilter === 'seen';
  const hideObserver = mineOnly;

  let list = rows;
  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    list = list.filter(r => {
      const t = tax.get(r.c);
      return t && ((t.is || '') + ' ' + t.en + ' ' + t.sci).toLowerCase().includes(q);
    });
  }
  if (showSeen && state.seenFilter !== 'all') {
    const seen = mine || new Set();
    list = list.filter(r => state.seenFilter === 'seen' ? seen.has(r.c) : !seen.has(r.c));
  }

  // In "Mín gögn" the dates being sorted on are yours, not the last time anyone
  // else saw the bird -- otherwise "Last Observed" ranks by a stranger's
  // sighting while the row shows your own.
  const ownDay = (r, which) => {
    const o = myRecs && myRecs[r.c];
    return o ? isoToDay(which === 'first' ? o.f : o.d) : null;
  };
  const key = personal
    ? { last:  r => -(ownDay(r, 'last')  ?? r.last.d),
        first: r => -(ownDay(r, 'first') ?? r.first.d),
        high:  r => -((myRecs[r.c]?.hi) ?? r.high?.n ?? -1),
        taxon: r => r.ord }[state.sort]
    : { last: r => -r.last.d, first: r => -r.first.d,
        high: r => -(r.high?.n ?? -1), taxon: r => r.ord }[state.sort];

  // Taxonomic order breaks ties, and it has to break them in the *opposite*
  // direction to the ordinal assignment below. Several species share a first
  // date -- a single morning's outing adds a handful at once -- and without a
  // matching tiebreak the life-list numbers jump around inside that day
  // (…47, 36, 37, 38…) instead of counting down the way eBird's list does.
  list = [...list].sort((a, b) => (key(a) - key(b)) ||
                                  (state.sort === 'first' ? b.ord - a.ord : a.ord - b.ord));

  // With your data loaded the number becomes your life-list ordinal for this
  // region, the way eBird's life list numbers species: 1 is the first you ever
  // recorded here, N the most recent addition. It stays attached to the species
  // whatever the table is sorted by.
  let lifeOrdinal = null;
  if (personal) {
    lifeOrdinal = new Map();
    const byCode = new Map(rows.map(r => [r.c, r]));
    Object.entries(myRecs)
      .filter(([c]) => byCode.get(c)?.x)
      .sort((a, b) => a[1].f.localeCompare(b[1].f) ||
                      (byCode.get(a[0]).ord - byCode.get(b[0]).ord))
      .forEach(([c], i) => lifeOrdinal.set(c, i + 1));
  }

  // eBird numbers only the countable species and lists the rest below.
  const countable = list.filter(r => r.x);
  const other = list.filter(r => !r.x);

  const total = countable.length + other.length;
  const start = state.page * PAGE;
  const shown = [...countable, ...other].slice(start, start + PAGE);

  const table = el('table', { class: 'table birdlist' },
    el('thead', {}, el('tr', {},
      el('th', { class: 'num-col',
                 title: personal ? 'your life-list number here' : null }, '#'),
      showSeen && !mineOnly
        ? el('th', { class: 'seen-col', title: 'in your own eBird data' }, '✓') : null,
      el('th', {}, 'Species'),
      el('th', { class: 'num' }, 'Count'),
      el('th', {}, state.sort === 'first' ? 'First seen' : 'Date'),
      hideObserver ? null : el('th', {}, 'Observer'),
      el('th', {}, 'Location'))),
    el('tbody', {}, shown.map((r, i) => {
      const t = tax.get(r.c);
      const rank = !r.x ? ''
        : (lifeOrdinal && lifeOrdinal.has(r.c)
            ? String(lifeOrdinal.get(r.c)) + '.'
            : String(countable.indexOf(r) + 1) + '.');
      const seenHere = mine && mine.has(r.c);

      // Whose record this row shows.
      const own = personal ? myRecs[r.c] : null;
      let count, dateNum, dateStr, sub, locId, locName, locType, observer;
      if (own) {
        count = state.sort === 'high' ? own.hi : own.n;
        // Your first sighting when the table is sorted by it, your latest
        // otherwise. Only the latest carries a checklist and locality, so a
        // first-observed row shows the date alone.
        dateStr = state.sort === 'first' ? own.f : own.d;
        sub = state.sort === 'first' && own.f !== own.d ? null : own.s;
        locId = own.l; locName = own.ln; locType = own.lt;
        observer = null;               // it is you
      } else {
        const rec = state.sort === 'first' ? r.first
                  : (state.sort === 'high' ? r.high : r.last);
        count = rec.n;
        dateNum = rec.d;
        sub = rec.s;
        locId = sum.locs.id[rec.l];
        locName = sum.locs.name[rec.l];
        locType = sum.locs.type[rec.l];
        observer = rec.b;
      }

      return el('tr', { class: (r.x ? '' : 'is-other') + (seenHere ? ' is-seen' : '') },
        el('td', { class: 'num-col muted', text: rank }),
        showSeen && !mineOnly
          ? el('td', { class: 'seen-col', title: seenHere ? 'you have seen this here' : '' },
              seenHere ? '✓' : '') : null,
        el('td', {},
          el('a', { class: 'sp-name', href: areaCode
              ? `#/mun/${slug}/area/${areaCode}/species/${r.c}`
              : `#/mun/${slug}/species/${r.c}` },
            spName(t, lang)),
          el('span', { class: 'sp-sec', text: ' ' + spSecondary(t, lang) }),
          // Observation count and checklist count are identical by construction:
          // the rollup leaves one row per checklist per species. Show one number.
          el('span', { class: 'sp-meta', text: own
            ? `you: ${fmtNum(own.k)} of ${fmtNum(r.k)} checklist${r.k === 1 ? '' : 's'}`
            : `${fmtNum(r.k)} checklist${r.k === 1 ? '' : 's'}` })
        ),
        el('td', { class: 'num', text: fmtCount(count) }),
        el('td', {}, sub
          ? extLink(ebird.checklist(sub),
              own ? fmtDate(isoToDay(dateStr), lang) : fmtDate(dateNum, lang))
          : el('span', { text: fmtDate(isoToDay(dateStr), lang) })),
        hideObserver ? null
          : el('td', {}, own
              ? el('span', { class: 'obsr is-you', text: lang === 'is' ? 'þú' : 'you' })
              : extLink(ebird.observer(observer), observer, 'obsr')),
        el('td', {},
          extLink(ebird.hotspot(locId, locType), locName,
                  locType === 'H' ? '' : 'personal-loc')));
    }))
  );

  const wrap = el('div', { class: 'table-wrap' }, table);

  if (total > PAGE) {
    const pages = Math.ceil(total / PAGE);
    wrap.appendChild(el('div', { class: 'pager' },
      el('button', {
        class: 'pill', disabled: state.page === 0 || null,
        onclick: () => { state.page--; redraw(); }
      }, '‹ Previous'),
      el('span', { class: 'pager-info',
        text: `${start + 1}–${Math.min(start + PAGE, total)} of ${total}` }),
      el('button', {
        class: 'pill', disabled: state.page >= pages - 1 || null,
        onclick: () => { state.page++; redraw(); }
      }, 'Next ›')));
  }

  if (!total) wrap.appendChild(el('div', { class: 'empty', text: 'No species match.' }));
  if (other.length) {
    wrap.appendChild(el('p', { class: 'note' },
      `${other.length} unnumbered entries are spuh, slash, hybrid or domestic taxa. ` +
      `eBird does not count these towards the species total, and neither does this page.`));
  }
  return wrap;
}

// -----------------------------------------------------------------------------
// species detail
// -----------------------------------------------------------------------------

async function viewSpecies(root, slug, code, areaCode) {
  root.appendChild(loading());
  const [sum, tax, obs, chk, meta] = await Promise.all([
    loadSummary(slug), loadTaxonomy(), loadObs(slug), loadChecklists(slug), loadMeta()
  ]);
  root.textContent = '';

  const t = tax.get(code);
  const lang = state.lang;
  const area = areaCode ? findArea(sum, areaCode) : null;
  const areaIdx = area ? chk.areas.indexOf(area.id) : null;
  const recs = observationsForSpecies(obs, chk, code, areaIdx);

  root.appendChild(munHeader(sum, 'birdlist', area));

  root.appendChild(el('div', { class: 'sp-head' },
    el('div', {},
      // The title leads to the Iceland-wide view: which sveitarfelog is it in?
      el('h2', { class: 'sp-title' },
        el('a', { href: `#/species/${code}`,
                  title: 'See every sveitarfélag this taxon has been recorded in' },
          spName(t, lang))),
      el('div', { class: 'sp-sub' },
        el('span', { text: t ? t.en : '' }),
        el('em', { text: t ? t.sci : '' }),
        t ? el('span', { class: 'muted', text: t.fam }) : null)),
    el('div', { class: 'sp-actions' },
      el('a', { class: 'btn', href: `#/species/${code}` }, 'Where else in Ísland? ›'),
      extLink(ebird.species(code, sum.region),
        `Open in eBird${sum.regionName ? ' — ' + sum.regionName : ''} ›`, 'btn btn-ghost'),
      el('div', { class: 'note',
        text: 'eBird has no municipality level, so that link is scoped to the parent region.' }))
  ));

  if (!recs.length) {
    root.appendChild(el('div', { class: 'empty', text: 'No records here.' }));
    return;
  }

  const counts = recs.map(r => r.n).filter(n => n !== null);
  const years = [...new Set(recs.map(r => dayYear(r.d)))].sort();
  root.appendChild(el('div', { class: 'stats' },
    // One row per checklist per species after the rollup, so an observation
    // count here would just repeat the checklist count.
    statTile(recs.length, 'Checklists'),
    statTile(new Set(recs.map(r => r.loc)).size, 'Localities'),
    statTile(counts.length ? Math.max(...counts) : 0, 'High count'),
    statTile(years.length, 'Years recorded', yearSpan(years))
  ));

  root.appendChild(monthChart(recs, lang));
  root.appendChild(yearChart(recs));

  root.appendChild(el('div', { class: 'table-wrap' },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Date'), el('th', { class: 'num' }, 'Count'),
        el('th', {}, 'Observer'), el('th', {}, 'Location'), el('th', {}, ''))),
      el('tbody', {}, recs.slice(0, 500).map(r => el('tr', {},
        el('td', {}, extLink(ebird.checklist(r.sub), fmtDate(r.d, lang))),
        el('td', { class: 'num', text: fmtCount(r.n) }),
        el('td', {}, extLink(ebird.observer(r.obsr), r.obsr, 'obsr')),
        el('td', {}, extLink(ebird.hotspot(chk.locs.id[r.loc], chk.locs.type[r.loc]),
          chk.locs.name[r.loc], chk.locs.type[r.loc] === 'H' ? '' : 'personal-loc')),
        el('td', { class: 'muted', text: r.media ? '📷' : '' })
      ))))));

  if (recs.length > 500) {
    root.appendChild(el('p', { class: 'note',
      text: `Showing the 500 most recent of ${fmtNum(recs.length)} records.` }));
  }
  root.appendChild(footer(meta));
}

function monthChart(recs, lang) {
  const by = new Array(12).fill(0);
  for (const r of recs) by[dayMonth(r.d)]++;
  const max = Math.max(...by, 1);
  const names = lang === 'is' ? MONTHS_IS : MONTHS_EN;
  return el('div', { class: 'chart' },
    el('h3', { text: 'By month' }),
    el('div', { class: 'bars' }, by.map((v, i) =>
      el('div', { class: 'bar-col', title: `${names[i]}: ${v}` },
        el('div', { class: 'bar', style: `height:${(v / max * 100).toFixed(1)}%` }),
        el('span', { class: 'bar-label', text: names[i] })))));
}

function yearChart(recs) {
  const by = new Map();
  for (const r of recs) {
    const y = dayYear(r.d);
    by.set(y, (by.get(y) || 0) + 1);
  }
  const years = [...by.keys()].sort((a, b) => a - b);
  if (years.length < 2) return el('div');
  const full = [];
  for (let y = years[0]; y <= years[years.length - 1]; y++) full.push([y, by.get(y) || 0]);
  const max = Math.max(...full.map(f => f[1]), 1);
  const step = Math.ceil(full.length / 14);
  return el('div', { class: 'chart' },
    el('h3', { text: 'By year' }),
    el('div', { class: 'bars' }, full.map(([y, v], i) =>
      el('div', { class: 'bar-col', title: `${y}: ${v}` },
        el('div', { class: 'bar', style: `height:${(v / max * 100).toFixed(1)}%` }),
        el('span', { class: 'bar-label', text: i % step === 0 ? String(y) : '' })))));
}

// -----------------------------------------------------------------------------
// checklists
// -----------------------------------------------------------------------------

async function viewChecklists(root, slug, areaCode) {
  root.appendChild(loading('Loading checklists…'));
  const [sum, chk, meta] = await Promise.all([
    loadSummary(slug), loadChecklists(slug), loadMeta()
  ]);
  root.textContent = '';

  const area = areaCode ? findArea(sum, areaCode) : null;
  root.appendChild(munHeader(sum, 'checklists', area));

  // Restricted to one postal area when viewing it; the area lives on the
  // checklist, so this is a plain filter over the same payload.
  const areaIdx = area ? chk.areas.indexOf(area.id) : -1;
  const idx = [];
  for (let i = 0; i < chk.sub.length; i++) {
    if (areaIdx < 0 || chk.area[i] === areaIdx) idx.push(i);
  }
  const n = idx.length;
  let sortKey = 'date', sortDir = -1, page = 0, q = '';

  // Your own submission ids here, so the list can be narrowed to your visits.
  const myCl = myChecklistsIn(slug);
  const mySubs = myCl ? new Set(myCl.map(c => c.s)) : null;
  let onlyMine = hasMyData() && state.mapMode === 'mine' && !!mySubs;

  const host = el('div', {});
  root.appendChild(host);
  root.appendChild(footer(meta));

  const value = {
    date: i => chk.date[i],
    loc:  i => chk.locs.name[chk.loc[i]],
    obsr: i => chk.obsrs[chk.obsr[i]],
    proto: i => chk.protos[chk.proto[i]],
    dur:  i => chk.dur[i] ?? -1,
    dist: i => chk.dist[i] ?? -1,
    nsp:  i => chk.nsp[i]
  };

  const cols = [
    ['date', 'Date', ''], ['loc', 'Location', ''], ['obsr', 'Observer', ''],
    ['proto', 'Protocol', ''], ['dur', 'Duration', 'num'],
    ['dist', 'Distance', 'num'], ['nsp', 'Species', 'num']
  ];

  function draw() {
    host.textContent = '';
    host.appendChild(el('div', { class: 'controls' },
      el('div', { class: 'control-group grow' },
        el('label', { text: 'Find' }),
        el('input', {
          type: 'search', placeholder: 'location or observer…', value: q,
          oninput: e => { q = e.target.value; page = 0; draw(); }
        })),
      mySubs
        ? el('div', { class: 'control-group' },
            el('label', { text: 'Whose' }),
            pills([['all', 'Everyone'], ['mine', 'Mín gögn']],
              onlyMine ? 'mine' : 'all',
              v => { onlyMine = v === 'mine'; page = 0; draw(); }))
        : null,
      el('div', { class: 'control-group' },
        el('span', { class: 'muted', text: `${fmtNum(n)} checklists` }))
    ));

    let rows = idx;
    if (onlyMine && mySubs) rows = rows.filter(i => mySubs.has(chk.sub[i]));
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter(i =>
        value.loc(i).toLowerCase().includes(s) || value.obsr(i).toLowerCase().includes(s));
    }
    rows = [...rows].sort((a, b) => {
      const x = value[sortKey](a), y = value[sortKey](b);
      if (typeof x === 'string') return sortDir * x.localeCompare(y, 'is');
      return sortDir * (x - y);
    });

    const start = page * PAGE;
    const shown = rows.slice(start, start + PAGE);

    host.appendChild(el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, cols.map(([k, label, cls]) =>
          el('th', {
            class: `${cls} sortable${k === sortKey ? (sortDir < 0 ? ' sort-desc' : ' sort-asc') : ''}`,
            onclick: () => {
              if (sortKey === k) sortDir = -sortDir;
              else { sortKey = k; sortDir = -1; }
              draw();
            }
          }, label)))),
        el('tbody', {}, shown.map(i => el('tr', {},
          el('td', {},
            extLink(ebird.checklist(chk.sub[i]), fmtDate(chk.date[i], state.lang)),
            chk.time[i] ? el('span', { class: 'muted', text: ' ' + chk.time[i].slice(0, 5) }) : null,
            chk.shared[i] ? el('span', { class: 'tag', title: 'shared checklist', text: 'shared' }) : null),
          el('td', {}, extLink(
            ebird.hotspot(chk.locs.id[chk.loc[i]], chk.locs.type[chk.loc[i]]),
            chk.locs.name[chk.loc[i]],
            chk.locs.type[chk.loc[i]] === 'H' ? '' : 'personal-loc')),
          el('td', {}, extLink(ebird.observer(chk.obsrs[chk.obsr[i]]),
            chk.obsrs[chk.obsr[i]], 'obsr')),
          el('td', { class: 'muted', text: chk.protos[chk.proto[i]] }),
          el('td', { class: 'num', text: fmtDuration(chk.dur[i]) }),
          el('td', { class: 'num', text: chk.dist[i] != null ? chk.dist[i] + ' km' : '' }),
          el('td', { class: 'num strong', text: chk.nsp[i] ? String(chk.nsp[i]) : '' })
        )))),
      el('div', { class: 'pager' },
        el('button', {
          class: 'pill', disabled: page === 0 || null,
          onclick: () => { page--; draw(); }
        }, '‹ Previous'),
        el('span', { class: 'pager-info',
          text: `${rows.length ? start + 1 : 0}–${Math.min(start + PAGE, rows.length)} of ${fmtNum(rows.length)}` }),
        el('button', {
          class: 'pill', disabled: start + PAGE >= rows.length || null,
          onclick: () => { page++; draw(); }
        }, 'Next ›'))
    ));
  }
  draw();
}

// -----------------------------------------------------------------------------
// species across Iceland  (#/species/{code})
// -----------------------------------------------------------------------------

async function viewSpeciesRange(root, code) {
  root.appendChild(loading());
  const [sp, tax, meta, geo] = await Promise.all([
    loadSpecies(code), loadTaxonomy(), loadMeta(), loadGeo()
  ]);
  root.textContent = '';

  const t = tax.get(code);
  const lang = state.lang;

  root.appendChild(el('div', { class: 'mun-head' },
    el('div', { class: 'crumbs' },
      el('a', { href: '#/' }, 'Ísland'),
      el('span', { text: ' / ' }),
      el('a', { href: '#/species' }, 'Tegundir')),
    el('div', { class: 'sp-head' },
      el('div', {},
        el('h1', { text: spName(t, lang) }),
        el('div', { class: 'sp-sub' },
          el('span', { text: t ? t.en : '' }),
          el('em', { text: t ? t.sci : '' }),
          t ? el('span', { class: 'muted', text: t.fam }) : null)),
      el('div', { class: 'sp-actions' },
        extLink(ebird.species(code, 'IS'), 'Open in eBird — Ísland ›', 'btn')))
  ));

  if (!sp.countable) {
    root.appendChild(el('p', { class: 'note' },
      'This is a spuh, slash, hybrid or domestic taxon. eBird does not count it ' +
      'towards a species total, and neither does this site.'));
  }

  const host = el('div', {});
  root.appendChild(host);
  root.appendChild(footer(meta));

  // Your own records of this taxon, keyed by municipality: which sveitarfélög
  // you have it in, and your latest sighting in each.
  function myRange() {
    const d = getMyData();
    if (!d) return null;
    const out = [];
    for (const [slug, m] of Object.entries(d.municipalities)) {
      const rec = m.sp && m.sp[code];
      if (rec) {
        const info = meta.municipalities.find(x => x.slug === slug);
        out.push({ slug, name: info ? info.name : slug,
                   region: info ? info.region : '', regionName: info ? info.regionName : '',
                   rec });
      }
    }
    return out.sort((a, b) => b.rec.k - a.rec.k);
  }

  function draw() {
    host.textContent = '';
    const t2 = mapModeToggle(draw);
    if (t2) host.appendChild(t2);

    const mine = state.mapMode === 'mine' ? myRange() : null;

    if (mine) {
      const totalK = mine.reduce((a, m) => a + m.rec.k, 0);
      const counts = mine.map(m => m.rec.hi).filter(n => n !== null && n !== undefined);
      const years = [...new Set(mine.map(m => +m.rec.f.slice(0, 4))
        .concat(mine.map(m => +m.rec.d.slice(0, 4))))].sort();
      host.appendChild(el('div', { class: 'stats' },
        statTile(mine.length, 'My sveitarfélög', `of ${sp.municipalities} with records`),
        statTile(totalK, 'My checklists', `of ${fmtNum(sp.checklists)} in Iceland`),
        statTile(counts.length ? Math.max(...counts) : 0, 'My high count',
          `Iceland high ${fmtNum(sp.highCount ?? 0)}`),
        statTile(years.length, 'My years', yearSpan(years))));
    } else {
      host.appendChild(el('div', { class: 'stats' },
        statTile(sp.municipalities, 'Sveitarfélög', `of ${meta.totals.municipalities} with records`),
        statTile(sp.checklists, 'Checklists'),
        statTile(sp.highCount ?? 0, 'High count'),
        statTile(sp.years.length, 'Years recorded', yearSpan(sp.years))));
    }

    // Where in Iceland: the same choropleth, coloured by this taxon's checklist
    // count rather than by species richness.
    const values = mine
      ? new Map(mine.map(m => [m.slug, m.rec.k]))
      : new Map(sp.mun.map(m => [m.slug, m.k]));
    // In "Mín gögn" the dots are the localities where you actually saw it,
    // not every locality you have ever birded.
    const points = mine
      ? (myLocalities() || []).filter(L =>
          mine.some(m => m.rec.l === L.id))
      : [];

    host.appendChild(renderMap(geo, values, {
      onSelect: slug => {
        if (values.has(slug)) location.hash = `#/mun/${slug}/species/${code}`;
      },
      label: 'checklists', points
    }));

    host.appendChild(el('p', { class: 'note' }, mine
      ? `Coloured by your own checklists of this taxon in each sveitarfélag; grey ` +
        `where you have none. The dots are where you saw it.`
      : 'Grey sveitarfélög have no record of this taxon. Click a coloured one for ' +
        'its records there. Hafsvæði (open sea) has no polygon; see the table below.'));

    host.appendChild(mine ? myTable(mine) : allTable());
  }

  function allTable() {
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'num-col' }, '#'),
          el('th', {}, 'Sveitarfélag'),
          el('th', {}, 'eBird region'),
          el('th', { class: 'num' }, 'Checklists'),
          el('th', { class: 'num' }, 'High'),
          el('th', {}, 'Last observed'),
          el('th', {}, 'Observer'),
          el('th', {}, 'Location'))),
        el('tbody', {}, sp.mun.map((m, i) => el('tr', {},
          el('td', { class: 'num-col muted', text: `${i + 1}.` }),
          el('td', {},
            el('a', { class: 'sp-name', href: `#/mun/${m.slug}/species/${code}` }, m.name),
            el('span', { class: 'sp-meta', text: yearSpan(m.y) })),
          el('td', { class: 'muted' }, m.region
            ? extLink(ebird.region(m.region), m.regionName) : '—'),
          el('td', { class: 'num strong', text: fmtNum(m.k) }),
          el('td', { class: 'num', text: fmtCount(m.high.n) }),
          el('td', {}, extLink(ebird.checklist(m.last.s), fmtDate(m.last.d, lang))),
          el('td', {}, extLink(ebird.observer(m.last.b), m.last.b, 'obsr')),
          el('td', {}, extLink(ebird.hotspot(m.last.l, m.last.lt), m.last.ln,
                               m.last.lt === 'H' ? '' : 'personal-loc'))
        )))));
  }

  function myTable(mine) {
    if (!mine.length) {
      return el('div', { class: 'empty' },
        el('p', { text: `You have no records of ${spName(t, lang)} in Iceland.` }),
        el('p', { class: 'note' },
          'Switch to All eBirders to see where other people have found it.'));
    }
    return el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'num-col' }, '#'),
          el('th', {}, 'Sveitarfélag'),
          el('th', {}, 'eBird region'),
          el('th', { class: 'num' }, 'My checklists'),
          el('th', { class: 'num' }, 'My high'),
          el('th', {}, 'First seen'),
          el('th', {}, 'Last seen'),
          el('th', {}, 'Location'))),
        el('tbody', {}, mine.map((m, i) => el('tr', { class: 'is-seen' },
          el('td', { class: 'num-col muted', text: `${i + 1}.` }),
          el('td', {},
            el('a', { class: 'sp-name', href: `#/mun/${m.slug}/species/${code}` }, m.name)),
          el('td', { class: 'muted' }, m.region
            ? extLink(ebird.region(m.region), m.regionName) : '—'),
          el('td', { class: 'num strong', text: fmtNum(m.rec.k) }),
          el('td', { class: 'num', text: fmtCount(m.rec.hi) }),
          el('td', { class: 'muted', text: fmtDate(isoToDay(m.rec.f), lang) }),
          el('td', {}, extLink(ebird.checklist(m.rec.s),
                               fmtDate(isoToDay(m.rec.d), lang))),
          el('td', {}, extLink(ebird.hotspot(m.rec.l, m.rec.lt), m.rec.ln,
                               m.rec.lt === 'H' ? '' : 'personal-loc'))
        )))));
  }

  draw();
}

// -----------------------------------------------------------------------------
// species index  (#/species)
// -----------------------------------------------------------------------------

async function viewSpeciesIndex(root) {
  root.appendChild(loading());
  const [idx, tax, meta] = await Promise.all([
    loadSpeciesIndex(), loadTaxonomy(), loadMeta()
  ]);
  root.textContent = '';

  root.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Tegundir' },
      el('span', { class: 'page-head-sub', text: ' — allar tegundir á Íslandi' })),
    el('p', { class: 'lede' },
      `${meta.totals.species} species and ${meta.totals.taxa - meta.totals.species} ` +
      `other taxa recorded in Iceland. Pick one to see which sveitarfélög it has ` +
      `been found in.`)
  ));

  const host = el('div', {});
  root.appendChild(host);
  root.appendChild(footer(meta));

  let q = '', sortKey = 'ord', sortDir = 1, page = 0;

  function draw() {
    host.textContent = '';
    host.appendChild(el('div', { class: 'controls' },
      el('div', { class: 'control-group grow' },
        el('label', { text: 'Find' }),
        el('input', {
          type: 'search', placeholder: 'Icelandic, English or scientific name…',
          value: q,
          oninput: e => { q = e.target.value; page = 0; draw(); }
        })),
      pills([['ord', 'Taxonomic'], ['m', 'Most widespread'],
             ['k', 'Most checklists'], ['lastDate', 'Recently seen']],
        sortKey, v => { sortKey = v; sortDir = v === 'ord' ? 1 : -1; page = 0; draw(); })
    ));

    let rows = idx;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter(r => {
        const t = tax.get(r.c);
        return t && ((t.is || '') + ' ' + t.en + ' ' + t.sci).toLowerCase().includes(s);
      });
    }
    rows = [...rows].sort((a, b) => sortDir * ((a[sortKey] || 0) - (b[sortKey] || 0)));

    const start = page * PAGE;
    const shown = rows.slice(start, start + PAGE);

    host.appendChild(el('div', { class: 'table-wrap' },
      el('table', { class: 'table birdlist' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Species'),
          el('th', { class: 'num' }, 'Sveitarfélög'),
          el('th', { class: 'num' }, 'Checklists'),
          el('th', {}, 'First'),
          el('th', {}, 'Last'))),
        el('tbody', {}, shown.map(r => {
          const t = tax.get(r.c);
          return el('tr', { class: r.countable ? '' : 'is-other' },
            el('td', {},
              el('a', { class: 'sp-name', href: `#/species/${r.c}` }, spName(t, state.lang)),
              el('span', { class: 'sp-sec', text: ' ' + spSecondary(t, state.lang) })),
            el('td', { class: 'num strong', text: fmtNum(r.m) }),
            el('td', { class: 'num', text: fmtNum(r.k) }),
            el('td', { class: 'muted', text: fmtDate(r.firstDate, state.lang) }),
            el('td', { text: fmtDate(r.lastDate, state.lang) }));
        }))),
      el('div', { class: 'pager' },
        el('button', {
          class: 'pill', disabled: page === 0 || null,
          onclick: () => { page--; draw(); }
        }, '‹ Previous'),
        el('span', { class: 'pager-info',
          text: `${rows.length ? start + 1 : 0}–${Math.min(start + PAGE, rows.length)} of ${rows.length}` }),
        el('button', {
          class: 'pill', disabled: start + PAGE >= rows.length || null,
          onclick: () => { page++; draw(); }
        }, 'Next ›'))));
  }
  draw();
}

// -----------------------------------------------------------------------------
// sub-areas of one sveitarfelag  (#/mun/{slug}/areas)
// -----------------------------------------------------------------------------

// Both layers are keyed by URL code, so find by code rather than postal number:
// a named neighbourhood has no number.
function findArea(sum, code) {
  return (sum.areas || []).find(a => String(a.code) === String(code));
}

// A neighbouring area drawn on the map can be navigated to even though it
// belongs to another sveitarfelag -- otherwise those polygons would be visible
// but dead. The id cannot be parsed for this ("0000-reykjavikurborg-midborg"
// splits ambiguously), so read the slug and code the exporter put on the
// feature.
function areaHref(areaId, geo) {
  const f = geo && geo.features.find(x => x.properties.area_id === areaId);
  if (f) location.hash = `#/mun/${f.properties.slug}/area/${f.properties.code}`;
}

// What this municipality's fourth level is called.
function areaKindLabel(areas, plural) {
  const named = areas && areas.length && areas[0].kind === 'hverfi';
  if (named) return plural ? 'Hverfi' : 'hverfi';
  return plural ? 'Póstnúmer' : 'póstnúmer';
}

async function viewAreas(root, slug) {
  root.appendChild(loading());
  const [sum, meta, ageo] = await Promise.all([
    loadSummary(slug), loadMeta(), loadAreaGeo()
  ]);
  root.textContent = '';

  root.appendChild(munHeader(sum, 'areas'));

  const areas = [...(sum.areas || [])].sort((a, b) => b.species - a.species);
  if (!areas.length) {
    root.appendChild(el('div', { class: 'empty',
      text: 'No postal areas with records here.' }));
    root.appendChild(footer(meta));
    return;
  }

  const { values, label } = areaMapValues(meta);
  root.appendChild(renderMap(ageo, values, {
    zoomTo: areas.map(a => a.id),   // frames the whole sveitarfelag
    idKey: 'area_id', nameKey: 'label',
    onSelect: id => areaHref(id, ageo),
    onZoomOut: () => { location.hash = `#/mun/${slug}`; },
    label, points: myPoints()
  }));
  root.appendChild(el('p', { class: 'note' },
    `${sum.name} is covered by ${areas.length} ${areaKindLabel(areas).toLowerCase()}. ` +
    (areas[0].kind === 'hverfi'
      ? `Neighbourhood names come from Hagstofa Íslands. `
      : `Postal boundaries come from Byggðastofnun. `) +
    `Each area is the intersection with the sveitarfélag, so it lies wholly ` +
    `inside it and together they tile it.`));

  const mine = hasMyData();
  root.appendChild(el('div', { class: 'table-wrap' },
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', { class: 'num-col' }, '#'),
        el('th', {}, areaKindLabel(areas, true)),
        el('th', { class: 'num' }, 'Species'),
        mine ? el('th', { class: 'num' }, 'Mine') : null,
        el('th', { class: 'num' }, 'Checklists'),
        el('th', { class: 'num' }, 'Localities'),
        el('th', { class: 'num' }, 'eBirders'),
        el('th', { class: 'num' }, 'km²'))),
      el('tbody', {}, areas.map((a, i) => {
        const my = mine ? mySpeciesInArea(a.id) : null;
        return el('tr', {},
          el('td', { class: 'num-col muted', text: `${i + 1}.` }),
          el('td', {},
            el('a', { class: 'sp-name', href: `#/mun/${slug}/area/${a.code}` }, a.label),
            el('span', { class: 'sp-meta', text: `${a.taxa} taxa incl. spuh/hybrids` })),
          el('td', { class: 'num strong', text: fmtNum(a.species) }),
          mine ? el('td', { class: 'num' + (my && my.size ? ' is-mine' : ' muted'),
                            text: my ? fmtNum(my.size) : '0' }) : null,
          el('td', { class: 'num', text: fmtNum(a.checklists) }),
          el('td', { class: 'num muted', text: fmtNum(a.localities) }),
          el('td', { class: 'num muted', text: fmtNum(a.observers) }),
          el('td', { class: 'num muted', text: fmtNum(a.areaKm2) }));
      }))
    )));

  root.appendChild(footer(meta));
}

// -----------------------------------------------------------------------------
// my data  (#/me)
// -----------------------------------------------------------------------------

async function viewMyData(root) {
  root.appendChild(loading());
  const [meta, tax] = await Promise.all([loadMeta(), loadTaxonomy()]);
  root.textContent = '';

  root.appendChild(el('div', { class: 'page-head' },
    el('h1', { text: 'Mín gögn' },
      el('span', { class: 'page-head-sub', text: ' — your own eBird data' })),
    el('p', { class: 'lede' },
      'Upload your eBird export to see your own records placed in sveitarfélög: ' +
      'where you have birded, what you have seen there, and what you have not.')
  ));

  const host = el('div', {});
  root.appendChild(host);
  root.appendChild(footer(meta));

  function draw() {
    host.textContent = '';
    const data = getMyData();
    host.appendChild(data ? summaryPane(data) : uploadPane());
  }

  // --- privacy notice, restated wherever the file is asked for ---
  function privacyNote() {
    return el('div', { class: 'privacy' },
      el('strong', { text: 'Your file stays in this browser.' }),
      el('p', {},
        'It is read and analysed locally by JavaScript on this page. It is not ' +
        'uploaded — this site is static files with no server to receive it. ' +
        'If you save it, it goes into this browser’s localStorage on this ' +
        'device only, and "Remove my data" erases it.'),
      el('p', { class: 'muted' },
        'An eBird export is a record of where you have been and when. Treat it ' +
        'accordingly, and do not upload one that is not yours.'));
  }

  function uploadPane() {
    const status = el('div', { class: 'upload-status' });
    const input = el('input', {
      type: 'file', accept: '.csv,text/csv', id: 'csvfile',
      onchange: e => { if (e.target.files[0]) handle(e.target.files[0]); }
    });

    const drop = el('label', { class: 'dropzone', for: 'csvfile' },
      el('div', { class: 'dropzone-icon', text: '↑' }),
      el('div', { class: 'dropzone-main', text: 'Choose your MyEBirdData.csv' }),
      el('div', { class: 'dropzone-sub', text: 'or drag it here' }),
      input);

    for (const ev of ['dragenter', 'dragover']) {
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('is-over'); });
    }
    for (const ev of ['dragleave', 'drop']) {
      drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('is-over'); });
    }
    drop.addEventListener('drop', e => {
      const f = e.dataTransfer.files[0];
      if (f) handle(f);
    });

    async function handle(file) {
      status.textContent = '';
      status.appendChild(loading(`Reading ${file.name}…`));
      try {
        const text = await file.text();
        const data = await importCSV(text);
        const saved = saveMyData(data);
        if (!saved) {
          status.textContent = '';
          status.appendChild(el('p', { class: 'note' },
            'Loaded, but too large to save in this browser — it will be here ' +
            'for this session only.'));
        }
        draw();
      } catch (err) {
        status.textContent = '';
        status.appendChild(el('div', { class: 'error-box' },
          el('strong', { text: 'Could not read that file' }),
          el('p', { text: String(err.message || err) })));
      }
    }

    return el('div', {},
      drop,
      status,
      privacyNote(),
      el('div', { class: 'howto' },
        el('h3', { text: 'Getting the file' }),
        el('ol', {},
          el('li', {}, 'Sign in at ',
            extLink('https://ebird.org/downloadMyData', 'ebird.org/downloadMyData')),
          el('li', {}, 'Request your data; eBird emails you a zip.'),
          el('li', {}, 'Unzip it and pick ', el('code', { text: 'MyEBirdData.csv' }), '.')),
        el('p', { class: 'note' },
          'The export covers your whole life list. Only rows in Iceland ' +
          '(State/Province IS-1 … IS-8) are read; everything else is ignored.')));
  }

  function summaryPane(data) {
    const wrap = el('div', {});
    const s = data.stats;
    const totalMun = meta.municipalities.length;

    wrap.appendChild(el('div', { class: 'stats' },
      statTile(s.species, 'Species observed', `of ${meta.totals.species} in Iceland`),
      statTile(s.municipalities, 'Sveitarfélög', `of ${totalMun} visited`),
      statTile(s.checklists, 'Checklists'),
      statTile(s.rowsIceland, 'Observations',
        `${s.firstDate} – ${s.lastDate}`)
    ));

    wrap.appendChild(el('div', { class: 'controls' },
      el('button', {
        class: 'pill',
        // Drop back to the all-eBirders maps too, so nothing is left pointing
        // at data that no longer exists.
        onclick: () => { clearMyData(); setMapMode('all'); draw(); }
      }, 'Remove my data'),
      el('label', { class: 'pill', for: 'csvreplace' }, 'Replace file'),
      el('input', {
        type: 'file', accept: '.csv,text/csv', id: 'csvreplace', style: 'display:none',
        onchange: async e => {
          const f = e.target.files[0];
          if (!f) return;
          try {
            saveMyData(await importCSV(await f.text()));
            draw();
          } catch (err) { alert(String(err.message || err)); }
        }
      }),
      el('span', { class: 'muted', text: `imported ${data.imported}` })
    ));

    // Map of where they have birded.
    const values = new Map(Object.entries(data.municipalities)
      .map(([slug, m]) => [slug, m.species.length]));
    loadGeo().then(geo => {
      mapHost.textContent = '';
      mapHost.appendChild(renderMap(geo, values, {
        // Clicking out of your own map should stay in your own map.
        onSelect: slug => { setMapMode('mine'); location.hash = `#/mun/${slug}`; },
        label: 'species seen', points: data.locs || []
      }));
      mapHost.appendChild(el('p', { class: 'note' },
        'Grey sveitarfélög are ones you have no records from. Click any to see ' +
        'its full bird list, with your species marked.'));
    });
    const mapHost = el('div', {}, loading('Drawing map…'));
    wrap.appendChild(mapHost);

    // Coverage table: what you have vs what has been recorded there.
    const totals = new Map(meta.municipalities.map(m => [m.slug, m]));
    const rows = Object.entries(data.municipalities).map(([slug, m]) => {
      const t = totals.get(slug);
      return {
        slug, name: t ? t.name : slug, region: t ? t.regionName : '',
        mine: m.species.length, total: t ? t.species : 0,
        checklists: m.checklists, last: m.last
      };
    }).sort((a, b) => b.mine - a.mine);

    wrap.appendChild(el('div', { class: 'table-wrap' },
      el('table', { class: 'table' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'num-col' }, '#'),
          el('th', {}, 'Sveitarfélag'),
          el('th', {}, 'eBird region'),
          el('th', { class: 'num' }, 'My species'),
          el('th', { class: 'num' }, 'Recorded there'),
          el('th', { class: 'num' }, 'Coverage'),
          el('th', { class: 'num' }, 'My checklists'),
          el('th', {}, 'Last visit'))),
        el('tbody', {}, rows.map((r, i) => el('tr', {},
          el('td', { class: 'num-col muted', text: `${i + 1}.` }),
          el('td', {}, el('a', {
            class: 'sp-name', href: `#/mun/${r.slug}`,
            onclick: () => setMapMode('mine')
          }, r.name)),
          el('td', { class: 'muted', text: r.region }),
          el('td', { class: 'num strong', text: fmtNum(r.mine) }),
          el('td', { class: 'num muted', text: fmtNum(r.total) }),
          el('td', { class: 'num' }, coverageBar(r.mine, r.total)),
          el('td', { class: 'num', text: fmtNum(r.checklists) }),
          el('td', { class: 'muted', text: r.last })
        ))))));

    // Anything the import could not do cleanly, said plainly.
    const w = data.warnings;
    const notes = [];
    if (s.placedByPolygon) {
      notes.push(`${fmtNum(s.placedByPolygon)} of your observations were at ` +
        `localities not in this EBD release, so they were placed by testing ` +
        `their coordinates against the municipality boundaries directly.`);
    }
    if (w.notInDataset && w.notInDataset.length) {
      // These are named by scientific name on purpose: the site's taxonomy only
      // covers taxa recorded in Iceland, so it has no Icelandic name for them.
      const names = w.notInDataset.map(x => x.sci).join(', ');
      const one = w.notInDataset.length === 1;
      notes.push(`${w.notInDataset.length} species in your data ` +
        `${one ? 'is' : 'are'} not in this EBD release — pending review, or ` +
        `recorded after its 30 Jun 2026 cut-off: ${names}. ` +
        `${one ? 'It counts' : 'They count'} towards your species total but ` +
        `cannot be ticked off in a sveitarfélag bird list, because the list ` +
        `does not contain ${one ? 'it' : 'them'} yet.`);
    }
    if (w.unplacedTotal) {
      notes.push(`${fmtNum(w.unplacedTotal)} observations could not be placed in ` +
        `any sveitarfélag (most likely at sea).`);
    }
    if (w.unknownTaxa.length) {
      notes.push(`${w.unknownTaxa.length} taxa were not recognised by the eBird ` +
        `taxonomy this site was built against: ${w.unknownTaxa.slice(0, 5).join(', ')}.`);
    }
    if (notes.length) {
      wrap.appendChild(el('div', { class: 'howto' },
        el('h3', { text: 'Notes on your import' }),
        el('ul', {}, notes.map(n => el('li', { text: n })))));
    }

    wrap.appendChild(privacyNote());
    return wrap;
  }

  draw();
}

function coverageBar(mine, total) {
  if (!total) return el('span', { class: 'muted', text: '—' });
  const pct = Math.round(100 * mine / total);
  return el('span', { class: 'coverage', title: `${mine} of ${total}` },
    el('span', { class: 'coverage-bar' },
      el('span', { class: 'coverage-fill', style: `width:${pct}%` })),
    el('span', { class: 'coverage-pct', text: `${pct}%` }));
}

// -----------------------------------------------------------------------------
// shared chrome
// -----------------------------------------------------------------------------

function munHeader(sum, active, area) {
  const nAreas = (sum.areas || []).length;
  return el('div', { class: 'mun-head' },
    el('div', { class: 'crumbs' },
      el('a', { href: '#/' }, 'Ísland'),
      el('span', { text: ' / ' }),
      sum.region
        ? extLink(ebird.region(sum.region), sum.regionName, 'muted')
        : el('span', { class: 'muted', text: 'utan sveitarfélaga' }),
      area ? el('span', { text: ' / ' }) : null,
      area ? el('a', { href: `#/mun/${sum.slug}` }, sum.name) : null),
    el('h1', {}, area ? area.label : sum.name),
    area ? el('p', { class: 'note' },
      `${area.kind === 'hverfi' ? 'Hverfi' : 'Póstnúmer'} within ${sum.name} — ` +
      `${area.areaKm2} km², ${fmtNum(area.localities)} eBird localities.`) : null,
    // Only worth flagging where boat and pelagic checklists are a real share of
    // the data: those carry a single coordinate for a whole route, so they are
    // attributed to one municipality rather than split along the route.
    sum.slug === OPEN_SEA_SLUG
      ? el('p', { class: 'note' },
          `Checklists more than 30 km from the nearest municipality: open-ocean ` +
          `crossings, ferries and deep-water seabird trips. They sit outside every ` +
          `sveitarfélag, so they are collected here rather than dropped.`)
      : sum.stats.offshoreChecklists > 0.02 * sum.stats.checklists
        ? el('p', { class: 'note' },
            `${fmtNum(sum.stats.offshoreChecklists)} of ${fmtNum(sum.stats.checklists)} ` +
            `checklists here are at offshore localities (boat trips, bird islands, ` +
            `ferry legs) assigned to this, the nearest municipality.`)
        : null,
    el('div', { class: 'tabs' },
      el('a', { class: 'tab' + (active === 'birdlist' ? ' is-active' : ''),
                href: area ? `#/mun/${sum.slug}/area/${area.code}`
                           : `#/mun/${sum.slug}` }, 'Bird List'),
      el('a', { class: 'tab' + (active === 'checklists' ? ' is-active' : ''),
                href: area ? `#/mun/${sum.slug}/area/${area.code}/checklists`
                           : `#/mun/${sum.slug}/checklists` }, 'Checklists'),
      // Only offered where postal codes actually subdivide the municipality;
      // 16 of 61 are a single postal area, where the tab would say nothing.
      (!area && nAreas > 1)
        ? el('a', { class: 'tab' + (active === 'areas' ? ' is-active' : ''),
                    href: `#/mun/${sum.slug}/areas` },
            `${areaKindLabel(sum.areas, true)} (${nAreas})`)
        : null)
  );
}

function footer(meta) {
  return el('footer', { class: 'foot' },
    el('p', {}, meta.citation),
    el('p', {},
      `Municipality boundaries: ${meta.lmiVersion}, Landmælingar Íslands (CC BY 4.0). `,
      `Built ${meta.generated} from ${meta.ebdRelease}.`),
    el('p', { class: 'muted' },
      'Observer display names are not distributed in the eBird Basic Dataset, so ' +
      'eBirders appear as their eBird id. The links resolve to their profiles.')
  );
}

export {
  viewHome, viewBirdList, viewSpecies, viewChecklists, viewAreas,
  viewSpeciesRange, viewSpeciesIndex, viewMyData, state, setLang
};
