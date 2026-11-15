/* The right panel: go/no-go poll, the walk's numbers, and the comparison route. */
import {
  state, $, RESERVE_H, COLD_LIMIT_C, DAY_START_H, DAY_END_H,
  startHour, suitHours, selectedWeather, totalHours,
  fmtH, fmtClock, fmtDist, priorityName, pointName,
} from './state.js';
import { airTempAt } from './weather.js';
import { drawElevChart, drawTempChart } from './charts.js';
import { leavePov } from './view3dBridge.js';

/** Each system gives its call: go, caution or nogo. Returns [[level, system, detail], …]. */
function poll(route) {
  const { config } = state;
  const s = route.stats;
  const totalH = totalHours(route);
  const t0 = startHour(), t1 = t0 + totalH;
  const suit = suitHours();
  const left = suit - totalH;
  const items = [];

  items.push(left >= RESERVE_H
    ? ['go', 'Suit time', `${fmtH(totalH)} of ${suit} h used, ${fmtH(left)} to spare.`]
    : left >= 0
      ? ['caution', 'Suit time', `Only ${Math.round(left * 60)} min to spare. We want at least ${RESERVE_H * 60} min.`]
      : ['nogo', 'Suit time', `${fmtH(-left)} over the ${suit} h limit. Drop a target or work less at each one.`]);

  const steep = s.maxGradeDeg >= 15, rough = s.roughPct >= 50;
  items.push(!steep && !rough
    ? ['go', 'Terrain', `Steepest section ${s.maxGradeDeg.toFixed(0)}°, ${s.roughPct.toFixed(0)}% on sand or slopes over 10°.`]
    : ['caution', 'Terrain', `${steep ? `A ${s.maxGradeDeg.toFixed(0)}° section: slow down there. ` : ''}${s.roughPct.toFixed(0)}% on sand or slopes over 10°.`]);

  const wx = selectedWeather();
  if (wx) {
    const temps = [];
    for (let h = t0; h <= t1; h += 0.25) temps.push(airTempAt(wx, h));
    const lo = Math.min(...temps), hi = Math.max(...temps);
    items.push(lo > COLD_LIMIT_C
      ? ['go', 'Thermal', `Air ${lo.toFixed(0)} to ${hi.toFixed(0)} °C during the walk (REMS, sol ${wx.sol}).`]
      : ['caution', 'Thermal', `Down to ${lo.toFixed(0)} °C. Check suit heater margins (REMS, sol ${wx.sol}).`]);
  }

  items.push(t0 >= DAY_START_H && t1 <= DAY_END_H
    ? ['go', 'Daylight', `Outside ${fmtClock(t0)} to ${fmtClock(t1)}, inside the ${DAY_START_H}:00 to ${DAY_END_H}:00 window.`]
    : ['caution', 'Daylight', `Outside ${fmtClock(t0)} to ${fmtClock(t1)}. Before ${DAY_START_H}:00 or after ${DAY_END_H}:00 it gets much colder.`]);

  const dose = config.radiation_mSv_per_day * totalH / config.sol_hours;
  items.push(['go', 'Radiation', `${dose.toFixed(3)} mSv, ${(100 * totalH / config.sol_hours).toFixed(0)}% of a full sol on the surface (Curiosity RAD).`]);
  return items;
}

export function renderSummary() {
  const { plan, points, config } = state;
  const box = $('verdictBox');
  const r = plan?.chosen;
  ['statsBox', 'compareBox', 'elevBox'].forEach((id) => { $(id).hidden = !r; });
  $('player').hidden = !r;
  $('btnPOV').disabled = !r;
  // map legend for the comparison route (drawn only when it differs from yours)
  const ghostShown = !!(r && plan.ghost && plan.ghost.path.join() !== r.path.join());
  $('legendRoute').hidden = !r;
  $('legendGhost').parentElement.hidden = !ghostShown;
  if (ghostShown) $('legendGhost').textContent = priorityName(plan.ghostPriority).toLowerCase();
  $('btnPOV').title = r ? 'Walk the route at eye level' : 'Plan a route first';
  if (!r) leavePov();   // no route to stand on: back to the map or 3D view you came from
  box.className = 'verdict-box';
  if (!r) {
    $('verdict').textContent = 'Standby';
    $('verdictWhy').textContent = points.length >= 2
      ? 'No safe route reaches every target. Move the target that sits among cliffs or slopes over 25°.'
      : points.length
        ? 'Add at least one science target. Each system below will give its call.'
        : 'Place a start and at least one science target. Each system below will give its call.';
    $('poll').innerHTML = '';
    drawTempChart();
    return;
  }

  // Go / no-go
  const items = poll(r);
  const nogo = items.filter((i) => i[0] === 'nogo').length;
  const cautions = items.filter((i) => i[0] === 'caution').length;
  box.classList.add(nogo ? 'nogo' : cautions ? 'caution' : 'go');
  $('verdict').textContent = nogo ? 'No-go' : 'Go';
  $('verdictWhy').textContent = nogo
    ? `${items.find((i) => i[0] === 'nogo')[1]} says no-go. Change the plan before stepping outside.`
    : cautions ? `Go for the walk, with ${cautions} caution${cautions > 1 ? 's' : ''} to brief.` : 'All systems are go for the walk.';
  const callWord = { go: 'Go', caution: 'Caution', nogo: 'No-go' };
  $('poll').innerHTML = items.map(([lvl, sys, detail]) =>
    `<li class="${lvl}"><span class="sys">${sys}</span><span class="call">${callWord[lvl]}</span><small>${detail}</small></li>`).join('');

  // Stats
  const s = r.stats, totalH = totalHours(r);
  $('sDist').textContent = fmtDist(s.total);
  $('sTime').textContent = fmtH(totalH);
  $('sUp').textContent = `${Math.round(s.up)} m`;
  $('sDown').textContent = `${Math.round(s.down)} m`;
  $('sRad').textContent = `${(config.radiation_mSv_per_day * totalH / config.sol_hours).toFixed(3)} mSv`;
  $('sEnd').textContent = fmtClock(startHour() + totalH);
  $('sOrder').innerHTML = r.legs.map((l) =>
    `<li><i style="background:${l.color}"></i>${pointName(l.fromPoint)} to ${pointName(l.toPoint).toLowerCase()}` +
    `<span>${fmtDist(s.dist[l.to] - s.dist[l.from])}</span></li>`).join('');

  // Comparison with the other end of the slider
  const g = plan.ghost;
  $('compareBox').hidden = !g;
  if (g) {
    const gName = priorityName(plan.ghostPriority);
    $('ghostName').textContent = gName.toLowerCase();
    $('cHeadA').textContent = `Yours (${priorityName(r.priority).toLowerCase()})`;
    $('cHeadB').textContent = gName;
    const rows = [
      ['Time outside', totalH, totalHours(g), fmtH, 'low'],
      ['Distance', s.total, g.stats.total, fmtDist, 'low'],
      ['Climb', s.up, g.stats.up, (v) => `${Math.round(v)} m`, 'low'],
      ['Steepest section', s.maxGradeDeg, g.stats.maxGradeDeg, (v) => `${v.toFixed(0)}°`, 'low'],
      ['Rough ground', s.roughPct, g.stats.roughPct, (v) => `${v.toFixed(0)}%`, 'low'],
    ];
    $('compareBody').innerHTML = rows.map(([name, a, b, f]) => {
      const fa = f(a), fb = f(b);
      const ca = fa !== fb && a < b ? 'better' : '', cb = fa !== fb && b < a ? 'better' : '';
      return `<tr><td>${name}</td><td class="${ca}">${fa}</td><td class="${cb}">${fb}</td></tr>`;
    }).join('');
  }

  drawElevChart(r);
  drawTempChart();
}
