// core.js -- the renderer, the router, and the handful of pieces every page uses.

import {
  html, render, createContext, useState, useEffect, useLayoutEffect, useRef,
  useMemo, useCallback, useContext
} from '../../vendor/preact/standalone.module.js';
import { COUNTRY } from '../lib/regions.js';

// Everything a page needs that is not its own: language, whose data, the tree.
const App = createContext(null);
const useApp = () => useContext(App);

// ---- routing -----------------------------------------------------------------
//
//   #/                         Iceland
//   #/r/{regionId}             any region
//   #/s/{code}[/{regionId}]    a species, scoped to a region
//   #/me                       the personal export
//
// Tab and year ride in a query after the path (#/r/x?tab=checklists&year=2026),
// so a view is a link and the back button does what it says.

function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs));
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);

  if (seg.length === 0) return { page: 'region', regionId: COUNTRY, q };
  if (seg[0] === 'r' && seg[1]) return { page: 'region', regionId: seg[1], q };
  if (seg[0] === 's' && seg[1]) return { page: 'species', code: seg[1], regionId: seg[2] || COUNTRY, q };
  // Exactly #/me: #/me/firsts is an old URL and belongs to the redirects below.
  if (seg[0] === 'me' && seg.length === 1) return { page: 'me', q };

  const legacy = legacyRedirect(seg);
  return legacy ? { redirect: legacy } : { page: 'notfound', q };
}

// The first version of the site was public under different URLs. Keep them
// working: a bookmark that 404s is a small betrayal.
function legacyRedirect(seg) {
  if (seg[0] === 'species') return seg[1] ? speciesHref(seg[1]) : regionHref(COUNTRY);
  if (seg[0] === 'me' && seg[1] === 'firsts') return regionHref(COUNTRY, { tab: 'firsts' });
  if (seg[0] !== 'mun' || !seg[1]) return null;
  const slug = seg[1];
  if (seg[2] === 'area' && seg[3]) {
    const id = `${slug}-${seg[3]}`;
    if (seg[4] === 'checklists') return regionHref(id, { tab: 'checklists' });
    if (seg[4] === 'species' && seg[5]) return speciesHref(seg[5], id);
    return regionHref(id);
  }
  if (seg[2] === 'areas') return regionHref(slug, { tab: 'areas' });
  if (seg[2] === 'checklists') return regionHref(slug, { tab: 'checklists' });
  if (seg[2] === 'species' && seg[3]) return speciesHref(seg[3], slug);
  return regionHref(slug);
}

function withQuery(path, q) {
  const entries = Object.entries(q || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return entries.length ? `${path}?${new URLSearchParams(entries)}` : path;
}

function regionHref(id, q) {
  return withQuery(id === COUNTRY || !id ? '#/' : `#/r/${encodeURIComponent(id)}`, q);
}

function speciesHref(code, id, q) {
  const base = `#/s/${encodeURIComponent(code)}`;
  return withQuery(id && id !== COUNTRY ? `${base}/${encodeURIComponent(id)}` : base, q);
}

function useRoute() {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

// Change the query without leaving a history entry for every filter touched.
function replaceQuery(patch) {
  const r = parseHash(location.hash);
  const q = { ...r.q, ...patch };
  const next = r.page === 'species' ? speciesHref(r.code, r.regionId, q) : regionHref(r.regionId, q);
  history.replaceState(null, '', next);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

// ---- async data --------------------------------------------------------------

// Run an async loader when its inputs change. While the next answer is on its
// way the previous one stays up, flagged stale -- so changing tab or region
// dims the page for a moment rather than blanking it and jumping the layout.
function useAsync(fn, deps) {
  const [state, setState] = useState({ data: undefined, error: null, loading: true, key: 0 });
  const run = useRef(0);
  useEffect(() => {
    const id = ++run.current;
    setState(s => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      data => { if (run.current === id) setState({ data, error: null, loading: false }); },
      error => { if (run.current === id) setState({ data: undefined, error, loading: false }); }
    );
  }, deps);
  return state;
}

// ---- small components ---------------------------------------------------------

const ExtLink = ({ href, class: cls, children }) =>
  (href ? html`<a href=${href} class=${cls || ''} target="_blank" rel="noopener">${children}</a>`
        : html`<span class=${cls || ''}>${children}</span>`);

function Stat({ value, label, sub, lead }) {
  return html`<div class=${'stat' + (lead ? ' is-lead' : '')}>
    <div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>
    ${sub ? html`<div class="stat-sub">${sub}</div>` : null}
  </div>`;
}

function Tabs({ tabs, active }) {
  return html`<nav class="tabs" role="tablist">
    ${tabs.map(t => html`<a key=${t.id} role="tab" href=${t.href} data-tab=${t.id}
      aria-selected=${t.id === active ? 'true' : 'false'}
      class=${'tab' + (t.id === active ? ' is-active' : '')}>${t.label}</a>`)}
  </nav>`;
}

function Pills({ options, value, onPick, label }) {
  return html`<div class="pills" role="group" aria-label=${label || ''}>
    ${options.map(([v, text]) => html`<button key=${v} type="button"
      class=${'pill' + (v === value ? ' is-active' : '')}
      aria-pressed=${v === value ? 'true' : 'false'}
      onClick=${() => onPick(v)}>${text}</button>`)}
  </div>`;
}

const PAGE = 100;

function Pager({ page, total, onPage, t }) {
  if (total <= PAGE) return null;
  const start = page * PAGE;
  const n = v => v.toLocaleString('de-DE');
  return html`<div class="pager">
    <button type="button" class="pill" disabled=${page === 0} onClick=${() => onPage(page - 1)}>${t('pager.prev')}</button>
    <span class="pager-info">${t('pager.of', { a: n(start + 1), b: n(Math.min(start + PAGE, total)), n: n(total) })}</span>
    <button type="button" class="pill" disabled=${start + PAGE >= total} onClick=${() => onPage(page + 1)}>${t('pager.next')}</button>
  </div>`;
}

const Loading = ({ t }) => html`<div class="loading">${t('loading')}</div>`;

function ErrorBox({ error, t }) {
  return html`<div class="error"><h2>${t('error.title')}</h2><p class="muted">${String((error && error.message) || error)}</p></div>`;
}

export {
  html, render, useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback,
  App, useApp, parseHash, regionHref, speciesHref, useRoute, replaceQuery, useAsync,
  ExtLink, Stat, Tabs, Pills, Pager, PAGE, Loading, ErrorBox
};
