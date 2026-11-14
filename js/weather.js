/* REMS weather for the chosen sol (from weather.json). */
import { state, $, selectedWeather } from './state.js';
import { drawTempChart } from './charts.js';

export function setupWeather() {
  const { weather } = state;
  if (!weather.length) { $('inSol').closest('.field').hidden = true; return; }
  $('inSol').innerHTML = weather.map((w) => `<option value="${w.sol}">sol ${w.sol}</option>`).join('');
  $('inSol').value = String(weather[weather.length - 1].sol);
  renderWeather();
  drawTempChart();
}

export function renderWeather() {
  const w = selectedWeather();
  if (!w) return;
  const v = (x, unit) => (x == null ? 'no data' : `${x} ${unit}`);
  const range = (lo, hi) => (lo == null || hi == null ? 'no data' : `${lo} to ${hi} °C`);
  $('wxSol').textContent = `on sol ${w.sol}`;
  $('wxBody').className = '';
  $('wxBody').innerHTML = `<dl class="wx">
      <dt>Air</dt><dd>${range(w.air_min_C, w.air_max_C)}</dd>
      <dt>Ground</dt><dd>${range(w.ground_min_C, w.ground_max_C)}</dd>
      <dt>Pressure</dt><dd>${v(w.pressure_Pa, 'Pa')}</dd>
      <dt>UV peak</dt><dd>${v(w.uv_peak, 'W/m²')}</dd>
      <dt>Humidity peak</dt><dd>${v(w.humidity_max_pct, '%')}</dd>
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
