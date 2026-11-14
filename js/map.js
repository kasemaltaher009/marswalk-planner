/* The 2D map (Leaflet): base maps, overlay layers, and the readout under the mouse. */
import { DATA, $, state } from './state.js';
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
  const img = (file, opacity) => (files.includes(file) ? L.imageOverlay(DATA + file, area, { opacity }) : null);
  layers.photo = img('photo.jpg', 1);
  layers.relief = img('hillshade.png', 1);
  layers.slope = img('slope.png', 0.7);
  layers.ground = img('ground.png', 0.8);
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
  ['photo', 'relief'].forEach((n) => {
    const on = n === name;
    document.querySelector(`[data-base="${n}"]`).setAttribute('aria-pressed', on);
    if (!layers[n]) return;
    if (on) layers[n].addTo(map).bringToBack(); else map.removeLayer(layers[n]);
  });
  sync3DTexture();
}

export function setOverlay(name, on) {
  const btn = document.querySelector(`[data-overlay="${name}"]`);
  btn.setAttribute('aria-pressed', on);
  if (layers[name]) { if (on) layers[name].addTo(map); else map.removeLayer(layers[name]); }
  const legend = $('legend' + name[0].toUpperCase() + name.slice(1));
  if (legend) legend.hidden = !on || !layers[name];
  if (name === 'curiosity') sync3DTraverse(); else sync3DTexture();
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
  box.innerHTML = `${grid.elev[idx].toFixed(0)} m, slope ${s.toFixed(0)}°, ${cls}` +
    `<small>${latlng.lat.toFixed(5)}° ${latlng.lng.toFixed(5)}°E</small>`;
}
