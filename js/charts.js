/* Charts (Chart.js): elevation along the route, and the air temperature over the sol. */
import { state, $, startHour, selectedWeather, totalHours, pointName, fmtElev } from './state.js';
import { map, hoverDot, latlngOf } from './map.js';

Chart.defaults.color = '#a0a7af';
Chart.defaults.borderColor = '#3a414a';
Chart.defaults.font.family = '"Saira", system-ui, sans-serif';
Chart.defaults.font.size = 12;

// Draws chart.$window = [x0, x1] as a shaded band and chart.$cursor = x as a vertical line.
Chart.register({
  id: 'marks',
  beforeDatasetsDraw(chart) {
    const w = chart.$window;
    if (!w) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    const x0 = Math.max(a.left, x.getPixelForValue(w[0])), x1 = Math.min(a.right, x.getPixelForValue(w[1]));
    ctx.save();
    ctx.fillStyle = 'rgba(98, 214, 232, .14)';
    ctx.fillRect(x0, a.top, Math.max(0, x1 - x0), a.bottom - a.top);
    ctx.restore();
  },
  afterDatasetsDraw(chart) {
    if (chart.$cursor == null) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    const px = x.getPixelForValue(chart.$cursor);
    if (px < a.left || px > a.right) return;
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
    ctx.restore();
  },
});

// Created the first time they're drawn; playback moves their cursors.
export let elevChart, tempChart;

export function drawElevChart(r) {
  const { grid } = state;
  const { path, stopAt, stats } = r;
  const step = Math.max(1, Math.floor(path.length / 400));   // keep the chart light
  const line = [];
  for (let k = 0; k < path.length; k += step) line.push({ x: stats.dist[k] / 1000, y: grid.elev[path[k]], k });
  const stops = stopAt.map((s) => ({ x: stats.dist[s.pos] / 1000, y: grid.elev[path[s.pos]], label: pointName(s.point) }));
  // colour the profile by leg, matching the map
  const legOf = new Uint8Array(path.length);
  for (const leg of r.legs) legOf.fill(leg.i, leg.from + 1, leg.to + 1);

  const data = {
    datasets: [
      { type: 'line', label: 'Elevation', data: line, borderColor: '#62d6e8', backgroundColor: 'rgba(98,214,232,.12)',
        fill: true, pointRadius: 0, borderWidth: 2, tension: 0.2,
        segment: { borderColor: (ctx) => r.legs[legOf[line[ctx.p1DataIndex].k]].color } },
      { type: 'scatter', label: 'Stops', data: stops, backgroundColor: '#d9b24c', borderColor: '#fff', pointRadius: 5 },
    ],
  };
  const options = {
    animation: false, maintainAspectRatio: false, parsing: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    scales: {
      x: { type: 'linear', title: { display: true, text: 'distance walked (km)' } },
      y: { ticks: { callback: (v) => String(v) }, title: { display: true, text: 'elevation (m)' } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        label: (c) => c.dataset.type === 'scatter'
          ? `${c.raw.label}: ${fmtElev(c.raw.y)}`
          : `${fmtElev(c.raw.y)} after ${c.raw.x.toFixed(2)} km`,
      } },
    },
    // hovering the profile shows that spot on the map
    onHover: (_, els) => {
      const el = els.find((e) => e.datasetIndex === 0);
      if (el && state.activeView === 'map') hoverDot.setLatLng(latlngOf(path[line[el.index].k])).addTo(map);
      else map.removeLayer(hoverDot);
    },
  };
  if (elevChart) { elevChart.data = data; elevChart.options = options; elevChart.$cursor = null; elevChart.update(); }
  else {
    elevChart = new Chart($('elevChart'), { data, options });
    $('elevChart').addEventListener('mouseleave', () => map.removeLayer(hoverDot));
  }
}

/** Hourly air temperature; the walk's hours are shaded. */
export function drawTempChart() {
  const w = selectedWeather();
  if (!w) return;
  const hours = Object.keys(w.air_by_hour_C).map(Number).sort((a, b) => a - b);
  const pts = hours.map((h) => ({ x: h + 0.5, y: w.air_by_hour_C[h] }));
  $('wxChartBox').hidden = false;

  const options = {
    animation: false, maintainAspectRatio: false, parsing: false,
    scales: {
      x: { type: 'linear', min: 0, max: 24, ticks: { stepSize: 4, callback: (v) => `${v}:00` }, title: { display: true, text: 'local solar time' } },
      y: { title: { display: true, text: 'air (°C)' } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { title: (c) => `${Math.floor(c[0].raw.x)}:00 to ${Math.floor(c[0].raw.x) + 1}:00`, label: (c) => `${c.raw.y} °C` } },
    },
  };
  const data = { datasets: [{ type: 'line', data: pts, borderColor: '#f08c3a', backgroundColor: '#f08c3a', pointRadius: 2, borderWidth: 2, tension: 0.3 }] };
  if (tempChart) { tempChart.data = data; tempChart.options = options; }
  else tempChart = new Chart($('tempChart'), { data, options });
  tempChart.$window = state.plan ? [startHour(), startHour() + totalHours(state.plan.chosen)] : null;
  tempChart.$cursor = null;
  tempChart.update();
}
