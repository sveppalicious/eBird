// Search.js -- one box for species and places.
//
// It replaces the navigation: with every page reachable by typing its name,
// there is nothing left for a row of links to do.

import { html, useState, useMemo, useRef, useApp, regionHref, speciesHref } from './core.js';
import { spName, spSecondary, fold } from '../lib/format.js';

const MAX_SPECIES = 7, MAX_PLACES = 5;

function Search() {
  const { tax, baseTree, t, lang } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef(null);
  // Closing waits a moment after blur so a click on a result can land first.
  // That timer has to be cancelled when the box is used again, or a blur from
  // one search closes the list of the next one out from under the pointer.
  const closing = useRef(null);
  const show = () => { clearTimeout(closing.current); setOpen(true); };

  // Folded once: every keystroke would otherwise re-fold 500 names.
  const index = useMemo(() => ({
    species: [...tax.values()].map(x => ({ code: x.c, tx: x, key: fold(`${x.is} ${x.en} ${x.sci}`) })),
    places: baseTree.all().filter(r => r.kind !== 'country')
      .map(r => ({ id: r.id, r, key: fold(r.name), parent: baseTree.parent(r.id) }))
  }), [tax, baseTree]);

  const results = useMemo(() => {
    const f = fold(q.trim());
    if (f.length < 2) return [];
    // A match at the start of a word outranks one buried inside it.
    const rank = key => (key.startsWith(f) ? 0 : key.includes(' ' + f) ? 1 : 2);
    const sp = index.species.filter(s => s.key.includes(f))
      .sort((a, b) => rank(a.key) - rank(b.key) || a.tx.ord - b.tx.ord).slice(0, MAX_SPECIES)
      .map(s => ({ href: speciesHref(s.code), main: spName(s.tx, lang), sub: spSecondary(s.tx, lang), kind: t('search.species') }));
    const pl = index.places.filter(p => p.key.includes(f))
      .sort((a, b) => rank(a.key) - rank(b.key) || b.r.checklists - a.r.checklists).slice(0, MAX_PLACES)
      .map(p => ({ href: regionHref(p.id), main: p.r.name, kind: t('kind.' + p.r.kind),
                   sub: p.parent && p.parent.kind !== 'country' ? p.parent.name : '' }));
    return [...sp, ...pl];
  }, [q, index, lang]);

  const go = r => {
    if (!r) return;
    location.hash = r.href;
    setQ(''); setOpen(false);
    if (input.current) input.current.blur();
  };

  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return html`<div class="search" role="search">
    <input ref=${input} type="search" value=${q} placeholder=${t('search.placeholder')}
           aria-label=${t('search.placeholder')} autocomplete="off" spellcheck=${false}
           role="combobox" aria-expanded=${open && results.length ? 'true' : 'false'} aria-controls="search-results"
           onInput=${e => { setQ(e.target.value); setActive(0); show(); }}
           onFocus=${show} onKeyDown=${onKey}
           onBlur=${() => { closing.current = setTimeout(() => setOpen(false), 150); }} />
    ${open && q.trim().length >= 2 ? html`<ul class="search-results" id="search-results" role="listbox">
      ${results.length ? results.map((r, i) => html`<li role="option" aria-selected=${i === active ? 'true' : 'false'}
          class=${i === active ? 'is-active' : ''}
          onMouseDown=${e => { e.preventDefault(); go(r); }} onMouseEnter=${() => setActive(i)}>
        <span class="search-main">${r.main}</span>
        ${r.sub ? html`<span class="search-sub">${r.sub}</span>` : null}
        <span class="search-kind">${r.kind}</span>
      </li>`) : html`<li class="search-empty">${t('search.none')}</li>`}
    </ul>` : null}
  </div>`;
}

export { Search };
