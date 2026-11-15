/* REMS weather for the chosen sol (from weather.json). */
import { state, $, selectedWeather } from './state.js';
import { drawTempChart } from './charts.js';

export function setupWeather() {
  const { weather } = state;
  if (!weather.length) { $('inSol').closest('section').hidden = true; return; }
  $('inSol').innerHTML = weather.map((w) => `<option value="${w.sol}">sol ${w.sol}</option>`).join('');
  $('inSol').value = String(weather[weather.length - 1].sol);
  renderWeather();
  drawTempChart();
}

export function renderWeather() {
  const w = selectedWeather();
  if (!w) return;
  const range = (lo, hi) => (lo == null || hi == null ? 'no data' : `${Math.round(lo)} to ${Math.round(hi)} °C`);
  $('wxBody').className = '';
  $('wxBody').innerHTML = `<dl class="wx">
      <dt>Air</dt><dd>${range(w.air_min_C, w.air_max_C)}</dd>
      <dt>Ground</dt><dd>${range(w.ground_min_C, w.ground_max_C)}</dd>
      ${w.pressure_Pa == null ? '' : `<dt>Pressure</dt><dd>${Math.round(w.pressure_Pa)} Pa</dd>`}
    </dl>`;
}

/** Air temperature at a local solar hour, interpolated from REMS hourly means. */
export function airTempAt(w, hour) {
  const pts = Object.entries(w.air_by_hour_C).map(([h, v]) => [Number(h) + 0.5, v]).sort((a, b) => a[0] - b[0]);
  if (!pts.length) return NaN;
  if (hour <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (hour <= pts[i][0]) {
      const [h0, v0] = pts[i - 1], [h1, v1] = pts[i];
      return v0 + (v1 - v0) * (hour - h0) / (h1 - h0);
    }
  }
  return pts[pts.length - 1][1];
}
