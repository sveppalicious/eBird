// app.js -- boot, shell and routing.
//
// The shell owns the three things every page shares: the language, whose data
// is on show, and the tree of regions under that source. A page is handed a
// provider and never asks which one it is.

import {
  html, render, useState, useEffect, useMemo, App, useRoute, regionHref, Loading, ErrorBox, useAsync
} from './ui/core.js';
import { makeT, initialLang, saveLang } from './i18n.js';
import { remote, loadMeta, loadGeo, loadAreaGeo, loadTaxonomy, loadTree } from './data/remote.js';
import { loadMine, mineProvider } from './data/mine.js';
import { fmtDate } from './lib/format.js';
import { RegionPage } from './ui/RegionPage.js';
import { SpeciesPage } from './ui/SpeciesPage.js';
import { MyDataPage } from './ui/MyDataPage.js';
import { Search } from './ui/Search.js';

const SOURCE_KEY = 'source';
const initialSource = () => {
  try { return localStorage.getItem(SOURCE_KEY) === 'mine' ? 'mine' : 'all'; } catch { return 'all'; }
};

function Shell() {
  const route = useRoute();
  const [lang, setLangState] = useState(initialLang);
  const [source, setSourceState] = useState(initialSource);
  const [mine, setMine] = useState(undefined);         // undefined until storage has answered

  const boot = useAsync(() => Promise.all([
    loadMeta(), loadTaxonomy(), loadTree(), loadGeo(), loadAreaGeo(), loadMine()
  ]).then(([meta, tax, baseTree, geo, areaGeo, table]) => {
    setMine(table);
    return { meta, tax, baseTree, geo, areaGeo };
  }), []);

  const t = useMemo(() => makeT(lang), [lang]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = l => { saveLang(l); setLangState(l); };
  const setSource = s => {
    try { localStorage.setItem(SOURCE_KEY, s); } catch { /* storage disabled */ }
    setSourceState(s);
  };

  // Old URLs keep working.
  useEffect(() => { if (route.redirect) location.replace(route.redirect); }, [route]);
  // The old firsts link meant "my firsts".
  useEffect(() => { if (route.q && route.q.tab === 'firsts' && mine && source !== 'mine') setSource('mine'); }, [route, mine]);

  // A new page starts at the top; a new tab or filter on the same page does not.
  const place = `${route.page}|${route.regionId || ''}|${route.code || ''}`;
  useEffect(() => { window.scrollTo(0, 0); }, [place]);

  // "Mine" only means something once there is a table.
  const effective = source === 'mine' && mine ? 'mine' : 'all';
  const ctx = useMemo(() => {
    if (!boot.data) return null;
    const { meta, tax, baseTree, geo, areaGeo } = boot.data;
    const provider = effective === 'mine' ? mineProvider(mine, baseTree) : remote;
    return {
      lang, t, setLang, source: effective, setSource, mine: mine || null, setMine,
      meta, tax, baseTree, geo, areaGeo, provider,
      tree: effective === 'mine' ? provider.tree : baseTree
    };
  }, [boot.data, lang, t, effective, mine]);

  if (boot.error) return html`<main><${ErrorBox} error=${boot.error} t=${t} /></main>`;
  if (!ctx || route.redirect) return html`<main><${Loading} t=${t} /></main>`;

  const page =
    route.page === 'region' ? html`<${RegionPage} regionId=${route.regionId} q=${route.q} />`
    : route.page === 'species' ? html`<${SpeciesPage} code=${route.code} regionId=${route.regionId} />`
    : route.page === 'me' ? html`<${MyDataPage} />`
    : html`<div class="error"><h2>${t('notfound.page')}</h2><p><a href="#/">← ${t('nav.home')}</a></p></div>`;

  return html`<${App.Provider} value=${ctx}>
    <header class="topbar">
      <a class="brand" href="#/">
        <span class="brand-mark">eBird</span>
        <span class="brand-rest">${t('brand.sub')}</span>
      </a>
      <${Search} />
      <div class="topnav">
        <div class="switch" role="group" aria-label=${t('source.label')}>
          <button type="button" data-source="all" aria-pressed=${effective === 'all' ? 'true' : 'false'}
                  class=${effective === 'all' ? 'is-active' : ''} onClick=${() => setSource('all')}>${t('source.all')}</button>
          <button type="button" data-source="mine" aria-pressed=${effective === 'mine' ? 'true' : 'false'}
                  class=${effective === 'mine' ? 'is-active' : ''}
                  onClick=${() => { if (mine) setSource('mine'); else location.hash = '#/me'; }}>${t('source.mine')}</button>
        </div>
        <a class="topnav-link" href="#/me">${t('nav.myfile')}</a>
        <div class="switch" role="group" aria-label=${t('lang.label')}>
          <button type="button" data-lang="is" class=${lang === 'is' ? 'is-active' : ''} onClick=${() => setLang('is')}>ÍS</button>
          <button type="button" data-lang="en" class=${lang === 'en' ? 'is-active' : ''} onClick=${() => setLang('en')}>EN</button>
        </div>
      </div>
    </header>
    <main id="view">${page}</main>
    <footer class="foot">
      <p>${t('foot.cutoff', { d: fmtDate(ctx.meta.dateRange[1], lang) })}</p>
      <p>${ctx.meta.citation}</p>
      <p>${t('foot.boundaries', { v: ctx.meta.lmiVersion, built: ctx.meta.generated })}</p>
      <p class="muted">${t('foot.observers')}</p>
    </footer>
  <//>`;
}

render(html`<${Shell} />`, document.getElementById('app'));
