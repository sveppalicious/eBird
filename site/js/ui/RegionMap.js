// RegionMap.js -- the map, on Leaflet.
//
// The container has a height set in CSS and nothing about the data can change
// it. That one fact is the fix for the three faults the hand-rolled map had:
// its height was derived from the viewBox, so it shook by a pixel or two on
// every wheel tick as the rounded aspect ratio drifted, and it stood anywhere
// from 475px to 1,819px tall depending on the shape of the sveitarfelag.
//
// One Leaflet instance lives for the life of the page. Navigating restyles the
// shapes and flies to the region; nothing is torn down and redrawn, which is
// also why there is nothing left to flash.
//
// No tile layer: the site makes no third-party requests.

import { html, useRef, useState, useEffect, useLayoutEffect, useApp } from './core.js';
import { COUNTRY, municipalityOf, focusFor } from '../lib/regions.js';
import { fmtNum } from '../lib/format.js';

const L = window.L;

// eBird's ramp: pale yellow through orange to red.
const RAMP = ['#f5e79e', '#f2d180', '#eeb46c', '#e89463', '#e2705f', '#d94a54'];
const EMPTY = '#e6e8e6';
const CONTEXT = '#e4eaec';

function rampColor(t) {
  // NaN fails every comparison below and would index RAMP with NaN.
  if (!Number.isFinite(t) || t <= 0) return RAMP[0];
  const x = Math.min(0.999, t) * (RAMP.length - 1);
  const i = Math.floor(x);
  const a = RAMP[i], b = RAMP[i + 1], f = x - i;
  const ch = k => Math.round(parseInt(a.substr(k, 2), 16) + (parseInt(b.substr(k, 2), 16) - parseInt(a.substr(k, 2), 16)) * f)
    .toString(16).padStart(2, '0');
  return '#' + ch(1) + ch(3) + ch(5);
}

const POINTS_KEY = 'mapPoints';
let M = null;             // the one map

function create(geo, areaGeo) {
  const el = document.createElement('div');
  el.className = 'region-map';
  // Pinch to zoom and tap to select on a touch screen, but leave one-finger
  // drags to the page. A map that swallows the scroll gesture traps a phone
  // user on whatever is above it.
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const map = L.map(el, {
    attributionControl: false, zoomControl: true,
    zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    minZoom: 5, maxZoom: 14,
    // No maxBounds: on a wide, short frame the view at low zoom is wider than
    // any sensible box round Iceland, and Leaflet then drags the centre off the
    // country trying to honour it. minZoom and the reset button do the job.
    dragging: !touch, touchZoom: true
  });

  // A handle for the tests, which need to ask the map where it is looking --
  // and whether it has stopped: Leaflet reports the old zoom until an
  // animation lands, so the numbers alone cannot say.
  el.leafletMap = map;
  map.on('movestart', () => el.classList.add('is-moving'));
  map.on('moveend', () => el.classList.remove('is-moving'));

  const shape = { weight: 1, color: '#fff', fillOpacity: 1 };
  const layers = new Map();          // region id -> Leaflet layer
  const add = (g, key, isArea) => L.geoJSON(g, {
    style: shape,
    onEachFeature: (f, layer) => {
      const id = f.properties[key];
      layer.regionId = id;
      layer.isArea = isArea;
      layers.set(id, layer);
      layer.on('click', () => M.onSelect && M.onSelect(id));
      layer.on('mouseover', () => layer.setStyle({ weight: 2.2, color: '#2f5468' }));
      layer.on('mouseout', () => M.restyle(id));
      layer.bindTooltip(() => M.tip(id), { sticky: true, direction: 'top', offset: [0, -6], className: 'map-tip' });
      // The tests, and anyone with a screen reader, find a shape by its id.
      layer.on('add', () => {
        const node = layer.getElement();
        if (node) { node.setAttribute('data-id', id); node.classList.add('region-shape'); }
      });
    }
  });

  const munGroup = add(geo, 'slug', false).addTo(map);
  add(areaGeo, 'area_id', true);                // built now, shown as needed
  const pointsGroup = L.layerGroup();
  const canvas = L.canvas({ padding: 0.5 });
  const home = munGroup.getBounds();

  map.fitBounds(home, { animate: false });
  return { el, map, layers, munGroup, pointsGroup, canvas, home,
           shown: new Set(), onSelect: null, tip: () => '', restyle: () => {}, first: true };
}

function update(m, { tree, regionId, values, max, points, showPoints, onSelect, tip, pointTip }) {
  const { ids, selected, fit } = focusFor(tree, regionId);
  const focus = new Set(ids);
  // The sveitarfelag whose areas are on show: its own outline stays, emptied,
  // so the areas read as its subdivision.
  const holder = municipalityOf(tree, regionId);
  const areasShown = ids.some(id => m.layers.get(id) && m.layers.get(id).isArea);

  // Areas come and go; the sveitarfelog are always there.
  for (const id of m.shown) {
    if (!focus.has(id)) { m.map.removeLayer(m.layers.get(id)); m.shown.delete(id); }
  }
  for (const id of focus) {
    const layer = m.layers.get(id);
    if (layer && layer.isArea && !m.shown.has(id)) { layer.addTo(m.map); m.shown.add(id); }
  }

  const styleOf = id => {
    const isMun = !m.layers.get(id).isArea;
    if (focus.has(id)) {
      const v = values.get(id);
      const sel = id === selected;
      return { fillColor: v ? rampColor(v / max) : EMPTY, fillOpacity: 1,
               color: sel ? '#2f5468' : '#fff', weight: sel ? 2.6 : 1 };
    }
    if (isMun && areasShown && id === holder) {
      return { fillOpacity: 0, color: '#2f5468', weight: 1.6 };
    }
    return { fillColor: CONTEXT, fillOpacity: 1, color: '#fff', weight: 1 };
  };
  m.restyle = id => { const l = m.layers.get(id); if (l) l.setStyle(styleOf(id)); };
  m.munGroup.eachLayer(l => l.setStyle(styleOf(l.regionId)));
  for (const id of m.shown) m.restyle(id);
  // Order matters for clicks: the areas sit over the emptied sveitarfelag.
  for (const id of m.shown) m.layers.get(id).bringToFront();
  if (selected && m.layers.get(selected)) m.layers.get(selected).bringToFront();

  m.onSelect = onSelect;
  m.tip = tip;

  // Your localities.
  m.pointsGroup.clearLayers();
  if (points && points.length && showPoints) {
    for (const p of points) {
      L.circleMarker([p.y, p.x], {
        renderer: m.canvas, radius: Math.min(9, 3.5 + Math.sqrt(p.k) * 0.8),
        color: '#fff', weight: 1.5, fillColor: '#14313f', fillOpacity: 0.9
      }).bindTooltip(`<strong>${escapeHtml(p.n)}</strong><br>${escapeHtml(pointTip(p))}`,
                     { className: 'map-tip', direction: 'top' })
        .addTo(m.pointsGroup);
    }
    m.pointsGroup.addTo(m.map);
  } else m.map.removeLayer(m.pointsGroup);

  // Frame the region. A tiny place is not zoomed until it fills the map: with
  // nothing around it there is nothing to navigate by.
  const target = m.layers.get(fit);
  const bounds = fit === COUNTRY || !target ? m.home : target.getBounds();
  m.fitTo = () => {
    const go = () => m.map.fitBounds(bounds, { padding: [18, 18], maxZoom: 11, animate: false });
    // A fit issued while a zoom is animating is overridden when the animation
    // lands, so the reset button would appear to do nothing. Wait it out.
    if (m.map._animatingZoom) m.map.once('zoomend', go); else go();
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (m.first || reduce || m.fitKey === undefined) m.fitTo();
  else if (m.fitKey !== fit) m.map.flyToBounds(bounds, { padding: [18, 18], maxZoom: 11, duration: 0.55 });
  m.fitKey = fit;
  m.first = false;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param regionId  the region the page is about
 * @param values    Map of region id -> number, for the shapes in focus
 * @param label     what the number counts, for the legend
 * @param onSelect  called with a region id when a shape is clicked
 * @param describe  id -> one line for the tooltip (the value, in words)
 */
function RegionMap({ regionId, values, label, onSelect, describe }) {
  const { tree, geo, areaGeo, provider, t } = useApp();
  const host = useRef(null);
  const points = provider.localities();
  const [showPoints, setShowPoints] = usePoints();

  const { ids } = focusFor(tree, regionId);
  const max = Math.max(1, ...ids.map(id => values.get(id) || 0));

  // Attach the one map to this page's frame. Leaflet keeps its own state in the
  // element, so moving the element is all "mounting" has to mean.
  useLayoutEffect(() => {
    if (!M) M = create(geo, areaGeo);
    host.current.appendChild(M.el);
    M.map.invalidateSize({ animate: false });
    return () => { if (M.el.parentNode) M.el.parentNode.removeChild(M.el); };
  }, []);

  useEffect(() => {
    const tip = id => {
      const r = tree.get(id);
      if (!r) return '';
      const parent = (r.kind === 'hverfi' || r.kind === 'postnumer') ? tree.get(r.parent) : null;
      // The second line matters: a postal district can straddle a boundary, so
      // several shapes on screen can legitimately read "660 Mývatn".
      return `<strong>${escapeHtml(r.name)}</strong>` +
        (parent ? `<br><span class="tip-sub">${escapeHtml(parent.name)}</span>` : '') +
        `<br>${escapeHtml(describe(id))}`;
    };
    const pointTip = p => t('map.pointTip', { k: fmtNum(p.k), s: fmtNum(p.s) });
    update(M, { tree, regionId, values, max, points, showPoints, onSelect, tip, pointTip });
    // Only when something the map shows has changed. The page above re-renders
    // for reasons that are none of the map's business, and restyling 250 shapes
    // and rebuilding every locality dot each time would be wasted work.
  }, [tree, regionId, values, points, showPoints, t]);

  return html`<div class="map-wrap">
    <div class="map-frame">
      ${/* Its own host, with no children of Preact's: the Leaflet element is
           moved in and out by hand and must not be diffed. */''}
      <div class="map-host" ref=${host}></div>
      <div class="map-controls">
        <button type="button" class="map-btn" onClick=${() => M && M.fitTo()} title=${t('map.reset')}>⤢</button>
        ${points && points.length ? html`<button type="button"
          class=${'map-btn' + (showPoints ? ' is-active' : '')} aria-pressed=${showPoints ? 'true' : 'false'}
          onClick=${() => setShowPoints(!showPoints)}>◍ ${t('map.points', { n: fmtNum(points.length) })}</button>` : null}
      </div>
    </div>
    <div class="map-legend">
      <span>0</span>
      <span class="legend-bar" style=${`background: linear-gradient(90deg, ${RAMP.join(', ')})`}></span>
      <span>${fmtNum(max)}</span>
      <span class="legend-label">${label}</span>
    </div>
  </div>`;
}

function usePoints() {
  const [on, set] = useState(() => {
    try { return localStorage.getItem(POINTS_KEY) !== 'off'; } catch { return true; }
  });
  return [on, v => { try { localStorage.setItem(POINTS_KEY, v ? 'on' : 'off'); } catch { /* fine */ } set(v); }];
}

export { RegionMap, rampColor };
