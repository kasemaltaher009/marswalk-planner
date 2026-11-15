/* The 2D map (Leaflet): base maps, overlay layers, and the readout under the mouse. */
import { DATA, $, state, REDUCED_MOTION, fmtElev, SAND_FILTER } from './state.js';
import { cellAt, centreOfRC, rcOf } from './routing/grid.js';
import { curiosityLayer } from './curiosity.js';
import { addPoint } from './points.js';
import { drawRoutes } from './routeDraw.js';
import { play, renderPlayback } from './playback.js';
import { sync3DTexture, sync3DTraverse } from './view3dBridge.js';

// Mars-sized version of Leaflet's lat/lon map, so the scale bar and distances use Mars' radius.
const MARS_CRS = L.extend({}, L.CRS.EPSG4326, { R: 3396190 });

// Set up once by setupMap(); other modules import and use them.
export let map, routeLayer, hoverDot, astroMarker, walkedLine;
export const layers = {};           // name → Leaflet layer

// grid cell ↔ Leaflet lat/lon
export const cellAtLatLng = (latlng) => cellAt(state.grid, latlng.lat, latlng.lng);
export const latlngOfRC = (r, c) => L.latLng(...centreOfRC(state.grid, r, c));
export const latlngOf = (idx) => latlngOfRC(...rcOf(state.grid, idx));

export function setupMap() {
  const b = state.config.bounds;
  const area = L.latLngBounds([b.south, b.west], [b.north, b.east]);

  // The map always stays inside our area: it opens zoomed so the area fills the whole view,
  // and you can't pan or zoom out past its edges (where the data stops).
  map = L.map('map', { crs: MARS_CRS, maxZoom: 18, zoomSnap: 0.5, zoomControl: false,
                       maxBounds: area, maxBoundsViscosity: 1 });
  const fillView = () => {
    map.options.minZoom = 0;                     // getBoundsZoom never answers below the current minimum
    const z = map.getBoundsZoom(area, true);     // smallest zoom where the area covers the view
    map.setMinZoom(z);
    if (map.getZoom() < z) map.setZoom(z);
  };
  map.setView(area.getCenter(), map.getBoundsZoom(area, true));
  fillView();
  map.on('resize', fillView);                     // e.g. the side panels hide during a walk
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  // Global context tiles from NASA's Mars Trek (blurry up close, but shows the crater around our area)
  L.tileLayer('https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg', {
    maxNativeZoom: 7, maxZoom: 18, tileSize: 256, noWrap: true,
    attribution: 'Context: <a href="https://trek.nasa.gov/mars/">NASA Mars Trek</a> (Viking)',
  }).addTo(map);

  const files = state.config.overlays || [];
  const img = (file, opacity) => (files.includes(file) ? L.imageOverlay(DATA + file, area, { opacity, fullOpacity: opacity }) : null);
  layers.photo = img('photo.jpg', 1);
  layers.relief = img('hillshade.png', 1);
  layers.slope = img('slope.png', 0.7);
  layers.ground = img('ground.png', 0.8);
  layers.ground?.on('add', (e) => { e.target.getElement().style.filter = SAND_FILTER; });
  layers.curiosity = state.curiosity ? curiosityLayer() : null;

  // Toolbar buttons → layers. Hide buttons for files that don't exist.
  document.querySelectorAll('[data-base]').forEach((btn) => {
    const name = btn.dataset.base;
    if (!layers[name]) { btn.hidden = true; return; }
    btn.addEventListener('click', () => setBase(name));
  });
  document.querySelectorAll('[data-overlay]').forEach((btn) => {
    const name = btn.dataset.overlay;
    if (!layers[name]) { btn.hidden = true; return; }
    btn.addEventListener('click', () => setOverlay(name, btn.getAttribute('aria-pressed') !== 'true'));
  });
  setBase(layers.photo ? 'photo' : 'relief');
  ['slope', 'ground', 'curiosity'].forEach((n) => {
    const btn = document.querySelector(`[data-overlay="${n}"]`);
    setOverlay(n, btn.getAttribute('aria-pressed') === 'true');
  });

  L.rectangle(area, { color: '#d9b24c', weight: 1.5, fill: false, dashArray: '6 6', interactive: false }).addTo(map);

  routeLayer = L.layerGroup().addTo(map);
  hoverDot = L.circleMarker([0, 0], { radius: 6, color: '#fff', weight: 2, fillColor: '#62d6e8', fillOpacity: 1, interactive: false });
  astroMarker = L.marker([0, 0], {
    icon: L.divIcon({ className: '', html: '<div class="astro"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    interactive: false, keyboard: false, zIndexOffset: 1000,
  });
  walkedLine = L.polyline([], { color: '#ffffff', weight: 4, opacity: 0.95, interactive: false });

  map.on('click', (e) => addPoint(cellAtLatLng(e.latlng)));
  // lanes and arrows are spaced in screen pixels, so redraw them after zooming
  map.on('zoomend', () => {
    if (!state.plan) return;
    drawRoutes(false);
    if (play.tl && !$('hud').hidden) renderPlayback();
  });
  map.on('mousemove', (e) => showReadout(e.latlng));
  map.on('mouseout', () => { $('readout').hidden = true; });
}

export function setBase(name) {
  const other = name === 'photo' ? 'relief' : 'photo';
  [name, other].forEach((n) => document.querySelector(`[data-base="${n}"]`).setAttribute('aria-pressed', n === name));
  const on = layers[name], off = layers[other];
  cancelFade(on); cancelFade(off);
  if (!on) hideLayer(off, false);
  else {
    // the new base fades in on top of the old one, which goes once it's covered
    on.setOpacity(0);
    showLayer(on, 1, () => hideLayer(off, false));
    on.bringToBack();
    if (off && map.hasLayer(off)) off.bringToBack();
  }
  sync3DTexture();
}

export function setOverlay(name, on) {
  const btn = document.querySelector(`[data-overlay="${name}"]`);
  btn.setAttribute('aria-pressed', on);
  const layer = layers[name];
  if (layer) { if (on) showLayer(layer, layer.options.fullOpacity); else hideLayer(layer); }
  const legend = $('legend' + name[0].toUpperCase() + name.slice(1));
  if (legend) legend.hidden = !on || !layer;
  if (name === 'curiosity') sync3DTraverse(); else sync3DTexture();
}

// ---- Fading map layers in and out (photos and overlays; Curiosity's markers just switch) ----
const FADE_MS = 400;   // matches the opacity transition of .leaflet-image-layer in style.css
const fades = (layer) => layer instanceof L.ImageOverlay && !REDUCED_MOTION;
function cancelFade(layer) {
  if (!layer) return;
  clearTimeout(layer._fadeTimer);
  layer._fadeJob = (layer._fadeJob || 0) + 1;   // a pending fade-in or removal no longer counts
}
/** Add a layer (if needed) and fade it to `opacity`; `done` runs once it's fully shown. */
function showLayer(layer, opacity, done) {
  cancelFade(layer);
  if (!fades(layer)) { layer.addTo(map); if (layer.setOpacity) layer.setOpacity(opacity); done?.(); return; }
  if (!map.hasLayer(layer)) { layer.setOpacity(0); layer.addTo(map); }
  const job = layer._fadeJob;
  const go = () => requestAnimationFrame(() => requestAnimationFrame(() => {
    if (job !== layer._fadeJob) return;
    layer.setOpacity(opacity);
    layer._fadeTimer = setTimeout(() => done?.(), FADE_MS);
  }));
  // a big image downloading for the first time fades in once it has arrived
  if (layer.getElement().complete) go(); else layer.once('load', go);
}
/** Fade a layer out (or, with fade = false, just drop it) and take it off the map. */
function hideLayer(layer, fade = true) {
  if (!layer || !map.hasLayer(layer)) return;
  cancelFade(layer);
  if (!fade || !fades(layer)) { map.removeLayer(layer); return; }
  layer.setOpacity(0);
  layer._fadeTimer = setTimeout(() => map.removeLayer(layer), FADE_MS);
}
/** After planning: if the route runs under the cards over the map (layer buttons and legends at
 *  the left, the verdict card at the right, waypoints / player / view switch at the bottom), move
 *  the map so the route sits in the free space between them. Never zooms in; when the view is too
 *  small to have free space (phones), the map stays where it is. */
export function revealRoute(latlngs) {
  const box = map.getContainer().getBoundingClientRect();
  const shown = (q) => [...document.querySelectorAll(q)].filter((e) => !e.hidden && e.getClientRects().length)
    .map((e) => e.getBoundingClientRect());
  const gap = 12;
  const left = Math.max(gap, ...shown('.basecol').map((r) => r.right - box.left + gap));
  const top = Math.max(gap, ...shown('.chips').map((r) => r.bottom - box.top + gap));
  const right = Math.max(gap, ...shown('#summary').map((r) => box.right - r.left + gap));
  const bottom = Math.max(gap, ...shown('.centre-stack > *, #player, .viewdock').map((r) => box.bottom - r.top + gap));
  if (box.width - left - right < 160 || box.height - top - bottom < 160) return;

  const bounds = L.latLngBounds(latlngs);
  const nw = map.latLngToContainerPoint(bounds.getNorthWest()), se = map.latLngToContainerPoint(bounds.getSouthEast());
  if (nw.x >= left && nw.y >= top && se.x <= box.width - right && se.y <= box.height - bottom) return;   // all in view
  map.fitBounds(bounds, { paddingTopLeft: [left, top], paddingBottomRight: [right, bottom],
                          maxZoom: map.getZoom(), animate: !REDUCED_MOTION });
}

export const overlayOn = (name) => !!layers[name] && document.querySelector(`[data-overlay="${name}"]`).getAttribute('aria-pressed') === 'true';

function showReadout(latlng) {
  const { grid } = state;
  const idx = cellAtLatLng(latlng);
  const box = $('readout');
  box.hidden = !$('hud').hidden;     // the helmet display sits in the same corner
  if (box.hidden) return;
  if (idx < 0) { box.textContent = 'Outside the planning area'; return; }
  const s = grid.slope[idx], cost = grid.cost[idx];
  const cls = cost === 255 ? 'too steep to walk' : s < 10 ? 'easy walking' : s < 15 ? 'hard walking' : 'very hard walking';
  box.innerHTML = `${fmtElev(grid.elev[idx])}, slope ${s.toFixed(0)}°, ${cls}` +
    `<small>${latlng.lat.toFixed(5)}° ${latlng.lng.toFixed(5)}°E</small>`;
}
