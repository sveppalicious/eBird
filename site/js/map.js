// map.js -- interactive choropleth of Iceland as inline SVG.
//
// The projection is Web Mercator, in a fixed world square of WORLD units. That
// choice is what lets slippy-map tiles drop straight in: a tile (x, y, z)
// occupies exactly WORLD/2^z units at WORLD*x/2^z, WORLD*y/2^z, so an optional
// basemap needs no reprojection and no mapping library.
//
// Polygons are projected once into that world space and never redrawn. Panning
// and zooming only move the SVG viewBox, so dragging a 61-polygon country map
// costs nothing; only the tiles and the point radii are recomputed.
//
// A basemap is off by default. With it off the page makes no network requests
// beyond its own data, which is what keeps the site self-contained.

import { el } from './format.js';

const WORLD = 4096;          // edge of the projected world square
const TILE = 256;            // slippy tile size in CSS pixels

const BASEMAPS = {
  none: { label: 'Ekkert', url: null, attribution: null },
  osm: {
    label: 'Kort',
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    attribution: '© OpenStreetMap contributors',
    href: 'https://www.openstreetmap.org/copyright',
    maxZoom: 19
  },
  sat: {
    label: 'Gervihnöttur',
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    attribution: 'Esri, Maxar, Earthstar Geographics',
    href: 'https://www.esri.com/',
    maxZoom: 19
  }
};

// eBird's ramp: pale yellow through orange to red.
const RAMP = ['#f5e79e', '#f2d180', '#eeb46c', '#e89463', '#e2705f', '#d94a54'];
const EMPTY_FILL = '#e4e4e2';

function rampColor(t) {
  if (t <= 0) return RAMP[0];
  const x = Math.min(0.999, t) * (RAMP.length - 1);
  const i = Math.floor(x);
  return mix(RAMP[i], RAMP[i + 1], x - i);
}

function mix(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.substr(i, 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(b.substr(i, 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)
    .toString(16).padStart(2, '0')).join('');
}

// Web Mercator into the world square.
function project([lon, lat]) {
  const s = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
  return [
    (lon + 180) / 360 * WORLD,
    (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD
  ];
}

// The exporter normalises everything to MultiPolygon, but stay tolerant: a
// geometry type we cannot draw should be visibly reported, not silently skipped.
function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  if (geom.type === 'GeometryCollection') return geom.geometries.flatMap(ringsOf);
  console.warn('map: unsupported geometry type', geom.type);
  return [];
}

// Project once, cache on the GeoJSON object: it is fetched once and shared by
// every view. `idKey`/`nameKey` let the same renderer draw either layer --
// municipalities keyed by `slug`, sub-areas by `area_id`.
function prepare(geo, idKey = 'slug', nameKey = 'name') {
  const cacheKey = `_prep_${idKey}`;
  if (geo[cacheKey]) return geo[cacheKey];

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const features = geo.features.map(f => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const parts = ringsOf(f.geometry).map(ring => {
      let s = '';
      ring.forEach((coord, i) => {
        const [x, y] = project(coord);
        if (x < a) a = x; if (x > c) c = x;
        if (y < b) b = y; if (y > d) d = y;
        s += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
      });
      return s + 'Z';
    });
    if (a < x0) x0 = a; if (c > x1) x1 = c;
    if (b < y0) y0 = b; if (d > y1) y1 = d;
    return { slug: f.properties[idKey], name: f.properties[nameKey],
             d: parts.join(''), box: [a, b, c, d] };
  });

  geo[cacheKey] = { features, full: pad([x0, y0, x1, y1], 1.04) };
  return geo[cacheKey];
}

// [minX, minY, maxX, maxY] -> viewBox [x, y, w, h], grown by `factor`.
function pad(box, factor, minW = 0) {
  const [a, b, c, d] = box;
  const cx = (a + c) / 2, cy = (b + d) / 2;
  let w = Math.max((c - a) * factor, minW);
  let h = Math.max((d - b) * factor, minW * 0.55);
  // Keep at least the shape of the content so a long thin area is not squashed.
  const want = (c - a) / Math.max(d - b, 1e-9);
  if (w / h > want) h = w / want; else w = h * want;
  return [cx - w / 2, cy - h / 2, w, h];
}

function boxesOverlap(box, view) {
  const [a, b, c, d] = box;
  const [vx, vy, vw, vh] = view;
  return a < vx + vw && c > vx && b < vy + vh && d > vy;
}

const svgNS = 'http://www.w3.org/2000/svg';
const BASEMAP_KEY = 'basemap';
const POINTS_KEY = 'mapPoints';

/**
 * @param geo      GeoJSON FeatureCollection
 * @param values   Map id -> number (drives the colour)
 * @param opts     { onSelect, selected, zoomTo, onZoomOut, label, points,
 *                   idKey, nameKey }
 */
function renderMap(geo, values, opts = {}) {
  const prep = prepare(geo, opts.idKey || 'slug', opts.nameKey || 'name');

  // zoomTo takes one id, or several: the sub-area view frames a whole
  // sveitarfelag by passing every area that makes it up.
  const wanted = opts.zoomTo == null ? []
    : (Array.isArray(opts.zoomTo) ? opts.zoomTo : [opts.zoomTo]);
  const targets = prep.features.filter(f => wanted.includes(f.slug));

  // Never zoom closer than ~25 km across: Seltjarnarnesbaer is 2.1 km2, and
  // framing it on its own bounds leaves no context to navigate by.
  const MIN_W = WORLD * 0.00055;
  const home = targets.length
    ? pad(targets.reduce((acc, f) => [
        Math.min(acc[0], f.box[0]), Math.min(acc[1], f.box[1]),
        Math.max(acc[2], f.box[2]), Math.max(acc[3], f.box[3])
      ], [Infinity, Infinity, -Infinity, -Infinity]),
      targets.length > 1 ? 1.25 : 2.1, MIN_W)
    : prep.full;

  let view = home.slice();

  // Colour scale follows what is on screen, the way eBird does: its zoomed-in
  // views run the legend up to the largest value in the frame.
  const visible = prep.features.filter(f => boxesOverlap(f.box, view));
  const max = Math.max(1, ...visible.map(f => values.get(f.slug) || 0));

  let basemap = localStorage.getItem(BASEMAP_KEY) || 'none';
  if (!BASEMAPS[basemap]) basemap = 'none';
  let showPoints = localStorage.getItem(POINTS_KEY) !== 'off';

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'map-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Map of Iceland');
  svg.setAttribute('viewBox', view.map(v => v.toFixed(2)).join(' '));

  const tileLayer = document.createElementNS(svgNS, 'g');
  tileLayer.setAttribute('class', 'map-tiles');
  svg.appendChild(tileLayer);

  const areaLayer = document.createElementNS(svgNS, 'g');
  svg.appendChild(areaLayer);

  const pointLayer = document.createElementNS(svgNS, 'g');
  pointLayer.setAttribute('class', 'map-points');
  svg.appendChild(pointLayer);

  const tip = el('div', { class: 'map-tip', hidden: 'hidden' });
  const showTip = (e, html) => {
    tip.hidden = false;
    tip.innerHTML = html;
    const r = svg.getBoundingClientRect();
    tip.style.left = (e.clientX - r.left + 14) + 'px';
    tip.style.top = (e.clientY - r.top + 14) + 'px';
  };

  // ---- polygons, drawn once ------------------------------------------------
  for (const f of prep.features) {
    const v = values.get(f.slug);
    const isSel = opts.selected === f.slug;
    const p = document.createElementNS(svgNS, 'path');
    p.setAttribute('d', f.d);
    p.setAttribute('fill', v ? rampColor(v / max) : EMPTY_FILL);
    // evenodd renders holes (enclaves, lakes) correctly regardless of how the
    // source winds its rings.
    p.setAttribute('fill-rule', 'evenodd');
    p.setAttribute('class', 'map-area' + (isSel ? ' is-selected' : ''));
    p.dataset.slug = f.slug;

    p.addEventListener('mousemove', e => showTip(e,
      `<strong>${f.name}</strong><br>${v ? `${v} ${opts.label || 'species'}` : 'no records'}`));
    p.addEventListener('mouseleave', () => { tip.hidden = true; });

    if (opts.onSelect && !isSel) {
      p.addEventListener('click', () => opts.onSelect(f.slug));
      p.setAttribute('tabindex', '0');
      p.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onSelect(f.slug); }
      });
    }
    areaLayer.appendChild(p);
  }

  // ---- your localities -----------------------------------------------------
  const pts = (opts.points || []).map(pt => {
    const [cx, cy] = project([pt.x, pt.y]);
    const c = document.createElementNS(svgNS, 'circle');
    c.setAttribute('cx', cx.toFixed(2));
    c.setAttribute('cy', cy.toFixed(2));
    c.setAttribute('class', 'map-point');
    c.addEventListener('mousemove', e => showTip(e,
      `<strong>${pt.n}</strong><br>${pt.k} checklist${pt.k === 1 ? '' : 's'} · ${pt.s} species`));
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
    pointLayer.appendChild(c);
    return { el: c, k: pt.k };
  });

  // ---- rendering that depends on the current view --------------------------

  function applyView() {
    svg.setAttribute('viewBox', view.map(v => v.toFixed(2)).join(' '));

    // Dots keep a constant screen size, so they stay legible at every zoom.
    const unitsPerPx = view[2] / Math.max(svg.clientWidth || 900, 1);
    for (const p of pts) {
      const rPx = Math.min(11, 4.5 + Math.sqrt(p.k) * 0.9);
      p.el.setAttribute('r', (rPx * unitsPerPx).toFixed(2));
    }
    drawTiles();
  }

  function drawTiles() {
    const cfg = BASEMAPS[basemap];
    tileLayer.textContent = '';
    if (!cfg.url) return;

    const widthPx = svg.clientWidth || 900;
    // Pick the zoom whose tiles land nearest 256 CSS px on screen.
    let z = Math.round(Math.log2(WORLD * widthPx / (view[2] * TILE)));
    z = Math.max(0, Math.min(cfg.maxZoom, z));
    const n = 2 ** z;
    const size = WORLD / n;

    const x0 = Math.max(0, Math.floor(view[0] / size));
    const x1 = Math.min(n - 1, Math.floor((view[0] + view[2]) / size));
    const y0 = Math.max(0, Math.floor(view[1] / size));
    const y1 = Math.min(n - 1, Math.floor((view[1] + view[3]) / size));

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const img = document.createElementNS(svgNS, 'image');
        img.setAttribute('href', cfg.url(z, x, y));
        img.setAttribute('x', (x * size).toFixed(2));
        img.setAttribute('y', (y * size).toFixed(2));
        // Overlap by a hair; exact edges leave hairline seams when scaled.
        img.setAttribute('width', (size * 1.002).toFixed(2));
        img.setAttribute('height', (size * 1.002).toFixed(2));
        img.setAttribute('preserveAspectRatio', 'none');
        tileLayer.appendChild(img);
      }
    }
  }

  // ---- pan and zoom --------------------------------------------------------

  const MIN_VIEW = WORLD * 0.00008;      // ~3 km across
  const MAX_VIEW = prep.full[2] * 3;

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    // Zoom about the cursor: the world point under it must not move.
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    const wx = view[0] + fx * view[2];
    const wy = view[1] + fy * view[3];
    const k = Math.exp(e.deltaY * 0.0015);
    let w = Math.max(MIN_VIEW, Math.min(MAX_VIEW, view[2] * k));
    const h = w * (view[3] / view[2]);
    view = [wx - fx * w, wy - fy * h, w, h];
    applyView();
  }, { passive: false });

  let drag = null;
  svg.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, view: view.slice() };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add('is-dragging');
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const dx = (e.clientX - drag.x) / r.width * drag.view[2];
    const dy = (e.clientY - drag.y) / r.height * drag.view[3];
    view = [drag.view[0] - dx, drag.view[1] - dy, drag.view[2], drag.view[3]];
    svg.setAttribute('viewBox', view.map(v => v.toFixed(2)).join(' '));
    tip.hidden = true;
  });
  const endDrag = e => {
    if (!drag) return;
    drag = null;
    svg.classList.remove('is-dragging');
    if (e && e.pointerId != null && svg.hasPointerCapture(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId);
    }
    drawTiles();          // only now, so dragging stays cheap
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  // A click that followed a drag should not also select a polygon.
  svg.addEventListener('click', e => {
    if (svg.dataset.moved === '1') { e.stopPropagation(); svg.dataset.moved = '0'; }
  }, true);
  svg.addEventListener('pointermove', e => { if (drag) svg.dataset.moved = '1'; }, true);
  svg.addEventListener('pointerdown', () => { svg.dataset.moved = '0'; }, true);

  // ---- controls ------------------------------------------------------------

  const frameEl = el('div', { class: 'map-frame' + (targets.length ? ' is-zoomed' : '') });

  const attribution = el('div', { class: 'map-attrib' });
  function syncAttribution() {
    const cfg = BASEMAPS[basemap];
    attribution.textContent = '';
    if (!cfg.attribution) { attribution.hidden = true; return; }
    attribution.hidden = false;
    attribution.appendChild(el('a', {
      href: cfg.href, target: '_blank', rel: 'noopener'
    }, cfg.attribution));
    svg.classList.toggle('has-basemap', true);
  }

  const baseButtons = Object.entries(BASEMAPS).map(([k, cfg]) =>
    el('button', {
      type: 'button',
      class: 'map-btn' + (k === basemap ? ' is-active' : ''),
      onclick: e => {
        basemap = k;
        localStorage.setItem(BASEMAP_KEY, k);
        for (const b of e.target.parentNode.children) b.classList.remove('is-active');
        e.target.classList.add('is-active');
        svg.classList.toggle('has-basemap', k !== 'none');
        syncAttribution();
        drawTiles();
      }
    }, cfg.label));

  const controls = el('div', { class: 'map-controls' },
    el('div', { class: 'map-btns', role: 'group', 'aria-label': 'Basemap' }, baseButtons),
    pts.length ? el('button', {
      type: 'button',
      class: 'map-btn map-btn-solo' + (showPoints ? ' is-active' : ''),
      title: 'Show or hide your own localities',
      onclick: e => {
        showPoints = !showPoints;
        localStorage.setItem(POINTS_KEY, showPoints ? 'on' : 'off');
        e.target.classList.toggle('is-active', showPoints);
        pointLayer.style.display = showPoints ? '' : 'none';
      }
    }, `◍ Mínir staðir (${pts.length})`) : null,
    el('button', {
      type: 'button', class: 'map-btn map-btn-solo',
      title: 'Back to the starting view',
      onclick: () => { view = home.slice(); applyView(); }
    }, '⤢ Endurstilla'),
    opts.onZoomOut ? el('button', {
      type: 'button', class: 'map-btn map-btn-solo', onclick: opts.onZoomOut
    }, 'Zoom Out') : null
  );

  pointLayer.style.display = showPoints ? '' : 'none';
  svg.classList.toggle('has-basemap', basemap !== 'none');

  frameEl.appendChild(controls);
  frameEl.appendChild(svg);
  frameEl.appendChild(tip);
  frameEl.appendChild(attribution);

  const wrap = el('div', { class: 'map-wrap' }, frameEl, legend(max, opts.label));

  // Draw once now, so the map is complete even if nothing else ever fires --
  // requestAnimationFrame is suspended in a background tab, which silently left
  // the points radius-less and the tiles undrawn when the page loaded there.
  syncAttribution();
  applyView();

  // Then redraw whenever the element actually has a size. ResizeObserver fires
  // on layout rather than on paint, so it works in a hidden tab, and it doubles
  // as the window-resize handler: the tile zoom depends on the pixel width.
  if (typeof ResizeObserver !== 'undefined') {
    let lastW = 0;
    new ResizeObserver(() => {
      const w = svg.clientWidth;
      if (w && Math.abs(w - lastW) > 1) { lastW = w; applyView(); }
    }).observe(svg);
  }

  return wrap;
}

function legend(max, label) {
  const grad = RAMP.map((c, i) => `${c} ${(i / (RAMP.length - 1) * 100).toFixed(0)}%`).join(', ');
  return el('div', { class: 'map-legend' },
    el('span', { class: 'legend-end', text: '0' }),
    el('span', { class: 'legend-bar', style: `background: linear-gradient(90deg, ${grad})` }),
    el('span', { class: 'legend-end', text: String(max) }),
    el('span', { class: 'legend-label', text: label || 'species' }),
    el('span', { class: 'legend-hint', text: 'scroll to zoom · drag to pan' })
  );
}

export { renderMap, rampColor };
