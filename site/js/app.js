// app.js -- hash router and boot.

import {
  viewHome, viewBirdList, viewSpecies, viewChecklists, viewAreas,
  viewSpeciesRange, viewSpeciesIndex, viewMyData, state, setLang
} from './views.js';
import { el } from './format.js';

const root = document.getElementById('view');

// Most specific first: the area routes have to be matched before the plainer
// municipality ones they extend.
const routes = [
  [/^#?\/?$/,                                  () => viewHome(root)],
  [/^#\/me$/,                                  () => viewMyData(root, 'overview')],
  [/^#\/me\/firsts$/,                          () => viewMyData(root, 'firsts')],
  [/^#\/species$/,                             () => viewSpeciesIndex(root)],
  [/^#\/species\/([^/]+)$/,                    (m) => viewSpeciesRange(root, m[1])],
  [/^#\/mun\/([^/]+)\/areas$/,                 (m) => viewAreas(root, m[1])],
  [/^#\/mun\/([^/]+)\/area\/([^/]+)\/checklists$/,
                                               (m) => viewChecklists(root, m[1], m[2])],
  [/^#\/mun\/([^/]+)\/area\/([^/]+)\/species\/([^/]+)$/,
                                               (m) => viewSpecies(root, m[1], m[3], m[2])],
  [/^#\/mun\/([^/]+)\/area\/([^/]+)$/,         (m) => viewBirdList(root, m[1], m[2])],
  [/^#\/mun\/([^/]+)\/species\/([^/]+)$/,      (m) => viewSpecies(root, m[1], m[2])],
  [/^#\/mun\/([^/]+)\/checklists$/,            (m) => viewChecklists(root, m[1])],
  [/^#\/mun\/([^/]+)$/,                        (m) => viewBirdList(root, m[1])]
];

async function route() {
  const h = location.hash || '#/';
  root.textContent = '';
  window.scrollTo(0, 0);
  syncLangButtons();

  for (const [re, handler] of routes) {
    const m = h.match(re);
    if (m) {
      try {
        await handler(m);
      } catch (err) {
        console.error(err);
        root.textContent = '';
        root.appendChild(el('div', { class: 'error' },
          el('h2', { text: 'Could not load that view' }),
          el('p', { text: String(err.message || err) }),
          el('p', { class: 'note' },
            'If this says "Failed to fetch", the site is being opened straight from ' +
            'disk. Browsers block reading local JSON over file://. Serve the folder ' +
            'instead — see README.'),
          el('p', {}, el('a', { href: '#/' }, '← Back to the map'))));
      }
      return;
    }
  }
  root.appendChild(el('div', { class: 'error' },
    el('h2', { text: 'Not found' }),
    el('p', {}, el('a', { href: '#/' }, '← Back to the map'))));
}

function syncLangButtons() {
  document.querySelectorAll('[data-lang]').forEach(b => {
    b.classList.toggle('is-active', b.dataset.lang === state.lang);
  });
}

document.querySelectorAll('[data-lang]').forEach(b => {
  b.addEventListener('click', () => setLang(b.dataset.lang));
});

window.addEventListener('hashchange', route);
route();
