/* Curiosity's route on the map: its stops (click for photos) and drive lines. */
import { state, PHOTO_RADIUS_M } from './state.js';
import { map } from './map.js';
import { photoPopup } from './photos.js';

export const curiosityStops = () => state.curiosity.features.filter((f) => f.geometry.type === 'Point');
export const latestStop = () => curiosityStops().reduce((a, f) => (f.properties.sol > a.properties.sol ? f : a));

export function curiosityLayer() {
  const lastSol = latestStop().properties.sol;
  return L.geoJSON(state.curiosity, {
    style: { color: '#ffffff', weight: 2, opacity: 0.8, dashArray: '4 4' },
    // the drive lines (not the stops, which pointToLayer makes) ignore the mouse: they run through
    // every stop dot and would catch its clicks, and a click beside a line should place a point
    interactive: false,
    pointToLayer: (f, latlng) => {
      const now = f.properties.sol === lastSol;
      // The visible dot is small; an invisible 24 px circle on top takes the clicks and hovers.
      const dot = L.circleMarker(latlng, {
        radius: now ? 8 : 5, weight: 2, color: '#fff',
        fillColor: now ? '#ff4f7b' : '#9a86ff', fillOpacity: 1, interactive: false,
      });
      const hit = L.circleMarker(latlng, {
        radius: Math.max(12, now ? 8 : 5), stroke: false, fillOpacity: 0,
        bubblingMouseEvents: false,   // clicking a stop must not add a plan point
      });
      hit.on('add', (e) => dot.addTo(e.target._map)).on('remove', () => dot.remove());
      return hit;
    },
    onEachFeature: (f, layer) => {
      if (f.geometry.type !== 'Point') return;
      const p = f.properties;
      const now = p.sol === lastSol ? ', its latest position' : '';
      layer.bindTooltip(`Curiosity on sol ${p.sol}${now}`);
      layer.bindPopup(() => photoPopup(p.sol, p.elev_m, `Curiosity on sol ${p.sol}${now}`), { maxWidth: 300 });
    },
  });
}

/** Nearest Curiosity stop to a point (for "what does it look like there?"). */
export function nearestStop(latlng) {
  if (!state.curiosity) return null;
  let best = null;
  for (const f of curiosityStops()) {
    const [lng, lat] = f.geometry.coordinates;
    const d = map.distance(latlng, [lat, lng]);
    if (!best || d < best.d) best = { d, p: f.properties, ll: L.latLng(lat, lng) };
  }
  return best && best.d <= PHOTO_RADIUS_M ? best : null;
}
